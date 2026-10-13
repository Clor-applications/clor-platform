/**
 * Where the ledger field finds the ledger form.
 *
 * The form lives in App.jsx and the field is used all over App.jsx, so the
 * field reached back for it with a lazy `import('../../App')`. That closed a
 * circle — App imports the field, the field imports App — and a circle means
 * neither can be rendered, tested or replaced without the whole of the other.
 * Lazily is not a way out of a cycle; it is a cycle that loads late.
 *
 * So the dependency is inverted. App hands its form over once, and the field
 * asks for whatever is there. Both now point at this file and neither points at
 * the other.
 *
 * It stays a registry rather than becoming a prop because the field is used in
 * a dozen places, several of them deep inside other forms, and threading a
 * component through a dozen call sites to avoid one module is a worse trade
 * than one small, named seam. The real fix is to lift the form out of App.jsx
 * into its own module, at which point this file has nothing to do and can go.
 */

/**
 * A slot, rather than a getter.
 *
 * The field renders whatever is in here as `<ledgerForms.ChartAccountForm />`.
 * Reading it through a call instead — `const Form = ledgerForm()` — is
 * indistinguishable, to the compiler, from defining a component during render,
 * and it says so. A property read is the same value and tells the truth: the
 * component is defined once, at module load, and only looked up here.
 *
 * Null is a real answer: a screen rendered outside the accounting app — a
 * test, a story — has no master form, and the field hides its create route
 * rather than failing.
 */
export const ledgerForms = { ChartAccountForm: null };

/** App.jsx calls this once, at module load. */
export function registerLedgerForm(component) {
  ledgerForms.ChartAccountForm = component || null;
}

