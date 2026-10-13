/**
 * The band every landing screen opens with.
 *
 * Home had it and the modules did not: Sales, Purchases and Inventory each
 * opened with a plain heading and a sentence, so moving from Home into a module
 * changed the shape and the ground colour of the top of the page for no reason
 * a reader could name. One component now, used by all of them — the title, the
 * one line under it, whatever governs the page on the right, and the ways in
 * along the bottom.
 *
 * What differs between screens is only what goes in it: Home greets you and
 * puts search on the right, a module names itself and puts its period picker
 * there. The shape, the spacing and the colour are not the caller's to choose.
 */
export default function HeroBand({
  title,
  /** The quiet line above the title — a greeting, where there is one. */
  eyebrow = '',
  subtitle = null,
  right = null,
  meta = '',
  actions = [],
  /** A drawing at the far end of the band. Home has one; a module does not. */
  art = null,
  children,
}) {
  return (
    <section
      /*
        Tall enough for the drawing and no taller. At 15rem the band held the
        greeting, three lines and the buttons in its top half and nothing at all
        in its bottom one — a strip of empty ground between Home's first words
        and the work below them.
      */
      /* The tinted ground belongs to Home, which has the drawing and the
         greeting. A module overview is a page of figures: it takes the band's
         shape and spacing and leaves the wash behind, so nothing on it is
         coloured except the things that mean something. */
      className={`relative pt-1 ${art ? 'ui-hero-ground lg:min-h-[11.5rem]' : ''}`}
      aria-label="Overview"
    >
      {/* Behind the words, never over them: it ends before the text does at
          every width, and is gone entirely on a narrow screen. */}
      {art ? (
        <div
          /* Pinned to the foot of the band, clear of the search above it.
             Given the whole height it was squeezed into whatever the band
             happened to be and printed over the search box. */
          /*
            Taller than the band, deliberately. The drawing is wider than it is
            tall, so inside the band it was limited by the band's height and
            widening its box did nothing at all. It reaches a little above and
            below instead — the band keeps the height its words need, and the
            picture gets the size the design draws it at.
          */
          className="pointer-events-none absolute -top-6 -bottom-5 end-0 hidden w-[30rem] items-stretch justify-end lg:flex"
          aria-hidden="true"
        >
          {art}
        </div>
      ) : null}

      <div className={`relative flex justify-between gap-6 flex-wrap ${art ? 'items-start' : 'items-center'}`}>
        <div className="min-w-0">
          {eyebrow ? <p className="ui-t-body" style={{ color: 'rgb(var(--fg-muted))' }}>{eyebrow}</p> : null}
          {/* The name is the loudest thing on Home and a heading everywhere
              else, so the size follows the band's job rather than a prop. */}
          <h1
            className="ui-t-page"
            style={
              art
                ? { fontSize: '2.25rem', lineHeight: '2.625rem', letterSpacing: '-0.02em' }
                : { fontSize: 26, fontWeight: 700, lineHeight: '32px', letterSpacing: '-0.025em' }
            }
          >
            {title}
          </h1>

          {subtitle ? <div className="mt-1.5 flex items-center gap-2.5 flex-wrap">{subtitle}</div> : null}
        </div>

        {right ? <div className="relative flex flex-col items-end gap-1.5">{right}</div> : null}
      </div>

      {/* Under whatever sits on the right — a date, a filing window, a count. */}
      {meta ? <div className="ui-caption mt-1.5 text-end">{meta}</div> : null}

      {actions?.length ? (
        <div className="relative mt-4 flex flex-wrap gap-2">
          {actions.map((a, i) => (
            <button
              key={a.label}
              type="button"
              onClick={a.onClick}
              /* One primary, first. The rest are ways in, not invitations. */
              className={i === 0 ? 'ui-btn ui-btn-primary' : 'ui-btn ui-btn-secondary'}
            >
              {a.Icon ? <a.Icon size={16} aria-hidden="true" /> : null}
              {a.label}
            </button>
          ))}
        </div>
      ) : null}

      {children}
    </section>
  );
}
