import { useEffect, useState } from 'react';

/**
 * Registers the ⌘K / Ctrl+K shortcut and owns the palette's open state.
 *
 * Kept out of CommandPalette.jsx so that file exports only components and Fast
 * Refresh keeps working — the same reason useTheme lives beside Primitives
 * rather than inside it.
 */
export function useCommandPalette() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return { open, setOpen };
}
