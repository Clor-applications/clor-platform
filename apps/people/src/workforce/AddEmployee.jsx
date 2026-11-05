import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Camera, Check } from '@ui/components/ui/lineIcons';

import { PageHeader, SkeletonCard } from '@ui/components/ui/Primitives';
import Alert from '@ui/components/ui/Alert';
import ErrorState from '@ui/components/ui/ErrorState';
import DatePicker, { formatDate } from '@ui/components/ui/DatePicker';
import PopupSelect from '@ui/components/pickers/PopupSelect';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import useUnsavedChanges from '@ui/components/ui/useUnsavedChanges';
import { usePermissions } from '@ui/permissions/usePermissions';
import { Avatar, DOC_KINDS, GENDER_WORDS, shrinkPhoto } from '@ui/personnel/Employees';
import { HOURS_WORDS, datesFor, kindOf, probationEndFor } from '@ui/personnel/employmentKinds';
import { hasApp } from '@platform/context';
import { clearUnsaved } from '@platform/unsaved';

import SuggestInput from '@ui/components/ui/SuggestInput';
import { refreshSuggestions, useEmailSuggestions, useSuggestions } from './suggestions';
import { assignSalary, createEmployee, deleteDraft, getDraft, listContractors, listEmployees, listPayStructures, listTags, nextEmployeeCode, saveDraft, structure, uploadEmployeeDocument } from './api';
import { listBranches } from '../organization/api';
import { can } from './shared';
import { todayIst } from '@ui/utils/dates';

/**
 * Workforce → Add employee (People design spec v1 §4.3 EMP-02; Workforce
 * package WF-05, WF-09, WF-11). Four steps: Personal, Employment,
 * Organization, Review. Labels above fields, two columns where fields relate,
 * one on a phone. Continue checks the step and puts the cursor on the first
 * problem; Back keeps everything typed. Enter in a field never creates the
 * employee. Save draft is a real, private, 30-day draft on the server
 * (statutory numbers are never kept in it). Create is sent once, with an
 * idempotency key, and the server checks everything again.
 */
const STEPS = [['personal', 'Personal'], ['employment', 'Employment'], ['organization', 'Organisation'], ['review', 'Review']];
/* The files a new joiner brings. A permit or certificate needs its expiry and a letter is issued later, so both stay on the record's Documents tab. */
const JOINING_DOCS = DOC_KINDS.filter(([k]) => !['WORK_PERMIT', 'CERTIFICATE', 'LETTER'].includes(k));
const DOC_MAX = 5 * 1024 * 1024;
const DOC_ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xlsx,.txt';
const kb = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const readFile = (file) => new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = () => reject(new Error('Could not read the file.')); r.readAsDataURL(file); });
/* A salary is optional here, but half of one is not: a structure needs its CTC and a CTC its structure. */
function checkSalary(s) {
  const e = {};
  const ctc = String(s.annualCtc).trim();
  if (s.structureId && !(Number(ctc) > 0)) e.annualCtc = 'Enter the yearly CTC, or clear the structure to set the salary later.';
  if (ctc && !(Number(ctc) > 0)) e.annualCtc = 'The yearly CTC is a number above 0.';
  if (ctc && !s.structureId) e.structureId = 'Choose the salary structure this CTC is paid on.';
  return e;
}
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BLANK = {
  firstName: '', lastName: '', preferredName: '', workEmail: '', workPhone: '', email: '', phone: '', dateOfBirth: '', gender: '', guardianName: '', photoUrl: '',
  emergencyContactName: '', emergencyContactRelation: '', emergencyContactPhone: '',
  code: '', employeeTypeId: '', workTypeId: '', jobRoleId: '', dateOfJoining: '', probationEndDate: '', contractEndDate: '', hours: 'FULL_TIME', status: 'ACTIVE',
  departmentId: '', jobPositionId: '', branchId: '', areaId: '', establishmentId: '', businessUnitId: '', teamId: '', seatId: '', reportingManagerId: '', dottedManagerId: '', costCenterId: '', gradeId: '', workLocation: '',
  tagIds: [], devicePin: '', cardNumber: '', contractorId: '', attendanceRequired: true,
};
/* Where each checked field is asked, and which show their message under the field. */
const FIELD_STEP = { structureId: 'salary', annualCtc: 'salary', firstName: 'personal', workEmail: 'personal', email: 'personal', phone: 'personal', dateOfBirth: 'personal', emergencyContactPhone: 'personal', code: 'employment', dateOfJoining: 'employment', probationEndDate: 'employment', contractEndDate: 'employment', seatId: 'organization' };
const SHOWN_INLINE = new Set(['annualCtc', 'firstName', 'workEmail', 'email', 'phone', 'dateOfBirth', 'emergencyContactPhone', 'code', 'dateOfJoining', 'probationEndDate', 'contractEndDate']);

const CODE_MISSING = 'Enter an employee ID.';

