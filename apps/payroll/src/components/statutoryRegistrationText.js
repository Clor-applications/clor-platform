/* The words and checks of the statutory registrations step (StatutoryRegistrationsStep.jsx), kept apart so the component file exports components only. */

/* The same shapes the server checks (statutoryRegistrations.ts), so the field says so before the round trip. */
export const TAN_RE = /^[A-Z]{4}\d{5}[A-Z]$/;
export const PF_CODE_RE = /^[A-Z]{5}\d{8,10}$/;
export const ESI_CODE_RE = /^\d{17}$/;
export const compact = (v) => String(v ?? "").toUpperCase().replace(/[\s/\-.]/g, "");

export const WHERE = {
  pf: "On the EPFO employer portal (unifiedportal-emp.epfindia.gov.in), at the top of the page after you sign in, and on your registration letter. Fifteen characters, such as KNBNG0012345000: the slashes can be left out.",
  esi: "On the ESIC employer portal (esic.gov.in) after you sign in, and on the registration letter (form C-11). Seventeen digits.",
  pt: "On the state's professional tax portal and on your registration certificate. In Maharashtra it is the PTRC number, in Karnataka the e-Prerana registration, elsewhere the certificate from the commercial taxes department.",
  tan: "On the TAN allotment letter from the Income Tax Department, or on TRACES (tdscpc.gov.in) after you sign in. Ten characters, such as BLRA12345B.",
  responsible: "Named on Form 24Q and on every Form 16: usually the owner, a director or whoever signs for the accounts.",
};

export const problemOf = (scheme, value) => {
  const v = compact(value);
  if (!v) return "";
  if (scheme === "tds") return TAN_RE.test(v) ? "" : "Four letters, five numbers and a letter, such as BLRA12345B.";
  if (scheme === "pf") return PF_CODE_RE.test(v) ? "" : "Five letters followed by the numbers, such as KNBNG0012345000.";
  if (scheme === "esi") return ESI_CODE_RE.test(v) ? "" : "Seventeen digits.";
  return v.length <= 30 ? "" : "At most 30 characters.";
};
