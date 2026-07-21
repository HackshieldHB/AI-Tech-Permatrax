'use client'; // MODIFIED: dashboard shell client layout
export const dynamic = 'force-dynamic'; // MODIFIED: authenticated dashboard should stay dynamic

import React, { CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react'; // MODIFIED: hooks + CSSProperties for inline styles
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  BarChart3, Bell, BellRing, ChevronDown, ChevronLeft, ChevronRight, ClipboardList, Database,
  FileText, FolderOpen, GitBranch, Globe, HelpCircle, Inbox, LogOut, Menu, Package, PiggyBank, Settings, Wrench, X, // FIX: PackagePlus removed — no Request Stok nav
  ShoppingCart, Truck, UserCircle2, Wallet, Building, PackageX, Store, Receipt, // Phase 3 nav
  ListChecks, // NEW: Integra V1 — Daily Activity nav icon
} from 'lucide-react';
import { io, Socket } from 'socket.io-client';
import { Plus_Jakarta_Sans } from 'next/font/google';
import { toast } from 'sonner';
import { apiFetch } from '../../lib/auth';
import { apiGet, apiPost, API_BASE, API_HOST } from '../../lib/api'; // FIX: centralised API URLs
import { useAuthStore } from '../../store/authStore';
import { ProfileAvatar } from '../../components/ProfileAvatar';
import { useNotificationStore } from '../../store/notificationStore';
import { ErrorBoundary } from '../../components/ErrorBoundary';

const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-jakarta',
});

type Role =
  | 'GENERAL_MANAGER' | 'PM_SENIOR' | 'PM_FTTH' | 'PM_FTTB' | 'PM_FTTT'
  | 'ADMIN' | 'ADMIN_STOCK' | 'FINANCE'
  | 'SURVEYOR_FTTH' | 'SURVEYOR_FTTB' | 'SURVEYOR_FTTT'
  | 'DESIGNER' // FIX Issue 10: nav knows about the new DESIGNER role
  | 'MARKETING' | 'MARKETING_HEAD' | 'OPERATIONAL_MANAGER' | 'PURCHASING' // Phase 3 + UI roles
  | 'MAP_VIEWER'; // read-only GIS map access (e.g. JLM external users)

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ style?: CSSProperties; className?: string }>;
  featureKey?: string;
  roles?: Role[];
  section: 'OPERASIONAL' | 'INVENTARIS' | 'DOKUMEN' | 'DASHBOARD' | 'MANAJEMEN' | 'UTILITAS';
  gmOnly?: boolean;
  badge?: 'pr' | 'cashOp' | 'purchasingInbox' | 'stockOutInbox';
  dashboardForAllRoles?: boolean; // FIX: one sidebar tile — href resolved per role
};

function getDashboardHref(role: string): string {
  const routes: Record<string, string> = {
    GENERAL_MANAGER: '/dashboard-gm', // FIX
    PM_SENIOR: '/dashboard-pm', // FIX
    PM_FTTH: '/dashboard-pm', // FIX
    PM_FTTB: '/dashboard-pm', // FIX
    PM_FTTT: '/dashboard-pm', // FIX
    SURVEYOR_FTTH: '/dashboard-surveyor', // FIX
    SURVEYOR_FTTB: '/dashboard-surveyor', // FIX
    SURVEYOR_FTTT: '/dashboard-surveyor', // FIX
    ADMIN: '/dashboard-admin', // FIX
    DESIGNER: '/dashboard-designer', // FIX
    FINANCE: '/dashboard-finance', // FIX
    OPERATIONAL_MANAGER: '/dashboard-ops', // FIX
    MARKETING: '/dashboard-marketing', // FIX
    MARKETING_HEAD: '/dashboard-marketing', // FIX
    ADMIN_STOCK: '/dashboard-admin-stock', // FIX
    PURCHASING: '/dashboard-purchasing',
    MAP_VIEWER: '/home', // map-only users go to home first, then pick Peta GIS from sidebar
  };
  return routes[role] || '/home'; // FIX
}

const NAV_ITEMS: NavItem[] = [
  {
    href: '/map',
    label: 'Peta GIS',
    icon: Globe,
    featureKey: 'GIS_MAP',
    section: 'OPERASIONAL',
    roles: [
      'SURVEYOR_FTTH',
      'SURVEYOR_FTTB',
      'SURVEYOR_FTTT',
      'PM_FTTH',
      'PM_FTTB',
      'PM_FTTT',
      'PM_SENIOR',
      'DESIGNER',
      'OPERATIONAL_MANAGER',
      'GENERAL_MANAGER',
      'ADMIN',
      'MAP_VIEWER', // JLM / external read-only users
    ],
  },
  {
    href: '/permit-clusters',
    label: 'Pipeline Perizinan',
    icon: GitBranch,
    featureKey: 'PERMIT_PIPELINE',
    section: 'OPERASIONAL',
  },
  {
    href: '/visit-requests',
    label: 'Visit Request',
    icon: ClipboardList,
    featureKey: 'VISIT_REQUEST',
    section: 'OPERASIONAL',
  },
  {
    href: '/admin/legacy-ba-open',
    label: 'Legacy BA Open',
    icon: Wrench,
    section: 'OPERASIONAL',
    roles: ['ADMIN', 'GENERAL_MANAGER'],
  },
  { href: '/clean-list', label: 'Clean List', icon: Database, featureKey: 'CLEAN_LIST', section: 'OPERASIONAL' },
  {
    href: '/fttt-projects',
    label: 'FTTT Projects',
    icon: Database,
    section: 'OPERASIONAL',
    roles: ['PM_FTTT', 'SURVEYOR_FTTT', 'ADMIN', 'GENERAL_MANAGER', 'ADMIN_STOCK', 'FINANCE'],
  },
  {
    href: '/daily-activity',
    label: 'Daily Activity',
    icon: ListChecks,
    section: 'OPERASIONAL',
    // NEW: mirrors backend DAILY_ACTIVITY_VIEW permission
    roles: ['GENERAL_MANAGER', 'FINANCE', 'PM_FTTT', 'PM_SENIOR', 'ADMIN', 'SURVEYOR_FTTT'],
  },
  { href: '/ba-open', label: 'BA Open', icon: FileText, featureKey: 'BA_OPEN', section: 'OPERASIONAL' },
  { href: '/cash-operation', label: 'Cash Operation', icon: Wallet, featureKey: 'CASH_OPERATION', section: 'OPERASIONAL', badge: 'cashOp' },
  {
    href: '/orders',
    label: 'Order Barang', // FIX: nama final — alur approval di dalam /orders
    icon: ShoppingCart,
    featureKey: 'ORDER_MODULE',
    section: 'INVENTARIS',
    roles: [
      'PM_FTTH',
      'PM_FTTB',
      'PM_FTTT',
      'PM_SENIOR',
      'ADMIN_STOCK',
      'OPERATIONAL_MANAGER', // FIX: Ops Manager can see Order Barang
      'GENERAL_MANAGER',
      'FINANCE',
      'ADMIN',
      'PURCHASING',
    ],
  }, // FIX: satu entry — tanpa "Pengajuan Order Barang"
  {
    href: '/purchasing',
    label: 'Purchasing',
    icon: Store,
    section: 'INVENTARIS',
    roles: ['PURCHASING', 'GENERAL_MANAGER', 'ADMIN', 'FINANCE'],
    badge: 'purchasingInbox',
  },
  {
    href: '/suppliers',
    label: 'Master Supplier',
    icon: Building,
    section: 'INVENTARIS',
    roles: ['PURCHASING', 'FINANCE', 'GENERAL_MANAGER', 'ADMIN', 'ADMIN_STOCK'],
  },
  {
    href: '/supplier-invoices',
    label: 'Tagihan Supplier',
    icon: Receipt,
    section: 'INVENTARIS',
    roles: ['FINANCE', 'PURCHASING', 'GENERAL_MANAGER', 'ADMIN'],
  },
  {
    href: '/stock-out',
    label: 'Stock Out',
    icon: PackageX,
    section: 'INVENTARIS',
    roles: ['PM_FTTH', 'PM_FTTB', 'PM_FTTT', 'PM_SENIOR', 'ADMIN_STOCK', 'ADMIN'],
    badge: 'stockOutInbox',
  },
  { href: '/stock', label: 'Stok Barang', icon: Package, featureKey: 'STOCK_MODULE', section: 'INVENTARIS' },
  { href: '/surat-jalan', label: 'Surat Jalan', icon: Truck, featureKey: 'SURAT_JALAN', section: 'INVENTARIS' },
  { href: '/purchase-requests', label: 'Pembelian', icon: Inbox, featureKey: 'PURCHASE_REQUEST', section: 'INVENTARIS', badge: 'pr' },
  {
    href: '/document-list', // FIX: path
    label: 'Daftar Dokumen', // FIX: label
    icon: FolderOpen, // FIX: icon
    // Standardized access: gated by role only (mirrors backend DOCUMENT_LIST_VIEW).
    // The DOCUMENT_LIST feature flag was removed here — its DB-seeded grants were
    // inconsistent (missing surveyor/ops/finance/admin-stock/purchasing), which hid
    // the menu for roles that actually had backend access.
    section: 'DOKUMEN', // FIX: section
    roles: [
      'SURVEYOR_FTTH', 'SURVEYOR_FTTB', 'SURVEYOR_FTTT', // surveyors
      'PM_FTTH', 'PM_FTTB', 'PM_FTTT', 'PM_SENIOR', // PMs
      'DESIGNER', // designer
      'ADMIN', 'ADMIN_STOCK', // admin + stock admin
      'GENERAL_MANAGER', // GM
      'OPERATIONAL_MANAGER', // ops
      'FINANCE', // finance
      'PURCHASING', // FIX: purchasing — was missing, now standardized
    ],
  },
  { href: '/dashboard-gm', label: 'Dashboard', icon: BarChart3, section: 'DASHBOARD', dashboardForAllRoles: true }, // FIX: href resolved via getDashboardHref
  {
    href: '/finance-projects',
    label: 'Finance Projects',
    icon: PiggyBank,
    section: 'DASHBOARD',
    roles: ['FINANCE', 'GENERAL_MANAGER', 'ADMIN', 'OPERATIONAL_MANAGER'], // FIX 8
  },
  { href: '/settings', label: 'Pengaturan', icon: Settings, section: 'MANAJEMEN', gmOnly: true },
  { href: '/guide', label: 'Panduan', icon: HelpCircle, section: 'UTILITAS' },
];

