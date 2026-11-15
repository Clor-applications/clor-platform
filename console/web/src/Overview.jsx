import React from 'react';
import { ExternalLink, RefreshCw } from 'lucide-react';

import { api } from './api';
import { Loading, Notice, PageHead, Pill, When, useLoad } from './kit';

/*
 * One list on the page ground: each part of the platform, how it is, one line
 * of fact, and when that was last checked. A part that cannot be checked says
 * so; it never keeps an old green.
 */
export default function Overview() {
  const { data, error, loading, reload } = useLoad(() => api.overview());
  return (
    <>
      <PageHead title="Overview">
        <button type="button" className="ui-btn ui-btn-secondary" onClick={reload} disabled={loading}>
          <RefreshCw size={16} aria-hidden="true" />
          <span>{loading && data ? 'Checking…' : 'Check again'}</span>
        </button>
      </PageHead>
      {error ? <Notice tone="bad">{error.message}</Notice> : null}
      {!data && loading ? <Loading /> : null}
      {data ? (
        <ul className="con-list" aria-label="Platform status">
          {data.rows.map((row) => (
            <li key={row.key} className="con-row con-row--status">
              <span className="con-row-name">{row.name}</span>
              <Pill tone={row.tone}>{row.state}</Pill>
              <span className="con-row-fact">
                {row.fact}
                {row.since ? <>, <When at={row.since} /></> : null}
                {row.link ? <a className="con-link con-link--icon" href={row.link} target="_blank" rel="noreferrer" aria-label={`Open ${row.name} in a new tab`}><ExternalLink size={14} aria-hidden="true" /></a> : null}
              </span>
              <span className="con-row-when con-quiet">{row.checkedAt ? <>Checked <When at={row.checkedAt} /></> : 'Never checked'}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}
