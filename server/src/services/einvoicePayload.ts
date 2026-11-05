import { prisma } from '../utils/prisma.js';
import { platformPrisma } from '../utils/platformPrisma.js';
import { buildInv01, type Inv01DocType, type Inv01Item, type Inv01Result } from '../gst/inv01.js';

/**
 * Loads a stored sales document with its company, buyer and item masters,
 * and builds its INV-01 payload (see gst/inv01.ts).
 */

const parse = (raw: string | null | undefined, fallback: any) => {
  try {
    const v = JSON.parse(String(raw || ''));
    return v && typeof v === 'object' ? v : fallback;
  } catch {
    return fallback;
  }
};

export type EInvoiceDocKind = 'invoice' | 'creditNote';

const DOC_TYPE: Record<EInvoiceDocKind, Inv01DocType> = { invoice: 'INV', creditNote: 'CRN' };

type Scope = { accountId: string; orgId: string };

async function loadDoc(kind: EInvoiceDocKind, id: string, scope: Scope) {
  if (kind === 'invoice') {
    const row = await prisma.invoice.findFirst({ where: { id, ...scope } });
    if (!row) return null;
    return {
      row,
      branchId: row.branchId,
      partyId: row.customerId,
      partyName: row.customerName,
      partyGstin: row.customerGstin,
      againstDocId: null as string | null,
    };
  }
  const row = await prisma.creditNote.findFirst({ where: { id, ...scope } });
  if (!row) return null;
  return {
    row,
    branchId: row.branchId,
    partyId: row.partyId,
    partyName: row.partyName,
    partyGstin: row.partyGstin,
    againstDocId: row.againstDocId,
  };
}

export type BuiltEInvoice = { found: false } | ({ found: true; docNumber: string } & Inv01Result);

export async function buildEInvoiceFor(kind: EInvoiceDocKind, id: string, scope: Scope): Promise<BuiltEInvoice> {
  const doc = await loadDoc(kind, id, scope);
  if (!doc) return { found: false };
  const { row } = doc;
  const extras = parse(row.extrasJson, {});
  const lines = parse(row.itemsJson, []) as any[];

  const itemIds = [...new Set(lines.map((l) => String(l?.itemId ?? '')).filter(Boolean))];
  const [org, branch, party, items, original] = await Promise.all([
    platformPrisma.org.findUnique({ where: { id: scope.orgId }, select: { name: true, legalName: true, profileJson: true } }),
    platformPrisma.branch.findFirst({ where: { id: doc.branchId, orgId: scope.orgId } }),
    doc.partyId ? prisma.party.findFirst({ where: { id: doc.partyId, ...scope } }) : null,
    itemIds.length
      ? prisma.itemMaster.findMany({
          where: { ...scope, id: { in: itemIds } },
          select: { id: true, name: true, hsnSac: true, unit: true, itemType: true },
        })
      : [],
    doc.againstDocId ? prisma.invoice.findFirst({ where: { id: doc.againstDocId, ...scope }, select: { number: true, date: true } }) : null,
  ]);
  const profile = parse(org?.profileJson, {});

  const result = buildInv01({
    docType: DOC_TYPE[kind],
    doc: {
      number: row.number,
      date: row.date,
      partyGstin: doc.partyGstin,
      partyName: doc.partyName,
      placeOfSupplyState: row.placeOfSupplyState,
      reverseCharge: 'reverseCharge' in row ? Boolean((row as any).reverseCharge) : false,
      igstTotal: Number(row.igstTotal),
      total: Number(row.total),
      currency: row.currency,
      supplyType: extras.supplyType ?? null,
      otherChargesTotal: extras.otherChargesTotal ?? null,
      lines,
      original: original ? { number: original.number, date: original.date } : null,
    },
    seller: {
      // A branch registered on its own GSTIN issues under that GSTIN and address.
      gstin: branch?.gstin || profile.gstin,
      legalName: org?.legalName || org?.name,
      tradeName: profile.tradeName,
      address1: (branch?.gstin && branch.addressLine1) || profile.addressLine || branch?.addressLine1,
      address2: branch?.gstin ? branch.addressLine2 : null,
      city: (branch?.gstin && branch.city) || profile.city || branch?.city,
      pincode: profile.pincode,
      state: branch?.state || profile.state,
    },
    buyer: {
      gstin: party?.gstin,
      legalName: party?.legalName || party?.name || doc.partyName,
      registrationType: party?.gstRegistrationType,
      address1: party?.billingLine1,
      address2: party?.billingLine2,
      city: party?.billingCity,
      pincode: party?.billingPincode,
      state: party?.billingState || party?.placeOfSupplyState,
      country: party?.billingCountry,
    },
    items: new Map<string, Inv01Item>(items.map((it) => [it.id, it])),
  });
  return { found: true, docNumber: row.number, ...result };
}
