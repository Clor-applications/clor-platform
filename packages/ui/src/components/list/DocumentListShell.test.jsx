import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import DocumentListShell from './DocumentListShell';

const previousApp = document.documentElement.dataset.app;
afterEach(() => {
  if (previousApp === undefined) delete document.documentElement.dataset.app;
  else document.documentElement.dataset.app = previousApp;
});

it.each(['people', 'attendance'])('keeps operational details in the %s register header', (app) => {
  document.documentElement.dataset.app = app;
  render(<DocumentListShell title="Attendance register" introduction="One mark per person per day." description="November 2026" />);
  const heading = screen.getByRole('heading', { name: 'Attendance register' }).closest('.ui-page-heading');
  expect(within(heading).getByText(/November 2026/)).toBeVisible();
  expect(heading.textContent.includes('One mark per person per day.')).toBe(app === 'attendance');
});
