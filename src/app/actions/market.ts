'use server';

import { z } from 'zod';
import type { ActionResult } from '@/components/ui/form';
import { zUuid } from '@/lib/validation';
import { runAction } from '@/server/action';
import * as aiec from '@/server/services/aiec-contract';
import * as catalogue from '@/server/services/catalogue';
import { fileFromForm } from '@/server/services/files';
import * as quotes from '@/server/services/market-quotes';
import * as packages from '@/server/services/packages';
import * as rules from '@/server/services/rules';
import * as shop from '@/server/services/shop';

type R = Promise<ActionResult>;
const idOnly = z.object({ id: zUuid });

async function photosFrom(fd: FormData) {
  const out = [];
  for (const value of fd.getAll('photos')) {
    const file = await fileFromForm(value);
    if (file) out.push(file);
  }
  return out;
}
/** Collects `spec_<key>` inputs (and `spec_<key>[]` lists) into a specification object. */
function specsFrom(fd: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of new Set(fd.keys())) {
    if (!key.startsWith('spec_')) continue;
    const name = key.slice(5).replace(/\[\]$/, '');
    const values = fd.getAll(key).map(String).filter((v) => v.trim() !== '');
    if (key.endsWith('[]')) out[name] = values; else if (values.length) out[name] = values[values.length - 1];
  }
  return out;
}

// ───────────── customer ─────────────
export async function createShopProjectAction(_p: ActionResult, fd: FormData): R {
  return runAction(shop.shopProjectSchema, fd, async (i, ctx) => {
    const id = await shop.createShopProject(ctx, i, await photosFrom(fd));
    return { redirect: `/customer/shop/projects/${id}/packages` };
  });
}
export async function updateSpecAction(_p: ActionResult, fd: FormData): R {
  return runAction(shop.specSchema.extend({ leadId: zUuid }), fd, async ({ leadId, ...i }, ctx) => shop.updateProjectSpec(ctx, leadId, i, await photosFrom(fd)));
}
export async function startConfigurationAction(_p: ActionResult, fd: FormData): R {
  return runAction(shop.startSchema, fd, async (i, ctx) => ({ redirect: `/customer/shop/cart/${await shop.startConfiguration(ctx, i)}` }));
}
export async function setCartOptionAction(_p: ActionResult, fd: FormData): R {
  return runAction(shop.optionChangeSchema, fd, (i, ctx) => shop.setCartOption(ctx, i));
}
export async function saveConfigurationAction(_p: ActionResult, fd: FormData): R {
  return runAction(shop.configNameSchema.extend({ leadId: zUuid }), fd, async ({ leadId, ...i }, ctx) => {
    await shop.saveOrArchiveConfiguration(ctx, i);
    return i.action === 'ARCHIVE' ? { redirect: `/customer/shop/projects/${leadId}` } : { message: 'mk.cart.saved' };
  });
}
export async function requestQuotationAction(_p: ActionResult, fd: FormData): R {
  return runAction(quotes.requestQuotationSchema, fd, async (i, ctx) => ({ redirect: `/customer/shop/quotations/${(await quotes.requestQuotation(ctx, i)).quotationId}` }));
}
export async function respondQuotationAction(_p: ActionResult, fd: FormData): R {
  return runAction(quotes.respondSchema, fd, async (i, ctx) => {
    await quotes.respondQuotation(ctx, i);
    return { message: i.decision === 'ACCEPT' ? 'mk.quote.acceptedMsg' : 'mk.quote.declinedMsg' };
  });
}

// ───────────── supplier ─────────────
export async function saveSupplierProductAction(_p: ActionResult, fd: FormData): R {
  return runAction(catalogue.supplierProductSchema.extend({ image: z.instanceof(File).optional(), document: z.instanceof(File).optional() }), fd, async (i, ctx) => {
    const { image, document, ...input } = i;
    await catalogue.saveSupplierProduct(ctx, input, specsFrom(fd), { image: await fileFromForm(image), document: await fileFromForm(document) });
    return { message: 'common.saved' };
  });
}
export async function submitProductAction(_p: ActionResult, fd: FormData): R {
  return runAction(idOnly, fd, (i, ctx) => catalogue.submitProductForApproval(ctx, i.id));
}
export async function withdrawProductAction(_p: ActionResult, fd: FormData): R {
  return runAction(idOnly, fd, (i, ctx) => catalogue.withdrawProduct(ctx, i.id));
}
export async function stockAction(_p: ActionResult, fd: FormData): R {
  return runAction(catalogue.stockSchema, fd, (i, ctx) => catalogue.updateStock(ctx, i));
}
export async function submitPriceAction(_p: ActionResult, fd: FormData): R {
  return runAction(catalogue.priceSchema, fd, async (i, ctx) => {
    const r = await catalogue.submitPrice(ctx, i);
    return { message: r.flagged ? 'mk.sup.priceFlagged' : 'mk.sup.priceSubmitted' };
  });
}

