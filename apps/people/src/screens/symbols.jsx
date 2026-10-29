/*
 * The pictures HR puts on an announcement or an event (owner, 28 Oct 2026):
 * a cake for a birthday, a diya for Diwali, a bat for the cricket Fun Friday.
 * Stored as a key; the server accepts these keys only
 * (server/src/services/people/workspace.ts SYMBOL_KEYS).
 */
export const SYMBOLS = [
  { key: 'party', emoji: '🎉', label: 'Celebration' },
  { key: 'cake', emoji: '🎂', label: 'Birthday cake' },
  { key: 'diya', emoji: '🪔', label: 'Diya' },
  { key: 'confetti', emoji: '🎊', label: 'Confetti' },
  { key: 'balloon', emoji: '🎈', label: 'Balloon' },
  { key: 'gift', emoji: '🎁', label: 'Gift' },
  { key: 'trophy', emoji: '🏆', label: 'Trophy' },
  { key: 'star', emoji: '⭐', label: 'Star' },
  { key: 'sparkles', emoji: '✨', label: 'Sparkles' },
  { key: 'heart', emoji: '❤️', label: 'Heart' },
  { key: 'wave', emoji: '👋', label: 'Welcome' },
  { key: 'megaphone', emoji: '📢', label: 'Announcement' },
  { key: 'pin', emoji: '📌', label: 'Pinned' },
  { key: 'pizza', emoji: '🍕', label: 'Pizza' },
  { key: 'cricket', emoji: '🏏', label: 'Cricket' },
  { key: 'music', emoji: '🎵', label: 'Music' },
  { key: 'rocket', emoji: '🚀', label: 'Launch' },
  { key: 'books', emoji: '📚', label: 'Learning' },
  { key: 'plane', emoji: '✈️', label: 'Trip' },
  { key: 'sun', emoji: '☀️', label: 'Holiday' },
];
const BY_KEY = new Map(SYMBOLS.map((s) => [s.key, s]));
export const symbolOf = (key) => BY_KEY.get(key) || null;

/* A row of symbols to pick one from; picking the chosen one again clears it. */
export function SymbolPicker({ id, label, value, onChange }) {
  return (
    <div className="sm:col-span-2" role="group" aria-labelledby={`${id}-label`}>
      <span id={`${id}-label`} className="ui-label">{label}</span>
      <div className="ws-symbols">
        {SYMBOLS.map((s) => (
          <button key={s.key} type="button" className="ws-symbol" aria-pressed={value === s.key} aria-label={s.label} title={s.label} onClick={() => onChange(value === s.key ? '' : s.key)}>
            <span aria-hidden="true">{s.emoji}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
