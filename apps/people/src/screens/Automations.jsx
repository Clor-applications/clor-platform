import React, { useMemo } from 'react';

import AutomationsList from '@ui/automations/AutomationsList';

import { getAutomationHistory, getAutomations, saveAutomations } from '../api/engagement';

/**
 * Settings → Automations (WORKFLOW-GAP-RESEARCH-2026-10-30 4.7; automations plan B1): People's recipes on
 * the shared list (packages/ui/src/automations). What already ran before this screen starts on; everything
 * new starts off. Two attendance reminders have their own settings and link there.
 */
export default function Automations({ openScreen }) {
  const api = useMemo(() => ({ load: getAutomations, save: saveAutomations, history: getAutomationHistory }), []);
  return <AutomationsList module="people" api={api} openScreen={openScreen} readOnlyNote="HR changes these." />;
}
