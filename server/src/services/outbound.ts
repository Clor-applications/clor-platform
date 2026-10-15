import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import net from 'node:net';

/**
 * Outbound calls to addresses a customer typed in (webhooks). Ported from
 * ClorTime's services/integrations/http.js (Strix finding: SSRF via base_url).
 *
 * Where a connection may go is checked on the RESOLVED address at connect
 * time, so a hostname that resolves somewhere else, or a redirect, cannot get
 * round it:
 *  - always refused: link-local and cloud-metadata addresses (169.254.0.0/16,
 *    fe80::/10, fd00:ec2::254) and the unspecified address;
 *  - refused here also: loopback and private networks. This is a shared cloud
 *    where the URL is configured by a customer, ClorTime's "hosted pilot" case.
 *    INTEGRATIONS_ALLOW_PRIVATE=true lifts it for development and tests only.
 * TLS is always verified.
 */
const allowPrivate = () => String(process.env.INTEGRATIONS_ALLOW_PRIVATE || '').toLowerCase() === 'true';

const v4ToInt = (ip: string) => ip.split('.').reduce((n, o) => (n << 8) + Number(o), 0) >>> 0;
const inV4 = (ip: string, cidr: string) => {
  const [base, bits] = cidr.split('/');
  const mask = bits === '0' ? 0 : (~0 << (32 - Number(bits))) >>> 0;
  return (v4ToInt(ip) & mask) === (v4ToInt(base) & mask);
};
const ALWAYS_V4 = ['169.254.0.0/16', '0.0.0.0/8'];
const PRIVATE_V4 = ['127.0.0.0/8', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '100.64.0.0/10'];

/** Why an address may not be contacted, or null when it may. */
export function blockedReason(address: string): string | null {
  let ip = address;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) ip = mapped[1];
  if (net.isIPv4(ip)) {
    if (ALWAYS_V4.some((c) => inV4(ip, c))) return 'link-local or metadata address';
    if (!allowPrivate() && PRIVATE_V4.some((c) => inV4(ip, c))) return 'private or loopback address';
    return null;
  }
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    if (lower === '::' || /^fe[89ab]/.test(lower) || lower === 'fd00:ec2::254') return 'link-local or metadata address';
    if (!allowPrivate() && (lower === '::1' || /^f[cd]/.test(lower))) return 'private or loopback address';
    return null;
  }
  return 'not an IP address';
}

const blocked = (what: string, why: string) => Object.assign(new Error(`${what} is a ${why}; refused`), { code: 'EBLOCKEDADDRESS' });

const guardedLookup: any = (hostname: string, options: any, callback: any) => {
  const opts = typeof options === 'object' ? options : { family: options };
  dns.lookup(hostname, { ...opts, all: true }, (err, addresses: any) => {
    if (err) return callback(err);
    for (const a of addresses) {
      const why = blockedReason(a.address);
      if (why) return callback(blocked(`${hostname} (${a.address})`, why));
    }
    if (opts.all) return callback(null, addresses);
    return callback(null, addresses[0].address, addresses[0].family);
  });
};

const failedSocket = (err: Error) => {
  const s = new net.Socket();
  process.nextTick(() => s.destroy(err));
  return s;
};
/* A bare-IP URL never reaches dns.lookup, so the address is checked where every connection opens. */
const ipCheck = (host: string) => {
  if (!net.isIP(host)) return null;
  const why = blockedReason(host);
  return why ? blocked(host, why) : null;
};

class GuardedHttpAgent extends http.Agent {
  createConnection(options: any, cb: any) {
    const err = ipCheck(options.host);
    return err ? failedSocket(err) : (super.createConnection as any)(options, cb);
  }
}
class GuardedHttpsAgent extends https.Agent {
  createConnection(options: any, cb: any) {
    const err = ipCheck(options.host);
    return err ? failedSocket(err) : (super.createConnection as any)(options, cb);
  }
}
const httpAgent = new GuardedHttpAgent({ lookup: guardedLookup } as any);
const httpsAgent = new GuardedHttpsAgent({ lookup: guardedLookup, rejectUnauthorized: true } as any);

/** Only http(s) URLs with a host, no credentials in them. */
export function checkUrl(raw: string) {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return 'That is not a web address.';
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return 'Use an http or https address.';
  if (u.username || u.password) return 'Put credentials in the secret, not the address.';
  return null;
}

/** POST a body through the guarded agents; no redirects followed. */
export function guardedPost(url: string, body: string, headers: Record<string, string>, timeoutMs = 10_000): Promise<{ status: number }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request(
      u,
      { method: 'POST', agent: u.protocol === 'https:' ? httpsAgent : httpAgent, headers: { ...headers, 'Content-Length': Buffer.byteLength(body) }, timeout: timeoutMs },
      (res) => {
        res.resume();
        res.on('end', () => resolve({ status: res.statusCode || 0 }));
      }
    );
    req.on('timeout', () => req.destroy(new Error(`No answer within ${timeoutMs / 1000} s`)));
    req.on('error', reject);
    req.end(body);
  });
}
