# CLOR — e-Invoice (IRP) & e-Way Bill Integration Guide

**Version 1.0 · 19 August 2026**

This document explains how CLOR reports invoices to the GST network: what
happens technically, what credentials you need, how to configure the
connection, and how to operate it day to day.

---

## 1. What this integration does

When a sales invoice is created in CLOR, it can be **registered on the
Invoice Registration Portal (IRP)** — the GST network's system at
`einvoice1.gst.gov.in`. Registration returns:

- **IRN** (Invoice Reference Number) — a SHA-256 hash that is the invoice's
  legal identity on the GST network. One invoice, one IRN, forever.
- **Acknowledgement number and date** — proof of registration.
- **Signed QR code** — a JWT signed by the GST system. This must be printed
  on the invoice document.

Once an invoice has an IRN, an **e-Way Bill** can be generated from it in one
call — no re-entry of invoice data on the e-way bill portal.

### Who must e-invoice

B2B invoices of businesses with aggregate turnover above **₹5 crore** must be
registered on the IRP. Below the threshold it is optional. B2C invoices are
never registered (they carry a self-generated QR instead).

---

## 2. The two connection modes

CLOR supports two providers, selected in
**Settings → Tax & Compliance → e-Invoice (IRP)**:

| | **NIC direct** | **GSP gateway** |
|---|---|---|
| Who runs it | Government (NIC) | Private GSP (MasterGST, ClearTax, Cygnet…) |
| Cost | Free | Subscription |
| Signup | einvoice1.gst.gov.in → API registration | GSP's own portal |
| Protocol | Encrypted handshake (RSA + AES, below) | Plain REST with API keys |
| Best for | Direct control, no middleman | Simpler ops, support, no IP whitelisting |

Both end at the same IRP; the IRN is identical either way.

---

## 3. How the NIC direct protocol works

CLOR implements the NIC API specification (v1.04 auth / v1.03 core, as
published under Help → API sandbox on einvoice1.gst.gov.in):

**Step 1 — Authentication** (`POST {base}/eivital/v1.04/auth`)

1. CLOR generates a random 32-byte **AppKey**.
2. Your username, password and the AppKey are put in a JSON payload,
   base64-encoded, then **RSA-encrypted with the portal's public key** (the
   PEM you paste into settings).
3. The portal answers with an **AuthToken** and a **Sek** (session encryption
   key), where the Sek is AES-256-ECB encrypted under your AppKey. CLOR
   decrypts it and caches the session (~55 minutes; sandbox tokens live 60).

**Step 2 — Generate IRN** (`POST {base}/eicore/v1.03/Invoice`)

1. The invoice is converted to the NIC **INV-01 schema** (the same JSON the
   "e-Invoice JSON" download produces).
2. The payload is AES-256-ECB encrypted under the Sek and sent with the
   AuthToken.
3. The response is decrypted the same way and the IRN, acknowledgement and
   signed QR are stored on the invoice. Errors (e.g. "Duplicate IRN") are
   decoded from the portal's base64 error format into readable messages.

**Step 3 — e-Way Bill from IRN** (`POST {base}/eiewb/v1.03/ewaybill`)

Same encryption; the request carries the IRN plus transport details
(transporter ID, vehicle number, mode, distance). The EWB number, date and
validity are stored on the invoice.

**Security posture**: your API password and client secret are stored
**AES-256-GCM encrypted** in the CLOR database and are never returned by
any API — the settings form only shows *whether* a secret is on file. All
IRP calls happen server-side; the browser never sees credentials.

---

## 4. Getting sandbox credentials (do this first)

The sandbox is free and safe — IRNs generated there are not legal documents.

1. Open **https://einv-apisandbox.nic.in** and choose **Register**.
2. Register with your **GSTIN** and mobile/e-mail OTP.
3. Note the four values issued: **client_id**, **client_secret**,
   **username**, **password** (you set the username/password during API user
   creation).
4. During registration you declare your **public IP address** — the sandbox
   only accepts calls from whitelisted IPs. Use the public IP of the machine
   running the CLOR server (`curl ifconfig.me` shows it).
5. Download the **sandbox public key** (Certificates section of the sandbox
   portal) — a `.pem` file beginning `-----BEGIN PUBLIC KEY-----`.

For **production** you repeat the equivalent registration on
einvoice1.gst.gov.in (API registration → Direct access; requires the
e-invoice-enabled GSTIN) and download the *production* public key — the keys
differ between sandbox and production.

