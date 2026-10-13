/**
 * The formula a salary component may carry, and nothing else.
 *
 * Payroll formulas are written by whoever configures payroll, stored in the
 * database, and evaluated on the server for every employee in a run. That is
 * exactly the shape of an injection: `new Function` or `eval` here would let
 * anybody who can edit a salary component run arbitrary code inside the API
 * process, against a database holding everybody's pay. So there is no
 * JavaScript engine anywhere in this file — a formula is tokenised, parsed into
 * a tree of nodes this module understands, and walked. An expression that is
 * not in the grammar cannot be represented, let alone run.
 *
 * The grammar is deliberately small:
 *
 *   BASIC * 0.4
 *   GROSS - BASIC
 *   IF(GROSS > 50000, GROSS * 0.05, 0)
 *   MIN(BASIC * 0.12, 1800)
 *   ROUND(GROSS * 0.1)
 *
 * Numbers, the named variables below, `+ - * / ( )`, comparisons, and five
 * functions. No assignment, no property access, no loops, no calls to anything
 * that is not on the list.
 *
 * Validation happens before a component is saved, not during a payroll run: a
 * run of six hundred people must not stop halfway because the four hundredth
 * employee was the first to hit a bad expression.
 */

/** Everything a formula may refer to, with what it means. */
export const FORMULA_VARIABLES: { name: string; description: string }[] = [
  { name: 'BASIC', description: 'Basic pay for the period, after proration' },
  { name: 'GROSS', description: 'Total of every earning that counts towards gross' },
  { name: 'CTC', description: 'Annual cost to company from the salary assignment' },
  { name: 'MONTHLY_CTC', description: 'Annual CTC divided across the periods in a year' },
  { name: 'ANNUAL_CTC', description: 'Annual cost to company — the same figure as CTC' },
  { name: 'WORKING_DAYS', description: 'Days in the period the employee was expected to work' },
  { name: 'PAYABLE_DAYS', description: 'Days actually being paid for' },
  { name: 'LWP_DAYS', description: 'Days of leave without pay' },
  { name: 'VARIABLE_PAY', description: 'Variable pay entered for this period' },
  { name: 'OVERTIME', description: 'Overtime amount entered for this period' },
  { name: 'PF_WAGE', description: 'Wages that count towards provident fund' },
  { name: 'ESI_WAGE', description: 'Wages that count towards ESI' },
];

const VARIABLE_NAMES = new Set(FORMULA_VARIABLES.map((v) => v.name));

/**
 * A structure's own component codes are variables too.
 *
 * `HRA = BASIC * 0.4` is how salary is actually written down, and it only works
 * if the parser will accept BASIC as a name. So the caller passes the codes
 * that exist in the structure being evaluated, and anything outside that set is
 * still refused — a formula referring to a component this structure does not
 * have is a mistake worth catching at save time rather than a silent zero.
 */
const allowedNames = (extra?: Iterable<string>) => {
  if (!extra) return VARIABLE_NAMES;
  const set = new Set(VARIABLE_NAMES);
  for (const name of extra) {
    const clean = String(name || '').trim().toUpperCase();
    if (clean) set.add(clean);
  }
  return set;
};

/** The only functions a formula may call. */
const FUNCTIONS: Record<string, { arity: number; apply: (args: number[]) => number }> = {
  IF: { arity: 3, apply: ([cond, a, b]) => (cond ? a : b) },
  MIN: { arity: 2, apply: ([a, b]) => Math.min(a, b) },
  MAX: { arity: 2, apply: ([a, b]) => Math.max(a, b) },
  ROUND: { arity: 1, apply: ([a]) => Math.round(a) },
  FLOOR: { arity: 1, apply: ([a]) => Math.floor(a) },
  CEIL: { arity: 1, apply: ([a]) => Math.ceil(a) },
};

export class FormulaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FormulaError';
  }
}

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

type TokenType = 'NUMBER' | 'NAME' | 'OP' | 'LPAREN' | 'RPAREN' | 'COMMA' | 'END';
type Token = { type: TokenType; value: string; at: number };

