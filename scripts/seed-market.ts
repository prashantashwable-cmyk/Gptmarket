// Marketplace demo data. Every supplier, product, price, rule and package created here is DEMO
// data (fictional companies, illustrative prices, flagged is_demo). It is never loaded in
// production: production starts with no active pricing rules and no supplier prices.
import type { Ctx } from '../src/server/ctx';
import { loadCtx } from '../src/server/ctx';
import { withSystem } from '../src/server/db';
import type { ComponentCategory, OptionKind, PackageCode, PriceUnit } from '../src/lib/enums';
import type { PricingParams } from '../src/lib/pricing';
import { reviewPrice, reviewProduct, saveSupplierProduct, setSupplierStatus, submitPrice, submitProductForApproval } from '../src/server/services/catalogue';
import { addOption, addSlot, createPackageDraft, publishPackageVersion, updatePackageVersion } from '../src/server/services/packages';
import { activateRules, createPricingDraft } from '../src/server/services/rules';
import { registerCompany } from '../src/server/services/partners';
import { isoDateIST } from '../src/lib/format';

export const DEMO_PRICING: PricingParams = {
  installationBase: '45000', installationPerStop: '6000', transportDefault: '15000', transportByZone: { CHAKAN: '22000', TALEGAON: '24000' },
  siteWorkBase: '12000', siteWorkPerStop: '1500', overheadPercent: '8', marginPercent: '14', minMarginPercent: '9', maxDiscountPercent: '4',
  gstPercent: '18', floorHeightM: '3.2', quoteValidityDays: 15,
  paymentMilestones: [
    { name: 'Booking advance', percent: 20 }, { name: 'Material dispatch', percent: 50 }, { name: 'Installation complete', percent: 20 }, { name: 'Handover after statutory inspection', percent: 10 },
  ],
};

