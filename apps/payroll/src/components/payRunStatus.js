// A calculated or reviewed run still needs work. Confirmed stages use the
// positive tone. Draft and cancelled runs use the ordinary neutral tone.
const TONES = {
  CALCULATED: 'info',
  REVIEW: 'info',
  APPROVED: 'pos',
  LOCKED: 'pos',
  PAID: 'pos',
  POSTED: 'pos',
};

export const payRunStatusTone = (status) => TONES[status] || 'neutral';
