import React, { useState } from "react";
import { Send } from "@ui/components/ui/lineIcons";

import Modal from "@ui/components/ui/Modal";
import { notify } from "@ui/components/ui/notify";
import { openTicket } from "@platform/admin/account";
import { appFromHost } from "./appHosts";

/*
 * Round 38 picks, from the Help menu every app shares (never Books):
 * - "Chatting with CLOR support" (B): Help opens a ticket form, so the
 *   question is tracked; the answer comes by email and the ticket is followed
 *   in Workspace → Help and support.
 * - "CLOR service status" (A): one place to check, clor.in/status.
 */

export const STATUS_URL = "https://clor.in/status";

/* The ticket's app, from the address: Workspace for the front door. */
const TICKET_APP = {
  people: "people",
  attendance: "attendance",
  payroll: "payroll",
  admin: "workspace",
};
export const ticketAppHere = (hostname) =>
  TICKET_APP[appFromHost(hostname)] || null;

export const ticketReady = (subject, body) =>
  subject.trim().length >= 4 && body.trim().length >= 10;

export default function AskSupport({ onClose }) {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [urgent, setUrgent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ready = ticketReady(subject, body);

  const send = async (e) => {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError("");
    try {
      await openTicket({
        subject: subject.trim(),
        body: body.trim(),
        category: "QUESTION",
        app: ticketAppHere(),
        requestId: null,
        urgent,
      });
      notify.success(
        "Sent to CLOR support. The answer comes by email; follow it in Workspace → Help and support.",
      );
      onClose();
    } catch (err) {
      setError(err?.message || "Could not send. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Ask CLOR support"
      onClose={onClose}
      maxWidthClass="max-w-lg"
      dirty={Boolean(subject || body)}
      footer={
        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="ui-btn ui-btn-secondary"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="submit"
            form="ask-support"
            className="ui-btn ui-btn-primary"
            disabled={!ready || busy}
          >
            <Send size={16} aria-hidden="true" />{" "}
            {busy ? "Sending…" : "Send to CLOR support"}
          </button>
        </div>
      }
    >
      <form id="ask-support" className="grid gap-4" onSubmit={send}>
        <p className="ui-caption">
          CLOR support answers by email, usually within one working day.
        </p>
        {error ? (
          <p role="alert" className="ui-text-neg text-sm">
            {error}
          </p>
        ) : null}
        <label className="grid gap-1">
          <span>Subject</span>
          <input
            className="ui-input"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            maxLength={160}
            placeholder="PF settings will not save"
            required
          />
        </label>
        <label className="grid gap-1">
          <span>What happened</span>
          <textarea
            className="ui-input"
            rows={5}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={8000}
            placeholder="What you did, what you expected, and what you saw instead."
            required
          />
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            className="ui-checkbox"
            checked={urgent}
            onChange={(e) => setUrgent(e.target.checked)}
          />
          <span>Urgent: work has stopped</span>
        </label>
      </form>
    </Modal>
  );
}