interface P { key: string; cat: ComponentCategory; brand: string; model: string; name: string; unit?: PriceUnit; price: string; warranty?: number; specs?: Record<string, unknown> }
const PRODUCTS: P[] = [
  { key: 'mGL630', cat: 'MACHINE', brand: 'Demo Drives', model: 'GL-630', name: 'Gearless PMSM machine 630 kg', price: '165000', warranty: 24, specs: { maxLoadKg: 630, maxSpeedMps: 1.0, powerKw: 4.0, driveType: 'GEARLESS_PMSM' } },
  { key: 'mGL1000', cat: 'MACHINE', brand: 'Demo Drives', model: 'GL-1000', name: 'Gearless PMSM machine 1000 kg', price: '238000', warranty: 36, specs: { maxLoadKg: 1000, maxSpeedMps: 1.75, powerKw: 7.5, driveType: 'GEARLESS_PMSM' } },
  { key: 'cVC8', cat: 'CONTROLLER', brand: 'Demo Controls', model: 'VC-8', name: 'VVVF controller, 8 stops', price: '92000', warranty: 24, specs: { maxStops: 8, maxSpeedMps: 1.0, supportedDrives: ['GEARLESS_PMSM', 'GEARED'] } },
  { key: 'cVC16', cat: 'CONTROLLER', brand: 'Demo Controls', model: 'VC-16', name: 'VVVF controller, 16 stops, group-ready', price: '128000', warranty: 36, specs: { maxStops: 16, maxSpeedMps: 2.0, supportedDrives: ['GEARLESS_PMSM'] } },
  { key: 'kCB544', cat: 'CAR_CABIN', brand: 'Demo Cabins', model: 'CB-544', name: 'Cabin 8 persons (1100 × 1400 mm)', price: '88000', specs: { carWidthMm: 1100, carDepthMm: 1400, ratedLoadKg: 544 } },
  { key: 'kCB680', cat: 'CAR_CABIN', brand: 'Demo Cabins', model: 'CB-680', name: 'Cabin 10 persons (1300 × 1400 mm)', price: '104000', specs: { carWidthMm: 1300, carDepthMm: 1400, ratedLoadKg: 680 } },
  { key: 'fMS', cat: 'CABIN_FINISH', brand: 'Demo Cabins', model: 'FN-MS', name: 'Powder-coated mild steel panels', price: '18000' },
  { key: 'fSSH', cat: 'CABIN_FINISH', brand: 'Demo Cabins', model: 'FN-SSH', name: 'Stainless steel hairline panels', price: '42000' },
  { key: 'fGOLD', cat: 'CABIN_FINISH', brand: 'Demo Cabins', model: 'FN-GLD', name: 'Gold mirror-etched stainless steel', price: '96000' },
  { key: 'flPVC', cat: 'FLOORING', brand: 'Demo Interiors', model: 'FL-PVC', name: 'Anti-skid PVC flooring', price: '6000' },
  { key: 'flGRN', cat: 'FLOORING', brand: 'Demo Interiors', model: 'FL-GRN', name: 'Granite flooring', price: '16000' },
  { key: 'flMRB', cat: 'FLOORING', brand: 'Demo Interiors', model: 'FL-MRB', name: 'Italian marble inlay flooring', price: '34000' },
  { key: 'clSTD', cat: 'CEILING', brand: 'Demo Interiors', model: 'CL-STD', name: 'Flat ceiling with diffuser', price: '7000' },
  { key: 'clLED', cat: 'CEILING', brand: 'Demo Interiors', model: 'CL-LED', name: 'Designer false ceiling with LED panel', price: '19000' },
  { key: 'lLED', cat: 'LIGHTING', brand: 'Demo Interiors', model: 'LT-LED', name: 'LED lighting', price: '4000' },
  { key: 'lCOVE', cat: 'LIGHTING', brand: 'Demo Interiors', model: 'LT-COVE', name: 'Cove ambient lighting with sensor', price: '11000' },
  { key: 'bBTN', cat: 'COP_LOP', brand: 'Demo Controls', model: 'OP-BTN', name: 'Push-button COP / LOP, Braille', unit: 'PER_STOP', price: '3500' },
  { key: 'bTCH', cat: 'COP_LOP', brand: 'Demo Controls', model: 'OP-TCH', name: 'Touch glass COP / LOP, Braille', unit: 'PER_STOP', price: '7800' },
  { key: 'dDOT', cat: 'DISPLAY', brand: 'Demo Controls', model: 'DS-DOT', name: 'Dot-matrix floor display', price: '5000' },
  { key: 'dTFT', cat: 'DISPLAY', brand: 'Demo Controls', model: 'DS-TFT7', name: '7-inch TFT display with announcements', price: '16000' },
  { key: 'cd800', cat: 'CAR_DOOR', brand: 'Demo Doors', model: 'AD-800', name: 'Automatic centre-opening car door, 800 mm', price: '38000', specs: { clearOpeningMm: 800 } },
  { key: 'cd900', cat: 'CAR_DOOR', brand: 'Demo Doors', model: 'AD-900', name: 'Automatic centre-opening car door, 900 mm', price: '44000', specs: { clearOpeningMm: 900 } },
  { key: 'ld800', cat: 'LANDING_DOOR', brand: 'Demo Doors', model: 'LD-800', name: 'Automatic landing door, 800 mm', unit: 'PER_STOP', price: '21000', specs: { clearOpeningMm: 800 } },
  { key: 'ld900', cat: 'LANDING_DOOR', brand: 'Demo Doors', model: 'LD-900', name: 'Automatic landing door, 900 mm', unit: 'PER_STOP', price: '24500', specs: { clearOpeningMm: 900 } },
  { key: 'dfPC', cat: 'DOOR_FINISH', brand: 'Demo Doors', model: 'DF-PC', name: 'Powder-coated door finish', unit: 'PER_STOP', price: '1500' },
  { key: 'dfSS', cat: 'DOOR_FINISH', brand: 'Demo Doors', model: 'DF-SS', name: 'Stainless steel hairline door finish', unit: 'PER_STOP', price: '5200' },
  { key: 'gr', cat: 'GUIDE_RAILS', brand: 'Demo Steel', model: 'GR-T89', name: 'T89 guide rails with brackets (car + counterweight)', unit: 'PER_TRAVEL_METRE', price: '2600' },
  { key: 'rp', cat: 'ROPES', brand: 'Demo Steel', model: 'RP-8', name: 'Steel wire ropes 8 mm set', unit: 'PER_TRAVEL_METRE', price: '900' },
  { key: 'sg', cat: 'SAFETY_GEAR', brand: 'Demo Safety', model: 'SG-P175', name: 'Progressive safety gear', price: '24000', warranty: 24, specs: { maxSpeedMps: 1.75, maxLoadKg: 1000 } },
  { key: 'gv', cat: 'GOVERNOR', brand: 'Demo Safety', model: 'OG-175', name: 'Overspeed governor with tension pulley', price: '19000', warranty: 24, specs: { maxSpeedMps: 1.75 } },
  { key: 'bf', cat: 'BUFFERS', brand: 'Demo Safety', model: 'BF-PU175', name: 'Polyurethane buffers (car + counterweight)', price: '9000', specs: { maxSpeedMps: 1.75 } },
  { key: 'dl', cat: 'DOOR_LOCKS', brand: 'Demo Safety', model: 'DL-IL', name: 'Landing door interlocks', unit: 'PER_STOP', price: '2800' },
  { key: 'ard', cat: 'ARD', brand: 'Demo Safety', model: 'ARD-5', name: 'Automatic rescue device', price: '26000', warranty: 24 },
  { key: 'aIC', cat: 'ADD_ON', brand: 'Demo Controls', model: 'AO-ICCT', name: 'Intercom with cabin CCTV', price: '18000' },
  { key: 'aVA', cat: 'ADD_ON', brand: 'Demo Controls', model: 'AO-VAN', name: 'Voice announcement (English, Hindi, Marathi)', price: '8000' },
];

