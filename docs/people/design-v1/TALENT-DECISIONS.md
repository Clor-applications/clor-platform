# Talent: what we build, what we leave out, and why

Owner, 28 Oct 2026: "build talent completely". Talent is the rail module the owner approved on
28 Oct (`people-nav` decision): **Hiring** (job openings, candidates) and **Growth** (goals and
reviews, training). Until now all four were the generic register (`PeopleRecord` rows with a
free-form `details` blob): a job had a department typed as text, a candidate had six statuses
and a notes box, a goal was a percentage, a training was one row per person.

No research pack was sent for Talent, so the scope comes from the PRD (§7.16, P1) and the
same filter as every other module: **a 1–50 person Indian business, the owner doing HR with one
sign-in, a manager or two, hiring a few people a year and reviewing them once or twice a year.**

The question the module answers: **who are we hiring and where are they, how is each person
doing against what was agreed, and who is trained for what, and until when.**

## Hiring

| Built | Why |
|---|---|
| **Job openings** with department, designation, branch and employment type picked from the company's lists, number of places, hiring manager, target date, status Draft → Open → On hold → Filled / Closed | The hire then lands in the right department, designation, branch and manager without retyping |
| **A manager asks, HR opens.** Someone with Recruitment create but not edit (a manager) saves an opening as a request; someone who may edit opens it. The person who asked never opens their own request (unless nobody else could) | PRD "opening request", without a second approval system for a company this size |
| **Candidates** on one pipeline: Applied → Screening → Interview → Offer → Hired, or Rejected / Withdrew with a reason. Source (referral, job portal, walk-in, agency, website, apply link). Résumé file (PDF or Word, up to 5 MB). Every move, note, interview and offer on one timeline | Owners lose candidates in WhatsApp and e-mail; one list with one stage each is the fix |
| **Board and list.** The board shows the stages side by side; a card moves with its menu (keyboard and phone safe, no drag) | PRD screen "Board + list" |
| **Interviews**: date and time, how (in person, phone, video), where or the link, interviewers (company users). Each interviewer gives a recommendation (strong yes … strong no) and notes. **An interviewer sees others' feedback only after giving their own** | Independent opinions; the first loud voice does not decide |
| **Interviewers without Recruitment rights** see only the interviews they are on, the candidate's name, opening and résumé, and give feedback | A manager interviews without seeing every applicant's details |
| **Offer** from the existing offer letter (CTC annexure, accept link); accepting moves the candidate to Offer accepted | Reuses `services/people/offers.ts` |
| **Hire** makes the employee record with the opening's department, designation, branch, type and manager and the offer's joining date, and starts the joining plan. When an opening's places are all filled it is marked Filled | "Candidate to joiner" in one step, no retyping |
| **Apply link** per opening (off by default): a public page with name, e-mail, phone, a link to a résumé and a note; rate-limited, a hidden trap field for bots, no file upload from strangers | A small business shares a job on WhatsApp; applications land as Applied with source "Apply link" |
| **Candidate data is not kept for ever.** A candidate rejected or withdrawn more than 12 months ago is anonymised by a nightly job (name, contact, résumé, notes) | DPDP: personal data only as long as needed |
| **No automatic rejection or scoring** | PRD §2 rule 1: a person decides |

## Growth

| Built | Why |
|---|---|
| **Goals**: for a person, what and how it is measured, due date, weight; set by HR, the manager or the person. **Check-ins** record progress, on track / at risk / behind, and a note; the goal keeps its history | PRD "goals with check-ins"; one percentage with no history explained nothing |
| **Review cycles**: a name, the period, who is in (everyone working, or some departments), the self-review and manager-review dates. Opening a cycle makes one review per person with their manager at that moment. Self rating and comments, manager rating and comments (1–5 with plain words), the person's goals in the period shown beside it | PRD "review cycle with self and manager rating" |
| **Calibration**: HR sees every rating by department and manager, the spread, and sets the final rating with a reason where it differs; then **shares** the reviews and each person reads theirs in the employee app and acknowledges | PRD "calibration view", without forced ranking |
| **Improvement plans**: person, why, what is expected, from–to, check-in notes, outcome (completed, extended with a new end date, not met). Seen by HR and the person's manager only; the person sees their own plan. **No automatic action on "not met"** | PRD "improvement plan"; adverse outcomes stay a human decision through the existing leaving steps |
| **One-on-ones**: a manager's notes and agreed actions with each report, seen only by those two | PRD "1:1 notes"; private by design, not even HR |
| **Nobody reviews or rates themselves as manager, sets their own final rating, or puts themselves on a plan** | Same rule as every module |

## Training

| Built | Why |
|---|---|
| **Trainings**: title, provider, internal / external / online, dates, hours, mandatory or not, how long the certificate is good for | One training, many people, instead of one row per person |
| **Attendees**: assigned, completed (date), missed; a certificate file; the expiry date worked out from the validity | PRD "training records, certificate renewals" |
| **Renewals**: certificates expiring in 60, 30 and 0 days put a notice on HR's bell and the person's (once per stage) and show under **Expiring** | Fire safety, forklift, first aid: lapses cost inspections |
| **Employee app**: my trainings and certificate dates | Staff are asked for them |

## Moving the old registers

The migration copies every `recruitment`, `candidates`, `performance` and `learning` register row
into the new tables **with the same id**, so offers already sent to a candidate, links and
history keep working. Old statuses map: Shortlisted → Screening, Offered → Offer; a learning
row becomes a training with its one person as attendee. The register screens for these four kinds
are retired; the other registers (announcements, events, assets, benefits) are unchanged.

## Left out, and why

| Left out | Why |
|---|---|
| Skills catalogue with levels and assessors | A module of its own (PRD "Skills and training"); certificates cover the compliance need now |
| Job board posting (Naukri, LinkedIn), careers website | Paid integrations; the apply link is the small-business answer |
| Résumé parsing, AI matching or scoring | PRD: no automated decisions about people |
| Offer approval chains, salary bands | Pay reviews is its own P1 module; the offer letter already shows the CTC |
| 360° feedback from peers, OKR trees, continuous kudos | Not needed at 1–50 people; review + goals + 1:1 cover it |
| Course content / LMS | Training records, not a learning platform |
| Interview calendar sync (Google/Outlook) | Needs OAuth per user; the interview has a date, time and link |