const ROLE_COLORS: Record<string, string> = {
  GENERAL_MANAGER: '#A371F7',
  PM_SENIOR: '#58A6FF',
  PM_FTTH: '#3FB950',
  PM_FTTB: '#3FB950',
  PM_FTTT: '#3FB950',
  ADMIN: '#F0883E',
  ADMIN_STOCK: '#E3B341',
  FINANCE: '#2EA043',
  SURVEYOR_FTTH: '#8B949E',
  SURVEYOR_FTTB: '#8B949E',
  SURVEYOR_FTTT: '#8B949E',
  DESIGNER: '#6366F1', // FIX Issue 10: role color for DESIGNER badge
  MARKETING: '#39D353',
  MARKETING_HEAD: '#1F6FEB',
  OPERATIONAL_MANAGER: '#BC8CFF',
  PURCHASING: '#0D9488',
};

const BREADCRUMB_MAP: Record<string, string[]> = {
  '/map': ['Peta GIS'],
  '/permit-clusters': ['Pipeline Perizinan'],
  '/visit-requests': ['Visit Request'],
  '/visit-requests/new': ['Visit Request', 'Buat Baru'],
  '/admin/legacy-ba-open': ['Admin', 'Legacy BA Open'],
  '/clean-list': ['Clean List'],
  '/fttt-projects': ['FTTT Projects'],
  '/fttt-projects/new': ['FTTT Projects', 'Baru'],
  '/daily-activity': ['Daily Activity'],
  '/ba-open': ['BA Open'],
  '/cash-operation': ['Cash Operation'],
  '/cash-operation/new': ['Cash Operation', 'Buat Request'],
  '/stock': ['Stok Barang'],
  '/order-barang': ['Order Barang'], // FIX: redirect legacy
  '/order-barang/new': ['Order Barang', 'Buat Order'], // FIX
  '/orders': ['Order Barang'], // FIX
  '/orders/new': ['Order Barang', 'Buat Order'], // FIX
  '/surat-jalan': ['Surat Jalan'],
  '/purchase-requests': ['Permintaan Pembelian'],
  '/suppliers': ['Master Supplier'],
  '/suppliers/new': ['Master Supplier', 'Baru'],
  '/purchasing': ['Purchasing'],
  '/supplier-invoices': ['Tagihan Supplier'],
  '/stock-out': ['Stock Out'],
  '/stock-out/new': ['Stock Out', 'Baru'],
  '/document-list': ['Daftar Dokumen'],
  '/dashboard-gm': ['Dashboard'],
  '/dashboard-pm': ['Dashboard PM'],
  '/dashboard-surveyor': ['Dashboard Surveyor'],
  '/dashboard-admin': ['Dashboard Admin'],
  '/dashboard-designer': ['Dashboard Designer'], // FIX Issue 4B: breadcrumb for new designer dashboard
  '/dashboard-finance': ['Dashboard Finance'], // FIX
  '/dashboard-ops': ['Dashboard Ops'], // FIX
  '/dashboard-marketing': ['Dashboard Marketing'], // FIX
  '/dashboard-admin-stock': ['Dashboard Admin Stok'], // FIX
  '/dashboard-purchasing': ['Dashboard Purchasing'],
  '/finance-projects': ['Finance Projects'],
  '/finance-projects/new': ['Finance Projects', 'Proyek Baru'],
  '/finance-projects/transfer': ['Finance Projects', 'Transfer Alokasi'],
  '/finance-projects/transfer/new': ['Finance Projects', 'Transfer', 'Baru'],
  '/settings': ['Pengaturan'],
  '/guide': ['Panduan'],
};

