import React from 'react';

import AutomationsList from '@ui/automations/AutomationsList';
import { emoji } from '@ui/components/ui/emoji';
import { ArrowRight } from '@ui/components/ui/lineIcons';
import { PageHead } from './wsKit';
import './workspace.css';
import './ws-security.css';

/* This page's colour icon, the one its menu item wears. */
const PAGE_ICON = emoji('robot');

/**
 * Workspace → Company → Automations: what Workspace sends on its own for this company, as plain sentences
 * with a switch and one number (the shared list, packages/ui/src/automations; the recipes are in the
 * server's services/workspace/automations.ts). Seen with Company profile VIEW, changed with its EDIT:
 * the server decides, and the list shows itself read only to whoever may not change it.
 */
export default function Automations({ openScreen }) {
  return (
    <div className="ws">
      <div className="ws-inner">
        <PageHead crumbs={['Apps', 'Automations']} icon={PAGE_ICON} title="Automations" description="Reminders Workspace sends for this company. Each starts off; switch on the ones you want." />
        {/* The shared list, dressed for the Workspace: each group one sheet, the page's full width (workspace.css, .ws-autos). */}
        {/* The list and, at its right, how these work (owner, 19 Nov 2026: use the right side as the other pages do). */}
        <div className="ws-activity-layout">
          <div className="ws-activity-main ws-autos">
            <AutomationsList module="workspace" bare openScreen={openScreen} readOnlyNote="Whoever may change the company profile changes these." />
          </div>
          <aside className="ws-activity-side" aria-label="About automations">
            <section className="ws-activity-box">
              <p className="ws-activity-box-title">How these work</p>
              <p className="ws-side-note">Each one starts off. Switch it on and it runs at the time shown under it, telling the people it names.</p>
            </section>
            <section className="ws-activity-box">
              <p className="ws-activity-box-title">Change the number</p>
              <p className="ws-side-note">The number in each sentence is how many days it waits. It saves as soon as you leave the box.</p>
            </section>
            {openScreen ? (
              <section className="ws-activity-box">
                <p className="ws-activity-box-title">Emails</p>
                <p className="ws-side-note">Which emails CLOR sends for each app is set separately.</p>
                <button type="button" className="ws-row-link" onClick={() => openScreen('notifications')}>
                  Email notifications <ArrowRight size={14} aria-hidden="true" />
                </button>
              </section>
            ) : null}
          </aside>
        </div>
      </div>
    </div>
  );
}
