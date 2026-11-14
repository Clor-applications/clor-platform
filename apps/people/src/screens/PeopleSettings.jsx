import React from 'react';

import SettingsHub from '@ui/settings/SettingsHub';
import { SETTINGS_GROUPS } from '../settingsGroups';

/* People → Settings: the groups the panel beside it lists too (src/settingsGroups.js). */
export const GROUPS = SETTINGS_GROUPS;

export default function PeopleSettings(props) {
  return <SettingsHub {...props} groups={GROUPS} description="Set up People for this company. Changes apply to everyone in it." />;
}
