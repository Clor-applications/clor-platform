import { Ajv, type ErrorObject, type ValidateFunction } from 'ajv';
import { NIC_INV01_SCHEMA_SOURCE } from './nicInv01Schema.source.js';

/**
 * Validates an INV-01 payload against NIC's own published schema.
 *
 * NIC's text needs mechanical repair before any JSON-schema validator will
 * read it. Every repair below is a fix to the notation, never to a rule: no
 * length, pattern, enum or required list is changed.
 */

const SCHEMA_WORDS = new Set(['$schema', 'Title', 'Description', 'required', 'type']);

const TYPES = new Set(['string', 'number', 'integer', 'object', 'array', 'boolean', 'null']);

const isSchemaObject = (v: unknown) =>
  Boolean(v) && typeof v === 'object' && !Array.isArray(v) && Object.keys(v as object).some((k) => k.trim() === 'type');

/** Field names an object (or array-of-object) schema declares. */
const declared = (schema: any): string[] => Object.keys((schema?.items ?? schema)?.properties || {});

/**
 * RefDtls lists `"required": ["InvNo", "InvDt"]` among its properties, where
 * no validator reads it. Those are PrecDocDtls's fields, so the list is put
 * back on the schema that declares them.
 */
function placeStrayRequired(properties: Record<string, any>) {
  const stray = properties.required;
  if (!Array.isArray(stray)) return properties;
  const { required: _drop, ...rest } = properties;
  const owner = Object.values(rest).find((s: any) => stray.every((f: string) => declared(s).includes(f)));
  if (owner) {
    const target = owner.items ?? owner;
    target.required = [...new Set([...(target.required || []), ...stray])];
  }
  return rest;
}

function repair(node: unknown): unknown {
  if (Array.isArray(node)) {
    // NIC writes an array field as a bare one-element list of its item schema.
    if (node.length === 1 && isSchemaObject(node[0])) {
      return { type: 'array', items: repair(node[0]) };
    }
    return node.map(repair);
  }
  if (!node || typeof node !== 'object') return node;
  const out: Record<string, unknown> = {};
  for (const [rawKey, value] of Object.entries(node as Record<string, unknown>)) {
    const key = rawKey.trim();
    if (key === 'type' && typeof value === 'string') {
      const t = value.trim().toLowerCase();
      out.type = TYPES.has(t) ? t : value;
    } else if (key === 'pattern' && typeof value === 'string') {
      // JavaScript has no inline (?i); the enum beside it already fixes the case.
      out.pattern = value.replace(/^\(\?i\)/, '');
    } else if (key === 'required' && Array.isArray(value)) {
      out.required = value.map((f) => String(f).trim());
    } else if (key === 'properties' || key === 'items' || key === 'enum') {
      out[key] =
        key === 'properties'
          ? placeStrayRequired(
              Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k.trim(), repair(v)]))
            )
          : repair(value);
    } else if (key === 'description' || key === 'Description' || key === 'Title') {
      out[key] = value;
    } else {
      out[key] = repair(value);
    }
  }
  return out;
}

/** NIC's published text, made into a draft-07 schema the validator accepts. */
export function nicInv01Schema(): Record<string, unknown> {
  const text = NIC_INV01_SCHEMA_SOURCE
    // literal tabs and line breaks inside description strings
    .replace(/[\t\r\n]+/g, ' ')
    // trailing commas
    .replace(/,(\s*[\]}])/g, '$1');
  const parsed = repair(JSON.parse(text)) as Record<string, unknown>;
  // The top-level fields sit beside "$schema" instead of under "properties".
  const properties: Record<string, unknown> = {};
  const root: Record<string, unknown> = {};
  for (const [rawKey, v] of Object.entries(parsed)) {
    const k = rawKey.trim();
    if (SCHEMA_WORDS.has(k)) root[k] = v;
    else properties[k] = v;
  }
  return { ...root, type: 'object', properties };
}

let compiled: ValidateFunction | null = null;
const validator = () => {
  if (!compiled) {
    // NIC's patterns are Java regexes (`[^\\"]`); without the u flag JavaScript reads them the same way.
    const ajv = new Ajv({ allErrors: true, strict: false, unicodeRegExp: false });
    const schema = nicInv01Schema();
    delete schema.$schema;
    compiled = ajv.compile(schema);
  }
  return compiled;
};

/** "/ItemList/0/HsnCd" → "ItemList[1].HsnCd" (lines counted from one, as on the invoice). */
const fieldOf = (e: ErrorObject) => {
  const parts = e.instancePath.split('/').filter(Boolean);
  if (e.keyword === 'required') parts.push(String((e.params as { missingProperty: string }).missingProperty));
  return parts.reduce((s, p) => (/^\d+$/.test(p) ? `${s}[${Number(p) + 1}]` : s ? `${s}.${p}` : p), '');
};

const messageOf = (e: ErrorObject) => {
  switch (e.keyword) {
    case 'required':
      return 'is required';
    case 'enum':
      return `must be one of ${(e.params as { allowedValues: unknown[] }).allowedValues.join(', ')}`;
    case 'pattern':
      return 'is not in the format NIC accepts';
    default:
      return e.message || 'is invalid';
  }
};

export type SchemaIssue = { field: string; message: string };

export function validateInv01(payload: unknown): SchemaIssue[] {
  const validate = validator();
  if (validate(payload)) return [];
  const seen = new Set<string>();
  const issues: SchemaIssue[] = [];
  for (const e of validate.errors || []) {
    const issue = { field: fieldOf(e), message: messageOf(e) };
    const key = `${issue.field}|${issue.message}`;
    if (!seen.has(key)) {
      seen.add(key);
      issues.push(issue);
    }
  }
  return issues;
}
