/**
 * Sign the on-site connector so a customer's box only ever installs a file we made.
 *
 *   AGENT_SIGNING_KEY_FILE=~/.config/clor/agent-signing.key node scripts/sign-agent.mjs
 *       reads dist-agent/clor-agent.cjs and writes beside it
 *         clor-agent.cjs.sig     the Ed25519 signature of its bytes, base64
 *         clor-agent.cjs.sha256  its SHA-256, hex (for people checking by hand)
 *
 *   node scripts/sign-agent.mjs --keygen <dir>
 *       makes a new key pair: <dir>/agent-signing.key (PKCS#8 PEM, mode 600)
 *       and <dir>/agent-signing.pub, and prints the public PEM. Refuses to
 *       overwrite a key that is already there.
 *
 * The public half is compiled into the connector (agent/src/signing.ts); the
 * private half never goes near a repository or an image. Run after
 * `npm run agent:build`, before `gcloud builds submit` (see DEPLOY.md).
 */
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fail = (msg) => {
  console.error(msg);
  process.exit(1);
};

const k = process.argv.indexOf('--keygen');
if (k !== -1) {
  const dir = process.argv[k + 1];
  if (!dir) fail('Give the folder for the key pair: --keygen <dir>');
  const keyFile = path.join(dir, 'agent-signing.key');
  const pubFile = path.join(dir, 'agent-signing.pub');
  if (fs.existsSync(keyFile)) fail(`${keyFile} already exists; not overwriting it. Delete it yourself if you really mean to replace the key (every connector in the field would then refuse updates).`);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const pub = publicKey.export({ type: 'spki', format: 'pem' });
  fs.writeFileSync(keyFile, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  fs.chmodSync(keyFile, 0o600);
  fs.writeFileSync(pubFile, pub, { mode: 0o644 });
  console.log(`Private key: ${keyFile} (keep it out of every repository)\nPublic key:  ${pubFile}\n\n${pub}`);
  process.exit(0);
}

const keyFile = process.env.AGENT_SIGNING_KEY_FILE;
if (!keyFile) fail('Set AGENT_SIGNING_KEY_FILE to the private key (PEM), e.g. AGENT_SIGNING_KEY_FILE=$HOME/.config/clor/agent-signing.key');
const file = path.join(root, 'dist-agent/clor-agent.cjs');
if (!fs.existsSync(file)) fail(`${file} is not there; run npm run agent:build first.`);

let privateKey;
try {
  privateKey = createPrivateKey(fs.readFileSync(keyFile));
} catch (e) {
  fail(`Could not read the signing key ${keyFile}: ${e.message}`);
}
if (privateKey.asymmetricKeyType !== 'ed25519') fail(`${keyFile} is a ${privateKey.asymmetricKeyType} key; the connector checks Ed25519 signatures.`);

const code = fs.readFileSync(file);
const sig = sign(null, code, privateKey);
/* Sign, then check with the public half, so a broken key never ships a file nobody can install. */
if (!verify(null, code, createPublicKey(privateKey), sig)) fail('The signature did not verify against its own key; nothing written.');
const sha = createHash('sha256').update(code).digest('hex');
fs.writeFileSync(`${file}.sig`, sig.toString('base64') + '\n');
fs.writeFileSync(`${file}.sha256`, sha + '\n');
const pubFingerprint = createHash('sha256').update(createPublicKey(privateKey).export({ type: 'spki', format: 'pem' })).digest('hex');
console.log(`Signed dist-agent/clor-agent.cjs (${code.length} bytes, sha256 ${sha}) with key ${pubFingerprint.slice(0, 16)}…`);
