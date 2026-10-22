import React from 'react';

import { JobPositions as SharedJobPositions } from '@ui/personnel/StructureList';

/* One word across Clor: the menu says Designations here and in Attendance, so the page does too. */
export const JobPositions = (props) => <SharedJobPositions {...props} title="Designations" singular="designation" />;
