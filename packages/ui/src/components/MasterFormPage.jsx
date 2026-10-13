import { DocFormActions } from './DocumentForm';

/**
 * A master form, laid out as a screen.
 *
 * Master Data was a set of dialogs: a form in a box over a greyed-out list,
 * with its own Save at the bottom of whatever scrolled inside it. The documents
 * in Sales and Purchases have never worked that way — a new invoice takes the
 * screen, names itself at the top left, and keeps every way out of it at the
 * top right — and a master is a longer job than an invoice, not a shorter one.
 *
 * The bar is the form's own, so the submit button here is the form's submit.
 * Everything a particular master asks for goes in `children`; what does not
 * vary — the naming, the way back, the card the fields sit on — is here.
 */
export default function MasterFormPage({
  title,
  subtitle = '',
  onBack,
  primaryLabel,
  secondaryLabel = 'Cancel',
  menu = [],
  heading = '',
  description = '',
  children,
}) {
  return (
    <div className="space-y-6">
      <DocFormActions
        ownCard
        sticky
        title={title}
        subtitle={subtitle}
        onBack={onBack}
        backLabel="Back"
        secondaryLabel={secondaryLabel}
        onSecondary={onBack}
        primaryLabel={primaryLabel}
        primaryType="submit"
        menu={menu}
      />

      {/*
        A page that brings its own named sections gets no card of its own — two
        nested cards is the one thing DESIGN.md says a surface may not be. The
        shorter masters still pass a heading and keep theirs.
      */}
      {!heading && !description ? (
        children
      ) : (
      <section className="ui-card p-5 sm:p-6">
        {heading ? (
          <div className="mb-5">
            <h3 className="ui-t-sec">{heading}</h3>
            {description ? <p className="ui-caption mt-0.5">{description}</p> : null}
          </div>
        ) : null}
        {children}
      </section>
      )}
    </div>
  );
}
