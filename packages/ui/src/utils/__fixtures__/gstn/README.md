# GSTN request schemas

The return builders in `../../gstrExport.js` are tested against these files
(`../../gstrSchemas.test.js`). Both are GSTN's own, byte for byte as
downloaded from the GST developer portal,
https://developer.gst.gov.in/apiportal/taxpayer/returns → View API List →
the API → Request Payload → Download Schema. The portal sits behind a CAPTCHA,
so they were downloaded by hand (captured in the india-gst-kit sources,
16 and 18 Oct 2026). Do not edit them; replace them with a newer download.

| File | Portal API | Version | Published | SHA-256 |
|---|---|---|---|---|
| `gstr1-save-v4.1-schema.json` | GSTR1 – Save GSTR1 data | v4.1 | 04-02-2025 | `db2c0313b8596a1fe88832202374cf2889595ad8dceb5f4730d3ab2b03543457` |
| `gstr3b-save-v7.1-schema.json` | GSTR3B – Save GSTR3B data | v7.1 | 23-03-2026 | `043917ea6fcbe34e97e851fde6cfe9a472aaefb2be503e9438973b16e67480ae` |

GSTR-1 is checked against v4.1, not the newer v5.0, because v4.1 is the shape
the GST Offline Tool (3.2.4) writes and the portal's "Prepare offline" upload
takes — `doc_issue.doc_det` with a numeric `doc_num`, where v5.0 has
`doc_det_new`.

The publisher's quirks are kept: GSTR-1 v4.1 has keys named `if` and `then`
among its top-level properties and `additionalProperties` on an array. The
validator runs with `strict: false` so it reads the rules GSTN wrote and
ignores the misplaced keywords, and with `multipleOfPrecision: 2` so that
`multipleOf: 0.01` is not failed by binary floating point (0.07 is not an
exact multiple of 0.01 in a double).
