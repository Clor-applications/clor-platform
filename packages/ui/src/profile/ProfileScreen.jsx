import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  BadgeCheck,
  Building2,
  Check,
  Download,
  KeyRound,
  Mail,
  Pencil,
  Save,
  ShieldAlert,
  Trash2,
  Upload,
  UserRound,
  Warehouse,
  X,
} from '@ui/components/ui/lineIcons';

import { changePassword, exportMyData, forgotPassword, getProfile, resendVerification, updateProfile } from '@platform/auth';
import { operator } from '@platform/operator';
import { Button, PageHeader, SkeletonCard } from '@ui/components/ui/Primitives';
import AuthenticatorCard from './AuthenticatorCard';

/**
 * The largest data URL the server will store, matched to the cap in the route.
 * The picker resizes below this long before it matters; the check is here so a
 * refusal reads as a sentence rather than a 400.
 */
const AVATAR_MAX = 96 * 1024;
const AVATAR_PX = 256;

/**
 * Resize to a square, centred, and re-encode.
 *
 * A phone photo is three or four megabytes and none of that survives being
 * drawn at 40 pixels in a nav rail. Doing it in the browser means the byte the
 * server stores is the byte anyone will ever look at.
 */
function resizeToDataUrl(file) {
  return new Promise((resolve, reject) => {
    if (!/^image\/(png|jpeg|jpg|webp)$/i.test(file.type)) {
      reject(new Error('Pick a PNG, JPEG or WebP image.'));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('That file could not be read.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('That file is not an image the browser can open.'));
      img.onload = () => {
        try {
          const side = Math.min(img.width, img.height);
          const sx = Math.max(0, (img.width - side) / 2);
          const sy = Math.max(0, (img.height - side) / 2);
          const canvas = document.createElement('canvas');
          canvas.width = AVATAR_PX;
          canvas.height = AVATAR_PX;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, sx, sy, side, side, 0, 0, AVATAR_PX, AVATAR_PX);
          // Step the quality down until it fits rather than refusing a photo
          // that is merely detailed.
          let url = '';
          for (const q of [0.85, 0.7, 0.55, 0.4]) {
            url = canvas.toDataURL('image/jpeg', q);
            if (url.length <= AVATAR_MAX) break;
          }
          if (url.length > AVATAR_MAX) {
            reject(new Error('That image is too detailed to store. Try a simpler one.'));
            return;
          }
          resolve(url);
        } catch {
          reject(new Error('That image could not be processed.'));
        }
      };
      img.src = String(reader.result || '');
    };
    reader.readAsDataURL(file);
  });
}

function Avatar({ url, initials, size = 72 }) {
  if (url) {
    return (
      <img
        src={url}
        alt=""
        width={size}
        height={size}
        className="rounded-full object-cover shrink-0"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      className="rounded-full inline-flex items-center justify-center font-medium shrink-0"
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size / 2.8),
        backgroundColor: 'rgb(var(--accent-soft))',
        color: 'rgb(var(--brand-ink))',
      }}
      aria-hidden="true"
    >
      {initials}
    </span>
  );
}

