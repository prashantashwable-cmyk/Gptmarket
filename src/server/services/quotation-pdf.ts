import 'server-only';
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { fromPaise, percentOf, toPaise } from '@/lib/commission';
import { market as enMarket } from '@/i18n/messages/en/market';
import type { Rec } from '../db';

// The PDF uses the standard Helvetica font (WinAnsi). It cannot draw ₹ or Devanagari, so
// amounts use "Rs." and any character outside WinAnsi is replaced. The on-screen quotation
// is the multilingual version; this PDF is the English document copy.
const safe = (v: unknown): string => String(v ?? '').replace(/[^\x20-\x7E -ÿ]/g, '?');
const rs = (v: string | number | null | undefined) => {
  if (v === null || v === undefined) return '-';
  const n = Number(v);
  const fraction = Math.round(n * 100) % 100 !== 0 ? 2 : 0;
  return `Rs. ${new Intl.NumberFormat('en-IN', { minimumFractionDigits: fraction, maximumFractionDigits: fraction }).format(n)}`;
};
const categoryLabel = (code: string) => (enMarket.e.componentCategory as Record<string, string>)[code] ?? code;
const label = (code: string) => code.toLowerCase().replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

const NAVY = rgb(0.06, 0.14, 0.3);
const GREY = rgb(0.35, 0.38, 0.42);

