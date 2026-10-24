import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * The Accounting app's source as tests that read it expect to find it.
 *
 * Batch 10 split App.jsx into feature files (behaviour unchanged). A test that
 * reads App.jsx to check something is — or is not — written there must still
 * see the code that moved, or a "never does X" check would pass on a file that
 * no longer holds X. App.jsx comes first, so positions within it still work.
 */
export const SPLIT_FROM_APP = [
  'appShared.jsx',
  'features/expenses/ExpenseScreens.jsx',
  'features/masters/AccountingMasters.jsx',
  'features/reports/FinancialStatements.jsx',
  'features/gst/GstCompliance.jsx',
  'features/settings/AccountingSettingsView.jsx',
  'features/settings/TemplatePreview.jsx',
];

export function appSource(appPath) {
  const dir = dirname(appPath);
  return [appPath, ...SPLIT_FROM_APP.map((f) => join(dir, f))]
    .filter((p) => existsSync(p))
    .map((p) => readFileSync(p, 'utf8'))
    .join('\n');
}
