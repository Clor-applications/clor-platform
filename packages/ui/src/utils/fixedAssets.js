/**
 * Fixed assets — WDV depreciation the way the IT Act computes it.
 *
 * Each asset: cost, purchase date, block (preset IT Act rates, editable per
 * asset), accumulated depreciation up to last FY. Current-FY depreciation:
 *   WDV = cost − accumulated
 *   dep = WDV × rate            (full rate)
 *   dep = WDV × rate / 2       when purchased THIS FY and used < 180 days
 * Closing WDV = WDV − dep.
 */

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const r2 = (v) => Math.round(num(v) * 100) / 100;

export const ASSET_BLOCKS = [
  { name: 'Building', rate: 10 },
  { name: 'Plant & Machinery', rate: 15 },
  { name: 'Furniture & Fittings', rate: 10 },
  { name: 'Computers & Software', rate: 40 },
  { name: 'Vehicles', rate: 15 },
  { name: 'Intangibles', rate: 25 },
];

/** Days from purchase to FY end decide full vs half rate. */
const usedUnder180Days = (purchaseDate, fy) => {
  const p = String(purchaseDate || '').slice(0, 10);
  if (!p || p < fy.from || p > fy.to) return false; // bought in an earlier FY → full rate
  const days = Math.round((new Date(`${fy.to}T00:00:00Z`) - new Date(`${p}T00:00:00Z`)) / 86400000) + 1;
  return days < 180;
};

export function computeAssetDep(asset, fy) {
  const cost = num(asset.cost);
  const accumulated = num(asset.accumulatedDep);
  const openingWdv = Math.max(0, r2(cost - accumulated));
  const boughtThisFy = String(asset.purchaseDate || '').slice(0, 10) >= fy.from;
  const half = usedUnder180Days(asset.purchaseDate, fy);
  const rate = num(asset.depRate);
  const dep = r2((openingWdv * rate) / 100 / (half ? 2 : 1));
  return {
    openingWdv,
    rateApplied: half ? rate / 2 : rate,
    halfRate: half,
    boughtThisFy,
    dep,
    closingWdv: r2(openingWdv - dep),
  };
}

export function assetRows(db, companyId, fy) {
  return (db?.fixedAssets || [])
    .filter((a) => a.companyId === companyId && a.active !== false)
    .map((a) => ({ asset: a, ...computeAssetDep(a, fy) }))
    .sort((a, b) => String(a.asset.block).localeCompare(String(b.asset.block)));
}
