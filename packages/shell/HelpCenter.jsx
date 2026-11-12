import React, { useMemo, useState } from 'react';
import { ArrowRight, BookOpen, ExternalLink, Mail, MessageCircle, Search } from '@ui/components/ui/lineIcons';

import { operator } from '@platform/operator';
import { HELP_GROUPS, HELP_TOPICS, searchHelp } from './helpContent';

/**
 * The Help centre, a page of the shell like My profile: every app opens it
 * from Help, and it never leaves CLOR. Topics down the left (searchable), the
 * article on the right with a way straight to the screen it describes. The
 * longer integration guides open as their own pages under /docs.
 */
const digits = (s) => String(s || '').replace(/\D/g, '');

export default function HelpCenter({ initialTopic = 'welcome', onOpen }) {
  const [query, setQuery] = useState('');
  const [current, setCurrent] = useState(HELP_TOPICS.some((t) => t.key === initialTopic) ? initialTopic : 'welcome');
  const found = useMemo(() => searchHelp(query), [query]);
  const topic = HELP_TOPICS.find((t) => t.key === current) || HELP_TOPICS[0];
  const whatsapp = digits(operator.supportWhatsapp);
  const email = operator.contactEmail;

  return (
    <div className="ui-help">
      <header className="ui-help-head">
        <h1 className="ui-t-page">Help centre</h1>
        <label className="ui-help-search">
          <span className="sr-only">Search help</span>
          <Search size={16} aria-hidden="true" />
          <input type="search" className="ui-input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search help" />
        </label>
      </header>

      <div className="ui-help-body">
        <nav className="ui-help-nav" aria-label="Help topics">
          {HELP_GROUPS.map((g) => {
            const items = found.filter((t) => t.group === g.key);
            if (!items.length) return null;
            return (
              <div key={g.key} className="ui-help-group">
                <p className="ui-help-group-label">{g.label}</p>
                {items.map((t) => (
                  <button key={t.key} type="button" className="ui-help-topic" aria-current={t.key === topic.key ? 'page' : undefined} onClick={() => setCurrent(t.key)}>
                    {t.title}
                    {t.doc ? <ExternalLink size={13} aria-hidden="true" /> : null}
                  </button>
                ))}
              </div>
            );
          })}
          {found.length ? null : <p className="ui-caption px-2">Nothing matches “{query}”.</p>}
        </nav>

        <article className="ui-help-article" aria-labelledby="help-title">
          <h2 id="help-title" className="ui-help-title">{topic.title}</h2>
          <p className="ui-help-summary">{topic.summary}</p>

          {(topic.sections || []).map((s) => (
            <section key={s.heading} className="ui-help-section">
              <h3>{s.heading}</h3>
              {s.steps ? (
                <ol>
                  {s.steps.map((x) => <li key={x}>{x}</li>)}
                </ol>
              ) : (
                <ul>
                  {(s.points || []).map((x) => <li key={x}>{x}</li>)}
                </ul>
              )}
            </section>
          ))}

          <div className="ui-help-actions">
            {topic.doc ? (
              <a className="ui-btn ui-btn-primary" href={topic.doc} target="_blank" rel="noopener">
                <BookOpen size={16} aria-hidden="true" /> Read the full guide <ExternalLink size={14} aria-hidden="true" />
              </a>
            ) : null}
            {topic.open && onOpen ? (
              <button type="button" className="ui-btn ui-btn-secondary" onClick={() => onOpen(topic.open.app, topic.open.screen)}>
                {topic.open.label} <ArrowRight size={16} aria-hidden="true" />
              </button>
            ) : null}
          </div>

          <aside className="ui-help-contact" aria-label="Contact support">
            <p className="ui-help-contact-title">Still stuck?</p>
            <div className="ui-help-contact-links">
              {email ? (
                <a href={`mailto:${email}`}><Mail size={15} aria-hidden="true" /> {email}</a>
              ) : (
                <a href="mailto:support@clor.in"><Mail size={15} aria-hidden="true" /> support@clor.in</a>
              )}
              {whatsapp ? (
                <a href={`https://wa.me/${whatsapp}`} target="_blank" rel="noopener"><MessageCircle size={15} aria-hidden="true" /> WhatsApp us</a>
              ) : null}
            </div>
          </aside>
        </article>
      </div>
    </div>
  );
}