function resolveBreadcrumb(pathname: string): string[] {
  if (BREADCRUMB_MAP[pathname]) return BREADCRUMB_MAP[pathname];
  if (pathname.startsWith('/permit-clusters/')) return ['Pipeline Perizinan', 'Detail'];
  if (pathname.startsWith('/visit-requests/')) return ['Visit Request', 'Detail'];
  if (pathname.startsWith('/cash-operation/')) return ['Cash Operation', 'Detail'];
  if (pathname.startsWith('/order-barang/')) return ['Order Barang', 'Detail']; // FIX: legacy → /orders/[id]
  if (pathname.startsWith('/orders/') && pathname !== '/orders/new') return ['Order Barang', 'Detail']; // FIX
  if (pathname.startsWith('/suppliers/') && pathname !== '/suppliers/new') return ['Master Supplier', 'Detail'];
  if (pathname.startsWith('/purchasing/')) return ['Purchasing', 'Detail'];
  if (pathname.startsWith('/supplier-invoices/')) return ['Tagihan Supplier', 'Detail'];
  if (pathname.startsWith('/stock-out/') && pathname !== '/stock-out/new') return ['Stock Out', 'Detail'];
  if (pathname.startsWith('/fttt-projects/') && pathname !== '/fttt-projects/new') return ['FTTT Projects', 'Detail'];
  if (pathname.startsWith('/finance-projects/transfer/') && pathname !== '/finance-projects/transfer/new') {
    return ['Finance Projects', 'Transfer', 'Detail'];
  }
  if (
    pathname.startsWith('/finance-projects/') &&
    pathname !== '/finance-projects/new' &&
    pathname !== '/finance-projects/transfer' &&
    pathname !== '/finance-projects/transfer/new'
  ) {
    return ['Finance Projects', 'Detail'];
  }
  return ['Dashboard'];
}

function shouldShowSection(section: NavItem['section'], role?: string): boolean {
  if (!role) return false;
  const isSurveyor = role.startsWith('SURVEYOR_');
  if (section === 'INVENTARIS' && (isSurveyor || role === 'MARKETING' || role === 'MARKETING_HEAD')) return false; // FIX: requested visibility
  return true;
}

