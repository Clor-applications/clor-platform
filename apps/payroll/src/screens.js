import React from 'react';
import OpenInCompanyAdmin from '@ui/company/OpenInCompanyAdmin';
/**
 * Every screen Payroll shows, in one place, so the manifest can load
 * them as one file the first time the app opens (WX-03). The manifest names
 * them; nothing else should import from here.
 */
export { default as PayrollOverview } from './screens/PayrollOverview';
export { default as PayRuns } from './screens/PayRuns';
export { default as SalarySlips } from './screens/SalarySlips';
export { default as PayrollPayments } from './screens/PayrollPayments';
export { default as PayrollAdjustments } from './screens/PayrollAdjustments';
export { default as SalaryStructures } from './screens/SalaryStructures';
export { default as SalaryAssignments } from './screens/SalaryAssignments';
export { default as SalaryRevisions } from './screens/SalaryRevisions';
export { default as PayrollLoans } from './screens/PayrollLoans';
export { default as PayrollCompliance } from './screens/PayrollCompliance';
export { default as PayrollReports } from './screens/PayrollReports';
export { default as PayrollLedgerMapping } from './screens/PayrollLedgerMapping';
export { default as SalaryComponents } from './screens/SalaryComponents';
export { default as PayGroups } from './screens/PayGroups';
export { default as PayrollPeriods } from './screens/PayrollPeriods';
export { default as PayrollSetup } from './screens/PayrollSetup';
export { default as BankChanges } from './screens/BankChanges';
export { default as FinalSettlements } from './screens/FinalSettlements';
export { default as TaxDeclarations } from './screens/TaxDeclarations';

/* This app's roles and permissions, in Company admin's one role editor, opened on Payroll's share (ADR-010). */
export const RolesAccess = () => React.createElement(OpenInCompanyAdmin, { title: 'Roles & Access', screen: 'permissions', forApp: 'payroll' });