---

## 5. Configuring CLOR

1. **Settings → Features** → enable **"e-Invoice and e-Way Bill JSON"**
   (the `einvoice` feature flag).
2. **Settings → Tax & Compliance** → make sure GST is enabled and the
   company **GSTIN** is set.
3. In the **e-Invoice (IRP)** card:

   | Field | Value |
   |---|---|
   | Provider | **NIC direct API** |
   | Mode | **Sandbox** (switch to Production only after end-to-end testing) |
   | NIC base URL | `https://einv-apisandbox.nic.in` |
   | GSTIN used at the gateway | your GSTIN |
   | API username / password | from sandbox registration |
   | Client ID / Client secret | from sandbox registration |
   | NIC public key (PEM) | paste the downloaded key file's contents |

4. Click **Test connection**. This runs the real auth handshake — a green
   toast proves the URL, all four credentials AND the public key together.
5. (Optional) tick **Auto-register new invoices on the IRP** — every
   non-draft invoice will then fetch its IRN at creation time.

Using a **GSP instead**: set Provider to *GSP REST gateway*, paste the base
URL and keys from your GSP's dashboard, and add any extra static headers the
GSP requires as a JSON object (e.g. `{"ip_address": "…"}`). No public key
needed.

---

## 6. Day-to-day operation

**Registering an invoice**

1. Create the invoice normally (Sales → Invoices → New Invoice).
2. Open the invoice's row menu (⋯) → **Register on IRP (get IRN)**.
3. The IRN appears in a toast and is stored on the invoice; the menu entry
   now shows the IRN. A second registration attempt is refused — IRNs are
   immutable.

With auto-register enabled, step 2 happens by itself right after creation.

**Generating the e-Way Bill**

1. On an invoice that already has an IRN, the row menu shows
   **Generate e-Way Bill (from IRN)**.
2. The EWB number and validity are stored and shown in the menu.
3. Transport details (vehicle number, transporter ID, mode) can be supplied
   through the API; goods movements without an e-invoice (delivery challans,
   B2C) still use the e-way bill portal directly.

**Manual fallback (no credentials yet)**

The row menu's **e-Invoice JSON** / **e-Way Bill JSON** actions download
NIC-schema files that can be uploaded through the portals' bulk tools by
hand. Same schema, no API needed.

---

## 7. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| "No e-Invoice gateway configured" | Base URL empty — fill the settings card. |
| "NIC provider needs the … public key" | PEM field empty, or you pasted the certificate instead of the public key. |
| "Could not encrypt the auth payload" | Malformed PEM — paste the full block including BEGIN/END lines. |
| "Could not reach the NIC e-Invoice API" | Network/DNS, or your IP is not whitelisted at the sandbox. |
| "NIC auth failed: …" | Wrong client_id/secret/username/password, or sandbox account locked. |
| "Duplicate IRN" | The same invoice (GSTIN + doc type + number + FY) is already registered — the IRP enforces uniqueness. |
| "Register the invoice on the IRP first" | e-Way Bill was requested before the IRN exists. |
| "e-Invoicing is switched off" | Enable the feature under Settings → Features. |
| Errors after ~1 hour of use | Token expiry — CLOR re-authenticates automatically on the next call; a one-off failure between the two is normal in the sandbox. |

---

## 8. Reference — endpoints and artifacts

| Purpose | Endpoint (NIC) |
|---|---|
| Authentication | `POST /eivital/v1.04/auth` |
| Generate IRN | `POST /eicore/v1.03/Invoice` |
| e-Way Bill by IRN | `POST /eiewb/v1.03/ewaybill` |

| Where things live in CLOR | |
|---|---|
| Settings UI | Settings → Tax & Compliance → e-Invoice (IRP) |
| Server service | `server/src/services/einvoice.ts` |
| Server routes | `server/src/routes/einvoice.ts` |
| INV-01 / EWB-01 builders | `src/utils/einvoice.js` |
| Stored on invoice | IRN, ack no/date, signed QR, EWB no/date/validity |
| Tests | `server/src/__tests__/einvoice.test.ts` (crypto interop against a stub NIC server) |

**External references**

- Sandbox portal & API docs: https://einv-apisandbox.nic.in
- Production portal: https://einvoice1.gst.gov.in (Help → Presentation → API sandbox)
- e-Way Bill API specification: https://docs.ewaybillgst.gov.in/Documents/EWB_API.pdf
