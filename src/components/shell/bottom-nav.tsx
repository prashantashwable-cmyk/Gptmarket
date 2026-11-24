'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import {
  Bell, Boxes, Building2, CalendarRange, ChartColumn, CirclePlus, ClipboardList, FileSpreadsheet, Gauge, Gavel, HardHat, IndianRupee, Landmark,
  LayoutDashboard, Menu, PackageCheck, RefreshCw, Ruler, Scale, ScrollText, SearchCheck, Settings, ShieldCheck, ShoppingCart, Store, TriangleAlert,
  UserCog, Users, Wrench, type LucideIcon,
} from 'lucide-react';
import { useT } from '@/i18n/client';
import { cn } from '@/lib/format';
import { LanguageSwitcher } from '../language-switcher';

const ICONS: Record<string, LucideIcon> = {
  Bell, Boxes, Building2, CalendarRange, ChartColumn, CirclePlus, ClipboardList, FileSpreadsheet, Gauge, Gavel, HardHat, IndianRupee, Landmark,
  LayoutDashboard, PackageCheck, RefreshCw, Ruler, Scale, ScrollText, SearchCheck, Settings, ShieldCheck, ShoppingCart, Store, TriangleAlert,
  UserCog, Users, Wrench,
};
type Item = { key: string; href: string; icon: string; label: string; tab?: boolean };

const ROOTS = new Set(['/admin', '/partner', '/customer', '/tech']);
const isActive = (pathname: string, href: string) => (ROOTS.has(href) ? pathname === href : pathname === href || pathname.startsWith(`${href}/`));

/**
 * Native-style bottom tab bar for phones: up to four primary destinations plus "More", which opens
 * a sheet with every other destination and the language switcher. Hidden on large screens.
 */
export function BottomNav({ items, unread }: { items: Item[]; unread: number }) {
  const t = useT();
  const pathname = usePathname();
  const sheet = useRef<HTMLDetailsElement>(null);
  const tabs = items.filter((i) => i.tab).slice(0, 4);
  const rest = items.filter((i) => !tabs.includes(i));
  const moreActive = rest.some((i) => isActive(pathname, i.href));
  // Close the "More" sheet after navigating.
  useEffect(() => { if (sheet.current) sheet.current.open = false; }, [pathname]);

  const badge = (key: string) => key === 'notifications' && unread > 0 && (
    <span className="absolute -top-1 left-1/2 ml-1.5 min-w-4 rounded-full bg-accent-500 px-1 text-center text-[10px] leading-4 font-bold text-on-accent">{unread > 99 ? '99+' : unread}</span>
  );
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-white/10 bg-sidebar text-sidebar-fg shadow-[0_-4px_16px_rgb(0_0_0/0.15)] lg:hidden" aria-label={t('common.menu')}
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <ul className="mx-auto flex h-16 max-w-xl items-stretch">
        {tabs.map((item) => {
          const Icon = ICONS[item.icon] ?? LayoutDashboard;
          const active = isActive(pathname, item.href);
          return (
            <li key={item.key} className="flex-1">
              <Link href={item.href} aria-current={active ? 'page' : undefined} data-tab={item.key}
                className={cn('relative flex h-full flex-col items-center justify-center gap-0.5 px-1 text-[11px] font-medium', active ? 'text-sidebar-strong' : 'hover:text-sidebar-strong')}>
                {active && <span className="absolute top-0 h-0.5 w-10 rounded-full bg-sidebar-strong" aria-hidden />}
                <span className="relative"><Icon className="size-5" aria-hidden />{badge(item.key)}</span>
                <span className="max-w-full truncate">{item.label}</span>
              </Link>
            </li>
          );
        })}
        {(
          <li className="flex-1">
            <details ref={sheet} className="group h-full">
              <summary className={cn('relative flex h-full cursor-pointer list-none flex-col items-center justify-center gap-0.5 text-[11px] font-medium [&::-webkit-details-marker]:hidden',
                moreActive ? 'text-sidebar-strong' : 'hover:text-sidebar-strong')} data-tab="more">
                {moreActive && <span className="absolute top-0 h-0.5 w-10 rounded-full bg-sidebar-strong" aria-hidden />}
                <Menu className="size-5" aria-hidden />{t('common.more')}
              </summary>
              <div className="fixed inset-x-0 bottom-16 max-h-[70vh] overflow-y-auto rounded-t-2xl border-t border-slate-200 bg-surface p-3 text-slate-800 shadow-2xl"
                style={{ marginBottom: 'env(safe-area-inset-bottom)' }}>
                <div className="mb-3 flex justify-center"><LanguageSwitcher /></div>
                <ul className="grid grid-cols-3 gap-2">
                  {rest.map((item) => {
                    const Icon = ICONS[item.icon] ?? LayoutDashboard;
                    const active = isActive(pathname, item.href);
                    return (
                      <li key={item.key}>
                        <Link href={item.href} aria-current={active ? 'page' : undefined}
                          className={cn('relative flex min-h-20 flex-col items-center justify-center gap-1.5 rounded-xl border p-2 text-center text-xs font-medium',
                            active ? 'border-brand-600 bg-brand-50 text-brand-800' : 'border-slate-200 hover:bg-slate-50')}>
                          <span className="relative"><Icon className="size-5 text-brand-700" aria-hidden />{badge(item.key)}</span>
                          <span className="line-clamp-2">{item.label}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </details>
          </li>
        )}
      </ul>
    </nav>
  );
}