/** A read-mode row. Reads as a record, not as a form with the inputs greyed. */
function Field({ label, value, mono = false, hint = null }) {
  return (
    <div>
      <dt className="ui-caption">{label}</dt>
      <dd className={`ui-t-body mt-0.5 ${mono ? 'ui-mono' : ''}`} style={{ color: 'rgb(var(--fg))' }}>
        {value || <span style={{ color: 'rgb(var(--fg-subtle))' }}>Not set</span>}
      </dd>
      {hint ? (
        <div className="ui-t-body mt-0.5" style={{ color: 'rgb(var(--fg-subtle))' }}>
          {hint}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The signed-in user's own details.
 *
 * Read first, edit on request. The page is opened far more often to check a
 * number than to change one, and a screen of live inputs invites edits nobody
 * came to make — then asks whether it saved.
 *
 * What is editable is what belongs to the person: their name, how to reach
 * them, their picture. Role, branches and warehouses are shown here because
 * "what am I allowed to touch" is a question people ask of their profile, but
 * they are granted by an administrator and are read-only by construction —
 * an editable field the server would refuse is worse than no field.
 */
/**
 * First and last name as the form should show them. Accounts made before the
 * split carry only `fullName`; read that as first word + the rest so the form
 * does not open with empty name fields for someone who has a name.
 */
const nameParts = (u) => {
  if (u?.firstName || u?.lastName) return { first: u.firstName || '', last: u.lastName || '' };
  const [first = '', ...rest] = String(u?.fullName || '').trim().split(/\s+/).filter(Boolean);
  return { first, last: rest.join(' ') };
};

/**
 * `Header` is the page heading. Accounting passes its settings header, which
 * moves the actions into the settings frame; elsewhere a plain page header.
 */
export const ProfileScreen = ({ Header = PageHeader, links = [] }) => {
  const [me, setMe] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [form, setForm] = useState({ firstName: '', lastName: '', username: '', phone: '', avatarUrl: '' });
  const fileRef = useRef(null);

  const load = (d) => {
    setMe(d);
    const u = d?.user || {};
    const name = nameParts(u);
    setForm({
      firstName: name.first,
      lastName: name.last,
      username: u.username || '',
      phone: u.phone || '',
      avatarUrl: u.avatarUrl || '',
    });
  };

  useEffect(() => {
    let cancelled = false;
    Promise.resolve()
      .then(getProfile)
      .then((d) => !cancelled && load(d))
      .catch((e) => !cancelled && setError(String(e?.message || e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  const user = me?.user || {};
  const verified = Boolean(user.emailVerifiedAt);

  const initials = useMemo(() => {
    const src = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.fullName || user.email || '';
    const parts = String(src).trim().split(/[\s._@-]+/).filter(Boolean);
    if (!parts.length) return '—';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }, [user]);

  const branchNames = useMemo(() => {
    const rows = Array.isArray(me?.branches) ? me.branches : [];
    const names = rows.map((b) => b?.branchName || b?.name).filter(Boolean);
    if (names.length) return names.join(', ');
    const n = (me?.allowedBranchIds || []).length;
    return n ? `${n} branch${n === 1 ? '' : 'es'}` : '';
  }, [me]);

  const warehouseNames = useMemo(() => {
    const rows = Array.isArray(me?.warehouses) ? me.warehouses : [];
    return rows.map((w) => w?.name).filter(Boolean).join(', ');
  }, [me]);

  const savedName = nameParts(user);
  const dirty =
    form.firstName !== savedName.first ||
    form.lastName !== savedName.last ||
    form.username !== (user.username || '') ||
    form.phone !== (user.phone || '') ||
    form.avatarUrl !== (user.avatarUrl || '');

  const run = async (key, fn, note) => {
    setBusy(key);
    setError('');
    setNotice('');
    try {
      await fn();
      if (note) setNotice(note);
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setBusy('');
    }
  };

  const pickAvatar = async (file) => {
    if (!file) return;
    setError('');
    try {
      const url = await resizeToDataUrl(file);
      setForm((f) => ({ ...f, avatarUrl: url }));
    } catch (e) {
      setError(String(e?.message || e));
    }
  };

  const save = () =>
    run(
      'save',
      async () => {
        const r = await updateProfile({
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim(),
          username: form.username.trim(),
          phone: form.phone.trim(),
          avatarUrl: form.avatarUrl,
        });
        setMe((prev) => ({ ...prev, user: { ...prev.user, ...r.user } }));
        /* The shell's bar shows the name and photo too; tell it. */
        window.dispatchEvent(new CustomEvent('clor:profile-changed', { detail: { firstName: r.user?.firstName, lastName: r.user?.lastName, fullName: r.user?.fullName, avatarUrl: r.user?.avatarUrl ?? null } }));
        setEditing(false);
      },
      'Saved'
    );

  const cancel = () => {
    load(me);
    setEditing(false);
    setError('');
  };

  if (loading) return <SkeletonCard lines={5} />;

  const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.fullName || '';
  const orgNames = (me?.orgs || []).map((o) => o.org?.name).filter(Boolean);
  const lastIn = user.lastLoginAt
    ? new Date(user.lastLoginAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
    : '';
  const setF = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div className="ui-profile-page space-y-6">
      <Header
        entity="customer"
        title="My profile"
        description="Your details, how you sign in, and what you can open."
        actions={
          <>
            {notice ? (
              <span className="ui-pill ui-pill-pos" role="status">
                <Check size={11} aria-hidden="true" /> {notice}
              </span>
            ) : null}
            {editing ? (
              <>
                <button type="button" className="ui-btn ui-btn-secondary" onClick={cancel} disabled={busy === 'save'}>
                  <X size={16} aria-hidden="true" /> Cancel
                </button>
                <Button variant="primary" icon={Save} onClick={save} loading={busy === 'save'} disabled={!dirty}>
                  Save changes
                </Button>
              </>
            ) : (
              <button type="button" className="ui-btn ui-btn-primary" onClick={() => setEditing(true)}>
                <Pencil size={16} aria-hidden="true" /> Edit profile
              </button>
            )}
          </>
        }
      />

      {/* The open app's pages about the person themself (People: their leave and days), here rather than in the admin menu. */}
      {links.length ? (
        <nav aria-label="Your pages" className="ui-profile-links flex flex-wrap gap-2">
          {links.map((l) => (
            <button key={l.key} type="button" className="ui-btn ui-btn-secondary" onClick={l.onOpen}>
              {l.icon ? <l.icon size={16} aria-hidden="true" /> : null} {l.label}
            </button>
          ))}
        </nav>
      ) : null}

      {error ? (
        <div className="ui-card p-3 ui-t-body" role="alert" style={{ borderColor: 'rgb(var(--neg))', color: 'rgb(var(--neg))' }}>
          {error}
        </div>
      ) : null}

      {/* Who you are, at a glance: the picture, the name, the sign-in address and where you stand. */}
      <section className="ui-card p-5 sm:p-6" aria-label="You">
        <div className="flex flex-wrap items-center gap-5">
          <div className="flex flex-col items-center gap-2">
            <Avatar url={editing ? form.avatarUrl : user.avatarUrl} initials={initials} size={88} />
            {editing ? (
              <div className="flex items-center gap-1">
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="sr-only"
                  onChange={(e) => {
                    pickAvatar(e.target.files?.[0]);
                    e.target.value = '';
                  }}
                />
                <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => fileRef.current?.click()}>
                  <Upload size={14} aria-hidden="true" /> Photo
                </button>
                {form.avatarUrl ? (
                  <button
                    type="button"
                    className="ui-btn ui-btn-secondary ui-btn-sm"
                    onClick={() => setForm((f) => ({ ...f, avatarUrl: '' }))}
                    aria-label="Remove photo"
                    title="Remove photo"
                  >
                    <Trash2 size={14} aria-hidden="true" />
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="ui-t-page" style={{ fontSize: '1.5rem' }}>{fullName || user.email || 'Your profile'}</h2>
            <p className="ui-t-body mt-1 flex flex-wrap items-center gap-2" style={{ color: 'rgb(var(--fg-muted))' }}>
              <Mail size={14} aria-hidden="true" />
              <span className="min-w-0 break-all">{user.email || '—'}</span>
              {verified ? (
                <span className="ui-pill ui-pill-pos"><BadgeCheck size={11} aria-hidden="true" /> Confirmed</span>
              ) : (
                <span className="ui-pill ui-pill-warn"><ShieldAlert size={11} aria-hidden="true" /> Not confirmed</span>
              )}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="ui-pill">{me?.isOrgAdmin ? 'Administrator' : 'Member'}</span>
              {user.code ? <span className="ui-pill ui-mono">{user.code}</span> : null}
              {lastIn ? <span className="ui-caption">Last signed in {lastIn}</span> : null}
            </div>
          </div>
          {!verified && user.email ? (
            <Button icon={Mail} loading={busy === 'verify'} onClick={() => run('verify', resendVerification, 'Verification link sent')}>
              Send the confirmation link
            </Button>
          ) : null}
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px] items-start">
        <div className="space-y-6 min-w-0">
          <section className="ui-card p-5" aria-labelledby="me-details">
            <h2 id="me-details" className="ui-t-sec">Personal details</h2>
            <p className="ui-t-body mt-0.5 mb-4" style={{ color: 'rgb(var(--fg-subtle))' }}>
              {editing ? 'Your name, username and mobile number. The sign-in email is changed by an administrator.' : 'How you appear to colleagues and how they reach you.'}
            </p>
            {editing ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="ui-label" htmlFor="me-first">First name</label>
                  <input id="me-first" className="ui-input" value={form.firstName} maxLength={60} onChange={setF('firstName')} />
                </div>
                <div>
                  <label className="ui-label" htmlFor="me-last">Last name</label>
                  <input id="me-last" className="ui-input" value={form.lastName} maxLength={60} onChange={setF('lastName')} />
                </div>
                <div>
                  <label className="ui-label" htmlFor="me-username">Username</label>
                  <input id="me-username" className="ui-input" value={form.username} maxLength={40} placeholder="Optional" onChange={setF('username')} />
                  <div className="ui-caption mt-1">Letters, numbers, dot, dash and underscore. You can sign in with this instead of the email.</div>
                </div>
                <div>
                  <label className="ui-label" htmlFor="me-phone">Mobile number</label>
                  <input
                    id="me-phone"
                    className="ui-input"
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    value={form.phone}
                    maxLength={20}
                    placeholder="+91 98765 43210"
                    onChange={setF('phone')}
                  />
                </div>
              </div>
            ) : (
              <dl className="grid gap-4 sm:grid-cols-2">
                <Field label="First name" value={nameParts(user).first} />
                <Field label="Last name" value={nameParts(user).last} />
                <Field label="Username" value={user.username} />
                <Field label="Mobile number" value={user.phone} mono />
              </dl>
            )}
          </section>

          <PasswordCard email={user.email} />
          <AuthenticatorCard />
          <PrivacySection />
        </div>

        {/*
          Granted, not chosen. "What am I allowed to touch" is a question people
          ask of their own account, but every line here is set by an
          administrator — so it reads as a record, in edit mode as much as out.
        */}
        <aside className="ui-card p-5 space-y-4" aria-labelledby="me-access">
          <div>
            <h2 id="me-access" className="ui-t-sec">Access</h2>
            <p className="ui-t-body mt-0.5" style={{ color: 'rgb(var(--fg-subtle))' }}>
              Granted by an administrator. Ask them if something here is wrong.
            </p>
          </div>
          <dl className="grid gap-4">
            <Field label="Role" value={me?.isOrgAdmin ? 'Administrator' : 'Member'} />
            <div>
              <dt className="ui-caption">Companies</dt>
              <dd className="ui-t-body mt-1">
                {orgNames.length ? (
                  <ul className="space-y-1">
                    {orgNames.map((n) => (
                      <li key={n} className="flex items-center gap-2"><Building2 size={14} aria-hidden="true" style={{ color: 'rgb(var(--fg-subtle))' }} /> {n}</li>
                    ))}
                  </ul>
                ) : (
                  <span style={{ color: 'rgb(var(--fg-subtle))' }}>Not set</span>
                )}
              </dd>
            </div>
            <Field label="Branches" value={branchNames} hint={branchNames ? null : 'No branch restriction — you can see all of them.'} />
            <Field label="Warehouses" value={warehouseNames} hint={warehouseNames ? null : 'No warehouse restriction.'} />
            <Field label="User ID" value={user.code || '—'} mono />
            <Field label="Client ID" value={user.accountCode || user.accountId} mono />
          </dl>
        </aside>
      </div>
    </div>
  );
};

/**
 * Change your own password, here rather than only in Accounting's security
 * settings: every app shows this page, and a Payroll user had nowhere to do it.
 * Forgotten the current one? A reset link goes to the sign-in email.
 */
const EMPTY_PW = { current: '', next: '', confirm: '' };

function PasswordCard({ email }) {
  const [open, setOpen] = useState(false);
  const [pw, setPw] = useState(EMPTY_PW);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const act = async (key, fn, note) => {
    setBusy(key);
    setError('');
    setNotice('');
    try {
      await fn();
      setNotice(note);
      return true;
    } catch (e) {
      setError(String(e?.message || e));
      return false;
    } finally {
      setBusy('');
    }
  };

  const save = async () => {
    if (pw.next !== pw.confirm) return setError('The new passwords do not match.');
    if (pw.next === pw.current) return setError('Choose a password different from the current one.');
    const ok = await act('save', () => changePassword(pw.current, pw.next), 'Password changed. Other devices were signed out.');
    if (ok) {
      setPw(EMPTY_PW);
      setOpen(false);
    }
  };

  const field = (key, label, autoComplete) => (
    <label className="block">
      <span className="ui-label">{label}</span>
      <input
        type="password"
        className="ui-input w-full"
        value={pw[key]}
        onChange={(e) => setPw((p) => ({ ...p, [key]: e.target.value }))}
        autoComplete={autoComplete}
      />
    </label>
  );

  return (
    <section className="ui-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="ui-t-sec">Password</h2>
          <p className="ui-t-body mt-0.5" style={{ color: 'rgb(var(--fg-subtle))' }}>
            Changing it signs you out on other devices; this one stays signed in.
          </p>
        </div>
        {!open ? (
          <button type="button" className="ui-btn ui-btn-secondary" onClick={() => { setOpen(true); setNotice(''); setError(''); }}>
            <KeyRound size={16} aria-hidden="true" /> Change password
          </button>
        ) : null}
      </div>

      {open ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {field('current', 'Current password', 'current-password')}
          {field('next', 'New password', 'new-password')}
          {field('confirm', 'Confirm new password', 'new-password')}
          <div className="sm:col-span-3 flex flex-wrap items-center gap-2">
            <Button variant="primary" icon={Save} loading={busy === 'save'} disabled={!pw.current || !pw.next || !pw.confirm} onClick={save}>
              Save new password
            </Button>
            <button
              type="button"
              className="ui-btn ui-btn-secondary"
              disabled={busy === 'save'}
              onClick={() => { setOpen(false); setPw(EMPTY_PW); setError(''); }}
            >
              <X size={16} aria-hidden="true" /> Cancel
            </button>
          </div>
        </div>
      ) : null}

      {error ? (
        <p className="ui-t-body mt-3" role="alert" style={{ color: 'rgb(var(--neg))' }}>{error}</p>
      ) : null}
      {notice ? (
        <p className="ui-t-body mt-3 flex items-center gap-1.5" role="status" style={{ color: 'rgb(var(--pos))' }}>
          <Check size={14} aria-hidden="true" /> {notice}
        </p>
      ) : null}

      {email ? (
        <p className="ui-t-body mt-4 flex flex-wrap items-center gap-1.5" style={{ color: 'rgb(var(--fg-subtle))' }}>
          <UserRound size={14} aria-hidden="true" />
          Forgotten your current password?
          <button
            type="button"
            className="ui-link"
            disabled={busy === 'reset'}
            onClick={() => act('reset', () => forgotPassword(email), `A reset link is on its way to ${email}.`)}
          >
            {busy === 'reset' ? 'Sending…' : 'Email me a reset link'}
          </button>
        </p>
      ) : null}
    </section>
  );
}

/**
 * The person's own rights, where they look for them: their profile.
 *
 * Download is self-service. Erasure is a request, because closing an account
 * touches records a business may be legally bound to keep — it goes to the
 * operator's grievance contact, who can say what can go and what must stay.
 */
function PrivacySection() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const download = async () => {
    setBusy(true);
    setError('');
    try {
      const data = await exportMyData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `my-data-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError(String(e?.message || 'Could not prepare your data.'));
    } finally {
      setBusy(false);
    }
  };

  const erasureHref = operator.grievanceEmail
    ? `mailto:${operator.grievanceEmail}?subject=${encodeURIComponent('Request to close my account and erase my data')}`
    : null;

  return (
    <section className="ui-card p-5" aria-labelledby="privacy-heading">
      <h2 id="privacy-heading" className="ui-t-sec">Your data and privacy</h2>
      <p className="ui-t-body mt-0.5 mb-4" style={{ color: 'rgb(var(--fg-subtle))' }}>
        What this service holds about you, and your rights over it.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="ui-btn ui-btn-secondary" onClick={download} disabled={busy}>
          <Download size={14} aria-hidden="true" />
          {busy ? 'Preparing…' : 'Download my data'}
        </button>
        {erasureHref ? (
          <a className="ui-btn ui-btn-secondary" href={erasureHref}>
            Ask to close my account
          </a>
        ) : null}
      </div>
      {error ? <p role="alert" className="mt-2 text-sm" style={{ color: 'rgb(var(--neg))' }}>{error}</p> : null}
      <p className="ui-t-body mt-3" style={{ color: 'rgb(var(--fg-subtle))' }}>
        The download covers your profile, the companies you belong to, your sign-in sessions and sign-in history.
        A company&rsquo;s own records are exported by its administrator from Settings &rarr; Backup.
        {erasureHref ? null : ' To close your account, contact the operator of this service.'}
      </p>
      <nav aria-label="Policies" className="mt-3">
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <li><a className="ui-link" href="#/legal/privacy" target="_blank" rel="noopener">Privacy notice</a></li>
          <li><a className="ui-link" href="#/legal/terms" target="_blank" rel="noopener">Terms of service</a></li>
          <li><a className="ui-link" href="#/legal/cookies" target="_blank" rel="noopener">Cookies and browser storage</a></li>
          <li><a className="ui-link" href="#/legal/accessibility" target="_blank" rel="noopener">Accessibility</a></li>
        </ul>
      </nav>
    </section>
  );
}

export default ProfileScreen;
