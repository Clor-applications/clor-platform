/**
 * The kinds of reader and source CLOR takes attendance from, and what each
 * can do. Screens and routes ask a driver what it supports instead of asking
 * "is this ADMS?", so a new vendor is a new entry here plus its transport —
 * not a hunt through every `vendor === …` in the code.
 *
 * Every driver ends in the same place: punches go through ingestPunches
 * (routes/iclock.ts), so matching, days, duplicates and webhooks are the same
 * whatever the brand.
 */

export type Capability =
  /** The source sends punches to CLOR. */
  | 'push'
  /** CLOR fetches punches on a schedule or on "Sync now". */
  | 'pull'
  /** Users can be sent to and removed from it. */
  | 'users'
  /** Fingerprints / faces can be copied to and from it. */
  | 'templates'
  /** Raw commands (reboot, clear, door). */
  | 'commands'
  /** Accepted only from approved networks. */
  | 'networkLock'
  /** Heartbeats and counts for Reader health. */
  | 'health'
  /** Where each field is in what it sends is set per reader. */
  | 'mapping';

export type Driver = {
  vendor: string;
  label: string;
  /** Who it is for, in a sentence on the add-reader screen. */
  blurb: string;
  capabilities: Capability[];
  /** Added by people from the Readers screen (not created by the system). */
  addable: boolean;
  /** "in" / "out" arrive as such (state 0 / 1), rather than a reader's own state codes. */
  explicitDirection: boolean;
  /** Not on hardware CLOR has tested; shown as such. */
  unverified?: boolean;
};

export const DRIVERS: Driver[] = [
  {
    vendor: 'ADMS',
    label: 'Push reader (ADMS)',
    blurb: 'ZKTeco, eSSL, Biomax, Realtime, Identix, Mantra and other readers with a "Cloud server / ADMS" setting.',
    capabilities: ['push', 'users', 'templates', 'commands', 'networkLock', 'health'],
    addable: true,
    explicitDirection: false,
  },
  {
    vendor: 'HTTP_PUSH',
    label: 'Any reader or software that can send HTTP',
    blurb: 'Readers, turnstiles, middleware or vendor software that can post punches to a URL. You say where each field is.',
    capabilities: ['push', 'mapping'],
    addable: true,
    explicitDirection: true,
  },
  {
    vendor: 'MATRIX_COSEC',
    label: 'Matrix COSEC door controller (push)',
    blurb: 'Matrix COSEC Door V3, PVR, Vega, FMX, ARC DC 200 and ARGO with "Push API" on. The controller logs in to a CLOR URL, sends each punch as it happens, and takes reboot, counts and the time from CLOR.',
    capabilities: ['push', 'commands', 'health'],
    addable: true,
    explicitDirection: true,
    unverified: true,
  },
  {
    vendor: 'FILE',
    label: 'File import',
    blurb: 'A CSV exported from any reader or attendance software. Upload it whenever you have one.',
    capabilities: ['mapping'],
    addable: true,
    explicitDirection: true,
  },
  {
    vendor: 'HIKVISION',
    label: 'Hikvision terminal (ISAPI)',
    blurb: 'Hikvision face or card terminals reachable from the internet. CLOR pulls events every few minutes with the terminal’s user name and password.',
    capabilities: ['pull'],
    addable: true,
    explicitDirection: true,
    unverified: true,
  },
  {
    vendor: 'DAHUA',
    label: 'Dahua access controller',
    blurb: 'Dahua controllers reachable from the internet. CLOR pulls access records every few minutes.',
    capabilities: ['pull'],
    addable: true,
    explicitDirection: true,
    unverified: true,
  },
  {
    vendor: 'BIOSTAR',
    label: 'Suprema BioStar 2 server',
    blurb: 'A BioStar 2 server with its API on. CLOR signs in and pulls events every few minutes.',
    capabilities: ['pull'],
    addable: true,
    explicitDirection: true,
    unverified: true,
  },
  {
    vendor: 'HTTP_PULL',
    label: 'Any software with a JSON API',
    blurb: 'Attendance software or a device with its own API: give CLOR the URL to call (with {from} and {to}), how to sign in, and where each field is.',
    capabilities: ['pull', 'mapping'],
    addable: true,
    explicitDirection: true,
  },
  {
    vendor: 'ETIMEOFFICE',
    label: 'e-Time Office cloud',
    blurb: 'Punches pulled from your e-Time Office account.',
    capabilities: ['pull'],
    addable: true,
    explicitDirection: false,
  },
  {
    vendor: 'API',
    label: 'API key',
    blurb: 'Punches sent with an API key (Integrations).',
    capabilities: ['push'],
    addable: false,
    explicitDirection: true,
  },
];

const BY_VENDOR = new Map(DRIVERS.map((d) => [d.vendor, d]));

export const driverOf = (vendor: string | null | undefined) => BY_VENDOR.get(String(vendor || 'ADMS')) || BY_VENDOR.get('ADMS')!;
export const can = (vendor: string | null | undefined, capability: Capability) => driverOf(vendor).capabilities.includes(capability);

/** The vendors whose driver can do this — for Prisma `vendor: { in: … }` filters. */
export const vendorsWith = (capability: Capability) => DRIVERS.filter((d) => d.capabilities.includes(capability)).map((d) => d.vendor);

/** What the Readers screen needs to offer the right choices. */
export const publicDrivers = () =>
  DRIVERS.filter((d) => d.addable).map(({ vendor, label, blurb, capabilities, unverified }) => ({ vendor, label, blurb, capabilities, unverified: !!unverified }));
