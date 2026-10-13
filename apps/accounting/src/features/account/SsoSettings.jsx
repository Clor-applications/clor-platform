import React from 'react';
import { KeyRound, ShieldCheck } from 'lucide-react';

import { PageHeader } from '@ui/components/ui/Primitives';
import NotConnected from '@ui/components/ui/NotConnected';

/**
 * Single sign-on, and deliberately not a sign-in button.
 *
 * The database has carried an `AuthProvider` table — OIDC and SAML fields, per
 * organisation, disabled by default — since the multi-tenant work, and nothing
 * has ever driven it. This page says that plainly and shows what setting it up
 * will ask for.
 *
 * What it must never do is show a working-looking "Sign in with…" button. Of
 * everything that can be mocked, an authentication control is the one that is
 * genuinely unsafe: a button that appears to sign someone in and does not is
 * security theatre, and the person who trusts it is trusting it about who can
 * reach their books.
 *
 * There is no form here either. A half-configured provider is worse than none,
 * and the fields are listed rather than offered so nobody fills them in and
 * believes it took.
 */

const Field = ({ label, hint }) => (
  <div className="flex items-start justify-between gap-4 py-2">
    <div>
      <div className="text-sm">{label}</div>
      <div className="ui-caption ui-muted">{hint}</div>
    </div>
    <div className="ui-caption ui-muted shrink-0">Not set</div>
  </div>
);

export default function SsoSettings() {
  return (
    <div className="space-y-6">
      <PageHeader
        entity="settings"
        title="Single Sign-On"
            />

      <NotConnected what="single sign-on">
        Everyone signs in with an email and password today. Nothing on this page changes that, and there is no sign-in
        button here on purpose: one that looked like it worked would be telling you something untrue about who can reach
        your books.
      </NotConnected>

      <div className="ui-card p-4">
        <div className="flex items-start gap-3">
          <ShieldCheck size={18} aria-hidden="true" className="ui-muted mt-0.5" />
          <div>
            <div className="ui-label">How it will work</div>
            <p className="mt-1 max-w-2xl text-sm ui-muted">
              A provider is configured per company. People whose email address matches a domain you nominate are sent to
              your provider to sign in; everybody else keeps using a password. Roles and company access stay here — the
              provider says who somebody is, not what they may do.
            </p>
          </div>
        </div>
      </div>

      <div className="ui-card p-4">
        <div className="flex items-start gap-3">
          <KeyRound size={18} aria-hidden="true" className="ui-muted mt-0.5" />
          <div className="min-w-0 flex-1">
            <div className="ui-label">What it will ask for</div>
            <div className="mt-2 divide-y">
              <Field label="Provider type" hint="OpenID Connect or SAML 2.0" />
              <Field label="Issuer / entry point" hint="The address your provider signs people in at" />
              <Field label="Client ID and secret" hint="Issued by your provider when you register this application" />
              <Field label="Signing certificate" hint="SAML only — used to verify the assertion" />
              <Field label="Email domains" hint="Which addresses are sent to the provider rather than a password" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