function check(step, f) {
  const e = {};
  if (step === 'personal') {
    if (!f.firstName.trim()) e.firstName = 'Enter the legal first name.';
    if (f.workEmail && !EMAIL.test(f.workEmail.trim())) e.workEmail = 'Enter a valid work email, like name@company.com.';
    if (f.email && !EMAIL.test(f.email.trim())) e.email = 'Enter a valid email.';
    if (f.phone && f.phone.replace(/\D/g, '').length < 10) e.phone = 'Enter at least 10 digits.';
    if (f.dateOfBirth && f.dateOfBirth > todayIst()) e.dateOfBirth = 'The date of birth cannot be in the future.';
    if (f.emergencyContactPhone && f.emergencyContactPhone.replace(/\D/g, '').length < 10) e.emergencyContactPhone = 'Enter at least 10 digits.';
  }
  if (step === 'employment') {
    if (!f.code.trim()) e.code = CODE_MISSING;
    if (!f.dateOfJoining) e.dateOfJoining = 'Enter the joining date.';
    if (f.probationEndDate && f.dateOfJoining && f.probationEndDate < f.dateOfJoining) e.probationEndDate = 'Probation cannot end before the joining date.';
    if (f.contractEndDate && f.dateOfJoining && f.contractEndDate < f.dateOfJoining) e.contractEndDate = 'The contract cannot end before the joining date.';
  }
  return e;
}