type Slot = [ComponentCategory, Array<[string, OptionKind]>, { mandatory?: boolean; editable?: boolean }?];
const SAFETY: Slot[] = [['GUIDE_RAILS', [['gr', 'STANDARD']]], ['ROPES', [['rp', 'STANDARD']]], ['SAFETY_GEAR', [['sg', 'STANDARD']]], ['GOVERNOR', [['gv', 'STANDARD']]],
  ['BUFFERS', [['bf', 'STANDARD']]], ['DOOR_LOCKS', [['dl', 'STANDARD']]], ['ARD', [['ard', 'STANDARD']]]];

const PACKAGES: Record<PackageCode, { title: string; summary: string; features: string; exclusions: string; warranty: number; purposes: string[]; stops: [number, number]; speed: number; load: [number, number]; slots: Slot[] }> = {
  BASIC: {
    title: 'AIEC Basic', summary: 'Reliable passenger lift for small residential buildings.', warranty: 12, purposes: ['PASSENGER'], stops: [2, 6], speed: 1.0, load: [300, 600],
    features: 'Gearless machine\nAutomatic doors\nAutomatic rescue device\nLED lighting', exclusions: 'Civil and shaft work\n3-phase power supply to the machine\nStatutory fees',
    slots: [['MACHINE', [['mGL630', 'STANDARD']]], ['CONTROLLER', [['cVC8', 'STANDARD']]], ['CAR_CABIN', [['kCB544', 'STANDARD']]],
      ['CABIN_FINISH', [['fMS', 'STANDARD'], ['fSSH', 'UPGRADE']], { editable: true }], ['FLOORING', [['flPVC', 'STANDARD'], ['flGRN', 'UPGRADE']], { editable: true }],
      ['CEILING', [['clSTD', 'STANDARD']]], ['LIGHTING', [['lLED', 'STANDARD']]], ['COP_LOP', [['bBTN', 'STANDARD']]], ['DISPLAY', [['dDOT', 'STANDARD']]],
      ['CAR_DOOR', [['cd800', 'STANDARD']]], ['LANDING_DOOR', [['ld800', 'STANDARD']]], ['DOOR_FINISH', [['dfPC', 'STANDARD'], ['dfSS', 'UPGRADE']], { editable: true }], ...SAFETY],
  },
  STANDARD: {
    title: 'AIEC Standard', summary: 'Comfortable, accessible lift for apartments and offices.', warranty: 18, purposes: ['PASSENGER', 'ACCESSIBLE'], stops: [2, 8], speed: 1.0, load: [300, 700],
    features: 'Stainless steel cabin\nTouch-free ready operating panels\n900 mm option for wheelchair access\nAutomatic rescue device', exclusions: 'Civil and shaft work\n3-phase power supply\nStatutory fees',
    slots: [['MACHINE', [['mGL630', 'STANDARD']]], ['CONTROLLER', [['cVC8', 'STANDARD']]], ['CAR_CABIN', [['kCB544', 'STANDARD'], ['kCB680', 'UPGRADE']], { editable: true }],
      ['CABIN_FINISH', [['fSSH', 'STANDARD'], ['fGOLD', 'UPGRADE']], { editable: true }], ['FLOORING', [['flPVC', 'STANDARD'], ['flGRN', 'UPGRADE']], { editable: true }],
      ['CEILING', [['clSTD', 'STANDARD'], ['clLED', 'UPGRADE']], { editable: true }], ['LIGHTING', [['lLED', 'STANDARD'], ['lCOVE', 'UPGRADE']], { editable: true }],
      ['COP_LOP', [['bBTN', 'STANDARD'], ['bTCH', 'UPGRADE']], { editable: true }], ['DISPLAY', [['dDOT', 'STANDARD'], ['dTFT', 'UPGRADE']], { editable: true }],
      ['CAR_DOOR', [['cd800', 'STANDARD'], ['cd900', 'ALTERNATIVE']]], ['LANDING_DOOR', [['ld800', 'STANDARD'], ['ld900', 'ALTERNATIVE']]],
      ['DOOR_FINISH', [['dfSS', 'STANDARD']]], ['ADD_ON', [['aIC', 'UPGRADE'], ['aVA', 'UPGRADE']], { mandatory: false, editable: true }], ...SAFETY],
  },
  PREMIUM: {
    title: 'AIEC Premium', summary: 'Faster, larger lift with premium interiors for mid-rise buildings.', warranty: 24, purposes: ['PASSENGER', 'ACCESSIBLE'], stops: [2, 16], speed: 1.5, load: [400, 1000],
    features: '1000 kg gearless machine\n16-stop controller\nTFT display with announcements\nDesigner ceiling', exclusions: 'Civil and shaft work\n3-phase power supply\nStatutory fees',
    slots: [['MACHINE', [['mGL1000', 'STANDARD']]], ['CONTROLLER', [['cVC16', 'STANDARD']]], ['CAR_CABIN', [['kCB680', 'STANDARD'], ['kCB544', 'ALTERNATIVE']], { editable: true }],
      ['CABIN_FINISH', [['fSSH', 'STANDARD'], ['fGOLD', 'UPGRADE']], { editable: true }], ['FLOORING', [['flGRN', 'STANDARD'], ['flMRB', 'UPGRADE']], { editable: true }],
      ['CEILING', [['clLED', 'STANDARD']]], ['LIGHTING', [['lCOVE', 'STANDARD']]], ['COP_LOP', [['bTCH', 'STANDARD']]], ['DISPLAY', [['dTFT', 'STANDARD']]],
      ['CAR_DOOR', [['cd900', 'STANDARD']]], ['LANDING_DOOR', [['ld900', 'STANDARD']]], ['DOOR_FINISH', [['dfSS', 'STANDARD']]],
      ['ADD_ON', [['aIC', 'UPGRADE'], ['aVA', 'UPGRADE']], { mandatory: false, editable: true }], ...SAFETY],
  },
  LUXURY: {
    title: 'AIEC Luxury', summary: 'Signature interiors and the highest comfort level.', warranty: 36, purposes: ['PASSENGER', 'ACCESSIBLE'], stops: [2, 16], speed: 1.75, load: [400, 1000],
    features: 'Gold mirror-etched cabin\nItalian marble flooring\nCove lighting\nIntercom with CCTV included', exclusions: 'Civil and shaft work\n3-phase power supply\nStatutory fees',
    slots: [['MACHINE', [['mGL1000', 'STANDARD']]], ['CONTROLLER', [['cVC16', 'STANDARD']]], ['CAR_CABIN', [['kCB680', 'STANDARD']]],
      ['CABIN_FINISH', [['fGOLD', 'STANDARD'], ['fSSH', 'ALTERNATIVE']], { editable: true }], ['FLOORING', [['flMRB', 'STANDARD'], ['flGRN', 'ALTERNATIVE']], { editable: true }],
      ['CEILING', [['clLED', 'STANDARD']]], ['LIGHTING', [['lCOVE', 'STANDARD']]], ['COP_LOP', [['bTCH', 'STANDARD']]], ['DISPLAY', [['dTFT', 'STANDARD']]],
      ['CAR_DOOR', [['cd900', 'STANDARD']]], ['LANDING_DOOR', [['ld900', 'STANDARD']]], ['DOOR_FINISH', [['dfSS', 'STANDARD']]], ['ADD_ON', [['aIC', 'STANDARD']]], ...SAFETY],
  },
};

