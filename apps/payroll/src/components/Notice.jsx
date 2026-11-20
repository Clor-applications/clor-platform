import React from "react";
import { AlertTriangle, Check, Info } from "@ui/components/ui/lineIcons";

/*
 * A note that needs reading, on the page's own white ground (DESIGN.md: never
 * a tinted panel). A hairline round it, and the state said by an icon and a
 * word in the status ink: "Check", "Problem", "Note". The text stays in the
 * body ink so it reads as easily as the rest of the page.
 *
 * `tone`: warn (needs a look), neg (stops something), info (worth knowing),
 * pos (done). `word` replaces the default word. `action` sits at the right.
 */

const TONES = {
  warn: { Icon: AlertTriangle, ink: "var(--warn-ink)", word: "Check" },
  neg: { Icon: AlertTriangle, ink: "var(--neg)", word: "Problem" },
  info: { Icon: Info, ink: "var(--fg-muted)", word: "Note" },
  pos: { Icon: Check, ink: "var(--pos)", word: "Done" },
};

export default function Notice({ tone = "warn", word, title, action = null, role = "status", className = "", children }) {
  const t = TONES[tone] || TONES.warn;
  const ink = { color: `rgb(${t.ink})` };
  return (
    <div
      role={role}
      className={`flex flex-wrap items-start justify-between gap-3 rounded-xl p-3 text-sm ${className}`}
      style={{ background: "rgb(var(--surface))", border: "1px solid rgb(var(--border))" }}
    >
      <div className="flex items-start gap-2 min-w-0 max-w-3xl">
        <t.Icon size={16} aria-hidden="true" className="mt-0.5 shrink-0" style={ink} />
        <div className="min-w-0">
          <span className="font-semibold" style={ink}>{word || t.word}</span>
          {title ? <span className="font-semibold"> · {title}</span> : null}
          {children ? <div>{children}</div> : null}
        </div>
      </div>
      {action}
    </div>
  );
}
