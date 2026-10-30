/* Referrals' small words, shared by the employee app and People (ReferJobs, Referrals). */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const istDay = (d) => (d ? (/^\d{4}-\d{2}-\d{2}$/.test(String(d)) ? String(d) : new Date(new Date(d).getTime() + 330 * 60_000).toISOString().slice(0, 10)) : '');

/** 30 Oct 2026, in India time. */
export const dayWords = (d) => {
  const [y, m, dd] = istDay(d).split('-');
  return y && m && dd ? `${Number(dd)} ${MONTHS[Number(m) - 1]} ${y}` : '';
};

/** ₹5,000 in Indian grouping. */
export const rupees = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
