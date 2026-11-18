import { useState } from 'react';
import Drawer from '@ui/components/ui/Drawer';
import { GUIDES } from './helpGuides';

/**
 * Round 61 "pagehelp" A: a "How this works" link at the top right of a screen that has a
 * how-to article, opening a short side panel for this screen only. The article is the
 * same one the Help centre shows, so there is one text to keep right.
 */
export function guideForScreen(appId, screen, guides = GUIDES) {
  if (!appId || !screen) return null;
  const hit = (o) => o && o.app === appId && o.screen === screen;
  return guides.find((g) => hit(g.open)) || guides.find((g) => hit(g.alt)) || null;
}

export default function ScreenHelp({ appId, screen, onOpenHelpCentre }) {
  const [open, setOpen] = useState(false);
  const guide = guideForScreen(appId, screen);
  if (!guide) return null;
  return (
    <>
      <button type="button" className="ui-link ui-screen-help text-sm" onClick={() => setOpen(true)}>How this works ›</button>
      <Drawer open={open} onClose={() => setOpen(false)} title={guide.title} description={guide.summary}>
        <div className="space-y-5">
          {guide.sections.map((s) => (
            <section key={s.heading}>
              <h3 className="text-sm font-semibold">{s.heading}</h3>
              {s.steps ? (
                <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm">{s.steps.map((t) => <li key={t}>{t}</li>)}</ol>
              ) : null}
              {s.points ? (
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">{s.points.map((t) => <li key={t}>{t}</li>)}</ul>
              ) : null}
            </section>
          ))}
          {onOpenHelpCentre ? (
            <button type="button" className="ui-link text-sm" onClick={() => { setOpen(false); onOpenHelpCentre(guide.key); }}>Open in the Help centre</button>
          ) : null}
        </div>
      </Drawer>
    </>
  );
}
