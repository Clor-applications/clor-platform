import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import { PageHeader } from '../ui/Primitives';
import { ListSearch, MoreButton, StatCards } from './ListPageParts';

/**
 * The shape of a document list page, in one place.
 *
 * Sales Invoices had it and its five siblings did not: a quotation list was a
 * bare heading, one primary button and a filter band, so moving between the two
 * screens meant learning the page again — search in a different place, export
 * behind a different control, no figures at the top and no status tabs at all.
 * The layout is the product's answer to "what is a list of documents", and it
 * cannot be the answer on one screen out of six.
 *
 * A shell rather than a whole page component: the columns, the row and what a
 * status means belong to the document, and forcing a challan through an invoice
 * template is how a list ends up with a Balance column that is always blank.
 * What is shared is where things sit and how they behave.
 *
 *   header  — title, description, search, page-level actions, one primary
 *   figures — the row of cards
 *   tabs    — status, with counts, as tinted pills
 *   table   — one card holding the whole grid
 *   tip     — one line under the table, dismissed for good
 */
export default function DocumentListShell({
  title,
  description = '',
  /* Which business object this list holds — see entityIdentity. Draws the
     mark beside the title in that area's colour family. */
  entity = '',
  search = null,
  headerExtras = null,
  moreItems = null,
  onMoreSelect = null,
  primary = null,
  cards = null,
  denseCards = false,
  company = null,
  tabs = null,
  statusValue = '',
  statusCounts = {},
  onStatusChange = null,
  tabsLabel = 'Status',
  statusInHeader = false,
  /*
   * Controls that ride the far end of the status row.
   *
   * A list whose narrowings do not fit in its column headings — a window over
   * a date, say — had nowhere to put them but a band across the page, which is
   * a second toolbar above the rows somebody came to read. The status row is
   * already there and already half empty.
   */
  tabsExtras = null,
  above = null,
  /*
   * Where the rows sit. Almost every list is a table and takes the card;
   * `plain` is for a page whose rows are cards in their own right — a company
   * switcher, say — because a card inside a card is the one thing DESIGN.md
   * says a list may not be.
   */
  surface = 'card',
  compact = true,
  tight = false,
  className = '',
  headerPortalId = '',
  children,
}) {
  const [headerHost, setHeaderHost] = useState(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setHeaderHost(headerPortalId ? document.getElementById(headerPortalId) : null);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [headerPortalId]);

  const header = (
    <PageHeader
      entity={entity}
      title={title}
      description={description}
      actions={
        <>
          {statusInHeader && tabs?.length ? (
            <select
              className="ui-select ui-ctl-compact w-44"
              value={statusValue}
              onChange={(event) => onStatusChange?.(event.target.value)}
              aria-label={tabsLabel}
            >
              {tabs.map((tab) => (
                <option key={tab.value || 'all'} value={tab.value}>
                  {tab.label} ({statusCounts[tab.value] ?? 0})
                </option>
              ))}
            </select>
          ) : null}
          {search?.before || null}
          {search ? (
            <ListSearch
              value={search.value}
              onChange={search.onChange}
              placeholder={search.placeholder}
              label={search.label || search.placeholder}
            />
          ) : null}
          {headerExtras}
          {moreItems?.length ? <MoreButton items={moreItems} onSelect={onMoreSelect} /> : null}
          {primary}
        </>
      }
    />
  );

  return (
    <div className={`${compact ? (tight ? 'space-y-2' : 'space-y-3') : 'space-y-6'} ${tight ? 'document-list-tight' : ''} ${className}`}>
      {headerHost ? createPortal(header, headerHost) : header}

      {cards?.length ? <StatCards company={company} cards={cards} dense={denseCards} /> : null}

      {tabs?.length && !statusInHeader ? (
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="ui-segmented" role="tablist" aria-label={tabsLabel}>
            {tabs.map((t) => {
              const on = statusValue === t.value;
              const n = statusCounts[t.value] ?? 0;
              return (
                <button
                  key={t.value || 'all'}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  onClick={() => onStatusChange?.(t.value)}
                  className="ui-segment"
                  data-tone={t.tone}
                >
                  {t.label}
                  {/* The colour marks something that is there. A red 0 next to
                      Overdue is an alarm about nothing; grey until it counts. */}
                  <span className="ui-segment-count" data-on={n > 0 ? 'true' : undefined}>
                    {n}
                  </span>
                </button>
              );
            })}
          </div>

          {tabsExtras ? (
            <div className="flex flex-wrap items-center gap-2 ms-auto">{tabsExtras}</div>
          ) : null}
        </div>
      ) : null}

      {/* An inline create form sits above the list it will add to, outside the
          table's own card — a form inside the table card reads as a row being
          edited in place, which is not what it is. */}
      {above}

      {/* One card, not two: the filters belong to the table they filter, and a
          separate floating box above it reads as an unrelated control panel. */}
      {surface === 'plain' ? children : <div className="ui-card overflow-hidden">{children}</div>}

    </div>
  );
}
