import React from 'react';

import AutomationsList from '@ui/automations/AutomationsList';
import { emoji } from '@ui/components/ui/emoji';
import { PageHead } from './wsKit';
import './workspace.css';

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
        <div className="ws-autos">
          <AutomationsList module="workspace" bare openScreen={openScreen} readOnlyNote="Whoever may change the company profile changes these." />
        </div>
      </div>
    </div>
  );
}
