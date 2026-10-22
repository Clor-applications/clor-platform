import React from 'react';

import SharedEmployees from '@ui/personnel/Employees';

/* People says what the list is for; Attendance keeps its header as it is. */
export const Employees = (props) => <SharedEmployees {...props} description="Everyone in the company, past and present. Open a person to see their work, pay and history." />;