const OPERATORS = ['<=', '>=', '==', '!=', '<', '>', '+', '-', '*', '/', '%'];

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i += 1;
      continue;
    }
    if (ch === '(') {
      tokens.push({ type: 'LPAREN', value: ch, at: i });
      i += 1;
      continue;
    }
    if (ch === ')') {
      tokens.push({ type: 'RPAREN', value: ch, at: i });
      i += 1;
      continue;
    }
    if (ch === ',') {
      tokens.push({ type: 'COMMA', value: ch, at: i });
      i += 1;
      continue;
    }
    const two = source.slice(i, i + 2);
    const op = OPERATORS.find((o) => (o.length === 2 ? o === two : o === ch));
    if (op) {
      tokens.push({ type: 'OP', value: op, at: i });
      i += op.length;
      continue;
    }
    if (ch >= '0' && ch <= '9') {
      let j = i;
      let dots = 0;
      while (j < source.length && ((source[j] >= '0' && source[j] <= '9') || source[j] === '.')) {
        if (source[j] === '.') dots += 1;
        j += 1;
      }
      const text = source.slice(i, j);
      if (dots > 1) throw new FormulaError(`"${text}" is not a number.`);
      tokens.push({ type: 'NUMBER', value: text, at: i });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i;
      while (j < source.length && /[A-Za-z0-9_]/.test(source[j])) j += 1;
      tokens.push({ type: 'NAME', value: source.slice(i, j).toUpperCase(), at: i });
      i = j;
      continue;
    }
    throw new FormulaError(`"${ch}" cannot be used in a formula.`);
  }
  tokens.push({ type: 'END', value: '', at: source.length });
  return tokens;
}

// ---------------------------------------------------------------------------
// Parsing — precedence climbing over a fixed grammar
// ---------------------------------------------------------------------------

type Node =
  | { kind: 'number'; value: number }
  | { kind: 'variable'; name: string }
  | { kind: 'binary'; op: string; left: Node; right: Node }
  | { kind: 'unary'; op: string; operand: Node }
  | { kind: 'call'; name: string; args: Node[] };

/** Lower binds looser. Comparisons sit below arithmetic, as they read. */
const PRECEDENCE: Record<string, number> = {
  '<': 1, '>': 1, '<=': 1, '>=': 1, '==': 1, '!=': 1,
  '+': 2, '-': 2,
  '*': 3, '/': 3, '%': 3,
};

class Parser {
  private pos = 0;
  private readonly used = new Set<string>();

  constructor(private readonly tokens: Token[], private readonly names: Set<string>) {}

  private peek(): Token {
    return this.tokens[this.pos];
  }

  private take(): Token {
    const t = this.tokens[this.pos];
    this.pos += 1;
    return t;
  }

  private expect(type: TokenType, what: string): Token {
    const t = this.peek();
    if (t.type !== type) throw new FormulaError(`Expected ${what}${t.type === 'END' ? ' but the formula ended' : ` but found "${t.value}"`}.`);
    return this.take();
  }

  parse(): { node: Node; variables: string[] } {
    const node = this.expression(0);
    const end = this.peek();
    if (end.type !== 'END') throw new FormulaError(`"${end.value}" is not expected here.`);
    return { node, variables: [...this.used] };
  }

  private expression(minPrecedence: number): Node {
    let left = this.unary();
    for (;;) {
      const t = this.peek();
      if (t.type !== 'OP') break;
      const precedence = PRECEDENCE[t.value];
      if (precedence === undefined || precedence < minPrecedence) break;
      this.take();
      const right = this.expression(precedence + 1);
      left = { kind: 'binary', op: t.value, left, right };
    }
    return left;
  }

  private unary(): Node {
    const t = this.peek();
    if (t.type === 'OP' && (t.value === '-' || t.value === '+')) {
      this.take();
      return { kind: 'unary', op: t.value, operand: this.unary() };
    }
    return this.primary();
  }

