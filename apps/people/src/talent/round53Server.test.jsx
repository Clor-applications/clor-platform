import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { InterviewQuestionsDrawer, RatedAnswers, RatingRow, ScreeningAnswers } from './round53Server';
import { CompanyGoals, GoalMarks, GoalScore } from './round53Goals';

const api = vi.hoisted(() => ({
  getInterviewQuestions: vi.fn(), setInterviewQuestions: vi.fn(), listCompanyGoals: vi.fn(), createCompanyGoal: vi.fn(), updateCompanyGoal: vi.fn(),
}));
const ui = vi.hoisted(() => ({ confirmDialog: vi.fn(), notify: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('../api/talent', () => api);
vi.mock('@ui/components/ui/notify', () => ui);
vi.mock('@ui/components/ui/Drawer', () => ({ default: ({ title, children, footer }) => <div role="dialog" aria-label={title}>{children}{footer}</div> }));
vi.mock('./shared', () => ({
  SHEET: '', day: (d) => d,
  FormError: ({ error }) => (error ? <p role="alert">{error.message}</p> : null),
  Footer: ({ onSave, label }) => <button type="button" onClick={onSave}>{label}</button>,
}));
beforeEach(() => vi.clearAllMocks());

describe('interview questions, rated 1 to 5', () => {
  it('a rating row picks a number and says its word', () => {
    const onChange = vi.fn();
    const { rerender } = render(<RatingRow question="Communication" value={null} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText('4'));
    expect(onChange).toHaveBeenCalledWith(4);
    rerender(<RatingRow question="Communication" value={4} onChange={onChange} />);
    expect(screen.getByText('Good')).toBeTruthy();
  });
  it('reads ratings back, with a dash for one left out', () => {
    render(<RatedAnswers answers={[{ question: 'Communication', rating: 4 }, { question: 'Problem solving', rating: null }]} />);
    expect(screen.getByText('Communication').textContent).toBe('Communication 4');
    expect(screen.getByText('Problem solving').textContent).toBe('Problem solving —');
  });
  it('HR saves the list one a line', async () => {
    api.getInterviewQuestions.mockResolvedValue({ questions: ['Communication'], canEdit: true });
    api.setInterviewQuestions.mockResolvedValue(['Communication', 'Fits the team']);
    const onClose = vi.fn();
    render(<InterviewQuestionsDrawer onClose={onClose} />);
    const box = await screen.findByDisplayValue('Communication');
    fireEvent.change(box, { target: { value: 'Communication\n\n Fits the team ' } });
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(api.setInterviewQuestions).toHaveBeenCalledWith(['Communication', 'Fits the team']));
    expect(onClose).toHaveBeenCalled();
  });
});

describe('screening answers on the candidate', () => {
  it('lists each question with its answer, or says it was not answered', () => {
    render(<ScreeningAnswers answers={[{ question: 'Licence?', answer: 'Yes' }, { question: 'Notice period?', answer: null }]} />);
    expect(screen.getByText('Yes')).toBeTruthy();
    expect(screen.getByText('Not answered')).toBeTruthy();
  });
  it('shows nothing when the opening asked nothing', () => {
    const { container } = render(<ScreeningAnswers answers={[]} />);
    expect(container.textContent).toBe('');
  });
});

describe('goals: company goals, who sees it, the score', () => {
  it('company goals show progress from the linked goals; HR may add', () => {
    render(<CompanyGoals state={{ loaded: true, canEdit: true, reload: vi.fn(), goals: [{ id: 'g1', title: 'Grow revenue 20%', dueDate: '2027-03-31', linkedGoals: 2, progress: 45 }] }} />);
    expect(screen.getByText('Grow revenue 20%')).toBeTruthy();
    expect(screen.getByText('by 2027-03-31 · 2 goals linked, 45% on average')).toBeTruthy();
    fireEvent.click(screen.getByText('Add'));
    expect(screen.getByRole('dialog', { name: 'New company goal' })).toBeTruthy();
  });
  it('the strip hides for someone who cannot add when there are none', () => {
    const { container } = render(<CompanyGoals state={{ loaded: true, canEdit: false, reload: vi.fn(), goals: [] }} />);
    expect(container.textContent).toBe('');
  });
  it('marks a team goal, a private one and a teammate’s', () => {
    render(<GoalMarks goal={{ forTeam: true, visibility: 'PRIVATE', peer: true }} />);
    expect(screen.getByText('Team goal')).toBeTruthy();
    expect(screen.getByText('Only them and their manager')).toBeTruthy();
    expect(screen.getByText('Teammate')).toBeTruthy();
  });
  it('the goals’ score sits beside the rating as a suggestion', () => {
    render(<GoalScore score={{ score: 3.8, progress: 70, goals: 2, weighted: true }} />);
    expect(screen.getByLabelText('Score from goals').textContent).toBe('Goals say 3.8 (70% done across 2 goals, by weight)');
  });
});