/** Hindi and Marathi versions of the demo package texts. */
const PACKAGE_I18N: Record<PackageCode, Record<string, string>> = {
  BASIC: { titleHi: 'AIEC बेसिक', titleMr: 'AIEC बेसिक', summaryHi: 'छोटी आवासीय इमारतों के लिए भरोसेमंद पैसेंजर लिफ्ट।', summaryMr: 'लहान निवासी इमारतींसाठी विश्वासार्ह प्रवासी लिफ्ट.', featuresHi: 'गियरलेस मशीन\nऑटोमैटिक दरवाज़े\nऑटोमैटिक रेस्क्यू डिवाइस\nLED लाइटिंग', featuresMr: 'गियरलेस मशीन\nस्वयंचलित दरवाजे\nस्वयंचलित बचाव उपकरण\nLED लाइटिंग', exclusionsHi: 'सिविल और शाफ़्ट कार्य\nमशीन के लिए थ्री-फ़ेज़ बिजली आपूर्ति\nवैधानिक शुल्क', exclusionsMr: 'सिव्हिल आणि शाफ्टचे काम\nमशीनसाठी थ्री-फेज वीजपुरवठा\nवैधानिक शुल्क' },
  STANDARD: { titleHi: 'AIEC स्टैंडर्ड', titleMr: 'AIEC स्टँडर्ड', summaryHi: 'अपार्टमेंट और ऑफ़िस के लिए आरामदायक, सुलभ लिफ्ट।', summaryMr: 'अपार्टमेंट आणि कार्यालयांसाठी आरामदायक, सुलभ लिफ्ट.', featuresHi: 'स्टेनलेस स्टील केबिन\nटच-फ़्री के लिए तैयार ऑपरेटिंग पैनल\nव्हीलचेयर के लिए 900 मिमी विकल्प\nऑटोमैटिक रेस्क्यू डिवाइस', featuresMr: 'स्टेनलेस स्टील केबिन\nटच-फ्रीसाठी तयार ऑपरेटिंग पॅनल\nव्हीलचेअरसाठी 900 मिमी पर्याय\nस्वयंचलित बचाव उपकरण', exclusionsHi: 'सिविल और शाफ़्ट कार्य\nथ्री-फ़ेज़ बिजली आपूर्ति\nवैधानिक शुल्क', exclusionsMr: 'सिव्हिल आणि शाफ्टचे काम\nथ्री-फेज वीजपुरवठा\nवैधानिक शुल्क' },
  PREMIUM: { titleHi: 'AIEC प्रीमियम', titleMr: 'AIEC प्रीमियम', summaryHi: 'मध्यम ऊँचाई की इमारतों के लिए तेज़, बड़ी लिफ्ट और प्रीमियम इंटीरियर।', summaryMr: 'मध्यम उंचीच्या इमारतींसाठी वेगवान, मोठी लिफ्ट आणि प्रीमियम इंटिरियर.', featuresHi: '1000 किलो गियरलेस मशीन\n16-स्टॉप कंट्रोलर\nघोषणाओं वाला TFT डिस्प्ले\nडिज़ाइनर सीलिंग', featuresMr: '1000 किलो गियरलेस मशीन\n16-स्टॉप कंट्रोलर\nघोषणांसह TFT डिस्प्ले\nडिझायनर सीलिंग', exclusionsHi: 'सिविल और शाफ़्ट कार्य\nथ्री-फ़ेज़ बिजली आपूर्ति\nवैधानिक शुल्क', exclusionsMr: 'सिव्हिल आणि शाफ्टचे काम\nथ्री-फेज वीजपुरवठा\nवैधानिक शुल्क' },
  LUXURY: { titleHi: 'AIEC लक्ज़री', titleMr: 'AIEC लक्झरी', summaryHi: 'सिग्नेचर इंटीरियर और सर्वोच्च आराम।', summaryMr: 'सिग्नेचर इंटिरियर आणि सर्वोच्च आराम.', featuresHi: 'गोल्ड मिरर-एच्ड केबिन\nइटैलियन मार्बल फ़्लोरिंग\nकोव लाइटिंग\nCCTV के साथ इंटरकॉम शामिल', featuresMr: 'गोल्ड मिरर-एच्ड केबिन\nइटालियन मार्बल फ्लोअरिंग\nकोव्ह लाइटिंग\nCCTV सह इंटरकॉम समाविष्ट', exclusionsHi: 'सिविल और शाफ़्ट कार्य\nथ्री-फ़ेज़ बिजली आपूर्ति\nवैधानिक शुल्क', exclusionsMr: 'सिव्हिल आणि शाफ्टचे काम\nथ्री-फेज वीजपुरवठा\nवैधानिक शुल्क' },
};

