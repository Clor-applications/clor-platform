/**
 * Discount rules engine.
 *
 * A rule lives in db.discountRules:
 * {
 *   id, companyId, name, active,
 *   validFrom, validTo,            // promotional window, either side optional
 *   itemScope: 'ALL'|'ITEM'|'ITEMS'|'CATEGORY', itemId, itemIds[], category,
 *   customerScope: 'ALL'|'CUSTOMER'|'CUSTOMERS'|'GROUP', customerId, customerIds[], groupId,
 *   type: 'PERCENT'|'FIXED',       // FIXED = amount off per unit
 *   value,                          // used when there are no tiers
 *   qtyTiers: [{ minQty, value }]   // quantity breaks: buy 10 → 5%, 50 → 10%…
 * }
 *
 * Resolution: all active, in-window, scope-matching rules compete; the one
 * giving the LARGEST money discount for this line wins. Tiers pick the
 * highest break the quantity reaches.
 */

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const inWindow = (rule, date) => {
  const d = String(date || '').slice(0, 10);
  if (rule.validFrom && d && d < String(rule.validFrom)) return false;
  if (rule.validTo && d && d > String(rule.validTo)) return false;
  return true;
};

const matchesItem = (rule, item) => {
  const scope = String(rule.itemScope || 'ALL');
  if (scope === 'ALL') return true;
  if (scope === 'ITEM') return String(rule.itemId) === String(item?.id);
  if (scope === 'ITEMS') {
    const ids = Array.isArray(rule.itemIds) ? rule.itemIds : [];
    return ids.some((id) => String(id) === String(item?.id));
  }
  if (scope === 'CATEGORY') {
    const cat = String(item?.category || '').trim().toLowerCase();
    return cat && cat === String(rule.category || '').trim().toLowerCase();
  }
  return false;
};

const matchesCustomer = (rule, customer) => {
  const scope = String(rule.customerScope || 'ALL');
  if (scope === 'ALL') return true;
  if (!customer) return false;
  if (scope === 'CUSTOMER') return String(rule.customerId) === String(customer.id);
  if (scope === 'CUSTOMERS') {
    const ids = Array.isArray(rule.customerIds) ? rule.customerIds : [];
    return ids.some((id) => String(id) === String(customer.id));
  }
  if (scope === 'GROUP') return String(rule.groupId) === String(customer.groupId);
  return false;
};

/** The rule's effective value for this quantity (tiers beat the flat value). */
export const effectiveRuleValue = (rule, qty) => {
  const tiers = (Array.isArray(rule.qtyTiers) ? rule.qtyTiers : [])
    .map((t) => ({ minQty: num(t.minQty), value: num(t.value) }))
    .filter((t) => t.minQty > 0 && t.value > 0)
    .sort((a, b) => b.minQty - a.minQty);
  for (const t of tiers) {
    if (num(qty) >= t.minQty) return t.value;
  }
  if (tiers.length) return 0; // tiered rule and quantity below the first break
  return num(rule.value);
};

/**
 * Best discount for one prospective line.
 * Returns { pct, fixedPerUnit, ruleName } or null. Only one of pct /
 * fixedPerUnit is non-zero — whichever the winning rule uses.
 */
export function resolveDiscountForLine({ db, companyId, customer, item, qty, rate, date }) {
  const rules = (Array.isArray(db?.discountRules) ? db.discountRules : []).filter(
    (r) => r.companyId === companyId && r.active !== false && inWindow(r, date) && matchesItem(r, item) && matchesCustomer(r, customer)
  );
  if (!rules.length) return null;

  const q = Math.max(1, num(qty));
  const r0 = num(rate);
  let best = null;
  for (const rule of rules) {
    const value = effectiveRuleValue(rule, q);
    if (value <= 0) continue;
    const isPct = String(rule.type || 'PERCENT') === 'PERCENT';
    const money = isPct ? (q * r0 * Math.min(value, 100)) / 100 : q * value;
    if (!best || money > best.money) {
      best = { money, pct: isPct ? Math.min(value, 100) : 0, fixedPerUnit: isPct ? 0 : value, ruleName: rule.name };
    }
  }
  return best ? { pct: best.pct, fixedPerUnit: best.fixedPerUnit, ruleName: best.ruleName } : null;
}
