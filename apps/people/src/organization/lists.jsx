import React from 'react';

import StructurePage from './StructurePage';

/* Each Organization list is the one StructurePage with its kind (the same layout, drawers and rules on every list). */
export const OrgDepartments = (props) => <StructurePage kind="departments" {...props} />;
export const OrgDesignations = (props) => <StructurePage kind="job-positions" {...props} />;
export const OrgJobRoles = (props) => <StructurePage kind="job-roles" {...props} />;
export const OrgTeams = (props) => <StructurePage kind="teams" {...props} />;
export const OrgPositions = (props) => <StructurePage kind="seats" {...props} />;
export const OrgLocations = (props) => <StructurePage kind="areas" {...props} />;
export const OrgWorkSites = (props) => <StructurePage kind="establishments" {...props} />;
export const OrgBusinessUnits = (props) => <StructurePage kind="business-units" {...props} />;
export const OrgGrades = (props) => <StructurePage kind="grades" {...props} />;
export const OrgCostCentres = (props) => <StructurePage kind="cost-centres" {...props} />;
