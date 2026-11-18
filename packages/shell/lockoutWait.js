/**
 * After too many wrong sign-in codes the server answers 429 with
 * "Too many failed attempts. Try again in 5 minute(s)." (round 26 pick:
 * show a wait timer with the time left). These helpers turn that answer into
 * seconds to count down, and the seconds into "4:58".
 */
export function lockoutSeconds(err) {
  if (!err || Number(err.status) !== 429 || err.code === 'SMS_HELD') return 0;
  const m = /try again in (\d+) minute/i.exec(String(err.message || ''));
  return m ? Number(m[1]) * 60 : 0;
}

export function clockText(seconds) {
  const s = Math.max(0, Math.ceil(Number(seconds) || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