export default function AddEmployee({ params = {}, updateParams, openScreen }) {
  const perms = usePermissions();
  const [form, setForm] = useState(BLANK);
  const [saved, setSaved] = useState(BLANK);
  const [draftId, setDraftId] = useState(params.draft || null);
  const [loading, setLoading] = useState(Boolean(params.draft));
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState(null);
  const [duplicates, setDuplicates] = useState(null);
  const [duplicateReason, setDuplicateReason] = useState('');
  const [lists, setLists] = useState(null);
  /* Salary and Documents (owner's suite spec, 5–6 Nov 2026): each step shows only to someone who may do it, and is
     sent once the person exists. Neither goes into a draft: a salary is not left in a draft, and files are quick to choose again. */
  const salaryOn = hasApp('payroll') && can(perms, 'PAYROLL::Salary Assignments::CREATE') && can(perms, 'PAYROLL::Salary Structures::VIEW');
  const docsOn = can(perms, 'PEOPLE::Documents::CREATE');
  const steps = [...STEPS.slice(0, 3), ...(salaryOn ? [['salary', 'Salary']] : []), ...(docsOn ? [['documents', 'Documents']] : []), STEPS[3]];
  const [salary, setSalary] = useState({ structureId: '', annualCtc: '' });
  const [payStructures, setPayStructures] = useState(null);
  const [files, setFiles] = useState([]);
  const fileInput = useRef(null);
  useEffect(() => {
    if (salaryOn) listPayStructures().then(setPayStructures).catch(() => setPayStructures([]));
  }, [salaryOn]);
  /* The employment type decides which end dates are asked for (an intern has no probation, a permanent hire no contract end). */
  const dates = datesFor(kindOf(lists?.types, form.employeeTypeId));
  /* The type's probation length fills the end date once both are known, and follows a corrected joining date while it is still the date filled in; a date typed by hand is never replaced. */
  const probationMonths = (lists?.types || []).find((t) => t.id === form.employeeTypeId)?.probationMonths;
  const suggestedProbation = dates.probation ? probationEndFor(form.dateOfJoining, probationMonths) : '';
  const filledProbation = useRef('');
  useEffect(() => {
    if (!suggestedProbation) return;
    if (form.probationEndDate && form.probationEndDate !== filledProbation.current) return;
    filledProbation.current = suggestedProbation;
    if (form.probationEndDate !== suggestedProbation) setForm((f) => ({ ...f, probationEndDate: suggestedProbation }));
  }, [suggestedProbation]); // eslint-disable-line react-hooks/exhaustive-deps
  const [people, setPeople] = useState([]);
  const stepKey = steps.some(([k]) => k === params.step) ? params.step : 'personal';
  const stepIndex = steps.findIndex(([k]) => k === stepKey);
  const bodyRef = useRef(null);
  /* The suggested employee ID while it is on its way, and a Continue waiting for it (one at a time). */
  const suggestedCode = useRef(null);
  const continuing = useRef(false);
  /* What is on screen now, read after that wait: the person may have typed or moved meanwhile. */
  const latest = useRef({ form: BLANK, stepKey });
  /* A field to put the caret in once its step is drawn (a server answer about it, after Create). */
  const [focusField, setFocusField] = useState(null);
  useEffect(() => {
    const el = focusField && document.getElementById(focusField);
    if (!el) return;
    el.focus();
    setFocusField(null);
  }, [focusField, stepKey]);
  const dirty = JSON.stringify(form) !== JSON.stringify(saved);

  useEffect(() => {
    Promise.all([...['departments', 'job-positions', 'employee-types', 'work-types', 'areas', 'establishments', 'teams', 'cost-centres', 'grades', 'business-units', 'seats', 'job-roles'].map((k) => structure(k).catch(() => [])), hasApp('attendance') ? listContractors() : Promise.resolve([]), listTags().catch(() => []), listBranches().catch(() => [])])
      .then(([departments, positions, types, workTypes, areas, establishments, teams, centres, grades, units, seats, roles, contractors, tags, branchRows]) => setLists({ departments, positions, types, workTypes, areas, establishments, teams, centres, grades, units, seats, roles, contractors, tags , branches: branchRows.filter((b) => b.isActive !== false).map((b) => ({ id: b.id, name: b.branchName, isActive: true })) }));
    listEmployees({ limit: 500, sort: 'name' }).then((r) => setPeople((r?.employees || []).filter((e) => e.status !== 'LEFT'))).catch(() => {});
  }, []);
  /* A draft named in the address opens as it was left; otherwise the next ID is suggested. */
  useEffect(() => {
    let live = true;
    if (params.draft) {
      getDraft(params.draft).then((d) => { if (!live) return; const next = { ...BLANK, ...d.data }; setForm(next); setSaved(next); setDraftId(d.id); }).catch((e) => live && setFailure(e)).finally(() => live && setLoading(false));
    } else {
      /* The suggestion is not an edit: the baseline takes it too, so an untouched wizard leaves without a warning. */
      const pending = nextEmployeeCode().then((code) => {
        if (!live || !code) return null;
        setForm((f) => (f.code ? f : { ...f, code }));
        setSaved((f) => (f.code ? f : { ...f, code }));
        /* A Continue pressed before it came asked for an ID the field now holds: that message is out of date. */
        setErrors((e) => (e.code === CODE_MISSING ? (({ code: _gone, ...rest }) => rest)(e) : e));
        return code;
      }).catch(() => null).finally(() => { if (suggestedCode.current === pending) suggestedCode.current = null; });
      suggestedCode.current = pending;
    }
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useUnsavedChanges(dirty);

  const goStep = (k) => { updateParams?.({ step: k === 'personal' ? null : k }, { push: true }); bodyRef.current?.focus(); window.scrollTo(0, 0); };
  const emailHints = useEmailSuggestions(form.workEmail, form.firstName, form.lastName);
  const relationHints = useSuggestions('relation');
  const field = (k) => ({ value: form[k], onChange: (v) => { setForm((f) => ({ ...f, [k]: v })); if (errors[k]) setErrors((e) => { const n = { ...e }; delete n[k]; return n; }); } });
  latest.current = { form, stepKey };
  const next = async () => {
    if (continuing.current) return;
    let f = form;
    /* On a slow line the suggested employee ID can still be on its way when Continue is pressed on Employment:
       wait for it rather than ask for an ID that is about to appear (H1 on a phone, 31 Oct 2026). */
    if (stepKey === 'employment' && !f.code.trim() && suggestedCode.current) {
      continuing.current = true;
      try {
        const code = await suggestedCode.current;
        if (latest.current.stepKey !== stepKey) return;
        f = latest.current.form;
        if (!f.code.trim() && code) f = { ...f, code };
      } finally {
        continuing.current = false;
      }
    }
    const e = stepKey === 'salary' ? checkSalary(salary) : check(stepKey, f);
    setErrors(e);
    if (Object.keys(e).length) {
      setTimeout(() => bodyRef.current?.querySelector('[aria-invalid="true"]')?.focus(), 0);
      return;
    }
    goStep(steps[stepIndex + 1][0]);
  };
  const back = () => goStep(steps[stepIndex - 1][0]);
  const saveAsDraft = async () => {
    if (busy) return;
    setBusy(true);
    try {
      /* The photo is left out of a draft: it is the one large value, and is quick to choose again. */
      const { photoUrl: _photo, ...kept } = form;
      const d = await saveDraft(draftId, { step: stepIndex + 1, data: kept });
      setDraftId(d.id);
      setSaved(form);
      updateParams?.({ draft: d.id });
      notify.success('Draft saved. Only you can see it; it is kept for 30 days.');
    } catch (e) {
      notify.error(String(e?.message || 'Draft not saved. Your entries are still here.'));
    } finally {
      setBusy(false);
    }
  };
  const cancel = async () => {
    if (dirty && !(await confirmDialog({ title: 'Discard unsaved changes?', message: draftId ? 'The saved draft stays; only the changes since it are lost.' : 'Nothing has been saved.', confirmLabel: 'Discard' }))) return;
    setSaved(form);
    clearUnsaved();
    openScreen?.('employees');
  };
  const discardDraft = async () => {
    if (!(await confirmDialog({ title: 'Delete the saved draft?', confirmLabel: 'Delete draft' }))) return;
    try { await deleteDraft(draftId); setDraftId(null); updateParams?.({ draft: null }); notify.success('Draft deleted.'); } catch (e) { notify.error(String(e?.message || 'Not deleted.')); }
  };
  /* The salary starts on the joining date, or on the structure's own start if that is later (the server refuses earlier). */
  const chosenStructure = (payStructures || []).find((x) => x.id === salary.structureId);
  const salaryFrom = chosenStructure?.effectiveFrom && chosenStructure.effectiveFrom > form.dateOfJoining ? chosenStructure.effectiveFrom : form.dateOfJoining;
  /* The person exists by now: what fails here is said, and is added on their record, rather than undoing the person. */
  const afterCreate = async (id) => {
    const missed = [];
    if (salaryOn && salary.structureId && Number(salary.annualCtc) > 0) {
      try { await assignSalary({ employeeId: id, structureId: salary.structureId, effectiveFrom: salaryFrom, annualCtc: Number(salary.annualCtc) }); } catch (e) { missed.push(`Salary: ${e?.message || 'not saved'}.`); }
    }
    for (const d of docsOn ? files : []) {
      try {
        await uploadEmployeeDocument(id, { kind: d.kind, title: d.title.trim() || d.file.name.replace(/\.[^.]+$/, ''), data: await readFile(d.file), mime: d.file.type, classification: 'EMPLOYEE_VISIBLE' });
      } catch (e) {
        missed.push(`${d.file.name}: ${e?.message || 'not uploaded'}`);
      }
    }
    return missed;
  };
  const addFiles = (list) => {
    const chosen = [...(list || [])];
    const big = chosen.filter((x) => x.size > DOC_MAX);
    if (big.length) notify.error(`${big.map((x) => x.name).join(', ')}: files up to 5 MB.`);
    setFiles((now) => [...now, ...chosen.filter((x) => x.size <= DOC_MAX).map((file, i) => ({ key: `${Date.now()}-${i}-${file.name}`, file, kind: 'ID_PROOF', title: '' }))]);
    if (fileInput.current) fileInput.current.value = '';
  };
  const setFile = (key, patch) => setFiles((now) => now.map((d) => (d.key === key ? { ...d, ...patch } : d)));
  const create = async () => {
    for (const [k] of STEPS.slice(0, 3)) {
      const e = check(k, form);
      if (Object.keys(e).length) { setErrors(e); goStep(k); return; }
    }
    if (salaryOn) {
      const e = checkSalary(salary);
      if (Object.keys(e).length) { setErrors(e); goStep('salary'); return; }
    }
    if (busy) return;
    setBusy(true);
    setFailure(null);
    try {
      const body = Object.fromEntries(Object.entries(form).filter(([k, v]) => v !== '' && v !== null && !(k === 'tagIds' && !v.length) && !(k === 'attendanceRequired' && !hasApp('attendance')) && !(k === 'probationEndDate' && !dates.probation) && !(k === 'contractEndDate' && !dates.contract)));
      refreshSuggestions();
      const r = await createEmployee({ ...body, ...(duplicateReason ? { duplicateReason } : {}), ...(draftId ? { draftId } : {}) });
      setSaved(form);
      clearUnsaved();
      const missed = await afterCreate(r.employee.id);
      if (missed.length) notify.error(`${r.employee.name} added, but not all of it was saved. ${missed.join(' ')} Add it on their record.`);
      else notify.success(`${r.employee.name} added.`);
      openScreen?.('employee', { id: r.employee.id });
    } catch (e) {
      if (e?.status === 409 && e?.data?.code === 'DUPLICATE') setDuplicates(e.data.duplicates || []);
      else if (e?.status === 409) {
        /* A seat someone holds is on Organization; anything else taken (the employee ID) on Employment. Review lists it with a link there. */
        const k = /seat/i.test(e.message || '') ? 'seatId' : 'code';
        setErrors({ [k]: e.message || 'That employee ID is already used in this company.' });
      }
      else setFailure(e);
    } finally {
      setBusy(false);
    }
  };

  if (!can(perms, 'PEOPLE::Employees::CREATE')) return <ErrorState kind="forbidden" body="Adding employees needs the Employees create permission." />;
  if (loading || !lists) return <div className="space-y-4" aria-busy="true"><SkeletonCard lines={2} /><SkeletonCard lines={8} /></div>;

  const opts = (arr) => [{ value: '', label: 'Not set' }, ...arr.map((x) => ({ value: x.id, label: x.name }))];
  /* A list narrowed to what belongs under the choice above it; the current pick stays, so nothing is dropped silently. */
  const nameIn = (items, id) => items.find((x) => x.id === id)?.name;
  const within = (items, key, parent, current) => items.filter((x) => !parent || !x[key] || x[key] === parent || x.id === current);
  const errorList = Object.entries(errors).map(([k, message]) => ({ field: k, message }));
  /* One message the step cannot show by its field (a server answer on Review, a taken seat) still gets the summary. */
  const summarise = errorList.length > 1 || errorList.some((x) => !SHOWN_INLINE.has(x.field) || FIELD_STEP[x.field] !== stepKey);
  const showField = (k) => {
    if (FIELD_STEP[k] && FIELD_STEP[k] !== stepKey) goStep(FIELD_STEP[k]);
    setFocusField(k);
  };

  return (
    <div className="space-y-6 ui-wizard">
      <PageHeader breadcrumb={[{ label: 'People' }, { label: 'Employees', onClick: cancel }, { label: 'Add employee' }]} title="Add employee"
        actions={draftId ? <button type="button" className="ui-link text-sm" onClick={discardDraft}>Delete saved draft</button> : null} />
      <ol className="ui-stepper" aria-label="Steps">
        {steps.map(([k, label], i) => (
          <li key={k} className={`ui-step ${i === stepIndex ? 'is-current' : ''} ${i < stepIndex ? 'is-done' : ''}`} aria-current={i === stepIndex ? 'step' : undefined}>
            <span className="ui-step-mark" aria-hidden="true">{i < stepIndex ? <Check size={14} /> : i + 1}</span>
            <span className="ui-step-label">{label}</span>
          </li>
        ))}
      </ol>

      {/* noValidate: `check` asks for each field in plain words. The browser's own "fill in this field" stopped Continue
          before `next` ran, so an employee ID still on its way kept the wizard on Employment (H1 on a phone). */}
      <form ref={bodyRef} tabIndex={-1} noValidate className="ui-record-section ui-wizard-body" aria-label={steps[stepIndex][1]}
        onSubmit={(e) => { e.preventDefault(); if (stepKey === 'review') create(); else next(); }}
        onKeyDown={(e) => { if (e.key === 'Enter' && e.target.tagName === 'INPUT' && !e.nativeEvent.isComposing) e.preventDefault(); }}>
        {summarise ? (
          <div className="ui-alert ui-alert-neg" role="alert">
            <div><p className="ui-alert-title">{errorList.length === 1 ? 'One field needs attention' : `${errorList.length} fields need attention`}</p>
              <ul className="ui-alert-body list-disc pl-4">{errorList.map((x) => <li key={x.field}><a href={`#${x.field}`} className="ui-link" onClick={(e) => { e.preventDefault(); showField(x.field); }}>{x.message}</a></li>)}</ul>
            </div>
          </div>
        ) : null}
        {failure ? <ErrorState error={failure} compact onRetry={stepKey === 'review' ? create : null} retryLabel="Try again" body={failure?.network ? 'Nothing was created. Everything you entered is still here.' : undefined} /> : null}

        {stepKey === 'personal' ? (
          <Step title="Personal details">
            <Text id="firstName" label="First name" required {...field('firstName')} error={errors.firstName} autoFocus />
            <Text id="lastName" label="Last name" {...field('lastName')} />
            <Text id="preferredName" label="Preferred name" optional {...field('preferredName')} />
            <Text id="workEmail" label="Work email" optional type="email" inputMode="email" placeholder="name@company.com" {...field('workEmail')} error={errors.workEmail} suggestions={emailHints} />
            <Text id="phone" label="Phone" optional type="tel" inputMode="tel" placeholder="98765 43210" {...field('phone')} error={errors.phone} />
            <Text id="email" label="Personal email" optional type="email" inputMode="email" {...field('email')} error={errors.email} />
            <Text id="workPhone" label="Work phone" optional type="tel" inputMode="tel" {...field('workPhone')} />
            <DateField id="dateOfBirth" label="Date of birth" optional max={todayIst()} {...field('dateOfBirth')} error={errors.dateOfBirth} />
            <SelectField id="gender" label="Gender" optional options={[{ value: '', label: 'Not set' }, ...Object.entries(GENDER_WORDS).map(([value, label]) => ({ value, label }))]} {...field('gender')} />
            <Text id="guardianName" label="Father / husband name" optional {...field('guardianName')} />
            <PhotoField value={form.photoUrl} onChange={(v) => field('photoUrl').onChange(v)} name={[form.firstName, form.lastName].filter(Boolean).join(' ')} />
            <h3 className="ui-t-sec sm:col-span-2 mt-2">Emergency contact</h3>
            <Text id="emergencyContactName" label="Name" {...field('emergencyContactName')} />
            <Text id="emergencyContactRelation" label="Relationship" {...field('emergencyContactRelation')} suggestions={relationHints} />
            <Text id="emergencyContactPhone" label="Phone" type="tel" inputMode="tel" {...field('emergencyContactPhone')} error={errors.emergencyContactPhone} />
          </Step>
        ) : null}

        {stepKey === 'employment' ? (
          <Step title="Employment">
            <Text id="code" label="Employee ID" required {...field('code')} error={errors.code} max={40} />
            <SelectField id="employeeTypeId" label="Employment type" optional options={opts(lists.types)} {...field('employeeTypeId')} />
            <DateField id="dateOfJoining" label="Joining date" required {...field('dateOfJoining')} error={errors.dateOfJoining} />
            <SelectField id="hours" label="Hours" options={Object.entries(HOURS_WORDS).map(([value, label]) => ({ value, label }))} {...field('hours')} />
            <SelectField id="workTypeId" label="Work mode" optional options={opts(lists.workTypes)} {...field('workTypeId')} />
            {dates.probation ? <DateField id="probationEndDate" label="Probation ends" optional min={form.dateOfJoining || ''} {...field('probationEndDate')} error={errors.probationEndDate} /> : null}
            {dates.contract ? <DateField id="contractEndDate" label={dates.contractLabel} optional min={form.dateOfJoining || ''} {...field('contractEndDate')} error={errors.contractEndDate} /> : null}
          </Step>
        ) : null}

        {stepKey === 'organization' ? (
          <Step title="Organisation">
            {(lists.branches || []).length > 1 ? <SelectField id="branchId" label="Works at" optional options={opts(lists.branches)} {...field('branchId')} /> : null}
            <SelectField id="departmentId" label="Department" optional options={opts(lists.departments)} {...field('departmentId')} />
            <SelectField id="jobPositionId" label="Designation" optional options={opts(within(lists.positions, 'departmentId', form.departmentId, form.jobPositionId))} {...field('jobPositionId')} />
            {lists.roles.length ? <SelectField id="jobRoleId" label="Job role" optional options={opts(within(lists.roles, 'jobPositionId', form.jobPositionId, form.jobRoleId))} {...field('jobRoleId')} /> : null}
            {lists.areas.length ? <SelectField id="areaId" label="Location" optional options={opts(lists.areas)} {...field('areaId')} /> : null}
            {lists.establishments.length ? <SelectField id="establishmentId" label="Work site" optional options={opts(lists.establishments)} {...field('establishmentId')} /> : null}
            <SelectField id="reportingManagerId" label="Manager" optional options={[{ value: '', label: 'Not set' }, ...people.map((e) => ({ value: e.id, label: e.code ? `${e.name} (${e.code})` : e.name }))]} {...field('reportingManagerId')} />
            <SelectField id="dottedManagerId" label="Secondary manager" optional options={[{ value: '', label: 'Not set' }, ...people.map((e) => ({ value: e.id, label: e.code ? `${e.name} (${e.code})` : e.name }))]} {...field('dottedManagerId')} />
            {lists.units.length ? <SelectField id="businessUnitId" label="Business unit" optional options={opts(lists.units)} {...field('businessUnitId')} /> : null}
            {lists.teams.length ? <SelectField id="teamId" label="Team" optional options={opts(within(lists.teams, 'departmentId', form.departmentId, form.teamId))} {...field('teamId')} /> : null}
            {lists.seats.length ? <SelectField id="seatId" label="Position" optional options={opts(within(lists.seats, 'teamId', form.teamId, form.seatId))} {...field('seatId')} /> : null}
            {lists.tags.length ? (
              <fieldset className="sm:col-span-2">
                <legend className="ui-label">Tags</legend>
                <div className="flex flex-wrap gap-1.5">
                  {lists.tags.map((t) => { const on = form.tagIds.includes(t.id); return <button key={t.id} type="button" aria-pressed={on} className="ui-choice-chip" onClick={() => field('tagIds').onChange(on ? form.tagIds.filter((x) => x !== t.id) : [...form.tagIds, t.id])}>{t.name}</button>; })}
                </div>
              </fieldset>
            ) : null}
            {hasApp('attendance') ? (
              <>
                <h3 className="ui-t-sec sm:col-span-2 mt-2">Attendance device</h3>
                <Text id="devicePin" label="Attendance ID" placeholder={form.code} max={20} {...field('devicePin')} />
                <Text id="cardNumber" label="Card number" optional max={20} {...field('cardNumber')} />
                {lists.contractors.length ? <SelectField id="contractorId" label="Contractor" optional options={opts(lists.contractors)} {...field('contractorId')} /> : null}
                <label className="flex items-center gap-2 text-sm self-end pb-2"><input type="checkbox" className="ui-checkbox" checked={form.attendanceRequired !== false} onChange={(e) => field('attendanceRequired').onChange(e.target.checked)} />Expected to mark attendance</label>
              </>
            ) : null}
            {lists.centres.length ? <SelectField id="costCenterId" label="Cost centre" optional options={opts(lists.centres)} {...field('costCenterId')} /> : null}
            {lists.grades.length ? <SelectField id="gradeId" label="Grade" optional options={opts(lists.grades)} {...field('gradeId')} /> : null}
          </Step>
        ) : null}

        {stepKey === 'salary' ? (
          <Step title="Salary" hint="Their yearly CTC on one of the company's salary structures. Payroll pays from it; you can also set it later on their record.">
            {payStructures?.length ? (
              <>
                <SelectField id="structureId" label="Salary structure" optional options={[{ value: '', label: 'Set later' }, ...payStructures.map((x) => ({ value: x.id, label: x.name }))]} value={salary.structureId}
                  onChange={(v) => { setSalary((x) => ({ ...x, structureId: v })); setErrors((e) => { const n = { ...e }; delete n.structureId; delete n.annualCtc; return n; }); }} />
                <Text id="annualCtc" label="Yearly CTC (₹)" inputMode="decimal" max={12} placeholder="480000" value={salary.annualCtc} error={errors.annualCtc}
                  help={salary.structureId && salaryFrom ? `Starts ${formatDate(salaryFrom)}${Number(salary.annualCtc) > 0 ? `, about ₹${Math.round(Number(salary.annualCtc) / 12).toLocaleString('en-IN')} a month` : ''}.` : null}
                  onChange={(v) => { setSalary((x) => ({ ...x, annualCtc: v.replace(/[^\d.]/g, '') })); setErrors((e) => { const n = { ...e }; delete n.annualCtc; return n; }); }} />
              </>
            ) : (
              <p className="ui-caption sm:col-span-2">{payStructures ? 'Payroll has no active salary structure yet. Make one in Payroll, then set this salary on their record.' : 'Loading salary structures…'}</p>
            )}
          </Step>
        ) : null}

        {stepKey === 'documents' ? (
          <Step title="Documents" hint="ID proof, address proof, the signed offer. They are added to the record once it is created, and the person sees them under Me. Up to 5 MB a file.">
            <div className="sm:col-span-2 space-y-3">
              <input ref={fileInput} id="joiningFiles" type="file" multiple accept={DOC_ACCEPT} className="hidden" onChange={(e) => addFiles(e.target.files)} />
              <button type="button" className="ui-btn ui-btn-secondary" onClick={() => fileInput.current?.click()}>Choose files</button>
              {files.length ? (
                <ul className="ui-doc-picks" aria-label="Files to add">
                  {files.map((d) => (
                    <li key={d.key} className="ui-doc-pick">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium" title={d.file.name}>{d.file.name}</span>
                        <span className="ui-caption tabular-nums">{kb(d.file.size)}</span>
                      </span>
                      <span className="ui-doc-pick-fields">
                        <div><PopupSelect showValueSubtext={false} label="Type" ariaLabel={`Type of ${d.file.name}`} value={d.kind} onChange={(v) => setFile(d.key, { kind: v || 'ID_PROOF' })} options={JOINING_DOCS.map(([value, label]) => ({ value, label }))} /></div>
                        <label className="block"><span className="ui-label">Name</span><input className="ui-input w-full" maxLength={120} aria-label={`Name for ${d.file.name}`} placeholder={d.file.name.replace(/\.[^.]+$/, '')} value={d.title} onChange={(e) => setFile(d.key, { title: e.target.value })} /></label>
                      </span>
                      <button type="button" className="ui-link text-sm" aria-label={`Remove ${d.file.name}`} onClick={() => setFiles((now) => now.filter((x) => x.key !== d.key))}>Remove</button>
                    </li>
                  ))}
                </ul>
              ) : <p className="ui-caption">No files chosen. They can also be added on the record later.</p>}
            </div>
          </Step>
        ) : null}

        {stepKey === 'review' ? (
          <div className="space-y-4 ui-panel-in">
            <h2 className="ui-t-sec">Review</h2>
            {duplicates?.length ? (
              <Alert tone="warn" title="This may be someone already here">
                <ul className="mt-1 space-y-1">{duplicates.map((d) => <li key={d.id}><button type="button" className="ui-link" onClick={() => openScreen?.('employee', d.left ? { id: d.id, tab: 'employment' } : { id: d.id })}>{d.name}{d.code ? ` (${d.code})` : ''}</button> has the same {d.field}.{d.left ? ' They left earlier: open them and Rehire instead, to keep their history.' : ''}</li>)}</ul>
                <label className="block mt-2"><span className="ui-label">Why is this a different person? *</span><input className="ui-input w-full" value={duplicateReason} onChange={(e) => setDuplicateReason(e.target.value)} maxLength={300} /></label>
              </Alert>
            ) : null}
            {[['personal', 'Personal', [['Name', [form.firstName, form.lastName].filter(Boolean).join(' ')], ['Preferred name', form.preferredName], ['Photo', form.photoUrl ? 'Added' : ''], ['Work email', form.workEmail], ['Phone', form.phone], ['Work phone', form.workPhone], ['Personal email', form.email], ['Date of birth', form.dateOfBirth && formatDate(form.dateOfBirth)], ['Gender', GENDER_WORDS[form.gender]], ['Father / husband name', form.guardianName], ['Emergency contact', [form.emergencyContactName, form.emergencyContactRelation, form.emergencyContactPhone].filter(Boolean).join(' · ')]]],
              ['employment', 'Employment', [['Employee ID', form.code], ['Employment type', nameIn(lists.types, form.employeeTypeId)], ['Joining date', form.dateOfJoining && formatDate(form.dateOfJoining)], ['Hours', HOURS_WORDS[form.hours]], ['Work mode', nameIn(lists.workTypes, form.workTypeId)], ['Probation ends', dates.probation && form.probationEndDate && formatDate(form.probationEndDate)], [dates.contractLabel, dates.contract && form.contractEndDate && formatDate(form.contractEndDate)]]],
              ['organization', 'Organisation', [...((lists.branches || []).length > 1 ? [['Works at', nameIn(lists.branches, form.branchId)]] : []), ['Department', nameIn(lists.departments, form.departmentId)], ['Designation', nameIn(lists.positions, form.jobPositionId)], ...(lists.roles.length ? [['Job role', nameIn(lists.roles, form.jobRoleId)]] : []), ...(lists.areas.length ? [['Location', nameIn(lists.areas, form.areaId)]] : []), ...(lists.establishments.length ? [['Work site', nameIn(lists.establishments, form.establishmentId)]] : []), ['Manager', people.find((x) => x.id === form.reportingManagerId)?.name], ['Secondary manager', people.find((x) => x.id === form.dottedManagerId)?.name], ...(lists.units.length ? [['Business unit', nameIn(lists.units, form.businessUnitId)]] : []), ...(lists.teams.length ? [['Team', nameIn(lists.teams, form.teamId)]] : []), ...(lists.seats.length ? [['Position', nameIn(lists.seats, form.seatId)]] : []), ...(lists.centres.length ? [['Cost centre', nameIn(lists.centres, form.costCenterId)]] : []), ...(lists.grades.length ? [['Grade', nameIn(lists.grades, form.gradeId)]] : []), ['Tags', lists.tags.filter((t) => form.tagIds.includes(t.id)).map((t) => t.name).join(', ')], ...(hasApp('attendance') ? [['Attendance ID', form.devicePin || (form.code ? `${form.code} (employee ID)` : '')], ['Card number', form.cardNumber], ...(lists.contractors.length ? [['Contractor', nameIn(lists.contractors, form.contractorId)]] : []), ['Marks attendance', form.attendanceRequired === false ? 'No, door only' : 'Yes']] : [])]],
              ...(salaryOn ? [['salary', 'Salary', [['Salary structure', chosenStructure?.name || 'Set later'], ['Yearly CTC', chosenStructure && Number(salary.annualCtc) > 0 ? `₹${Number(salary.annualCtc).toLocaleString('en-IN')}` : ''], ['Starts', chosenStructure && salaryFrom ? formatDate(salaryFrom) : '']]]] : []),
              ...(docsOn ? [['documents', 'Documents', [['Files', files.length ? files.map((d) => `${d.title.trim() || d.file.name} (${JOINING_DOCS.find(([k]) => k === d.kind)?.[1] || d.kind})`).join(', ') : 'None']]]] : []),
            ].map(([k, title, rows]) => (
              <section key={k} className="ui-review-block" aria-label={title}>
                <header className="flex items-center justify-between"><h3 className="text-sm font-semibold">{title}</h3><button type="button" className="ui-link text-sm" onClick={() => goStep(k)}>Edit</button></header>
                <dl className="ui-field-grid mt-2">{rows.filter(([, v]) => v).map(([l, v]) => <div key={l} className="ui-field-row"><dt className="ui-caption">{l}</dt><dd className="text-sm">{v}</dd></div>)}</dl>
              </section>
            ))}
          </div>
        ) : null}

        <div className="ui-wizard-actions">
          <button type="button" className="ui-btn ui-btn-secondary" onClick={cancel}>Cancel</button>
          <span className="flex flex-wrap gap-2 ml-auto">
            {stepIndex > 0 ? <button type="button" className="ui-btn ui-btn-secondary" onClick={back}><ArrowLeft size={16} aria-hidden="true" /> Back</button> : null}
            <button type="button" className="ui-btn ui-btn-secondary" disabled={busy} onClick={saveAsDraft}>Save draft</button>
            {stepKey === 'review'
              ? <button type="submit" className="ui-btn ui-btn-primary" disabled={busy || (duplicates?.length && !duplicateReason.trim())}>{busy ? 'Creating…' : 'Create employee'}</button>
              : <button type="submit" className="ui-btn ui-btn-primary">Continue <ArrowRight size={16} aria-hidden="true" /></button>}
          </span>
        </div>
      </form>
    </div>
  );
}

function PhotoField({ value, onChange, name }) {
  const input = useRef(null);
  return (
    <div>
      <span className="ui-label">Photo</span>
      <div className="flex items-center gap-3">
        {value || name ? <Avatar person={{ name, photoUrl: value || null }} size={44} /> : <span className="ui-photo-empty" aria-hidden="true"><Camera size={18} /></span>}
        <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => input.current?.click()}>{value ? 'Change' : 'Choose a photo'}</button>
        {value ? <button type="button" className="ui-link text-sm" onClick={() => onChange('')}>Remove</button> : null}
        <input ref={input} type="file" accept="image/*" className="sr-only" aria-label="Choose a photo" onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          try { onChange(await shrinkPhoto(f)); } catch (err) { notify.error(String(err?.message || 'Could not use that photo.')); }
        }} />
      </div>
    </div>
  );
}

