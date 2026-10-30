/**
 * Built-in holiday calendars to import (time depth, gap 17): a national list
 * and each state's own days, applied to everyone or to one branch.
 *
 * Only what was checked against a published source is here, and each list
 * says where it came from. Checked on 30 Oct 2026:
 *
 * - National 2027: the Department of Personnel and Training's Office
 *   Memorandum F. No. 12/2/2023-JCA of 16 July 2026, Annexure I — the 17
 *   gazetted holidays for central government offices in Delhi / New Delhi
 *   (as reproduced by staffnews.in and gconnect.in; the two agree). Eid,
 *   Muharram and Milad-un-Nabi follow the moon and may move at short notice.
 * - States 2027: no state had published its 2027 list yet (Karnataka's and
 *   Maharashtra's come out in November–December). Only a state's own day that
 *   falls on the same date every year and is on its list every year is here;
 *   the rest of a state's list is imported from the notification with
 *   Holidays → Import once the state publishes it.
 *
 * A company is not bound to the central government's list: these are a
 * starting point HR edits, never a rule.
 */

export type CalendarHoliday = { date: string; name: string; moon?: boolean };
export type HolidayCalendar = { key: string; name: string; state: string | null; year: number; source: string; complete: boolean; note: string | null; holidays: CalendarHoliday[] };

const NATIONAL_2027: HolidayCalendar = {
  key: 'IN-2027',
  name: 'National (central government) 2027',
  state: null,
  year: 2027,
  source: 'DoPT Office Memorandum F. No. 12/2/2023-JCA, 16 July 2026, Annexure I (gazetted holidays)',
  complete: true,
  note: 'Eid, Muharram and Milad-un-Nabi follow the moon and may move. Five fall on a Saturday or Sunday; no other day is given for them.',
  holidays: [
    { date: '2027-01-26', name: 'Republic Day' },
    { date: '2027-03-10', name: 'Id-ul-Fitr', moon: true },
    { date: '2027-03-23', name: 'Holi' },
    { date: '2027-03-26', name: 'Good Friday' },
    { date: '2027-04-15', name: 'Ram Navami' },
    { date: '2027-04-19', name: 'Mahavir Jayanti' },
    { date: '2027-05-17', name: 'Id-ul-Zuha (Bakrid)', moon: true },
    { date: '2027-05-20', name: 'Buddha Purnima' },
    { date: '2027-06-16', name: 'Muharram', moon: true },
    { date: '2027-08-15', name: 'Independence Day' },
    { date: '2027-08-15', name: 'Milad-un-Nabi', moon: true },
    { date: '2027-08-25', name: 'Janmashtami' },
    { date: '2027-10-02', name: 'Mahatma Gandhi Jayanti' },
    { date: '2027-10-09', name: 'Dussehra' },
    { date: '2027-10-29', name: 'Diwali (Deepavali)' },
    { date: '2027-11-14', name: "Guru Nanak's Birthday" },
    { date: '2027-12-25', name: 'Christmas Day' },
  ],
};

const STATE_NOTE = 'The state has not published its 2027 list yet. Import the rest from its notification when it does.';
const stateDay = (state: string, date: string, name: string, source: string): HolidayCalendar => ({
  key: `${state.toUpperCase().replace(/[^A-Z]+/g, '-')}-2027`,
  name: `${state} 2027 (state's own day)`,
  state,
  year: 2027,
  source,
  complete: false,
  note: STATE_NOTE,
  holidays: [{ date, name }],
});

const STATES_2027: HolidayCalendar[] = [
  stateDay('Karnataka', '2027-11-01', 'Kannada Rajyotsava', "On the Karnataka government's general holiday list every year, on 1 November"),
  stateDay('Maharashtra', '2027-05-01', 'Maharashtra Din', "On the Maharashtra government's public holiday list every year, on 1 May"),
  stateDay('Telangana', '2027-06-02', 'Telangana Formation Day', "On the Telangana government's general holiday list every year, on 2 June"),
];

const ALL = [NATIONAL_2027, ...STATES_2027];

/** The calendars there are for a year, without their days (the picker's list). */
export function calendarsFor(year: number) {
  return ALL.filter((c) => c.year === year).map(({ holidays, ...c }) => ({ ...c, days: holidays.length }));
}

export function calendarOf(key: string) {
  return ALL.find((c) => c.key === key) || null;
}

/** Years that have at least one calendar: the screen offers import only there. */
export const CALENDAR_YEARS = [...new Set(ALL.map((c) => c.year))];
