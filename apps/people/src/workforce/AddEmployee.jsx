import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check } from 'lucide-react';

import { PageHeader, SkeletonCard } from '@ui/components/ui/Primitives';
import Alert from '@ui/components/ui/Alert';
import ErrorState from '@ui/components/ui/ErrorState';
import DatePicker, { formatDate } from '@ui/components/ui/DatePicker';
import PopupSelect from '@ui/components/pickers/PopupSelect';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import { usePermissions } from '@ui/permissions/usePermissions';
import { Avatar, GENDER_WORDS, shrinkPhoto } from '@ui/personnel/Employees';
import { hasApp } from '@platform/context';

import { createEmployee, deleteDraft, getDraft, listContractors, listEmployees, listTags, nextEmployeeCode, saveDraft, structure } from './api';
import { can } from './shared';

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
const STEPS = [['personal', 'Personal', 'Basic details'], ['employment', 'Employment', 'Job information'], ['organization', 'Organization', 'Reporting and location'], ['review', 'Review', 'Confirm details']];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BLANK = {
  firstName: '', lastName: '', preferredName: '', workEmail: '', workPhone: '', email: '', phone: '', dateOfBirth: '', gender: '', guardianName: '', photoUrl: '',
  emergencyContactName: '', emergencyContactRelation: '', emergencyContactPhone: '',
  code: '', employeeTypeId: '', workTypeId: '', jobRoleId: '', dateOfJoining: '', probationEndDate: '', contractEndDate: '', status: 'ACTIVE',
  departmentId: '', jobPositionId: '', areaId: '', establishmentId: '', businessUnitId: '', teamId: '', seatId: '', reportingManagerId: '', dottedManagerId: '', costCenterId: '', gradeId: '', workLocation: '',
  tagIds: [], devicePin: '', cardNumber: '', contractorId: '', attendanceRequired: true,
};
const todayIst = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

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
    if (!f.code.trim()) e.code = 'Enter an employee ID.';
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
  const [people, setPeople] = useState([]);
  const stepKey = STEPS.some(([k]) => k === params.step) ? params.step : 'personal';
  const stepIndex = STEPS.findIndex(([k]) => k === stepKey);
  const bodyRef = useRef(null);
  const dirty = JSON.stringify(form) !== JSON.stringify(saved);

  useEffect(() => {
    Promise.all([...['departments', 'job-positions', 'employee-types', 'work-types', 'areas', 'establishments', 'teams', 'cost-centres', 'grades', 'business-units', 'seats', 'job-roles'].map((k) => structure(k).catch(() => [])), hasApp('attendance') ? listContractors() : Promise.resolve([]), listTags().catch(() => [])])
      .then(([departments, positions, types, workTypes, areas, establishments, teams, centres, grades, units, seats, roles, contractors, tags]) => setLists({ departments, positions, types, workTypes, areas, establishments, teams, centres, grades, units, seats, roles, contractors, tags }));
    listEmployees({ limit: 500, sort: 'name' }).then((r) => setPeople((r?.employees || []).filter((e) => e.status !== 'LEFT'))).catch(() => {});
  }, []);
  /* A draft named in the address opens as it was left; otherwise the next ID is suggested. */
  useEffect(() => {
    let live = true;
    if (params.draft) {
      getDraft(params.draft).then((d) => { if (!live) return; const next = { ...BLANK, ...d.data }; setForm(next); setSaved(next); setDraftId(d.id); }).catch((e) => live && setFailure(e)).finally(() => live && setLoading(false));
    } else {
      /* The suggestion is not an edit: the baseline takes it too, so an untouched wizard leaves without a warning. */
      nextEmployeeCode().then((code) => {
        if (!live || !code) return;
        setForm((f) => (f.code ? f : { ...f, code }));
        setSaved((f) => (f.code ? f : { ...f, code }));
      }).catch(() => {});
    }
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const goStep = (k) => { updateParams?.({ step: k === 'personal' ? null : k }, { push: true }); bodyRef.current?.focus(); window.scrollTo(0, 0); };
  const field = (k) => ({ value: form[k], onChange: (v) => { setForm((f) => ({ ...f, [k]: v })); if (errors[k]) setErrors((e) => { const n = { ...e }; delete n[k]; return n; }); } });
  const next = () => {
    const e = check(stepKey, form);
    setErrors(e);
    if (Object.keys(e).length) {
      setTimeout(() => bodyRef.current?.querySelector('[aria-invalid="true"]')?.focus(), 0);
      return;
    }
    goStep(STEPS[stepIndex + 1][0]);
  };
  const back = () => goStep(STEPS[stepIndex - 1][0]);
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
    openScreen?.('employees');
  };
  const discardDraft = async () => {
    if (!(await confirmDialog({ title: 'Delete the saved draft?', confirmLabel: 'Delete draft' }))) return;
    try { await deleteDraft(draftId); setDraftId(null); updateParams?.({ draft: null }); notify.success('Draft deleted.'); } catch (e) { notify.error(String(e?.message || 'Not deleted.')); }
  };
  const create = async () => {
    for (const [k] of STEPS.slice(0, 3)) {
      const e = check(k, form);
      if (Object.keys(e).length) { setErrors(e); goStep(k); return; }
    }
    if (busy) return;
    setBusy(true);
    setFailure(null);
    try {
      const body = Object.fromEntries(Object.entries(form).filter(([k, v]) => v !== '' && v !== null && !(k === 'tagIds' && !v.length) && !(k === 'attendanceRequired' && !hasApp('attendance'))));
      const r = await createEmployee({ ...body, ...(duplicateReason ? { duplicateReason } : {}), ...(draftId ? { draftId } : {}) });
      setSaved(form);
      notify.success(`${r.employee.name} added.`);
      openScreen?.('employee', { id: r.employee.id });
    } catch (e) {
      if (e?.status === 409 && e?.data?.code === 'DUPLICATE') setDuplicates(e.data.duplicates || []);
      else if (e?.status === 409) setErrors({ code: e.message || 'That employee ID is already used in this company.' });
      else setFailure(e);
    } finally {
      setBusy(false);
    }
  };

  if (!can(perms, 'PEOPLE::Employees::CREATE')) return <ErrorState kind="forbidden" body="Adding employees needs the Employees create permission." />;
  if (loading || !lists) return <div className="space-y-4" aria-busy="true"><SkeletonCard lines={2} /><SkeletonCard lines={8} /></div>;

  const opts = (arr) => [{ value: '', label: 'Not set' }, ...arr.map((x) => ({ value: x.id, label: x.name }))];
  const errorList = Object.entries(errors).map(([k, message]) => ({ field: k, message }));

  return (
    <div className="space-y-4 ui-wizard">
      <PageHeader breadcrumb={[{ label: 'People' }, { label: 'Workforce', onClick: cancel }, { label: 'Add employee' }]} title="Add employee"
        actions={draftId ? <button type="button" className="ui-link text-sm" onClick={discardDraft}>Delete saved draft</button> : null} />
      <ol className="ui-stepper" aria-label="Steps">
        {STEPS.map(([k, label, hint], i) => (
          <li key={k} className={`ui-step ${i === stepIndex ? 'is-current' : ''} ${i < stepIndex ? 'is-done' : ''}`} aria-current={i === stepIndex ? 'step' : undefined}>
            <span className="ui-step-mark" aria-hidden="true">{i < stepIndex ? <Check size={14} /> : i + 1}</span>
            <span><span className="ui-step-label">{label}</span><span className="ui-step-hint">{hint}</span></span>
          </li>
        ))}
      </ol>

      <form ref={bodyRef} tabIndex={-1} className="ui-record-section ui-wizard-body" aria-label={STEPS[stepIndex][1]}
        onSubmit={(e) => { e.preventDefault(); if (stepKey === 'review') create(); else next(); }}
        onKeyDown={(e) => { if (e.key === 'Enter' && e.target.tagName === 'INPUT' && !e.nativeEvent.isComposing) e.preventDefault(); }}>
        {errorList.length > 1 ? (
          <div className="ui-alert ui-alert-neg" role="alert">
            <div><p className="ui-alert-title">{errorList.length} fields need attention</p>
              <ul className="ui-alert-body list-disc pl-4">{errorList.map((x) => <li key={x.field}><a href={`#${x.field}`} className="ui-link" onClick={(e) => { e.preventDefault(); document.getElementById(x.field)?.focus(); }}>{x.message}</a></li>)}</ul>
            </div>
          </div>
        ) : null}
        {failure ? <ErrorState error={failure} compact onRetry={stepKey === 'review' ? create : null} retryLabel="Try again" body={failure?.network ? 'Nothing was created. Everything you entered is still here.' : undefined} /> : null}

        {stepKey === 'personal' ? (
          <Step title="Personal details" hint="Basic information about the employee.">
            <Text id="firstName" label="Legal first name" required {...field('firstName')} error={errors.firstName} autoFocus />
            <Text id="lastName" label="Legal last name" {...field('lastName')} />
            <Text id="preferredName" label="Preferred name" optional help="Used in everyday communication." placeholder="E.g. Sari" {...field('preferredName')} />
            <Text id="workEmail" label="Work email" optional type="email" inputMode="email" placeholder="name@company.com" help="Not every worker has one." {...field('workEmail')} error={errors.workEmail} />
            <Text id="phone" label="Phone" optional type="tel" inputMode="tel" placeholder="98765 43210" {...field('phone')} error={errors.phone} />
            <Text id="email" label="Personal email" optional type="email" inputMode="email" {...field('email')} error={errors.email} />
            <Text id="workPhone" label="Work phone" optional type="tel" inputMode="tel" {...field('workPhone')} />
            <DateField id="dateOfBirth" label="Date of birth" optional max={todayIst()} {...field('dateOfBirth')} error={errors.dateOfBirth} />
            <SelectField id="gender" label="Gender" optional options={[{ value: '', label: 'Not set' }, ...Object.entries(GENDER_WORDS).map(([value, label]) => ({ value, label }))]} {...field('gender')} />
            <Text id="guardianName" label="Father’s / husband’s name" optional help="For the muster roll." {...field('guardianName')} />
            <PhotoField value={form.photoUrl} onChange={(v) => field('photoUrl').onChange(v)} name={[form.firstName, form.lastName].filter(Boolean).join(' ')} />
            <h3 className="ui-t-sec sm:col-span-2 mt-2">Emergency contact <span className="ui-caption font-normal">(optional)</span></h3>
            <Text id="emergencyContactName" label="Name" {...field('emergencyContactName')} />
            <Text id="emergencyContactRelation" label="Relationship" {...field('emergencyContactRelation')} />
            <Text id="emergencyContactPhone" label="Phone" type="tel" inputMode="tel" {...field('emergencyContactPhone')} error={errors.emergencyContactPhone} />
          </Step>
        ) : null}

        {stepKey === 'employment' ? (
          <Step title="Employment" hint="How and from when they work here.">
            <Text id="code" label="Employee ID" required help="Unique in this company. Suggested from your numbering; change it if you need to." {...field('code')} error={errors.code} max={40} />
            <SelectField id="employeeTypeId" label="Employment type" optional options={opts(lists.types)} {...field('employeeTypeId')} />
            <DateField id="dateOfJoining" label="Date of joining" required {...field('dateOfJoining')} error={errors.dateOfJoining} />
            <SelectField id="workTypeId" label="Work type" optional options={opts(lists.workTypes)} {...field('workTypeId')} />
            {lists.roles.length ? <SelectField id="jobRoleId" label="Job role" optional options={opts(lists.roles)} {...field('jobRoleId')} /> : null}
            <DateField id="probationEndDate" label="Probation ends" optional min={form.dateOfJoining || ''} {...field('probationEndDate')} error={errors.probationEndDate} />
            <DateField id="contractEndDate" label="Contract ends" optional min={form.dateOfJoining || ''} {...field('contractEndDate')} error={errors.contractEndDate} />
            <SelectField id="status" label="Work status" options={[{ value: 'ACTIVE', label: 'Active' }, { value: 'SUSPENDED', label: 'Suspended' }]} {...field('status')} />
          </Step>
        ) : null}

        {stepKey === 'organization' ? (
          <Step title="Organization" hint="Where they sit and who they report to. The server refuses a manager that would make a reporting loop.">
            <SelectField id="departmentId" label="Department" optional options={opts(lists.departments)} {...field('departmentId')} />
            <SelectField id="jobPositionId" label="Designation" optional options={opts(lists.positions)} {...field('jobPositionId')} />
            <SelectField id="areaId" label="Work location" optional options={opts(lists.areas)} {...field('areaId')} />
            <SelectField id="establishmentId" label="Establishment" optional options={opts(lists.establishments)} {...field('establishmentId')} />
            <SelectField id="reportingManagerId" label="Reporting manager" optional options={[{ value: '', label: 'Not set' }, ...people.map((e) => ({ value: e.id, label: e.code ? `${e.name} (${e.code})` : e.name }))]} {...field('reportingManagerId')} />
            <SelectField id="dottedManagerId" label="Also reports to (dotted line)" optional options={[{ value: '', label: 'Not set' }, ...people.map((e) => ({ value: e.id, label: e.code ? `${e.name} (${e.code})` : e.name }))]} {...field('dottedManagerId')} />
            {lists.units.length ? <SelectField id="businessUnitId" label="Business unit" optional options={opts(lists.units)} {...field('businessUnitId')} /> : null}
            {lists.teams.length ? <SelectField id="teamId" label="Team" optional options={opts(lists.teams)} {...field('teamId')} /> : null}
            {lists.seats.length ? <SelectField id="seatId" label="Seat" optional options={opts(lists.seats.filter((x) => !form.teamId || !x.teamId || x.teamId === form.teamId))} {...field('seatId')} /> : null}
            <Text id="workLocation" label="Work location (text)" optional help="For a place not in the Locations list." {...field('workLocation')} />
            {lists.tags.length ? (
              <fieldset className="sm:col-span-2">
                <legend className="ui-label">Tags <span className="ui-caption font-normal">(optional)</span></legend>
                <div className="flex flex-wrap gap-1.5">
                  {lists.tags.map((t) => { const on = form.tagIds.includes(t.id); return <button key={t.id} type="button" aria-pressed={on} className={`ui-pill ${on ? 'ui-pill-info' : ''}`} onClick={() => field('tagIds').onChange(on ? form.tagIds.filter((x) => x !== t.id) : [...form.tagIds, t.id])}>{t.name}</button>; })}
                </div>
              </fieldset>
            ) : null}
            {hasApp('attendance') ? (
              <>
                <h3 className="ui-t-sec sm:col-span-2 mt-2">Attendance readers <span className="ui-caption font-normal">(optional)</span></h3>
                <Text id="devicePin" label="Reader ID" optional help={form.code ? `Blank means the employee ID (${form.code}).` : 'The ID on the biometric reader.'} max={20} {...field('devicePin')} />
                <Text id="cardNumber" label="Card number" optional max={20} {...field('cardNumber')} />
                {lists.contractors.length ? <SelectField id="contractorId" label="Contractor" optional options={opts(lists.contractors)} {...field('contractorId')} /> : null}
                <label className="flex items-center gap-2 text-sm self-end pb-2"><input type="checkbox" className="ui-checkbox" checked={form.attendanceRequired !== false} onChange={(e) => field('attendanceRequired').onChange(e.target.checked)} />Expected to mark attendance</label>
              </>
            ) : null}
            {lists.centres.length ? <SelectField id="costCenterId" label="Cost centre" optional options={opts(lists.centres)} {...field('costCenterId')} /> : null}
            {lists.grades.length ? <SelectField id="gradeId" label="Grade" optional options={opts(lists.grades)} {...field('gradeId')} /> : null}
          </Step>
        ) : null}

        {stepKey === 'review' ? (
          <div className="space-y-4">
            <div><h2 className="ui-t-sec">Review</h2><p className="ui-caption">Check the details, then create the employee.</p></div>
            {duplicates?.length ? (
              <Alert tone="warn" title="This may be someone already here">
                <ul className="mt-1 space-y-1">{duplicates.map((d) => <li key={d.id}><button type="button" className="ui-link" onClick={() => openScreen?.('employee', { id: d.id })}>{d.name}{d.code ? ` (${d.code})` : ''}</button> has the same {d.field}.</li>)}</ul>
                <label className="block mt-2"><span className="ui-label">Why is this a different person? *</span><input className="ui-input w-full" value={duplicateReason} onChange={(e) => setDuplicateReason(e.target.value)} maxLength={300} /></label>
              </Alert>
            ) : null}
            {!form.workEmail && !form.phone ? <Alert tone="info" title="No work email or phone">That is fine for workers without one; they can be added later.</Alert> : null}
            {form.dateOfJoining > todayIst() ? <Alert tone="info" title={`Joining on ${formatDate(form.dateOfJoining)}`}>They show as "Joining soon" until then.</Alert> : null}
            {[['personal', 'Personal', [['Legal name', [form.firstName, form.lastName].filter(Boolean).join(' ')], ['Preferred name', form.preferredName], ['Work email', form.workEmail], ['Phone', form.phone], ['Personal email', form.personalEmail], ['Date of birth', form.dateOfBirth && formatDate(form.dateOfBirth)], ['Emergency contact', [form.emergencyContactName, form.emergencyContactRelation, form.emergencyContactPhone].filter(Boolean).join(' · ')]]],
              ['employment', 'Employment', [['Employee ID', form.code], ['Employment type', lists.types.find((t) => t.id === form.employeeTypeId)?.name], ['Date of joining', form.dateOfJoining && formatDate(form.dateOfJoining)], ['Probation ends', form.probationEndDate && formatDate(form.probationEndDate)], ['Work status', form.status === 'ACTIVE' ? 'Active' : 'Suspended']]],
              ['organization', 'Organization', [['Department', lists.departments.find((x) => x.id === form.departmentId)?.name], ['Designation', lists.positions.find((x) => x.id === form.jobPositionId)?.name], ['Work location', lists.areas.find((x) => x.id === form.areaId)?.name || form.workLocation], ['Establishment', lists.establishments.find((x) => x.id === form.establishmentId)?.name], ['Reporting manager', people.find((x) => x.id === form.reportingManagerId)?.name], ['Team', lists.teams.find((x) => x.id === form.teamId)?.name], ['Tags', lists.tags.filter((t) => form.tagIds.includes(t.id)).map((t) => t.name).join(', ')], ...(hasApp('attendance') ? [['Reader ID', form.devicePin || (form.code ? `${form.code} (employee ID)` : '')], ['Attendance expected', form.attendanceRequired === false ? 'No, door only' : 'Yes']] : [])]],
            ].map(([k, title, rows]) => (
              <section key={k} className="ui-review-block" aria-label={title}>
                <header className="flex items-center justify-between"><h3 className="text-sm font-semibold">{title}</h3><button type="button" className="ui-link text-sm" onClick={() => goStep(k)}>Edit</button></header>
                <dl className="ui-field-grid mt-2">{rows.map(([l, v]) => <div key={l} className="ui-field-row"><dt className="ui-caption">{l}</dt><dd className="text-sm">{v || <span className="ui-muted">Not provided</span>}</dd></div>)}</dl>
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
      <span className="ui-label">Photo <span className="ui-caption font-normal">(optional)</span></span>
      <div className="flex items-center gap-3">
        <Avatar person={{ name: name || '?', photoUrl: value || null }} size={44} />
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
    <div>
      <h2 className="ui-t-sec">{title}</h2>
      <p className="ui-caption mb-4">{hint}</p>
      <div className="ui-form-grid">{children}</div>
    </div>
  );
}

function Label({ id, label, required, optional }) {
  return <label htmlFor={id} className="ui-label">{label}{required ? <span aria-hidden="true" className="ui-required"> *</span> : null}{optional ? <span className="ui-caption font-normal"> (optional)</span> : null}</label>;
}

function Text({ id, label, required, optional, help, error, value, onChange, type = 'text', inputMode, placeholder, max = 160, autoFocus }) {
  return (
    <div>
      <Label id={id} label={label} required={required} optional={optional} />
      <input id={id} name={id} className={`ui-input w-full ${error ? 'is-invalid' : ''}`} type={type} inputMode={inputMode} placeholder={placeholder} maxLength={max} value={value} required={required} autoFocus={autoFocus}
        aria-invalid={error ? 'true' : undefined} aria-describedby={[error ? `${id}-err` : '', help ? `${id}-help` : ''].filter(Boolean).join(' ') || undefined}
        onChange={(e) => onChange(e.target.value)} />
      {error ? <p id={`${id}-err`} className="ui-field-error">{error}</p> : help ? <p id={`${id}-help`} className="ui-caption">{help}</p> : null}
    </div>
  );
}

function DateField({ id, label, required, optional, error, value, onChange, min = '', max = '' }) {
  return (
    <div>
      <Label id={id} label={label} required={required} optional={optional} />
      <DatePicker id={id} value={value} onChange={onChange} min={min} max={max} required={required} invalid={Boolean(error)} describedBy={error ? `${id}-err` : undefined} />
      {error ? <p id={`${id}-err`} className="ui-field-error">{error}</p> : null}
    </div>
  );
}

function SelectField({ label, required, optional, options, value, onChange }) {
  return (
    <div>
      <PopupSelect showValueSubtext={false} label={`${label}${required ? ' *' : ''}${optional ? ' (optional)' : ''}`} ariaLabel={label} value={value} onChange={(v) => onChange(v || '')} options={options} alwaysSearch={options.length > 8} placeholder="Not set" />
    </div>
  );
}