export async function renderQuotationPdf(q: Rec, v: Rec, approvals: Rec[]): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${q.quotation_number} v${v.version_no}`);
  pdf.setAuthor('ALL INDIA ELEVATORS COMPANY (AIEC)');
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const snap = v.snapshot as Rec;
  let page: PDFPage = pdf.addPage([595, 842]);
  let y = 800;
  const M = 40; const W = 515;

  const newPageIfNeeded = (h: number) => { if (y - h < 50) { page = pdf.addPage([595, 842]); y = 800; } };
  const text = (s: string, x: number, size = 9, f: PDFFont = font, color = rgb(0, 0, 0)) => page.drawText(safe(s), { x, y, size, font: f, color });
  const wrap = (s: string, size: number, width: number, f: PDFFont = font): string[] => {
    const words = safe(s).split(/\s+/); const lines: string[] = []; let cur = '';
    for (const w of words) { const next = cur ? `${cur} ${w}` : w; if (f.widthOfTextAtSize(next, size) > width && cur) { lines.push(cur); cur = w; } else cur = next; }
    if (cur) lines.push(cur);
    return lines;
  };
  const para = (s: string, size = 9, f: PDFFont = font, color = rgb(0, 0, 0)) => { for (const line of wrap(s, size, W, f)) { newPageIfNeeded(size + 4); text(line, M, size, f, color); y -= size + 4; } };
  const heading = (s: string) => { y -= 8; newPageIfNeeded(30); text(s, M, 11, bold, NAVY); y -= 6; page.drawLine({ start: { x: M, y }, end: { x: M + W, y }, thickness: 0.5, color: NAVY }); y -= 14; };
  const row = (l: string, r: string, f: PDFFont = font) => { newPageIfNeeded(14); text(l, M, 9, f); const w = f.widthOfTextAtSize(safe(r), 9); text(r, M + W - w, 9, f); y -= 14; };

  page.drawRectangle({ x: 0, y: 772, width: 595, height: 70, color: NAVY });
  y = 812; text('ALL INDIA ELEVATORS COMPANY (AIEC)', M, 14, bold, rgb(1, 1, 1)); y -= 18;
  text('AIEC Lift Marketplace - Package quotation', M, 10, font, rgb(0.85, 0.87, 0.9));
  y = 750;
  text(`${q.quotation_number}  version ${v.version_no}`, M, 13, bold); y -= 16;
  const basis = v.price_basis === 'FINAL' ? 'FINAL PRICE (based on AIEC site survey)' : 'ESTIMATED PRICE - not a final offer (dimensions not yet surveyed)';
  text(basis, M, 10, bold, v.price_basis === 'FINAL' ? rgb(0.05, 0.45, 0.2) : rgb(0.7, 0.35, 0)); y -= 14;
  text(`Status: ${label(q.status)}   Issued: ${String(v.created_at instanceof Date ? v.created_at.toISOString() : v.created_at).slice(0, 10)}   Valid until: ${v.valid_until}`, M, 9, font, GREY); y -= 8;

  heading('Customer and project');
  para(`Customer: ${snap.customer.name} (${snap.customer.phone})`);
  para(`Project: ${snap.project.projectName} (${snap.project.leadNumber}), ${snap.project.address}, zone ${snap.project.zoneCode}`);
  para(`Package: ${snap.package.title} (package version ${snap.package.versionNo}). Pricing rules v${snap.rules.pricingVersion}, compatibility rules v${snap.rules.compatibilityVersion}.`);

  heading('Lift specification');
  const s = snap.spec as Rec;
  para(`Purpose: ${(enMarket.e.liftPurpose as Record<string, string>)[s.purpose] ?? label(s.purpose)}. Persons: ${s.persons ?? '-'}. Rated load: ${s.ratedLoadKg ?? '-'} kg. Speed: ${s.speedMps ?? '-'} m/s. Floors: ${s.floors ?? '-'}. Stops: ${s.stops ?? '-'}.`);
  para(`Shaft: ${s.shaftWidthMm ?? '-'} x ${s.shaftDepthMm ?? '-'} mm. Pit: ${s.pitDepthMm ?? '-'} mm. Overhead: ${s.overheadMm ?? '-'} mm. Power: ${label(s.powerSupply)}. Accessibility: ${s.accessibility ? 'Yes' : 'No'}.`);
  para(`Dimensions source: ${s.source === 'SURVEYED' ? 'AIEC site survey (reviewed)' : 'declared by the customer (to be verified by survey)'}.`, 8, font, GREY);

  heading('Component-wise breakdown');
  for (const l of snap.lines as Rec[]) {
    newPageIfNeeded(28);
    text(`${categoryLabel(l.category)}${l.isSafetyCritical ? ' (safety - mandatory)' : ''}`, M, 9, bold);
    const price = rs(l.customerPrice); text(price, M + W - font.widthOfTextAtSize(safe(price), 9), 9); y -= 11;
    const detail = `${l.productName} - ${l.brand} ${l.model} - supplier ${l.supplierName} - qty ${l.quantity} - warranty ${l.warrantyMonths} months${Number(l.upgradeCharge) > 0 ? ` - includes upgrade ${rs(l.upgradeCharge)}` : ''}`;
    for (const line of wrap(detail, 8, W - 8)) { newPageIfNeeded(11); text(line, M + 8, 8, font, GREY); y -= 10; }
    y -= 4;
  }

  heading('Charges');
  row('Components and materials', rs(v.charge_materials));
  row('Installation', rs(v.charge_installation));
  row('Transportation', rs(v.charge_transport));
  row('Site work and other project charges', rs(v.charge_site_work));
  if (Number(v.discount_amount) > 0) row(`Discount (${Number(v.discount_percent)}%)`, `- ${rs(v.discount_amount)}`);
  row('Amount before GST', rs(v.selling_price));
  row(`GST (${Number(v.gst_percent)}%, estimated)`, rs(v.gst_amount));
  row(v.price_basis === 'FINAL' ? 'Total payable' : 'Estimated total', rs(v.total_payable), bold);

  heading('Payment milestones');
  const total = toPaise(v.total_payable); let used = 0n;
  (snap.paymentMilestones as Array<{ name: string; percent: number }>).forEach((m, i, all) => {
    const amt = i === all.length - 1 ? total - used : percentOf(total, BigInt(Math.round(m.percent * 10000))); used += amt;
    row(`${m.name} (${m.percent}%)`, rs(fromPaise(amt)));
  });

  heading('Warranty and exclusions');
  para(`Package warranty: ${snap.package.warrantyMonths} months from handover, subject to the signed contract. Component warranties as listed above.`);
  if (snap.package.exclusions) para(`Exclusions: ${String(snap.package.exclusions).split('\n').filter(Boolean).join('; ')}.`);

  heading('Technical approval status');
  const c = snap.compat as Rec;
  para(`Automated compatibility check: ${c.status}. ${(c.findings as Rec[]).map((f) => `[${f.level}] ${label(f.code)}`).join('; ') || 'No findings.'}`);
  const eng = approvals.find((a) => a.version_id === v.id && a.kind === 'ENGINEERING');
  para(eng ? `Engineering decision: ${eng.decision} by ${eng.decided_by_name} on ${String(eng.created_at instanceof Date ? eng.created_at.toISOString() : eng.created_at).slice(0, 10)}. Note: ${eng.note}`
    : v.price_basis === 'FINAL' ? 'Engineering decision: pending review by an authorised AIEC lift engineer.' : 'Engineering decision: after the AIEC site survey.');

  heading('Important');
  para('Estimated prices are indicative and may change after the site survey. Only an ISSUED quotation with a FINAL price, within its validity date, can be accepted. GST is shown at the configured rate and is subject to the applicable tax classification. Acceptance of this quotation is a commercial step; it is not a statutory permission. Erection permission, inspection and working licence under the Maharashtra Lifts, Escalators and Moving Walks Act, 2017 and Rules, 2026 are obtained separately. Contract, invoicing, payments and warranty follow the execution model chosen at acceptance (AIEC Contract or Marketplace Partner).', 8, font, GREY);
  return pdf.save();
}
