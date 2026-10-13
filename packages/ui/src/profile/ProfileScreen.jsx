import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  BadgeCheck,
  Building2,
  Check,
  Mail,
  Pencil,
  Save,
  ShieldAlert,
  Trash2,
  Upload,
  UserRound,
  Warehouse,
  X,
} from 'lucide-react';

import { getProfile, resendVerification, updateProfile } from '@platform/auth';
import { PageHeader, Spinner, SkeletonCard } from '@ui/components/ui/Primitives';

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
      <dt className="ui-t-label" style={{ color: 'rgb(var(--fg-subtle))' }}>
        {label}
      </dt>
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
export const ProfileScreen = ({ Header = PageHeader }) => {
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

  return (
    <div className="space-y-6">
      <Header
        entity="customer"
        title="My profile"
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
                <button type="button" className="ui-btn ui-btn-primary" onClick={save} disabled={!dirty || busy === 'save'}>
                  {busy === 'save' ? <Spinner /> : <Save size={16} aria-hidden="true" />} Save changes
                </button>
              </>
            ) : (
              <button type="button" className="ui-btn ui-btn-primary" onClick={() => setEditing(true)}>
                <Pencil size={16} aria-hidden="true" /> Edit profile
              </button>
            )}
          </>
        }
      />

      {error ? (
        <div
          className="ui-card p-3 ui-t-body"
          role="alert"
          style={{ borderColor: 'rgb(var(--neg))', color: 'rgb(var(--neg))' }}
        >
          {error}
        </div>
      ) : null}

      <section className="ui-card p-5">
        <div className="flex flex-wrap items-start gap-5">
          <div className="flex flex-col items-center gap-2">
            <Avatar url={editing ? form.avatarUrl : user.avatarUrl} initials={initials} size={72} />
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
                <button
                  type="button"
                  className="ui-btn ui-btn-secondary ui-btn-sm"
                  onClick={() => fileRef.current?.click()}
                >
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
            {editing ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="ui-label" htmlFor="me-first">
                    First name
                  </label>
                  <input
                    id="me-first"
                    className="ui-input"
                    value={form.firstName}
                    maxLength={60}
                    onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="ui-label" htmlFor="me-last">
                    Last name
                  </label>
                  <input
                    id="me-last"
                    className="ui-input"
                    value={form.lastName}
                    maxLength={60}
                    onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="ui-label" htmlFor="me-username">
                    Username
                  </label>
                  <input
                    id="me-username"
                    className="ui-input"
                    value={form.username}
                    maxLength={40}
                    placeholder="Optional"
                    onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
                  />
                  <div className="ui-t-body mt-1" style={{ color: 'rgb(var(--fg-subtle))' }}>
                    Letters, numbers, dot, dash and underscore. You can sign in with this instead of the email.
                  </div>
                </div>
                <div>
                  <label className="ui-label" htmlFor="me-phone">
                    Mobile number
                  </label>
                  <input
                    id="me-phone"
                    className="ui-input"
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    value={form.phone}
                    maxLength={20}
                    placeholder="+91 98765 43210"
                    onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                  />
                </div>
              </div>
            ) : (
              <dl className="grid gap-4 sm:grid-cols-2">
                <Field label="Name" value={[user.firstName, user.lastName].filter(Boolean).join(' ') || user.fullName} />
                <Field label="Username" value={user.username} />
                <Field label="Mobile number" value={user.phone} mono />
                <div>
                  <dt className="ui-t-label" style={{ color: 'rgb(var(--fg-subtle))' }}>
                    Email
                  </dt>
                  <dd className="ui-t-body mt-0.5 flex flex-wrap items-center gap-2" style={{ color: 'rgb(var(--fg))' }}>
                    {user.email || '—'}
                    {verified ? (
                      <span className="ui-pill ui-pill-pos">
                        <BadgeCheck size={11} aria-hidden="true" /> Confirmed
                      </span>
                    ) : (
                      <span className="ui-pill ui-pill-warn">
                        <ShieldAlert size={11} aria-hidden="true" /> Not confirmed
                      </span>
                    )}
                  </dd>
                  {!verified ? (
                    <button
                      type="button"
                      className="ui-btn ui-btn-secondary ui-btn-sm mt-1.5"
                      disabled={busy === 'verify'}
                      onClick={() => run('verify', resendVerification, 'Verification link sent')}
                    >
                      {busy === 'verify' ? <Spinner /> : <Mail size={14} aria-hidden="true" />} Send the link
                    </button>
                  ) : (
                    <div className="ui-t-body mt-0.5" style={{ color: 'rgb(var(--fg-subtle))' }}>
                      Changing the sign-in address is done by an administrator.
                    </div>
                  )}
                </div>
              </dl>
            )}
          </div>
        </div>
      </section>

      {/*
        Granted, not chosen. These sit on the profile because "what am I allowed
        to touch" is a question people ask of their own account, but every one
        of them is set by an administrator — so they read as a record, never as
        a form, in edit mode as much as out of it.
      */}
      <section className="ui-card p-5">
        <h2 className="ui-t-sec">Access</h2>
        <p className="ui-t-body mt-0.5 mb-4" style={{ color: 'rgb(var(--fg-subtle))' }}>
          Granted by an administrator. Ask them if something here is wrong.
        </p>
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="User role" value={me?.isOrgAdmin ? 'Administrator' : 'Member'} />
          <Field
            label="Organisation"
            value={(me?.orgs || []).map((o) => o.org?.name).filter(Boolean).join(', ')}
          />
          <Field
            label="Branch"
            value={branchNames}
            hint={branchNames ? null : 'No branch restriction — you can see all of them.'}
          />
          <Field
            label="Warehouse"
            value={warehouseNames}
            hint={warehouseNames ? null : 'No warehouse restriction.'}
          />
          <Field label="User ID" value={user.code || '—'} mono />
          <Field label="Client ID" value={user.accountCode || user.accountId} mono />
          <Field
            label="Last signed in"
            value={
              user.lastLoginAt
                ? new Date(user.lastLoginAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
                : ''
            }
          />
        </dl>
        <p className="ui-t-body mt-4 flex items-center gap-1.5" style={{ color: 'rgb(var(--fg-subtle))' }}>
          <UserRound size={14} aria-hidden="true" />
          Password, devices and sign-in activity are under Settings &rarr; Security.
        </p>
      </section>
    </div>
  );
};

export default ProfileScreen;