// ───────────── AIEC staff ─────────────
export async function supplierStatusAction(_p: ActionResult, fd: FormData): R {
  return runAction(catalogue.supplierStatusSchema, fd, (i, ctx) => catalogue.setSupplierStatus(ctx, i));
}
export async function productReviewAction(_p: ActionResult, fd: FormData): R {
  return runAction(catalogue.productReviewSchema, fd, (i, ctx) => catalogue.reviewProduct(ctx, i));
}
export async function priceReviewAction(_p: ActionResult, fd: FormData): R {
  return runAction(catalogue.priceReviewSchema, fd, (i, ctx) => catalogue.reviewPrice(ctx, i));
}
export async function createPackageDraftAction(_p: ActionResult, fd: FormData): R {
  return runAction(idOnly, fd, async (i, ctx) => ({ redirect: `/admin/marketplace/packages/${await packages.createPackageDraft(ctx, i.id)}` }));
}
export async function updatePackageVersionAction(_p: ActionResult, fd: FormData): R {
  return runAction(packages.packageVersionSchema, fd, (i, ctx) => packages.updatePackageVersion(ctx, i));
}
export async function addSlotAction(_p: ActionResult, fd: FormData): R {
  return runAction(packages.slotSchema, fd, (i, ctx) => packages.addSlot(ctx, i));
}
export async function removeSlotAction(_p: ActionResult, fd: FormData): R {
  return runAction(idOnly, fd, (i, ctx) => packages.removeSlot(ctx, i.id));
}
export async function addOptionAction(_p: ActionResult, fd: FormData): R {
  return runAction(packages.optionSchema, fd, (i, ctx) => packages.addOption(ctx, i));
}
export async function removeOptionAction(_p: ActionResult, fd: FormData): R {
  return runAction(idOnly, fd, (i, ctx) => packages.removeOption(ctx, i.id));
}
export async function publishPackageAction(_p: ActionResult, fd: FormData): R {
  return runAction(idOnly, fd, async (i, ctx) => { await packages.publishPackageVersion(ctx, i.id); return { message: 'mk.pkg.published' }; });
}
export async function deletePackageDraftAction(_p: ActionResult, fd: FormData): R {
  return runAction(idOnly, fd, async (i, ctx) => { await packages.deletePackageDraft(ctx, i.id); return { redirect: '/admin/marketplace/packages' }; });
}
export async function createPricingDraftAction(_p: ActionResult, fd: FormData): R {
  return runAction(rules.pricingFormSchema, fd, async (i, ctx) => { await rules.createPricingDraft(ctx, rules.pricingParamsFromForm(i), i.note ?? null); });
}
export async function createCompatDraftAction(_p: ActionResult, fd: FormData): R {
  return runAction(rules.compatFormSchema, fd, async (i, ctx) => { await rules.createCompatibilityDraft(ctx, i); });
}
export async function activateRulesAction(_p: ActionResult, fd: FormData): R {
  return runAction(rules.activateSchema, fd, (i, ctx) => rules.activateRules(ctx, i));
}
export async function issueVersionAction(_p: ActionResult, fd: FormData): R {
  return runAction(quotes.issueSchema, fd, async (i, ctx) => { await quotes.issueNewVersion(ctx, i); return { message: 'mk.adm.versionCreated' }; });
}
export async function engineeringDecisionAction(_p: ActionResult, fd: FormData): R {
  return runAction(quotes.engineeringSchema, fd, (i, ctx) => quotes.engineeringDecision(ctx, i));
}
export async function pricingDecisionAction(_p: ActionResult, fd: FormData): R {
  return runAction(quotes.pricingDecisionSchema, fd, (i, ctx) => quotes.pricingExceptionDecision(ctx, i));
}

// ───────────── AIEC Contract execution ─────────────
export async function createAiecOrderAction(_p: ActionResult, fd: FormData): R {
  return runAction(aiec.aiecOrderSchema.extend({ file: z.instanceof(File).optional() }), fd, async ({ file, ...i }, ctx) =>
    ({ redirect: `/admin/orders/${await aiec.createAiecOrder(ctx, i, await fileFromForm(file))}` }));
}
export async function issueInvoiceAction(_p: ActionResult, fd: FormData): R {
  return runAction(aiec.invoiceSchema, fd, async (i, ctx) => { await aiec.issueCustomerInvoice(ctx, i); });
}
export async function cancelInvoiceAction(_p: ActionResult, fd: FormData): R {
  return runAction(aiec.cancelInvoiceSchema, fd, (i, ctx) => aiec.cancelCustomerInvoice(ctx, i));
}
export async function recordPaymentAction(_p: ActionResult, fd: FormData): R {
  return runAction(aiec.paymentSchema, fd, async (i, ctx) => { await aiec.recordCustomerPayment(ctx, i); return { message: 'mk.aiec.paymentRecorded' }; });
}
export async function verifyPaymentAction(_p: ActionResult, fd: FormData): R {
  return runAction(aiec.verifyPaymentSchema, fd, (i, ctx) => aiec.verifyCustomerPayment(ctx, i));
}
export async function refundAction(_p: ActionResult, fd: FormData): R {
  return runAction(aiec.refundSchema, fd, (i, ctx) => aiec.refundCustomerPayment(ctx, i));
}
export async function payoutAction(_p: ActionResult, fd: FormData): R {
  return runAction(aiec.payoutSchema, fd, (i, ctx) => aiec.actOnPayout(ctx, i));
}