async function engineerUser(): Promise<Ctx> {
  return withSystem(async (tx) => {
    const existing = await tx.maybeOne<{ id: string }>(`select id from users where phone = '+919000000008'`);
    const id = existing?.id ?? (await tx.one<{ id: string }>(`insert into users (phone, full_name, is_demo) values ('+919000000008', 'Dr. Sameer Apte (Demo Lift Engineer)', true) returning id`)).id;
    await tx.exec(`insert into user_roles (user_id, role_code) select $1, 'ENGINEER' where not exists (select 1 from user_roles where user_id = $1 and role_code = 'ENGINEER')`, [id]);
    return (await loadCtx(tx, id))!;
  });
}

/** Creates two demo suppliers, approved products and prices, active demo rules and four published packages. */
export async function seedMarketplace(admin: Ctx, opts: { supplierCompanyId?: string; supplierPhone?: string } = {}): Promise<{ engineer: Ctx; productIds: Map<string, string>; suppliers: Ctx[] }> {
  const engineer = await engineerUser();
  const suppliers: Array<{ id: string; ctx: Ctx }> = [];
  const ensureSupplier = async (legalName: string, pan: string, phone: string, existingId?: string) => {
    const id = existingId ?? await registerCompany(admin, { legalName, category: 'SUPPLIER', entityType: 'PRIVATE_LIMITED', pan, address: 'Demo industrial estate, Pune', city: 'Pune', signatoryName: 'Demo Supplier' },
      { phone, name: `${legalName.split(' (')[0]} (Demo Supplier Admin)` });
    const ctx = await withSystem(async (tx) => {
      await tx.exec(`update companies set is_demo = true, status = 'ACTIVE', agreement_signed_on = coalesce(agreement_signed_on, current_date) where id = $1`, [id]);
      const u = await tx.one<{ id: string }>('update users set is_demo = true where phone = $1 returning id', [phone]);
      return (await loadCtx(tx, u.id))!;
    });
    await setSupplierStatus(admin, { companyId: id, status: 'APPROVED' });
    suppliers.push({ id, ctx });
  };
  await ensureSupplier('Bhima Components (Demo Supplier)', 'AAACB4444D', opts.supplierPhone ?? '+919000000014', opts.supplierCompanyId);
  await ensureSupplier('Indrayani Drives Pvt Ltd (Demo Supplier)', 'AAACI5555E', '+919000000015');

  const productIds = new Map<string, string>();
  const today = isoDateIST();
  for (const [i, p] of PRODUCTS.entries()) {
    const sup = suppliers[['MACHINE', 'CONTROLLER', 'SAFETY_GEAR', 'GOVERNOR', 'BUFFERS', 'ARD', 'ROPES', 'GUIDE_RAILS'].includes(p.cat) ? 1 : 0];
    const id = await saveSupplierProduct(sup.ctx, {
      categoryCode: p.cat, brand: p.brand, model: p.model, name: p.name, description: 'Demo product for the AIEC pilot. Not a real catalogue item.',
      priceUnit: p.unit ?? 'EACH', warrantyMonths: p.warranty ?? 12, deliveryDays: 10 + (i % 4) * 5, stockQty: 5 + (i % 7),
    }, p.specs ?? {}, { image: null, document: null });
    await submitProductForApproval(sup.ctx, id);
    await reviewProduct(admin, { id, decision: 'APPROVED' });
    const price = await submitPrice(sup.ctx, { productId: id, unitPrice: p.price, validFrom: today, note: 'Demo price' });
    await reviewPrice(admin, { id: price.id, decision: 'APPROVED' });
    productIds.set(p.key, id);
  }
  await withSystem((tx) => tx.exec('update supplier_products set is_demo = true'));

  const pricingId = await createPricingDraft(admin, DEMO_PRICING, 'DEMO pricing rules - illustrative values for the sandbox only.', true);
  await activateRules(admin, { id: pricingId, kind: 'pricing' });
  const compat = await withSystem((tx) => tx.one<{ id: string }>(`select id from compatibility_rule_versions where status = 'DRAFT' order by version_no limit 1`));
  await activateRules(engineer, { id: compat.id, kind: 'compatibility' });

  const packages = await withSystem((tx) => tx.query<{ id: string; code: PackageCode }>('select id, code from lift_packages order by tier'));
  for (const pkg of packages) {
    const def = PACKAGES[pkg.code];
    const versionId = await createPackageDraft(admin, pkg.id);
    await updatePackageVersion(admin, {
      id: versionId, title: def.title, summary: def.summary, features: def.features, exclusions: def.exclusions, warrantyMonths: def.warranty,
      eligiblePurposes: def.purposes as never, minStops: def.stops[0], maxStops: def.stops[1], maxSpeedMps: def.speed, minLoadKg: def.load[0], maxLoadKg: def.load[1],
      ...PACKAGE_I18N[pkg.code],
    });
    for (const [category, options, flags] of def.slots) {
      await addSlot(admin, { versionId, categoryCode: category, isMandatory: flags?.mandatory ?? true, customerEditable: flags?.editable ?? false });
      const slot = await withSystem((tx) => tx.one<{ id: string }>('select id from package_slots where version_id = $1 and category_code = $2', [versionId, category]));
      for (const [key, kind] of options) await addOption(admin, { slotId: slot.id, productId: productIds.get(key)!, kind });
    }
    await withSystem((tx) => tx.exec('update package_versions set is_demo = true where id = $1', [versionId]));
    await publishPackageVersion(admin, versionId);
  }
  return { engineer, productIds, suppliers: suppliers.map((s) => s.ctx) };
}