function Step({ title, hint, children }) {
  return (
    <div className="ui-panel-in">
      <h2 className="ui-t-sec">{title}</h2>
      {hint ? <p className="ui-caption mb-4">{hint}</p> : <div className="mb-4" />}
      <div className="ui-form-grid">{children}</div>
    </div>
  );
}

function Label({ id, label, required }) {
  return <label htmlFor={id} className="ui-label">{label}{required ? <span aria-hidden="true" className="ui-required"> *</span> : null}</label>;
}

function Text({ id, label, required, help, error, value, onChange, type = 'text', inputMode, placeholder, max = 160, autoFocus, suggestions }) {
  const common = {
    id, name: id, className: `ui-input w-full ${error ? 'is-invalid' : ''}`, type, inputMode, placeholder, maxLength: max, required, autoFocus,
    'aria-invalid': error ? 'true' : undefined, 'aria-describedby': [error ? `${id}-err` : '', help ? `${id}-help` : ''].filter(Boolean).join(' ') || undefined,
  };
  return (
    <div>
      <Label id={id} label={label} required={required} />
      {/* What the company already has is offered under the field; typing stays free. */}
      {suggestions ? <SuggestInput {...common} value={value} onChange={onChange} suggestions={suggestions} /> : <input {...common} className={common.className || 'ui-input w-full'} value={value} onChange={(e) => onChange(e.target.value)} />}
      {error ? <p id={`${id}-err`} className="ui-field-error">{error}</p> : help ? <p id={`${id}-help`} className="ui-caption">{help}</p> : null}
    </div>
  );
}

function DateField({ id, label, required, error, value, onChange, min = '', max = '' }) {
  return (
    <div>
      <Label id={id} label={label} required={required} />
      <DatePicker id={id} value={value} onChange={onChange} min={min} max={max} required={required} invalid={Boolean(error)} describedBy={error ? `${id}-err` : undefined} />
      {error ? <p id={`${id}-err`} className="ui-field-error">{error}</p> : null}
    </div>
  );
}

function SelectField({ label, required, options, value, onChange }) {
  return (
    <div>
      <PopupSelect showValueSubtext={false} label={`${label}${required ? ' *' : ''}`} ariaLabel={label} value={value} onChange={(v) => onChange(v || '')} options={options} alwaysSearch={options.length > 8} placeholder="Not set" />
    </div>
  );
}
