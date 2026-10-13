# CLOR — Payment Reminders: Configuration & Usage Guide

**Version 1.0 · 19 August 2026**

How to set up and run the collections desk: WhatsApp and email payment
reminders on the **Due → +7 → +15** schedule.

---

## 1. What this feature does

**Sales → Payment Reminders** lists every open invoice that still has a
balance, most overdue first, and sends the customer a ready-made reminder
through **WhatsApp** or **email** — one click, message prefilled, sent from
your own WhatsApp / mail account. No API, no per-message cost.

Every send is stamped on the invoice (date · channel · stage), so the screen
always knows which invoices still need a reminder at their current stage.

---

## 2. One-time configuration

### Step 1 — Enable the feature

Settings → **Features** → make sure **"Payment reminders"** is ON (it is on
by default). The "Payment Reminders" entry then appears under Sales in the
sidebar.

### Step 2 — Put mobile numbers and emails on customers

The buttons use the customer master:

| Field on customer | Used by |
|---|---|
| **Mobile** | WhatsApp button — a bare 10-digit number is automatically prefixed with **91** (India). Numbers already carrying a country code are used as-is. |
| **Email** | Email button — opens your mail client with subject and body filled. |

Customer has no mobile? The WhatsApp button still works — it opens WhatsApp's
own contact picker with the message ready; you choose the chat.

### Step 3 — Get due dates right

The schedule runs off each invoice's **due date**:

- Set **Credit period (days)** on the customer (customer master) — invoices
  then compute their due date automatically. Blank = 30 days, 0 = due on
  receipt.
- Or set the due date manually on the invoice.

An invoice without a due date never enters the reminder schedule.

---

## 3. The reminder schedule

| Stage | Trigger | Chip shown |
|---|---|---|
| 1 | On/after the **due date** | Due |
| 2 | **7+ days** overdue | 7+ days |
| 3 | **15+ days** overdue | 15+ days |

An invoice that has **reached a stage without a reminder sent at that stage**
is flagged **"Send now"** — that's your daily work queue. After you send, the
flag clears until the invoice crosses into the next stage.

Filter chips across the top: **All open · Send now · Due · 7+ days · 15+
days**, each with a live count.

---

## 4. Sending a reminder

Open **Sales → Payment Reminders** and use the buttons on any row:

| Button | What happens |
|---|---|
| **WhatsApp** | Opens `wa.me/<customer mobile>` in a new tab with the message prefilled. Press send in WhatsApp — done. |
| **Email** (envelope icon) | Opens your mail client with subject "Payment reminder — Invoice <no>" and the message as body. |
| **Copy** (copy icon) | Puts the message on the clipboard — paste into SMS, Telegram, anywhere. |

All three stamp the reminder history; the **Last reminder** column shows
`date · channel`.

### The message

> Dear <customer>,
>
> Gentle reminder: invoice <number> dated <date> for ₹<total> was due on
> <due date> (overdue by N days).
> Balance outstanding: ₹<balance>.
>
> View invoice: <link>
>
> Kindly arrange the payment at the earliest. Please ignore if already paid.
>
> Regards,
> <your company name>

- Amounts are the **live balance** (total minus receipts) at send time.
- The view link opens the invoice in CLOR (the viewer needs access).
- Not yet overdue → the wording switches to "is due on <date>".

---

## 5. Daily routine (suggested)

1. Open Payment Reminders → click **Send now**.
2. Work the list top-down (most overdue first) with the WhatsApp button.
3. Record receipts as money arrives — paid invoices drop off automatically.
4. Repeat tomorrow. Invoices crossing 7 or 15 days re-enter "Send now" on
   their own.

---

## 6. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Invoice not listed | It is Draft, Cancelled, Paid, or has zero balance — only open collectibles show. |
| Stuck at "Not due" | No due date on the invoice — set the customer's credit period or the invoice due date. |
| WhatsApp opens without a chat selected | Customer has no mobile on file — pick the contact manually, or add the Mobile on the customer master. |
| Wrong WhatsApp number | Number stored with extra digits/prefix — store either a bare 10-digit Indian mobile or a full number with country code. |
| "Clipboard unavailable" on Copy | Browser blocked clipboard access (http origin) — use the WhatsApp/Email buttons instead. |
| Reminder sent but "Send now" still on | The invoice moved into a HIGHER stage since the last send (e.g. sent at Due, now 7+ days) — that's by design: each stage gets its own reminder. |

---

## 7. What's deliberately NOT here (yet)

- **Automatic sending** — every reminder is human-triggered on purpose;
  wrongly-dunned customers cost more than a click. The WhatsApp Business API
  can slot in behind the same buttons when volume demands it.
- **Custom templates / dunning tiers per customer** — say the word if the
  standard message needs per-company wording.

---

## 8. Reference

| Where | |
|---|---|
| Screen | Sales → Payment Reminders |
| Feature flag | `paymentReminders` (Settings → Features) |
| Customer fields used | Mobile, Email, Credit period (days), Contact Person |
| Stored on invoice | `remindersSent: [{ date, channel, stage }]` |
| Code | `src/features/sales/PaymentReminders.jsx`, `src/utils/reminders.js` |
