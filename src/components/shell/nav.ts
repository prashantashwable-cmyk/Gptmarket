import type { Ctx, Portal } from '@/server/ctx';
import type { Permission } from '@/lib/permissions';

/** `tab`: shown in the mobile bottom tab bar (max four per workspace; the rest are under "More"). */
export interface NavItem { key: string; href: string; icon: string; anyOf?: Permission[]; supplierOnly?: boolean; tab?: boolean }

const ADMIN: NavItem[] = [
  { key: 'dashboard', href: '/admin', icon: 'LayoutDashboard', tab: true },
  { key: 'marketplace', href: '/admin/marketplace', icon: 'Store', anyOf: ['market.view'], tab: true },
  { key: 'leads', href: '/admin/leads', icon: 'ClipboardList', anyOf: ['lead.view.all', 'lead.view.city', 'lead.view.assigned'], tab: true },
  { key: 'customers', href: '/admin/customers', icon: 'Users', anyOf: ['customer.view'] },
  { key: 'surveys', href: '/admin/surveys', icon: 'Ruler', anyOf: ['survey.schedule', 'survey.review', 'survey.perform'] },
  { key: 'partners', href: '/admin/partners', icon: 'Building2', anyOf: ['partner.view'] },
  { key: 'quotations', href: '/admin/quotations', icon: 'FileSpreadsheet', anyOf: ['quotation.view.all'] },
  { key: 'orders', href: '/admin/orders', icon: 'PackageCheck', anyOf: ['order.view.all'], tab: true },
  { key: 'projects', href: '/admin/projects', icon: 'HardHat', anyOf: ['project.view.all'] },
  { key: 'collections', href: '/admin/collections', icon: 'Scale', anyOf: ['payment.reconcile'] },
  { key: 'commissions', href: '/admin/commissions', icon: 'IndianRupee', anyOf: ['commission.view'] },
  { key: 'finance', href: '/admin/finance', icon: 'Landmark', anyOf: ['finance.referral.view'] },
  { key: 'compliance', href: '/admin/compliance', icon: 'ShieldCheck', anyOf: ['compliance.view'] },
  { key: 'qc', href: '/admin/qc', icon: 'SearchCheck', anyOf: ['qc.review'] },
  { key: 'incidents', href: '/admin/incidents', icon: 'TriangleAlert', anyOf: ['incident.manage'] },
  { key: 'service', href: '/admin/service', icon: 'Wrench', anyOf: ['service.manage'] },
  { key: 'disputes', href: '/admin/disputes', icon: 'Gavel', anyOf: ['dispute.manage'] },
  { key: 'reports', href: '/admin/reports', icon: 'ChartColumn', anyOf: ['report.view'] },
  { key: 'users', href: '/admin/users', icon: 'UserCog', anyOf: ['user.manage'] },
  { key: 'audit', href: '/admin/audit', icon: 'ScrollText', anyOf: ['audit.view'] },
  { key: 'settings', href: '/admin/settings', icon: 'Settings', anyOf: ['settings.manage'] },
  { key: 'notifications', href: '/admin/notifications', icon: 'Bell' },
];
const PARTNER: NavItem[] = [
  { key: 'dashboard', href: '/partner', icon: 'LayoutDashboard', tab: true },
  { key: 'company', href: '/partner/company', icon: 'Building2', anyOf: ['company.manage'] },
  { key: 'partnerLeads', href: '/partner/leads', icon: 'ClipboardList', anyOf: ['quotation.submit'], tab: true },
  { key: 'quotations', href: '/partner/quotations', icon: 'FileSpreadsheet', anyOf: ['quotation.submit'] },
  { key: 'orders', href: '/partner/orders', icon: 'PackageCheck', anyOf: ['order.accept'], tab: true },
  { key: 'projects', href: '/partner/projects', icon: 'HardHat', anyOf: ['project.assign'], tab: true },
  { key: 'capacity', href: '/partner/capacity', icon: 'CalendarRange', anyOf: ['project.assign'] },
  { key: 'performance', href: '/partner/performance', icon: 'Gauge', anyOf: ['quotation.submit'] },
  { key: 'team', href: '/partner/team', icon: 'Users', anyOf: ['team.manage'] },
  { key: 'partnerCollections', href: '/partner/collections', icon: 'Scale', anyOf: ['payment.evidence.submit'] },
  { key: 'commissions', href: '/partner/commissions', icon: 'IndianRupee', anyOf: ['commission.view.own'] },
  { key: 'service', href: '/partner/service', icon: 'Wrench', anyOf: ['service.perform'] },
  { key: 'catalogue', href: '/partner/catalogue', icon: 'Boxes', anyOf: ['catalogue.manage'] },
  { key: 'supplierCatalogue', href: '/partner/marketplace', icon: 'Store', anyOf: ['catalogue.manage'], supplierOnly: true, tab: true },
  { key: 'supplierOrders', href: '/partner/supplier-orders', icon: 'PackageCheck', anyOf: ['catalogue.manage'], supplierOnly: true, tab: true },
  { key: 'notifications', href: '/partner/notifications', icon: 'Bell' },
];
const CUSTOMER: NavItem[] = [
  { key: 'liftShop', href: '/customer/shop', icon: 'ShoppingCart', tab: true },
  { key: 'myProjects', href: '/customer', icon: 'LayoutDashboard', tab: true },
  { key: 'newRequirement', href: '/customer/new', icon: 'CirclePlus' },
  { key: 'customerFinance', href: '/customer/finance', icon: 'Landmark' },
  { key: 'customerService', href: '/customer/service', icon: 'Wrench', tab: true },
  { key: 'notifications', href: '/customer/notifications', icon: 'Bell', tab: true },
  { key: 'profile', href: '/customer/profile', icon: 'UserCog' },
];
const TECH: NavItem[] = [
  { key: 'myWork', href: '/tech', icon: 'HardHat', tab: true },
  { key: 'hazard', href: '/tech/hazard', icon: 'TriangleAlert', tab: true },
  { key: 'sync', href: '/tech/sync', icon: 'RefreshCw', tab: true },
  { key: 'notifications', href: '/tech/notifications', icon: 'Bell', tab: true },
];

export function navFor(portal: Portal, ctx: Ctx): NavItem[] {
  const items = { admin: ADMIN, partner: PARTNER, customer: CUSTOMER, tech: TECH }[portal];
  const supplier = ctx.companyCategory === 'SUPPLIER' || ctx.companyCategory === 'MANUFACTURER';
  return items.filter((item) => (!item.anyOf || item.anyOf.some((p) => ctx.permissions.has(p))) && (!item.supplierOnly || supplier));
}
