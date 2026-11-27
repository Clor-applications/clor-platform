import React from 'react';

import SettingsHub from '@ui/settings/SettingsHub';
import { SETTINGS_GROUPS } from '../settingsGroups';
import { SETTING_WORDS } from '../settingWords';

/* People → Settings: the groups the panel beside it lists too (src/settingsGroups.js). */
export const GROUPS = SETTINGS_GROUPS;

export default function PeopleSettings(props) {
  return <SettingsHub {...props} groups={GROUPS} words={SETTING_WORDS} description={null} showNotes={false} browseCategories />;
}
