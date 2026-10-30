import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Camera, Clock3, LogIn, LogOut, MapPin, X } from '@ui/components/ui/lineIcons';

import { shrinkPhoto } from './shrinkPhoto';

/** Metres between two points, close enough for a work-site radius. */
function metresBetween(a, b) {
  const R = 6371e3;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}
const metres = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`);

/**
 * Three things have to be true before the button does anything, and the card
 * says which one is missing rather than failing with "not punched": the phone
 * gave up a position, HR has set up a work site, and the person is inside
 * one. The position is asked for only after the card has said what it is for
 * (notice before collection) — unless the browser already allows it, in which
 * case it starts at once. A coarse fix comes first (under a second, tens of
 * metres — enough for a 100 m site) and a GPS watch refines it, so nobody
 * stands at the gate watching a spinner while satellites are found.
 *
 * The selfie opens the front camera in the page. A file input with capture
 * hands off to the camera app on a phone, but on a desktop it is a file
 * picker — any image someone has, not a face at the moment of the punch. The
 * file input stays as the fallback for a camera that will not open, and the
 * photo is optional throughout: a camera that fails must not cost anyone
 * their attendance.
 */
export default function PhonePunch({ phone, punches = [], onPunch, onDone, privacyHref = '#/legal/privacy' }) {
  const sites = useMemo(() => phone?.sites || [], [phone]);
  const [position, setPosition] = useState(null);
  const [asked, setAsked] = useState(false);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState('');
  const [photo, setPhoto] = useState(null);
  const [cameraOn, setCameraOn] = useState(false);
  const [note, setNote] = useState('');
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const watchRef = useRef(null);
  const file = useRef(null);

  const closeCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraOn(false);
  }, []);

  const startLocation = useCallback(() => {
    setAsked(true);
    setLocationError('');
    if (!navigator.geolocation) {
      setLocationError('This browser cannot give your location, so punching is not possible here.');
      return;
    }
    setLocating(true);
    const use = (p) => {
      setPosition({ latitude: p.coords.latitude, longitude: p.coords.longitude, accuracy: Math.round(p.coords.accuracy) });
      setLocating(false);
      setLocationError('');
    };
    navigator.geolocation.getCurrentPosition(use, () => {}, { enableHighAccuracy: false, maximumAge: 60_000, timeout: 8_000 });
    if (watchRef.current != null) navigator.geolocation.clearWatch(watchRef.current);
    watchRef.current = navigator.geolocation.watchPosition(
      use,
      (err) => {
        setLocating(false);
        /* Only fatal with nothing at all: losing a refined fix is no reason to drop a usable one. */
        setPosition((current) => {
          if (!current) {
            setLocationError(
              err.code === 1
                ? 'Location is blocked for this site. Allow it in the browser’s site settings, then try again.'
                : 'Your location could not be found yet. Turn on location (GPS), or move somewhere with a clearer view of the sky.'
            );
          }
          return current;
        });
      },
      { enableHighAccuracy: true, maximumAge: 30_000, timeout: 20_000 }
    );
  }, []);

  useEffect(() => {
    /* Already allowed: no reason to make them tap again. */
    navigator.permissions?.query({ name: 'geolocation' }).then((p) => { if (p.state === 'granted') startLocation(); }).catch(() => {});
    return () => {
      if (watchRef.current != null) navigator.geolocation?.clearWatch(watchRef.current);
      closeCamera();
    };
  }, [startLocation, closeCamera]);

  /* Where they stand, against the sites, before the button is pressed. */
  const nearest = useMemo(() => {
    if (!position || !sites.length) return null;
    let best = null;
    for (const site of sites) {
      const distance = metresBetween(position, site);
      if (!best || distance < best.distance) best = { site, distance };
    }
    return best ? { ...best, inside: best.distance <= best.site.radiusMeters } : null;
  }, [position, sites]);

  const openCamera = async () => {
    setNote('');
    if (!navigator.mediaDevices?.getUserMedia) {
      setNote('This browser cannot open the camera here. You can still punch without a selfie, or upload one.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 } }, audio: false });
      streamRef.current = stream;
      setCameraOn(true);
      /* The <video> exists once cameraOn has rendered it. */
      setTimeout(() => { if (videoRef.current) videoRef.current.srcObject = stream; }, 0);
    } catch (err) {
      setNote(err?.name === 'NotAllowedError'
        ? 'Camera permission was refused. You can still punch without a selfie, or upload one.'
        : 'The camera could not be opened. You can still punch without a selfie, or upload one.');
    }
  };

  /** Freeze the frame at 640px — what a reviewer needs to recognise a face, and 40–80 KB on the wire. */
  const capture = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const scale = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    setPhoto(canvas.toDataURL('image/jpeg', 0.75));
    closeCamera();
  };

  const pickPhoto = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try {
      setPhoto(await shrinkPhoto(f));
      setNote('');
    } catch (err) {
      setNote(String(err?.message || 'That photo could not be used.'));
    }
  };

  const doPunch = async () => {
    if (!position) return;
    setMessage(null);
    setBusy(true);
    try {
      const res = await onPunch({ ...position, ...(photo ? { photo } : {}) });
      setMessage({ ok: true, text: `${res.kind === 'IN' ? 'In' : 'Out'} at ${res.time} · ${res.site}${photo && !res.photo ? ' · the selfie was not saved' : ''}` });
      setPhoto(null);
      onDone?.();
    } catch (err) {
      if (err?.name !== 'SignedOut' && !(err && err.constructor && err.constructor.name === 'SignedOut')) setMessage({ ok: false, text: String(err?.message || 'Not punched.') });
    } finally {
      setBusy(false);
    }
  };

  const days = phone?.photoRetentionDays;
  const next = phone?.next === 'IN' ? 'Punch in' : 'Punch out';

  return (
    <section className="ui-card space-y-3 p-5" aria-label="Punch from this phone">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="ui-t-sec">{next}</h2>
        {punches.length ? <span className="ui-caption">Last: {punches[punches.length - 1].kind === 'IN' ? 'in' : 'out'} at {punches[punches.length - 1].time}</span> : null}
      </div>

      {/* The notice, before anything is collected. */}
      <p className="ui-caption">
        To punch here, your location is used to check you are at a work site and is saved with the punch.
        A selfie is optional{days ? ` and is deleted after ${days} days` : ''}.{' '}
        <a className="ui-link" href={privacyHref}>Privacy notice</a>
      </p>

      {!sites.length ? (
        <p className="text-sm rounded-xl p-3" style={{ backgroundColor: 'rgb(var(--warn) / 0.08)', color: 'rgb(var(--warn))' }}>
          No work site is set up for phone punches yet. Ask HR — until then punching from a phone is not possible.
        </p>
      ) : null}

      {!asked && !position ? (
        <button type="button" className="ui-btn ui-btn-secondary w-full" onClick={startLocation} disabled={!sites.length}>
          <MapPin size={16} aria-hidden="true" /> Share my location to punch
        </button>
      ) : null}
      {locating && !position ? (
        <p className="ui-caption flex items-center gap-2" role="status"><Clock3 size={14} aria-hidden="true" className="animate-spin" /> Finding your location…</p>
      ) : null}
      {locationError ? (
        <p className="text-sm rounded-xl p-3" role="alert" style={{ backgroundColor: 'rgb(var(--neg) / 0.08)', color: 'rgb(var(--neg))' }}>{locationError}</p>
      ) : null}
      {position ? (
        <p className="text-sm flex items-start gap-2" role="status">
          <MapPin size={16} aria-hidden="true" className="mt-0.5 shrink-0" style={{ color: nearest?.inside ? 'rgb(var(--pos))' : 'rgb(var(--warn))' }} />
          <span>
            {nearest?.inside
              ? <>At <strong>{nearest.site.name}</strong> · {metres(nearest.distance)} from its centre</>
              : nearest
                ? <>{metres(nearest.distance)} from <strong>{nearest.site.name}</strong> — punch within {metres(nearest.site.radiusMeters)} of it</>
                : 'Location found'}
            <span className="ui-caption block">Accurate to about {metres(position.accuracy)}{locating ? ', improving…' : ''}</span>
          </span>
        </p>
      ) : null}

      {/* The selfie: quieter than the punch itself. */}
      {photo ? (
        <div className="relative inline-block">
          <img src={photo} alt="Your selfie for this punch" className="h-28 w-28 rounded-xl object-cover" />
          <button type="button" className="absolute -right-2 -top-2 rounded-full p-0.5 text-white" style={{ backgroundColor: 'rgb(0 0 0 / 0.6)' }} aria-label="Remove the selfie" onClick={() => setPhoto(null)}>
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      ) : cameraOn ? (
        <div className="space-y-2">
          <video ref={videoRef} autoPlay playsInline muted className="w-full rounded-xl" style={{ transform: 'scaleX(-1)', maxHeight: '18rem', objectFit: 'cover', backgroundColor: 'rgb(0 0 0)' }} />
          <div className="flex gap-2">
            <button type="button" className="ui-btn ui-btn-primary flex-1" onClick={capture}><Camera size={16} aria-hidden="true" /> Take photo</button>
            <button type="button" className="ui-btn ui-btn-secondary" onClick={closeCamera}>Cancel</button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={openCamera}>
            <Camera size={16} aria-hidden="true" /> Take a selfie (optional)
          </button>
          {note ? (
            <button type="button" className="ui-link text-sm" onClick={() => file.current?.click()}>Upload a photo instead</button>
          ) : null}
          <input ref={file} type="file" accept="image/*" capture="user" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={pickPhoto} />
        </div>
      )}
      {note ? <p className="ui-caption" style={{ color: 'rgb(var(--warn))' }}>{note}</p> : null}

      <button type="button" className="ui-btn ui-btn-primary w-full !h-14 text-base" disabled={!position || busy || !sites.length} onClick={doPunch}>
        {phone?.next === 'IN' ? <LogIn size={20} aria-hidden="true" /> : <LogOut size={20} aria-hidden="true" />}
        {busy ? 'Saving…' : `${next} now`}
      </button>
      {message ? (
        <p className="text-sm font-medium" role={message.ok ? 'status' : 'alert'} style={{ color: message.ok ? 'rgb(var(--pos))' : 'rgb(var(--neg))' }}>
          {message.text}
        </p>
      ) : null}
    </section>
  );
}