function formatTimeAgoId(iso: string) {
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  if (diffMs < 60_000) return 'Baru saja';
  const m = Math.floor(diffMs / 60_000);
  if (m < 60) return `${m}m lalu`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}j lalu`;
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
}

function AppSignalLogo() {
  return (
    <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
      <path d="M4 16 Q16 4 28 16" stroke="#00D4B4" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M8 20 Q16 10 24 20" stroke="#00D4B4" strokeWidth="2.5" strokeLinecap="round" opacity="0.7" />
      <path d="M12 24 Q16 18 20 24" stroke="#00D4B4" strokeWidth="2.5" strokeLinecap="round" opacity="0.4" />
    </svg>
  );
}

function NavItemLink({
  item,
  collapsed,
  active,
  badge,
  onClick,
}: {
  item: NavItem;
  collapsed: boolean;
  active: boolean;
  badge?: number;
  onClick?: () => void;
}) {
  const activeStyle: CSSProperties = {
    color: 'var(--nav-active-text)',
    background: 'var(--nav-active-bg)',
    fontWeight: 500,
  };
  const inactiveStyle: CSSProperties = {
    color: 'var(--nav-inactive)',
    background: 'transparent',
  };

  return (
    <Link
      href={item.href}
      title={collapsed ? item.label : undefined}
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: collapsed ? 'center' : 'flex-start',
        gap: collapsed ? 0 : 10,
        height: 36,
        margin: '1px 8px',
        padding: collapsed ? 0 : '0 10px',
        borderRadius: 8,
        textDecoration: 'none',
        transition: 'all 150ms ease',
        position: 'relative',
        ...(active ? activeStyle : inactiveStyle),
      }}
      onMouseEnter={(e) => {
        if (!active) {
          e.currentTarget.style.color = 'var(--nav-active-text)';
          e.currentTarget.style.background = 'var(--nav-hover-bg)';
        }
      }}
      onMouseLeave={(e) => {
        if (!active) {
          e.currentTarget.style.color = 'var(--nav-inactive)';
          e.currentTarget.style.background = 'transparent';
        }
      }}
    >
      <item.icon style={{ width: 16, height: 16, flexShrink: 0 }} />
      {!collapsed ? (
        <span style={{ fontSize: 13, fontWeight: 500, flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {item.label}
        </span>
      ) : null}
      {badge !== undefined && badge > 0 ? (
        collapsed ? (
          <span style={{ position: 'absolute', top: -2, right: 12, width: 8, height: 8, borderRadius: '50%', background: '#F85149' }} />
        ) : (
          <span className="badge-pulse" style={{ minWidth: 18, height: 18, borderRadius: 9, background: '#F85149', color: '#FFF', fontSize: 10, fontWeight: 600, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px' }}>
            {badge > 9 ? '9+' : badge}
          </span>
        )
      ) : null}
    </Link>
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, accessToken, hydrated, logout, canAccess, featureAccessReady, hydrate } = useAuthStore();
  const {
    notifications, unreadCount, unreadPRCount, unreadCashOpCount,
    addNotification, markAllRead, markRead,
    incrementUnreadPR, resetUnreadPR, incrementUnreadCashOp,
  } = useNotificationStore();

  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [notifApi, setNotifApi] = useState<{ notifications: Array<{ id: string; title: string; message: string; link: string | null; isRead: boolean; createdAt: string; type?: string }>; unreadCount: number } | null>(null); // FIX: include optional `type` so TASK/PERMIT_FLOW/etc can be iconified in the bell
  const [notifApiLoading, setNotifApiLoading] = useState(false);
  const [markingAllNotif, setMarkingAllNotif] = useState(false);
  const [backendStatus, setBackendStatus] = useState<'checking' | 'ok' | 'error'>('checking'); // FIX: surface backend reachability in the UI instead of generic "Server error"
  const [purchasingInboxCount, setPurchasingInboxCount] = useState(0);
  const [stockOutInboxCount, setStockOutInboxCount] = useState(0);

  const notifRef = useRef<HTMLDivElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const healthFailStreak = useRef(0); // FIX: avoid flashing “backend down” on first transient failure

  const sidebarWidth = collapsed ? 56 : 240;
  const breadcrumb = useMemo(() => resolveBreadcrumb(pathname), [pathname]);
  const initials = user?.name?.split(' ').map((x) => x[0]).join('').slice(0, 2).toUpperCase() ?? 'PT';
  const roleColor = ROLE_COLORS[user?.role ?? ''] ?? '#8B949E';

  const visibleNav = useMemo(() => {
    if (!user) return [];
    const filtered = NAV_ITEMS.filter((item) => {
      if (item.gmOnly && user.role !== 'GENERAL_MANAGER') return false;
      if (item.dashboardForAllRoles) return true; // FIX: everyone gets a dashboard target
      if (item.roles && !item.roles.includes(user.role as Role)) return false;
      if (!shouldShowSection(item.section, user.role)) return false;
      if (item.featureKey && !canAccess(item.featureKey)) return false;
      return true;
    });
    return filtered.map((item) =>
      item.dashboardForAllRoles ? { ...item, href: getDashboardHref(user.role) } : item,
    ); // FIX: role-specific dashboard href
  }, [user, canAccess, featureAccessReady]);

  const sections = useMemo(() => ([
    { key: 'OPERASIONAL', label: 'Operasional', items: visibleNav.filter((n) => n.section === 'OPERASIONAL') },
    { key: 'INVENTARIS', label: 'Inventaris', items: visibleNav.filter((n) => n.section === 'INVENTARIS') },
    { key: 'DOKUMEN', label: 'Dokumen', items: visibleNav.filter((n) => n.section === 'DOKUMEN') },
    { key: 'DASHBOARD', label: 'Dashboard', items: visibleNav.filter((n) => n.section === 'DASHBOARD') },
    { key: 'MANAJEMEN', label: 'Manajemen', items: visibleNav.filter((n) => n.section === 'MANAJEMEN') },
  ]).filter((s) => s.items.length > 0), [visibleNav]);

  const handleNotif = useCallback((title: string, message: string, link: string, type: 'success' | 'info' | 'warning' | 'error' = 'info') => {
    addNotification({ id: String(Date.now()), type, title, message, link, isRead: false, createdAt: new Date().toISOString() });
    if (type === 'success') toast.success(title, { description: message });
    else if (type === 'warning') toast.warning(title, { description: message });
    else if (type === 'error') toast.error(title, { description: message });
    else toast.info(title, { description: message });
  }, [addNotification]);

  const loadNotificationsApi = useCallback(async () => {
    if (!user) return;
    setNotifApiLoading(true);
    try {
      const data = await apiGet<{ notifications: Array<{ id: string; title: string; message: string; link: string | null; isRead: boolean; createdAt: string; type?: string }>; unreadCount: number }>( // FIX: include `type` in payload shape so bell can map to icon
        '/notifications/my?limit=25',
        undefined,
        { silentForbidden: true },
      ); // FIX: designer (and other narrow roles) must not get spammed on bell prefetch
      setNotifApi(data);
    } catch {
      /* silent */
    } finally {
      setNotifApiLoading(false);
    }
  }, [user]);

  useEffect(() => { // FIX: hydrate → wait → auth/me → feature flags (sequential, fail-closed nav)
    let cancelled = false;
    (async () => {
      await (hydrate as () => Promise<void>)();
      const tok = useAuthStore.getState().accessToken;
      if (!tok || cancelled) return;
      useAuthStore.getState().resetFeatureAccess();
      const meRes = await apiFetch('/auth/me');
      if (cancelled) return;
      if (!meRes.ok) {
        await useAuthStore.getState().logout();
        router.replace('/login');
        return;
      }
      const me = await meRes.json();
      useAuthStore.getState().setUser(me);
      await useAuthStore.getState().fetchFeatureAccess();
    })();
    return () => { cancelled = true; };
  }, [hydrate, router]);

  useEffect(() => { // FIX: auth gate — only redirect after hydration completes to avoid race on page refresh
    if (hydrated && !accessToken) router.replace('/login');
  }, [accessToken, hydrated, router]);

  const refreshPurchasingAndStockBadges = useCallback(async () => {
    if (!user) return;
    const purchasingRoles = ['PURCHASING', 'GENERAL_MANAGER', 'ADMIN', 'FINANCE'];
    if (purchasingRoles.includes(user.role)) {
      try {
        const j = await apiGet<{ count: number }>('/purchasing/inbox-count', undefined, { silentForbidden: true });
        setPurchasingInboxCount(j.count ?? 0);
      } catch {
        setPurchasingInboxCount(0);
      }
    } else setPurchasingInboxCount(0);

    if (user.role === 'ADMIN_STOCK') {
      try {
        const j = await apiGet<{ count: number }>('/stock-out/inbox-count', undefined, { silentForbidden: true });
        setStockOutInboxCount(j.count ?? 0);
      } catch {
        setStockOutInboxCount(0);
      }
    } else setStockOutInboxCount(0);
  }, [user]);

  useEffect(() => {
    void refreshPurchasingAndStockBadges();
  }, [refreshPurchasingAndStockBadges]);

  useEffect(() => { // FIX: click outside dropdown handler
    const onDocClick = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setNotifOpen(false);
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) setUserMenuOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  useEffect(() => { // FIX: mobile sidebar always expanded
    if (mobileOpen) setCollapsed(false);
  }, [mobileOpen]);

  useEffect(() => { // FIX: retain existing socket event listeners
    if (!accessToken || !user) return;
    // FIX: use centralised API_HOST — no hardcoded localhost fallback
    // FIX 4: allow polling fallback + pass ngrok bypass header on polling requests (ignored on pure websocket)
    const s = io(API_HOST, {
      auth: { token: accessToken },
      transports: ['websocket', 'polling'],
      extraHeaders: { 'ngrok-skip-browser-warning': 'true' },
    });
    s.on('connect', () => s.emit('register', { userId: user.id, role: user.role }));
    s.on('featureFlag:updated', async () => {
      await useAuthStore.getState().fetchFeatureAccess();
    });
    s.on('user:roleChanged', async (data: { userId?: string }) => {
      if (data?.userId && data.userId === user.id) {
        toast.warning('Role akun Anda telah diubah. Silakan login kembali.');
        await logout();
        router.replace('/login');
      }
    });
    s.on('visitRequest:submitted', (data: { id: string; rwCode?: string; gate?: 'visit' | 'survey' }) => {
      const rw = data.rwCode ?? '—';
      if (data.gate === 'survey') {
        handleNotif('Hasil survey dikirim', `${rw} — menunggu review hasil survey (PM)`, `/visit-requests/${data.id}`);
      } else if (data.gate === 'visit') {
        handleNotif('Jadwal dikirim', `${rw} — menunggu review jadwal kunjungan (PM)`, `/visit-requests/${data.id}`);
      } else {
        handleNotif('Visit Request', `${rw} — menunggu review`, `/visit-requests/${data.id}`);
      }
    });
    s.on('visitRequest:visitGateApproved', (data: { id: string }) => {
      handleNotif(
        'Jadwal disetujui',
        'Silakan isi data survey lapangan di halaman visit request.',
        `/visit-requests/${data.id}`,
        'success',
      );
    });
    s.on(
      'visitRequest:visitGateRejected',
      (data: { id: string; rejectionReason?: string }) => {
        handleNotif(
          'Jadwal perlu direvisi',
          'PM meminta revisi jadwal kunjungan. Silakan ubah tanggal/jam lalu ajukan ulang.',
          `/visit-requests/${data.id}`,
          'warning',
        );
      },
    );
    s.on('visitRequest:pmReviewed', (data: { id: string; status: string }) =>
      handleNotif('Review hasil survey (PM)', `Status: ${data.status}`, `/visit-requests/${data.id}`),
    );
    s.on('visitRequest:pmSeniorReviewed', (data: { id: string; status: string }) => handleNotif('Review PM Senior', `Status: ${data.status}`, `/visit-requests/${data.id}`));
    s.on('visitRequest:adminApproved', (data: { id: string; baOpenGenerated?: boolean }) => handleNotif('Approval Admin', data.baOpenGenerated ? 'BA Open telah dibuat' : 'Jaringan existing ditandai', `/visit-requests/${data.id}`));
    s.on('baOpen:generated', (data: { documentNumber: string; baOpenId: string }) => handleNotif('BA Open Dibuat', data.documentNumber, `/ba-open/${data.baOpenId}`, 'success'));
    s.on('order:suratJalanReady', (data: { orderNumber: string; documentNumber: string }) => handleNotif('Surat Jalan Siap', `Order ${data.orderNumber} — ${data.documentNumber} siap diunduh`, '/surat-jalan', 'success'));
    s.on('purchaseRequest:new', (data: { requestNumber: string; itemCount: number }) => {
      if (user.role === 'FINANCE' || user.role === 'GENERAL_MANAGER') {
        handleNotif('Permintaan Pembelian Baru', `${data.requestNumber} — ${data.itemCount} item`, '/purchase-requests');
        incrementUnreadPR();
      }
    });
    s.on('order:purchaseRequestCreated', () => {
      if (user.role === 'FINANCE' || user.role === 'GENERAL_MANAGER') incrementUnreadPR();
    });
    s.on('purchaseRequest:updated', (data: { requestNumber: string; status: string }) => {
      handleNotif('Update Permintaan Pembelian', `${data.requestNumber} → ${data.status}`, '/purchase-requests');
      if (user.role === 'FINANCE') resetUnreadPR();
    });
    s.on('stock:lowAlert', (data: { itemName: string; currentQty: number; unit?: string }) => {
      if (user.role !== 'ADMIN_STOCK' && user.role !== 'GENERAL_MANAGER') return;
      handleNotif('Stok Rendah', `${data.itemName}: sisa ${data.currentQty} ${data.unit ?? ''}`, '/stock?lowStock=true', 'warning');
    });
    s.on('cashOp:newRequest', () => {
      if (['PM_FTTH','PM_FTTB','PM_FTTT','PM_SENIOR','ADMIN','OPERATIONAL_MANAGER','GENERAL_MANAGER','FINANCE','MARKETING_HEAD'].includes(user.role)) {
        incrementUnreadCashOp();
        toast.info('Ada request cash operation baru yang perlu ditinjau');
      }
    });
    s.on('cashOp:approved', (data: { requestNumber?: string }) => toast.success(`Request ${data.requestNumber ?? ''} disetujui`));
    s.on('cashOp:rejected', (data: { requestNumber?: string; reason?: string }) => toast.error(`Request ${data.requestNumber ?? ''} ditolak: ${data.reason ?? ''}`));
    s.on('cashOp:disbursed', (data: { amount?: number }) => toast.success(`Dana Rp ${Number(data.amount ?? 0).toLocaleString('id-ID')} telah dicairkan`));
    s.on('cashOp:realisasiSubmitted', (data: { cashOpId: string; requestNumber: string }) => {
      const approverRoles = [
        'FINANCE',
        'OPERATIONAL_MANAGER',
        'MARKETING_HEAD',
        'GENERAL_MANAGER',
        'PM_SENIOR',
      ];
      if (!approverRoles.includes(user.role)) return;
      toast.info(`Realisasi ${data.requestNumber} menunggu review Anda`, {
        action: { label: 'Lihat', onClick: () => router.push(`/cash-operation/${data.cashOpId}`) },
      });
    });
    s.on('cashOp:realisasiCompleted', (data: { cashOpId: string; requestNumber: string }) => {
      toast.success(`Realisasi ${data.requestNumber} selesai disetujui`, {
        action: { label: 'Lihat', onClick: () => router.push(`/cash-operation/${data.cashOpId}`) },
      });
      void loadNotificationsApi();
    });
    s.on(
      'cashOp:realisasiRejected',
      (data: { cashOpId: string; requestNumber: string; reason?: string }) => {
        const r = data.reason ? `: ${data.reason}` : '';
        toast.warning(`Realisasi ${data.requestNumber} perlu revisi${r}`, {
          action: { label: 'Lihat', onClick: () => router.push(`/cash-operation/${data.cashOpId}`) },
        });
        void loadNotificationsApi();
      },
    );
    s.on('cashOp:realisasiFinanceApproved', (data: { cashOpId: string; requestNumber: string }) => {
      const go = () => router.push(`/cash-operation/${data.cashOpId}`);
      if (user.role === 'GENERAL_MANAGER') {
        toast.info(`Realisasi ${data.requestNumber} disetujui Finance, menunggu approval Anda`, {
          action: { label: 'Lihat', onClick: go },
        });
      } else {
        toast.info(`Realisasi ${data.requestNumber} disetujui Finance, menunggu approval GM`, {
          action: { label: 'Lihat', onClick: go },
        });
      }
    });
    s.on('cashOp:realisasiFinanceRejected', (data: { cashOpId: string; requestNumber: string; reason?: string }) => {
      const r = data.reason ? `: ${data.reason}` : '';
      toast.error(`Realisasi ${data.requestNumber} ditolak Finance${r}`, {
        action: { label: 'Lihat', onClick: () => router.push(`/cash-operation/${data.cashOpId}`) },
      });
    });
    s.on(
      'cashOp:realisasiGmApproved',
      (data: { cashOpId: string; requestNumber: string; refundAmount?: string }) => {
        const go = () => router.push(`/cash-operation/${data.cashOpId}`);
        if (user.role === 'FINANCE') {
          toast.success(`Realisasi ${data.requestNumber} telah selesai`, {
            action: { label: 'Lihat', onClick: go },
          });
          return;
        }
        const refund =
          data.refundAmount && Number(data.refundAmount) > 0
            ? ` Selisih Rp ${Number(data.refundAmount).toLocaleString('id-ID')} dikembalikan ke budget.`
            : '';
        toast.success(`Realisasi ${data.requestNumber} selesai.${refund}`, {
          action: { label: 'Lihat', onClick: go },
        });
      },
    );
    s.on('cashOp:realisasiGmRejected', (data: { cashOpId: string; requestNumber: string; reason?: string }) => {
      const r = data.reason ? `: ${data.reason}` : '';
      toast.error(`Realisasi ${data.requestNumber} ditolak GM${r}`, {
        action: { label: 'Lihat', onClick: () => router.push(`/cash-operation/${data.cashOpId}`) },
      });
    });
    // Phase 3 — procurement / order workflow
    s.on('order:pendingPurchasing', (payload: { orderId: string; orderNumber: string }) => {
      if (user.role === 'PURCHASING') {
        toast.info(`Order ${payload.orderNumber} menunggu input harga`, {
          action: { label: 'Lihat', onClick: () => router.push(`/purchasing/${payload.orderId}`) },
        });
        void refreshPurchasingAndStockBadges();
      }
    });
    s.on('order:pendingOpsApproval', (payload: { orderId: string; orderNumber: string }) => {
      if (user.role === 'OPERATIONAL_MANAGER') {
        toast.info(`Order ${payload.orderNumber} menunggu persetujuan Ops`, {
          action: { label: 'Detail', onClick: () => router.push(`/orders/${payload.orderId}`) },
        });
      }
    });
    s.on('order:pendingGmApproval', (payload: { orderId: string; orderNumber: string }) => {
      if (user.role === 'GENERAL_MANAGER') {
        toast.info(`Order ${payload.orderNumber} menunggu persetujuan GM`, {
          action: { label: 'Detail', onClick: () => router.push(`/orders/${payload.orderId}`) },
        });
      }
    });
    s.on('order:gmApproved', (payload: { orderId: string; orderNumber: string }) => {
      if (user.role === 'FINANCE') {
        toast.info(`Order ${payload.orderNumber} disetujui GM — lakukan pembayaran & unggah bukti sesuai SOP`, {
          action: { label: 'Buka order', onClick: () => router.push(`/orders/${payload.orderId}`) },
        });
      }
    });
    s.on('order:purchased', (payload: { orderId: string; orderNumber: string }) => {
      if (user.role === 'ADMIN_STOCK') {
        toast.info(`Order ${payload.orderNumber} sudah dibayar — siapkan penerimaan & verifikasi barang`, {
          action: { label: 'Buka order', onClick: () => router.push(`/orders/${payload.orderId}`) },
        });
      }
    });
    s.on('supplierInvoice:uploaded', (payload: { invoiceId: string; invoiceNumber: string }) => {
      if (user.role === 'PURCHASING') {
        toast.info(`Tagihan ${payload.invoiceNumber} siap dikirim ke supplier`, {
          action: { label: 'Lihat', onClick: () => router.push(`/supplier-invoices/${payload.invoiceId}`) },
        });
      }
    });
    s.on('supplierInvoice:supplierAck', (payload: { invoiceId: string; invoiceNumber: string }) => {
      if (user.role === 'PURCHASING' || user.role === 'FINANCE') {
        toast.success(`Supplier menyetujui tagihan ${payload.invoiceNumber}`, {
          action: { label: 'Detail', onClick: () => router.push(`/supplier-invoices/${payload.invoiceId}`) },
        });
      }
    });
    s.on(
      'supplierInvoice:supplierReject',
      (payload: { invoiceId: string; invoiceNumber: string; reason: string }) => {
        if (user.role === 'FINANCE') {
          toast.error(`Supplier tolak tagihan ${payload.invoiceNumber}: ${payload.reason}`, {
            action: { label: 'Detail', onClick: () => router.push(`/supplier-invoices/${payload.invoiceId}`) },
          });
        }
      },
    );
    s.on('stockOut:requested', (payload: { stockOutId: string; requestNumber: string }) => {
      if (user.role === 'ADMIN_STOCK') {
        toast.info(`Permintaan stock out baru: ${payload.requestNumber}`, {
          action: { label: 'Buka', onClick: () => router.push(`/stock-out/${payload.stockOutId}`) },
        });
        void refreshPurchasingAndStockBadges();
      }
    });
    s.on('stockOut:fulfilled', (payload: { stockOutId: string; requestNumber: string }) => {
      toast.success(`Permintaan ${payload.requestNumber} dipenuhi`, {
        action: { label: 'Detail', onClick: () => router.push(`/stock-out/${payload.stockOutId}`) },
      });
    });
    s.on('stockOut:rejected', (payload: { stockOutId: string; requestNumber: string; reason: string }) => {
      toast.warning(`Permintaan ${payload.requestNumber} ditolak: ${payload.reason}`, {
        action: { label: 'Detail', onClick: () => router.push(`/stock-out/${payload.stockOutId}`) },
      });
    });
    s.on('notification:new', (payload: { title?: string; message?: string; link?: string }) => {
      void loadNotificationsApi();
      if (payload?.title) {
        handleNotif(payload.title, payload.message ?? '', payload.link ?? '/', 'info');
      }
    }); // FIX: realtime bell sync + toast
    setSocket(s);
    return () => { // FIX: return void in effect cleanup
      s.off('notification:new');
      s.disconnect();
    };
  }, [
    accessToken,
    user,
    router,
    handleNotif,
    incrementUnreadPR,
    resetUnreadPR,
    incrementUnreadCashOp,
    loadNotificationsApi,
    refreshPurchasingAndStockBadges,
  ]);

  useEffect(() => {
    loadNotificationsApi();
  }, [loadNotificationsApi]);

  useEffect(() => {
    if (!user) return;
    const id = setInterval(loadNotificationsApi, 30000);
    return () => clearInterval(id);
  }, [user, loadNotificationsApi]);

  // FIX: backend health probe — drives the red toast when the API is unreachable
  useEffect(() => {
    let cancelled = false;
    const apiBase = API_BASE; // FIX: centralised API base URL
    const probe = async () => {
      try {
        const res = await fetch(`${apiBase}/health`, {
          headers: { 'ngrok-skip-browser-warning': 'true' },
          cache: 'no-store',
        });
        if (cancelled) return;
        if (res.ok) {
          healthFailStreak.current = 0; // FIX
          setBackendStatus('ok');
        } else {
          healthFailStreak.current += 1; // FIX
          if (healthFailStreak.current >= 2) setBackendStatus('error'); // FIX: require consecutive failures
        }
      } catch {
        if (cancelled) return;
        healthFailStreak.current += 1; // FIX
        if (healthFailStreak.current >= 2) setBackendStatus('error'); // FIX
      }
    };
    probe();
    const id = setInterval(probe, 20000); // FIX: re-check every 20s so banner self-heals after ngrok/restart
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const markAllNotificationsApi = useCallback(async () => {
    setMarkingAllNotif(true);
    try {
      await apiPost('/notifications/mark-all-read', {});
      await loadNotificationsApi();
      markAllRead();
      toast.success('Semua notifikasi ditandai sudah dibaca');
    } catch {
      toast.error('Gagal menandai notifikasi');
    } finally {
      setMarkingAllNotif(false);
    }
  }, [loadNotificationsApi, markAllRead]);

  const handleLogout = useCallback(async () => {
    socket?.disconnect();
    await logout();
    router.replace('/login');
  }, [logout, router, socket]);

  if (!user) return null;

  const bellUnread = notifApi != null ? notifApi.unreadCount : unreadCount;
  const bellList = (notifApi?.notifications?.length ? notifApi.notifications : notifications) as typeof notifications;

  const sidebarNode = ( // NEW: single sidebar node reused by desktop + mobile
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--sidebar-bg)',
        borderRight: '0.5px solid var(--sidebar-border)',
        overflow: 'hidden',
        fontFamily: 'var(--font-jakarta, sans-serif)',
      }}
    >
      <div style={{ height: 52, borderBottom: '0.5px solid var(--sidebar-border)', display: 'flex', alignItems: 'center', padding: collapsed ? '0 14px' : '0 16px', gap: 10, justifyContent: collapsed ? 'center' : 'flex-start' }}>
        <AppSignalLogo />
        {!collapsed ? <span style={{ color: '#111827', fontSize: 15, fontWeight: 600, letterSpacing: -0.3 }}>PermaTrax</span> : null}
        {!collapsed ? (
          <button type="button" onClick={() => setCollapsed(true)} style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: 'var(--nav-inactive)', cursor: 'pointer', display: 'inline-flex' }}>
            <ChevronLeft size={16} />
          </button>
        ) : null}
      </div>

      <div style={{ height: 60, borderBottom: '0.5px solid var(--sidebar-border)', padding: '0 12px', display: 'flex', alignItems: 'center', justifyContent: collapsed ? 'center' : 'flex-start', gap: 10 }}>
        <ProfileAvatar name={user.name} role={user.role} avatarUrl={user.avatarUrl} size={34} roleColor={roleColor} />
        {!collapsed ? (
          <>
            <div style={{ minWidth: 0, flex: 1 }}>
              <p style={{ margin: 0, color: '#111827', fontSize: 13, fontWeight: 500, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{user.name}</p>
              <span style={{ display: 'inline-flex', padding: '1px 6px', borderRadius: 3, fontSize: 10, fontWeight: 500, marginTop: 2, background: `${roleColor}26`, color: roleColor }}>{user.role.replace(/_/g, ' ')}</span>
            </div>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#39D353' }} />
          </>
        ) : null}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
        {!featureAccessReady ? (
          <div style={{ padding: '8px 16px' }}>
            {[1, 2, 3, 4, 5].map((i) => (
              <div
                key={i}
                style={{
                  height: 36,
                  margin: '4px 8px',
                  borderRadius: 8,
                  background: 'var(--nav-hover-bg, #F3F4F6)',
                  opacity: 0.6,
                }}
              />
            ))}
          </div>
        ) : sections.map((section) => (
          <div key={section.key}>
            {!collapsed ? (
              <p style={{ padding: '16px 16px 4px', margin: 0, fontSize: 10, fontWeight: 600, color: '#9CA3AF', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                {section.label}
              </p>
            ) : null}
            {section.items.map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              const badge =
                item.badge === 'pr'
                  ? unreadPRCount
                  : item.badge === 'cashOp'
                    ? unreadCashOpCount
                    : item.badge === 'purchasingInbox'
                      ? purchasingInboxCount
                      : item.badge === 'stockOutInbox'
                        ? stockOutInboxCount
                        : 0;
              return <NavItemLink key={item.href} item={item} collapsed={collapsed} active={active} badge={badge} onClick={() => setMobileOpen(false)} />;
            })}
          </div>
        ))}
      </div>

      <div style={{ borderTop: '0.5px solid var(--sidebar-border)', padding: '6px 8px' }}>
        <NavItemLink item={{ href: '/guide', label: 'Panduan', icon: HelpCircle, section: 'UTILITAS' }} collapsed={collapsed} active={pathname === '/guide'} onClick={() => setMobileOpen(false)} />
        {!collapsed ? (
          <button type="button" onClick={() => setCollapsed(true)} style={{ width: 'calc(100% - 16px)', margin: '1px 8px', height: 36, borderRadius: 8, border: 'none', background: 'transparent', color: 'var(--nav-inactive)', display: 'flex', alignItems: 'center', gap: 10, padding: '0 10px', cursor: 'pointer' }}>
            <ChevronLeft size={16} /> <span style={{ fontSize: 13, fontWeight: 500 }}>Collapse</span>
          </button>
        ) : (
          <button type="button" onClick={() => setCollapsed(false)} style={{ width: 'calc(100% - 16px)', margin: '1px 8px', height: 36, borderRadius: 8, border: 'none', background: 'transparent', color: 'var(--nav-inactive)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
            <ChevronRight size={16} />
          </button>
        )}
        <button type="button" onClick={handleLogout} style={{ width: 'calc(100% - 16px)', margin: '1px 8px', height: 36, borderRadius: 8, border: 'none', background: 'transparent', color: 'var(--nav-inactive)', display: 'flex', alignItems: 'center', gap: collapsed ? 0 : 10, justifyContent: collapsed ? 'center' : 'flex-start', padding: collapsed ? 0 : '0 10px', cursor: 'pointer' }}>
          <LogOut size={16} />
          {!collapsed ? <span style={{ fontSize: 13, fontWeight: 500 }}>Keluar</span> : null}
        </button>
      </div>
    </div>
  );

  return (
    <div
      className={jakarta.variable}
      style={{
        height: '100vh',
        width: '100%',
        overflow: 'hidden',
        ['--sidebar-bg' as string]: '#FFFFFF',
        ['--sidebar-border' as string]: '#E5E7EB',
        ['--sidebar-width' as string]: `${sidebarWidth}px`,
        ['--sidebar-width-sm' as string]: '56px',
        ['--nav-active-bg' as string]: '#FDE8E8',
        ['--nav-active-text' as string]: '#F06A6A',
        ['--nav-active-bar' as string]: '#F06A6A',
        ['--nav-hover-bg' as string]: '#F3F4F6',
        ['--nav-inactive' as string]: '#6B7280',
        ['--content-bg' as string]: '#F6F8FA',
        ['--navbar-bg' as string]: '#FFFFFF',
        ['--navbar-border' as string]: '#D0D7DE',
        ['--accent' as string]: '#F06A6A',
        ['--accent-hover' as string]: '#E55A5A',
        ['--danger' as string]: '#F85149',
        ['--warning' as string]: '#D29922',
      }}
    >
      <style>{`
        @keyframes badge-pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.2); } } /* NEW */
        .badge-pulse { animation: badge-pulse .8s ease-in-out; } /* NEW */
        .dashboard-content { margin-left: var(--sidebar-width); transition: margin-left 200ms cubic-bezier(0.4, 0, 0.2, 1); } /* NEW */
        @media (max-width: 767px) { .dashboard-content { margin-left: 0 !important; } } /* NEW */
      `}</style>

      <aside className="hidden md:block" style={{ position: 'fixed', top: 0, left: 0, bottom: 0, width: sidebarWidth, zIndex: 40, transition: 'width 200ms cubic-bezier(0.4, 0, 0.2, 1)' }}>
        {sidebarNode}
      </aside>

      {mobileOpen ? (
        <>
          <div onClick={() => setMobileOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 48 }} />
          <aside className="md:hidden" style={{ position: 'fixed', top: 0, left: 0, bottom: 0, width: 240, zIndex: 49 }}>
            {sidebarNode}
          </aside>
        </>
      ) : null}

      <div className="dashboard-content" style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--content-bg)' }}>
        <header style={{ height: 52, background: 'var(--navbar-bg)', borderBottom: '0.5px solid var(--navbar-border)', padding: '0 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button type="button" onClick={() => setMobileOpen((prev) => !prev)} className="md:hidden" style={{ width: 36, height: 36, borderRadius: 18, border: 'none', background: 'var(--color-background-secondary, #f3f4f6)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }} aria-label={mobileOpen ? 'Tutup menu' : 'Buka menu'}>
              {mobileOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
            <div style={{ fontSize: 13, color: '#57606A' }}>
              {breadcrumb.map((b, idx) => (
                <span key={`${b}-${idx}`}>
                  {idx > 0 ? <span style={{ color: '#8B949E' }}> / </span> : null}
                  <span style={{ color: idx === breadcrumb.length - 1 ? '#1F2328' : '#57606A' }}>{b}</span>
                </span>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div ref={notifRef} style={{ position: 'relative' }}>
              <button
                type="button"
                onClick={() => {
                  setNotifOpen((v) => !v);
                  loadNotificationsApi();
                }}
                style={{ width: 36, height: 36, borderRadius: 18, border: 'none', background: 'transparent', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#57606A', cursor: 'pointer', position: 'relative' }}
              >
                {bellUnread > 0 ? <BellRing size={18} /> : <Bell size={18} />}
                {bellUnread > 0 ? (
                  <span
                    className="badge-pulse"
                    style={{
                      position: 'absolute',
                      top: -2,
                      right: -2,
                      minWidth: 18,
                      height: 18,
                      borderRadius: 9,
                      background: '#F85149',
                      color: '#FFF',
                      fontSize: 10,
                      fontWeight: 600,
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: '0 4px',
                    }}
                  >
                    {bellUnread > 99 ? '99+' : bellUnread > 9 ? '9+' : bellUnread}
                  </span>
                ) : null}
              </button>
              {notifOpen ? (
                <div style={{ position: 'absolute', right: 0, marginTop: 8, width: 320, background: '#FFF', border: '0.5px solid #D0D7DE', borderRadius: 12, boxShadow: '0 8px 24px rgba(0,0,0,0.12)', overflow: 'hidden', zIndex: 60 }}>
                  <div style={{ height: 40, borderBottom: '0.5px solid #D0D7DE', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 12px' }}>
                    <span style={{ fontSize: 13, fontWeight: 500 }}>Notifikasi</span>
                    {(notifApi?.unreadCount ?? 0) > 0 ? (
                      <button
                        type="button"
                        disabled={markingAllNotif || notifApiLoading}
                        onClick={markAllNotificationsApi}
                        style={{ border: 'none', background: 'transparent', color: 'var(--accent)', fontSize: 12, cursor: markingAllNotif ? 'wait' : 'pointer' }}
                      >
                        {markingAllNotif ? '…' : 'Baca Semua'}
                      </button>
                    ) : (
                      <button type="button" onClick={markAllRead} style={{ border: 'none', background: 'transparent', color: 'var(--accent)', fontSize: 12, cursor: 'pointer' }}>
                        Tandai dibaca
                      </button>
                    )}
                  </div>
                  <div style={{ maxHeight: 360, overflowY: 'auto' }}>
                    {bellList.length === 0 ? (
                      <div style={{ padding: '24px 12px', textAlign: 'center', color: '#8B949E' }}>
                        <Bell size={40} style={{ margin: '0 auto 8px' }} />
                        <div style={{ fontSize: 13 }}>{notifApiLoading ? 'Memuat…' : 'Tidak ada notifikasi'}</div>
                      </div>
                    ) : (
                      bellList.map((n) => {
                        const borderColor =
                          'type' in n && n.type === 'success'
                            ? '#00D4B4'
                            : 'type' in n && n.type === 'error'
                              ? '#F85149'
                              : 'type' in n && n.type === 'warning'
                                ? '#D29922'
                                : '#1F6FEB';
                        const href = n.link || '#';
                        return (
                          <Link
                            key={n.id}
                            href={href}
                            onClick={async () => {
                              markRead(n.id);
                              if (notifApi?.notifications?.length) {
                                try {
                                  await apiPost(`/notifications/${n.id}/read`, {});
                                  await loadNotificationsApi();
                                } catch {
                                  /* ignore */
                                }
                              }
                              setNotifOpen(false);
                            }}
                            style={{
                              display: 'block',
                              borderLeft: `3px solid ${borderColor}`,
                              padding: '10px 12px',
                              background: n.isRead ? '#F6F8FA' : '#FFF',
                              textDecoration: 'none',
                              color: '#1F2328',
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                              <div style={{ display: 'flex', gap: 8, minWidth: 0, flex: 1 }}>
                                {/* FIX: Fix 8 — type-specific icon so TASK/PERMIT_FLOW/CASH_OPERATION/VISIT_REQUEST are visually distinct */}
                                <span style={{ fontSize: 16, lineHeight: '16px', flexShrink: 0, marginTop: 1 }}>
                                  {(() => {
                                    const t = ('type' in n ? (n as { type?: string }).type : undefined) ?? '';
                                    if (t === 'TASK') return '📌';
                                    if (t === 'VISIT_REQUEST') return '🏠';
                                    if (t === 'PERMIT_FLOW') return '📋';
                                    if (t === 'CASH_OPERATION') return '💰';
                                    if (t === 'PR_BR') return '🧾';
                                    if (t === 'STOCK') return '📦';
                                    return '🔔';
                                  })()}
                                </span>
                                <div style={{ minWidth: 0, flex: 1 }}>
                                  <div style={{ fontSize: 13, fontWeight: n.isRead ? 400 : 600 }}>{n.title}</div>
                                  <div style={{ fontSize: 12, color: '#57606A', marginTop: 2 }}>{n.message}</div>
                                </div>
                              </div>
                              <span style={{ fontSize: 11, color: '#8B949E', whiteSpace: 'nowrap' }}>{formatTimeAgoId(n.createdAt)}</span>
                            </div>
                          </Link>
                        );
                      })
                    )}
                  </div>
                  <div style={{ height: 36, borderTop: '0.5px solid #D0D7DE', display: 'flex', alignItems: 'center', padding: '0 12px' }}>
                    <button type="button" onClick={() => { loadNotificationsApi(); }} style={{ color: 'var(--accent)', fontSize: 12, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                      Muat ulang
                    </button>
                  </div>
                </div>
              ) : null}
            </div>

            <div style={{ width: 1, height: 20, background: '#D0D7DE' }} />

            <div ref={userMenuRef} style={{ position: 'relative' }}>
              <button type="button" onClick={() => setUserMenuOpen((v) => !v)} style={{ border: 'none', background: 'transparent', borderRadius: 8, padding: '4px 8px', display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <ProfileAvatar name={user.name} role={user.role} avatarUrl={user.avatarUrl} size={30} roleColor={roleColor} />
                <div className="hidden md:block" style={{ textAlign: 'left' }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: '#1F2328' }}>{user.name}</div>
                  <div style={{ fontSize: 11, color: '#57606A' }}>{user.role.replace(/_/g, ' ')}</div>
                </div>
                <ChevronDown size={14} color="#57606A" />
              </button>
              {userMenuOpen ? (
                <div style={{ position: 'absolute', right: 0, marginTop: 8, width: 200, background: '#FFF', border: '0.5px solid #D0D7DE', borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.12)', overflow: 'hidden', zIndex: 60 }}>
                  <div style={{ padding: 10, borderBottom: '0.5px solid #D0D7DE' }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: '#1F2328' }}>{user.name}</div>
                    <div style={{ fontSize: 12, color: '#57606A' }}>{user.email}</div>
                  </div>
                  <Link href="/settings/profile" onClick={() => setUserMenuOpen(false)} style={{ height: 36, display: 'flex', alignItems: 'center', gap: 8, padding: '0 10px', textDecoration: 'none', color: '#1F2328', fontSize: 13 }}><UserCircle2 size={14} /> Profil</Link>
                  {user.role === 'GENERAL_MANAGER' ? <Link href="/settings" onClick={() => setUserMenuOpen(false)} style={{ height: 36, display: 'flex', alignItems: 'center', gap: 8, padding: '0 10px', textDecoration: 'none', color: '#1F2328', fontSize: 13 }}><Settings size={14} /> Pengaturan</Link> : null}
                  {user.role === 'GENERAL_MANAGER' ? <Link href="/settings?tab=overview" onClick={() => setUserMenuOpen(false)} style={{ height: 36, display: 'flex', alignItems: 'center', gap: 8, padding: '0 10px', textDecoration: 'none', color: '#1F2328', fontSize: 13 }}><BarChart3 size={14} /> System Overview</Link> : null}
                  <div style={{ borderTop: '0.5px solid #D0D7DE' }} />
                  <button type="button" onClick={handleLogout} style={{ width: '100%', height: 36, border: 'none', background: 'transparent', color: '#F85149', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8, padding: '0 10px', cursor: 'pointer' }}><LogOut size={14} /> Keluar</button>
                </div>
              ) : null}
            </div>
          </div>
        </header>

        <main style={{ flex: 1, overflowY: 'auto', background: 'var(--content-bg)' }}>
          <div style={{ maxWidth: 1400, margin: '0 auto', padding: '24px' }}>
            <ErrorBoundary>{children}</ErrorBoundary>
          </div>
        </main>
      </div>

      {/* FIX: floating banner shown only when backend is unreachable — tells the user exactly what to do */}
      {backendStatus === 'error' && (
        <div
          style={{
            position: 'fixed',
            bottom: 16,
            right: 16,
            zIndex: 9999,
            padding: '12px 18px',
            borderRadius: 10,
            maxWidth: 380,
            background: '#1F2937',
            border: '1px solid #EF4444',
            boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 600, color: '#EF4444', marginBottom: 6 }}>
            ⚠️ Backend tidak terjangkau
          </div>
          <div style={{ fontSize: 12, color: '#9CA3AF', lineHeight: 1.5, wordBreak: 'break-all' }}>
            URL: {API_BASE /* FIX: centralised API base URL */}
          </div>
          <div style={{ fontSize: 12, color: '#9CA3AF', marginTop: 6, lineHeight: 1.5 }}>
            Jalankan: <code style={{ color: '#00D4B4' }}>.\scripts\start-ngrok.ps1</code>
            <br />lalu restart frontend (<code style={{ color: '#00D4B4' }}>npm run dev</code>).
          </div>
          <button
            onClick={() => window.location.reload()}
            style={{
              marginTop: 10,
              padding: '6px 14px',
              borderRadius: 6,
              background: '#374151',
              border: '1px solid #4B5563',
              color: '#D1D5DB',
              cursor: 'pointer',
              fontSize: 12,
              width: '100%',
            }}
          >
            🔄 Coba Lagi
          </button>
        </div>
      )}
    </div>
  );
}
