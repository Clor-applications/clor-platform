import React from 'react';
import { Link } from '../router.jsx';
import { ArrowRight, Building2, FileText, Layers, Lock, Rocket, ShieldCheck, User, UserPlus, Users } from 'lucide-react';
import Illustration from './Illustration.jsx';
import { Reveal, RevealGroup } from './Blocks.jsx';

/*
 * Sections the home page and every product page share, so they stay word for
 * word the same: the section head, How it works and Trust and security.
 */
const STEPS = [
  { Icon: User, tone: 'orange', title: 'Create your workspace', text: 'Sign up and create your account.' },
  { Icon: Building2, tone: 'orange', title: 'Set up your company', text: 'Add your company details and structure.' },
  { Icon: Layers, tone: 'green', title: 'Choose your applications', text: 'Select the apps you need.' },
  { Icon: UserPlus, tone: 'blue', title: 'Invite your team', text: 'Add members and assign access.' },
  { Icon: Rocket, tone: 'orange', title: 'Start working', text: 'Go live and manage your business.' },
];

const TRUST = [
  { Icon: ShieldCheck, tone: 'green', title: 'Tenant isolation', text: 'Your data stays separate and secure.' },
  { Icon: Users, tone: 'orange', title: 'Scoped access', text: 'Role-based permissions across all applications.' },
  { Icon: FileText, tone: 'pink', title: 'Audit and control', text: 'Track activity and manage access.' },
  { Icon: Lock, tone: 'blue', title: 'Secure infrastructure', text: 'Built on modern, reliable cloud platform.' },
];

/** A section's small orange label, its title and its line under the title. */
export function Head({ eyebrow, title, intro, center = false, id }) {
  return (
    <div className={`head${center ? ' head--center' : ''}`}>
      {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
      <h2 className="h-1" id={id}>
        {title}
      </h2>
      {intro ? <p className="lede">{intro}</p> : null}
    </div>
  );
}


/** Get started in minutes: the five steps and the add-your-company form. */
export function HowItWorks() {
  return (
      <section className="section" id="how-it-works" aria-labelledby="how-title">
        <div className="wrap">
          <div className="panel-band">
            <Head id="how-title" eyebrow="How it works" title="Get started in minutes." />
            <RevealGroup as="ol" className="flow">
              {STEPS.map(({ Icon, tone, title, text }, i) => (
                <li key={title} className="flow-step" style={{ '--i': i }}>
                  <span className={`flow-icon tone-${tone}`} aria-hidden="true">
                    <Icon size={30} strokeWidth={1.75} />
                  </span>
                  <span className={`flow-n tone-${tone}`} aria-hidden="true">
                    {i + 1}
                  </span>
                  <h3 className="h-3">{title}</h3>
                  <p className="body">{text}</p>
                </li>
              ))}
            </RevealGroup>
            <Reveal className="flow-art">
              <Illustration src="/illustrations/start-form.webp" width={1300} height={260} alt="Adding your company in Clor: company name, country, industry and GST number, step one of four." />
            </Reveal>
          </div>
        </div>
      </section>
  );
}

/** Your data. Always protected. */
export function TrustBand() {
  return (
      <section className="section" aria-labelledby="trust-title">
        <div className="wrap">
          <div className="trust">
            <div className="trust-copy">
              <Head id="trust-title" eyebrow="Trust and security" title="Your data. Always protected." intro="Built with security, privacy and compliance at the core." />
              <RevealGroup as="ul" className="trust-cards">
                {TRUST.map(({ Icon, tone, title, text }, i) => (
                  <li key={title} className="trust-card" style={{ '--i': i }}>
                    <span className={`trust-icon tone-${tone}`} aria-hidden="true">
                      <Icon size={26} strokeWidth={1.75} />
                    </span>
                    <h3 className="h-3">{title}</h3>
                    <p className="body">{text}</p>
                  </li>
                ))}
              </RevealGroup>
              <Link className="btn btn--text" href="/security">
                How Clor keeps your data safe <ArrowRight size={16} strokeWidth={2} aria-hidden="true" />
              </Link>
            </div>
            <div className="trust-shield" aria-hidden="true">
              <span className="trust-shield-glow" />
              <span className="trust-shield-body">
                <Lock size={56} strokeWidth={1.5} />
              </span>
            </div>
          </div>
        </div>
      </section>
  );
}
