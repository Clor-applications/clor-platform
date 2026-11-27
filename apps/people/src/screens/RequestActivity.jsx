import React from 'react';
import { istDay } from '@ui/utils/dates';
import { formatDate } from '@ui/components/ui/DatePicker';

const stepLabels = {
  MORE_INFO: 'Asked for more information',
  APPROVED: 'Approved a step',
  REJECTED: 'Rejected the request',
  HANDED_ON: 'Passed to another reviewer',
  WITHDRAWN: 'Withdrew the request',
};

function latestEvents(requests) {
  const events = [];
  for (const request of requests) {
    events.push({ key: request.id, request, at: request.createdAt, actor: 'You', label: 'Submitted the request' });
    for (const step of request.steps || []) {
      const label = stepLabels[step.status];
      if (label && step.decidedAt) {
        events.push({ key: step.id, request, at: step.decidedAt, actor: step.decidedBy, label, status: step.status });
      }
    }
  }
  return events.filter(event => Number.isFinite(Date.parse(event.at)))
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 4);
}

export default function RequestActivity({ requests, onOpen }) {
  const events = latestEvents(requests);
  if (!events.length) return null;
  return (
    <aside className="inbox-activity" aria-labelledby="request-activity-title">
      <h2 id="request-activity-title">Recent request activity</h2>
      <ol>
        {events.map(({ key, request, at, actor, label, status }) => (
          <li key={key} data-status={status}>
            <time dateTime={at}>{formatDate(istDay(at))}</time>
            <button className="inbox-activity-link" type="button" onClick={() => onOpen(request)}>
              {request.title}<span aria-hidden="true"> ↗</span>
            </button>
            <span className="inbox-activity-detail">{label}{actor && <> · {actor}</>}</span>
          </li>
        ))}
      </ol>
    </aside>
  );
}