  private primary(): Node {
    const t = this.take();
    if (t.type === 'NUMBER') return { kind: 'number', value: Number(t.value) };
    if (t.type === 'LPAREN') {
      const inner = this.expression(0);
      this.expect('RPAREN', 'a closing bracket');
      return inner;
    }
    if (t.type === 'NAME') {
      if (this.peek().type === 'LPAREN') {
        const fn = FUNCTIONS[t.value];
        if (!fn) {
          throw new FormulaError(`There is no function called ${t.value}. Available: ${Object.keys(FUNCTIONS).join(', ')}.`);
        }
        this.take();
        const args: Node[] = [];
        if (this.peek().type !== 'RPAREN') {
          args.push(this.expression(0));
          while (this.peek().type === 'COMMA') {
            this.take();
            args.push(this.expression(0));
          }
        }
        this.expect('RPAREN', 'a closing bracket');
        if (args.length !== fn.arity) {
          throw new FormulaError(`${t.value} takes ${fn.arity} value${fn.arity === 1 ? '' : 's'}, not ${args.length}.`);
        }
        return { kind: 'call', name: t.value, args };
      }
      if (!this.names.has(t.value)) {
        throw new FormulaError(`${t.value} is not something this formula can use. Available: ${[...this.names].join(', ')}.`);
      }
      this.used.add(t.value);
      return { kind: 'variable', name: t.value };
    }
    if (t.type === 'END') throw new FormulaError('The formula is incomplete.');
    throw new FormulaError(`"${t.value}" is not expected here.`);
  }
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

function walk(node: Node, vars: Record<string, number>): number {
  switch (node.kind) {
    case 'number':
      return node.value;
    case 'variable': {
      const v = vars[node.name];
      /* An absent variable is zero, not NaN. A structure that mentions
         OVERTIME in a month nobody worked overtime should pay nothing, not
         produce a payslip full of "NaN". */
      return Number.isFinite(v) ? v : 0;
    }
    case 'unary': {
      const v = walk(node.operand, vars);
      return node.op === '-' ? -v : v;
    }
    case 'binary': {
      const a = walk(node.left, vars);
      const b = walk(node.right, vars);
      switch (node.op) {
        case '+': return a + b;
        case '-': return a - b;
        case '*': return a * b;
        /* Division by zero is a configuration mistake, and a payslip showing
           Infinity is worse than one that refuses to calculate. */
        case '/': if (b === 0) throw new FormulaError('This formula divides by zero.'); return a / b;
        case '%': if (b === 0) throw new FormulaError('This formula divides by zero.'); return a % b;
        case '<': return a < b ? 1 : 0;
        case '>': return a > b ? 1 : 0;
        case '<=': return a <= b ? 1 : 0;
        case '>=': return a >= b ? 1 : 0;
        case '==': return a === b ? 1 : 0;
        case '!=': return a !== b ? 1 : 0;
        default: throw new FormulaError(`"${node.op}" cannot be used in a formula.`);
      }
    }
    case 'call': {
      const fn = FUNCTIONS[node.name];
      return fn.apply(node.args.map((a) => walk(a, vars)));
    }
    default:
      throw new FormulaError('This formula cannot be read.');
  }
}

export type CompiledFormula = {
  source: string;
  variables: string[];
  evaluate: (vars: Record<string, number>) => number;
};

/**
 * Parse once, evaluate many times.
 *
 * A payroll run evaluates the same handful of formulas for every employee, so
 * the parse is done once per component and the tree is walked per person.
 */
export function compileFormula(source: string, extraVariables?: Iterable<string>): CompiledFormula {
  const text = String(source || '').trim();
  if (!text) throw new FormulaError('There is no formula here.');
  if (text.length > 500) throw new FormulaError('This formula is too long to be readable. Split it across components.');
  const { node, variables } = new Parser(tokenize(text), allowedNames(extraVariables)).parse();
  return {
    source: text,
    variables,
    evaluate: (vars) => {
      const result = walk(node, vars || {});
      if (!Number.isFinite(result)) throw new FormulaError('This formula did not produce a number.');
      return result;
    },
  };
}

export type FormulaVerdict =
  | { ok: true; variables: string[]; sample?: number }
  | { ok: false; error: string };

/**
 * Whether a formula can be saved, and what it refers to.
 *
 * Checked with a sample set of values as well as parsed, because an expression
 * can be perfectly well formed and still be unable to produce a number —
 * dividing by a variable that is zero for everybody, most often.
 */
export function validateFormula(
  source: string,
  sample?: Record<string, number>,
  extraVariables?: Iterable<string>
): FormulaVerdict {
  try {
    const compiled = compileFormula(source, extraVariables);
    const values = sample || {
      BASIC: 40000, GROSS: 80000, CTC: 1200000, MONTHLY_CTC: 100000, ANNUAL_CTC: 1200000,
      WORKING_DAYS: 30, PAYABLE_DAYS: 30, LWP_DAYS: 0, VARIABLE_PAY: 0, OVERTIME: 0,
      PF_WAGE: 15000, ESI_WAGE: 21000,
    };
    return { ok: true, variables: compiled.variables, sample: compiled.evaluate(values) };
  } catch (e) {
    return { ok: false, error: e instanceof FormulaError ? e.message : 'This formula cannot be read.' };
  }
}

/** One-shot evaluation, for callers that do not hold on to the compiled form. */
export function evaluateFormula(
  source: string,
  vars: Record<string, number>,
  extraVariables?: Iterable<string>
): number {
  return compileFormula(source, extraVariables).evaluate(vars);
}
