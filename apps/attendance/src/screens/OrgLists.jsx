import React from 'react';

import { Areas as SharedAreas, JobPositions as SharedJobPositions } from '@ui/personnel/StructureList';
import SharedDataHealth from '@ui/personnel/DataHealth';

/*
 * Attendance's names for two lists it shares with People (AT-03): the menu says
 * Designations and Locations & Sites, so the page does too. People keeps
 * "Job positions" and "Areas".
 */
export const JobPositions = (props) => <SharedJobPositions {...props} title="Designations" singular="designation" />;
/* Data health: the implementation auditor; its fix links open Attendance screens in place. */
export const DataHealth = (props) => <SharedDataHealth {...props} app="attendance" />;
export const Areas = (props) => <SharedAreas {...props} title="Locations & sites" singular="location" />;
