import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import http from 'node:http';
import { createVerify, generateKeyPairSync } from 'node:crypto';

/** Work sites found by address: a fake Photon and Nominatim on localhost stand in for the map services. */
process.env.INTEGRATIONS_ALLOW_PRIVATE = 'true';
const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { typedPosition, clearGeocodeCache } = await import('../services/geocode.js');
const app = buildApp().listen(0, '127.0.0.1');
afterAll(async () => {
  await new Promise((done) => app.close(done));
  await peoplePrisma.$disconnect();
});
const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
async function makeOwner(): Promise<Ctx> {
  const email = `geo.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'HR owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Geo Co ${Date.now()}-${rnd()}`, state: 'Karnataka' }).expect(200);
  const ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
  await request(app).put(`/api/orgs/${ctx.orgId}/features`).set(at(ctx)).send({ features: { people: true, attendance: true } }).expect(200);
  return ctx;
}
const api = (c: Ctx) => ({
  get: (p: string) => request(app).get(`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)),
  post: (p: string, b: unknown = {}) => request(app).post(`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)).send(b as any),
  put: (p: string, b: unknown = {}) => request(app).put(`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)).send(b as any),
});
const _person = async (c: Ctx, body: Record<string, unknown>) =>
  (await request(app).post(`/api/orgs/${c.orgId}/people/employees`).set(at(c)).send({ dateOfJoining: '2026-01-01', ...body }).expect(201)).body.employee;

/** A stand-in for a vendor: records what it was sent, answers as told. */
function fakeServer(handler: (req: http.IncomingMessage, body: string, res: http.ServerResponse) => void) {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => handler(req, body, res));
  });
  return new Promise<{ url: string; close: () => Promise<void> }>((resolve) => server.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${(server.address() as any).port}`, close: () => new Promise((r) => server.close(() => r())) })));
}

let c: Ctx;
let photon: { url: string; close: () => Promise<void> };
let nominatim: { url: string; close: () => Promise<void> };
const photonHits: string[] = [];
let photonDown = false;
beforeAll(async () => {
  photon = await fakeServer((req, _b, res) => {
    photonHits.push(req.url || '');
    res.setHeader('content-type', 'application/json');
    if (photonDown) { res.statusCode = 503; return res.end('{}'); }
    if (req.url?.startsWith('/api/')) {
      return res.end(JSON.stringify({ features: [
        { geometry: { coordinates: [77.5946, 12.9716] }, properties: { name: 'Acme Works', street: 'MG Road', housenumber: '12', city: 'Bengaluru', state: 'Karnataka', postcode: '560001', country: 'India' } },
        { geometry: { coordinates: [0, 0] }, properties: { name: 'Null Island' } },
      ] }));
    }
    if (req.url?.startsWith('/reverse')) return res.end(JSON.stringify({ features: [{ geometry: { coordinates: [77.6, 12.97] }, properties: { street: 'Church Street', city: 'Bengaluru', country: 'India' } }] }));
    res.statusCode = 404; res.end('{}');
  });
  nominatim = await fakeServer((req, _b, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url?.startsWith('/search')) return res.end(JSON.stringify([{ name: 'Fallback Gate', display_name: 'Fallback Gate, Peenya, Bengaluru, India', lat: '13.03', lon: '77.52' }]));
    res.statusCode = 404; res.end('[]');
  });
  process.env.GEOCODE_PHOTON_URL = photon.url;
  process.env.GEOCODE_NOMINATIM_URL = nominatim.url;
  c = await makeOwner();
}, 60_000);
afterAll(async () => {
  await photon.close();
  await nominatim.close();
});

describe('Work sites by address', () => {
  it('reads a typed position or a pasted map link without asking anyone', () => {
    expect(typedPosition('12.9716, 77.5946')).toMatchObject({ latitude: 12.9716, longitude: 77.5946, source: 'typed' });
    expect(typedPosition('https://www.google.com/maps/place/X/@12.9716,77.5946,17z/data=!3m1')).toMatchObject({ latitude: 12.9716, longitude: 77.5946 });
    expect(typedPosition('https://www.openstreetmap.org/?mlat=13.01&mlon=77.55#map=17/13.01/77.55')).toMatchObject({ latitude: 13.01 });
    expect(typedPosition('MG Road')).toBeNull();
    expect(typedPosition('95, 200')).toBeNull();
  });

  it('suggests places for an address, drops impossible points, and caches', async () => {
    clearGeocodeCache();
    const r = (await api(c).get('/geocode?q=acme%20works%20mg%20road').expect(200)).body;
    expect(r.places).toHaveLength(1);
    expect(r.places[0]).toMatchObject({ label: 'Acme Works', latitude: 12.9716, longitude: 77.5946, source: 'photon' });
    expect(r.places[0].detail).toMatch(/12 MG Road.*Bengaluru/);
    expect(photonHits.at(-1)).toMatch(/lat=21&lon=78.9/); // India until the company has a site
    const before = photonHits.length;
    await api(c).get('/geocode?q=Acme%20Works%20MG%20Road').expect(200);
    expect(photonHits.length).toBe(before);
    expect((await api(c).get('/geocode?q=ab').expect(200)).body.places).toEqual([]);
    expect((await api(c).get('/geocode?q=12.97,77.59').expect(200)).body.places[0].source).toBe('typed');
  });

  it('falls back to Nominatim when Photon is down', async () => {
    clearGeocodeCache();
    photonDown = true;
    try {
      const r = (await api(c).get('/geocode?q=peenya%20gate').expect(200)).body;
      expect(r.places[0]).toMatchObject({ label: 'Fallback Gate', latitude: 13.03, source: 'nominatim' });
    } finally {
      photonDown = false;
    }
  });

  it('names what is at a moved pin, and the site keeps its address', async () => {
    const r = (await api(c).get('/geocode/reverse?lat=12.97&lon=77.6').expect(200)).body;
    expect(r.place.address).toMatch(/Church Street.*Bengaluru/);
    await api(c).get('/geocode/reverse?lat=200&lon=1').expect(400);
    const made = (await api(c).post('/geofences', { name: 'Head office', latitude: 12.9716, longitude: 77.5946, radiusMeters: 200, address: 'Acme Works, 12 MG Road, Bengaluru' }).expect(201)).body.geofence;
    expect(made.address).toBe('Acme Works, 12 MG Road, Bengaluru');
    const kept = (await api(c).put(`/geofences/${made.id}`, { name: 'Head office', latitude: 12.9716, longitude: 77.5946, radiusMeters: 150 }).expect(200)).body.geofence;
    expect(kept.address).toBe('Acme Works, 12 MG Road, Bengaluru');
    /* Searches now lean towards the company's own site. */
    clearGeocodeCache();
    await api(c).get('/geocode?q=another%20place').expect(200);
    expect(photonHits.at(-1)).toMatch(/lat=12.9716&lon=77.5946/);
  });
});
