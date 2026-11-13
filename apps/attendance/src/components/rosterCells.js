/* What a roster cell says: the shift's code, W weekly off, H holiday, L leave, – not employed. The grid and its export agree. */
export const cellLabel = (c) => (c.kind === 'OUT' ? '–' : c.kind === 'OFF' ? 'W' : c.kind === 'HOLIDAY' ? 'H' : c.kind === 'LEAVE' ? 'L' : c.code || (c.name || '').slice(0, 2));
