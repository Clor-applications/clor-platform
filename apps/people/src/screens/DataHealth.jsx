import React from 'react';

import SharedDataHealth from '@ui/personnel/DataHealth';

/* People's Data Health: only Employees opens in place; other fixes open in Attendance or Payroll. */
export const DataHealth = (props) => <SharedDataHealth {...props} app="people" localScreens={['employees']} />;
