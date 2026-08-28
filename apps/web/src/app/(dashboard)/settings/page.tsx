'use client';

import React, { Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Plus, Pencil, Power } from 'lucide-react';
import { useAuthStore } from '../../../store/authStore';
import { apiFetch } from '../../../lib/auth';
import { apiGet, apiGetPaginated, apiPost, apiPatch } from '../../../lib/api';
import { toast } from 'sonner';
import type { IspEmailConfig, PaginatedResponse, SafeUser, UserStats } from '../../../types/api.types';

const TABS = [
  { id: 'isp', label: 'ISP Customer' },
  { id: 'users', label: 'Manajemen User' },
  { id: 'features', label: 'Akses Fitur' },
  { id: 'overview', label: 'Ringkasan Sistem' },
  { id: 'isp-email', label: 'Email ISP' }, // NEW: ISP email configuration tab
] as const;

const ROLE_LABELS: Record<string, string> = {
  GENERAL_MANAGER: 'General Manager',
  PM_SENIOR: 'Senior PM', // FIX Fix 2B: normalize label to match other screens
  PM_FTTH: 'PM FTTH',
  PM_FTTB: 'PM FTTB',
  PM_FTTT: 'PM FTTT',
  ADMIN: 'Admin',
  ADMIN_STOCK: 'Admin Stok',
  FINANCE: 'Finance',
  MARKETING: 'Marketing', // NEW: cash operation role label
  MARKETING_HEAD: 'Kepala Marketing', // FIX Fix 2B: human-readable Indonesian label
  OPERATIONAL_MANAGER: 'Operational Manager', // FIX Fix 2B: full label instead of abbreviation
  SURVEYOR_FTTH: 'Surveyor FTTH',
  SURVEYOR_FTTB: 'Surveyor FTTB',
  SURVEYOR_FTTT: 'Surveyor FTTT',
  PURCHASING: 'Purchasing',
  DESIGNER: 'Designer',
  MAP_VIEWER: 'Map Viewer',
};

const ROLE_COLORS: Record<string, string> = {
  GENERAL_MANAGER: '#7C3AED',
  PM_SENIOR: '#1D4ED8',
  PM_FTTH: '#0F766E',
  PM_FTTB: '#0F766E',
  PM_FTTT: '#0F766E',
  ADMIN: '#B45309',
  ADMIN_STOCK: '#C2410C',
  FINANCE: '#166534',
  MARKETING: '#0EA5E9', // NEW: role color
  MARKETING_HEAD: '#0369A1', // NEW: role color
  OPERATIONAL_MANAGER: '#7C3AED', // NEW: role color
  SURVEYOR_FTTH: '#374151',
  SURVEYOR_FTTB: '#374151',
  SURVEYOR_FTTT: '#374151',
  DESIGNER: '#EC4899', // FIX Fix 2B: distinct color for Design Team role badges
  PURCHASING: '#059669',
  MAP_VIEWER: '#2563EB',
};

const FIBER_ROLES = ['PM_FTTH', 'PM_FTTB', 'PM_FTTT', 'SURVEYOR_FTTH', 'SURVEYOR_FTTB', 'SURVEYOR_FTTT'];

function UserAvatar({ name, role, size = 32 }: { name: string; role: string; size?: number }) {
  const initials = name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase();
  const color = ROLE_COLORS[role] || '#374151';
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: `${color}20`,
        border: `1.5px solid ${color}40`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: size * 0.35,
        fontWeight: 600,
        color,
        flexShrink: 0,
      }}
    >
      {initials}
    </div>
  );
}

function RoleBadge({ role }: { role: string }) {
  const color = ROLE_COLORS[role] || '#374151';
  const label = ROLE_LABELS[role] || role;
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '2px 8px',
        borderRadius: 4,
        fontSize: 11,
        fontWeight: 500,
        background: `${color}18`,
        color,
        border: `0.5px solid ${color}40`,
      }}
    >
      {label}
    </span>
  );
}

function PasswordStrength({ password }: { password: string }) {
  const checks = [password.length >= 8, /[A-Z]/.test(password), /[0-9]/.test(password), /[^A-Za-z0-9]/.test(password)];
  const score = checks.filter(Boolean).length;
  const colors = ['#EF4444', '#F59E0B', '#EAB308', '#22C55E'];
  const labels = ['Sangat lemah', 'Lemah', 'Sedang', 'Kuat'];
  if (!password) return null;
  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ display: 'flex', gap: 3, marginBottom: 4 }}>
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            style={{
              flex: 1,
              height: 3,
              borderRadius: 2,
              background: i < score ? colors[score - 1] : '#E5EAF0',
              transition: 'background 200ms',
            }}
          />
        ))}
      </div>
      <span style={{ fontSize: 11, color: score > 0 ? colors[score - 1] : '#94A3B8' }}>
        {password ? labels[score - 1] || 'Sangat lemah' : ''}
      </span>
    </div>
  );
}

function SettingsPageContent() {
  const { user: currentUser } = useAuthStore();
  const searchParams = useSearchParams();
  const tabFromUrl = searchParams.get('tab');

  const [tab, setTab] = useState<string>(() => {
    if (tabFromUrl === 'overview') return 'overview';
    if (tabFromUrl === 'isp-email') return 'isp-email'; // NEW: deep-link support for ISP email tab
    return 'isp';
  });

  useEffect(() => {
    if (tabFromUrl === 'overview') setTab('overview');
    if (tabFromUrl === 'isp-email') setTab('isp-email'); // NEW: keep URL-driven tab in sync
  }, [tabFromUrl]);

  const [isps, setIsps] = useState<any[]>([]);
  const [ispLoading, setIspLoading] = useState(true);
  const [showIspForm, setShowIspForm] = useState(false);
  const [editIspId, setEditIspId] = useState<string | null>(null);
  const [ispForm, setIspForm] = useState({ name: '', code: '', contactEmail: '' });
  const [ispSaving, setIspSaving] = useState(false);
  const [ispConfigs, setIspConfigs] = useState<IspEmailConfig[]>([]); // NEW: ISP email config rows
  const [ispEmailLoading, setIspEmailLoading] = useState(false); // NEW: loading state for ISP email tab
  const [editingIsp, setEditingIsp] = useState<string | null>(null); // NEW: active ISP email editor
  const [ispEmailForm, setIspEmailForm] = useState({
    ispName: '',
    emailTo: '',
    emailCc: '',
    smtpNotes: '',
  }); // NEW: ISP email form state
  const [addingIsp, setAddingIsp] = useState(false); // NEW: add ISP email row state

  const fetchIsps = useCallback(async () => {
    setIspLoading(true);
    try {
      const res = await apiFetch('/isp-customers', {}, currentUser?.id);
      if (res.ok) setIsps(await res.json());
    } finally {
      setIspLoading(false);
    }
  }, [currentUser?.id]);

  const fetchIspConfigs = useCallback(async () => {
    setIspEmailLoading(true);
    try {
      const data = await apiGet<IspEmailConfig[]>('/isp-email-config');
      setIspConfigs(Array.isArray(data) ? data : []);
    } catch {
      toast.error('Gagal memuat konfigurasi email');
    } finally {
      setIspEmailLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === 'isp') fetchIsps();
  }, [tab, fetchIsps]);

  useEffect(() => {
    if (tab === 'isp-email') void fetchIspConfigs(); // NEW: load ISP email configs on tab change
  }, [tab, fetchIspConfigs]);

  const saveIsp = async (e: React.FormEvent) => {
    e.preventDefault();
    setIspSaving(true);
    try {
      const endpoint = editIspId ? `/isp-customers/${editIspId}` : '/isp-customers';
      const method = editIspId ? 'PATCH' : 'POST';
      const body = { ...ispForm, code: ispForm.code.toUpperCase() };
      const res = await apiFetch(endpoint, { method, body: JSON.stringify(body) }, currentUser?.id);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || 'Gagal menyimpan');
      }
      toast.success(editIspId ? 'ISP diperbarui' : 'ISP ditambahkan');
      setShowIspForm(false);
      setEditIspId(null);
      setIspForm({ name: '', code: '', contactEmail: '' });
      fetchIsps();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setIspSaving(false);
    }
  };

  const toggleIsp = async (row: any, active: boolean) => {
    try {
      const res = await apiFetch(`/isp-customers/${row.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: active }),
      }, currentUser?.id);
      if (!res.ok) throw new Error('Gagal');
      toast.success(active ? 'ISP diaktifkan' : 'ISP dinonaktifkan');
      fetchIsps();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const [users, setUsers] = useState<PaginatedResponse<SafeUser> | null>(null);
  const [userStats, setUserStats] = useState<UserStats | null>(null);
  const [usersLoading, setUsersLoading] = useState(false);
  const [userSearch, setUserSearch] = useState('');
  const [debouncedUserSearch, setDebouncedUserSearch] = useState('');
  const [userRoleFilter, setUserRoleFilter] = useState('');
  const [userStatusFilter, setUserStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [userPage, setUserPage] = useState(1);
  const [addPanelOpen, setAddPanelOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<SafeUser | null>(null);
  const [passwordTarget, setPasswordTarget] = useState<SafeUser | null>(null);
  const [toggleTarget, setToggleTarget] = useState<SafeUser | null>(null);
  const [userForm, setUserForm] = useState({
    name: '',
    email: '',
    role: '',
    fiberType: '',
    password: '',
    confirmPassword: '',
    isActive: true,
  });
  const [formLoading, setFormLoading] = useState(false);
  const [formError, setFormError] = useState('');
  const [emailAvailable, setEmailAvailable] = useState<boolean | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [pwLoading, setPwLoading] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedUserSearch(userSearch), 300);
    return () => clearTimeout(t);
  }, [userSearch]);

  useEffect(() => {
    setUserPage(1);
  }, [debouncedUserSearch]);

  const fetchUsers = useCallback(async () => {
    setUsersLoading(true);
    try {
      const params: Record<string, string | number> = {
        page: userPage,
        limit: 20,
      };
      if (debouncedUserSearch) params.search = debouncedUserSearch;
      if (userRoleFilter) params.role = userRoleFilter;
      if (userStatusFilter !== 'all') params.isActive = userStatusFilter === 'active' ? 'true' : 'false';
      const data = await apiGetPaginated<SafeUser>('/users', params);
      setUsers(data);
    } catch {
      toast.error('Gagal memuat data pengguna');
    } finally {
      setUsersLoading(false);
    }
  }, [userPage, debouncedUserSearch, userRoleFilter, userStatusFilter]);

  const fetchUserStats = useCallback(async () => {
    try {
      const data = await apiGet<UserStats>('/users/stats');
      setUserStats(data);
    } catch {
      /* silent */
    }
  }, []);

  useEffect(() => {
    if (tab === 'users') {
      void fetchUsers();
      void fetchUserStats();
    }
  }, [tab, fetchUsers, fetchUserStats]);

  const topRole = userStats?.byRole?.length
    ? [...userStats.byRole].sort((a, b) => b.count - a.count)[0]
    : null;

  const [flags, setFlags] = useState<any[]>([]);
  const [flagDrafts, setFlagDrafts] = useState<Record<string, { roles: string[]; isEnabled: boolean }>>({});
  const [flagsLoading, setFlagsLoading] = useState(false);

  const fetchFlags = useCallback(async () => {
    setFlagsLoading(true);
    try {
      const res = await apiFetch('/feature-flags', {}, currentUser?.id);
      if (res.ok) {
        const data = await res.json();
        setFlags(data);
        const d: Record<string, { roles: string[]; isEnabled: boolean }> = {};
        for (const f of data) {
          const roles = [...f.roles];
          if (!roles.includes('GENERAL_MANAGER')) roles.push('GENERAL_MANAGER');
          d[f.featureKey] = { roles, isEnabled: f.isEnabled };
        }
        setFlagDrafts(d);
      }
    } finally {
      setFlagsLoading(false);
    }
  }, [currentUser?.id]);

  useEffect(() => {
    if (tab === 'features') fetchFlags();
  }, [tab, fetchFlags]);

  const saveFlag = async (featureKey: string) => {
    const draft = flagDrafts[featureKey];
    if (draft && !draft.roles.includes('GENERAL_MANAGER')) {
      draft.roles = [...draft.roles, 'GENERAL_MANAGER'];
    }
    if (!draft) return;
    try {
      const res = await apiFetch(`/feature-flags/${featureKey}`, {
        method: 'PATCH',
        body: JSON.stringify({ roles: draft.roles, isEnabled: draft.isEnabled }),
      }, currentUser?.id);
      if (!res.ok) throw new Error('Gagal menyimpan');
      toast.success('Akses fitur diperbarui');
      fetchFlags();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const toggleRoleInFlag = (featureKey: string, role: string, on: boolean) => {
    if (role === 'GENERAL_MANAGER' && !on) return;
    setFlagDrafts((prev) => {
      const d = { ...prev[featureKey], roles: [...(prev[featureKey]?.roles ?? [])] };
      if (on) {
        if (!d.roles.includes(role)) d.roles.push(role);
      } else {
        d.roles = d.roles.filter((r) => r !== role);
      }
      return { ...prev, [featureKey]: { ...d, isEnabled: prev[featureKey]?.isEnabled ?? true } };
    });
  };

  // FIX Fix 2B: expanded list so full permission matrix is visible in the UI
  const FEATURE_KEYS_SHOW = [
    'CLEAN_LIST', 'VISIT_REQUEST', 'BA_OPEN', 'BA_SURVEY',
    'STOCK_MODULE', 'ORDER_MODULE', 'SURAT_JALAN', 'PURCHASE_REQUEST',
    'GIS_MAP', 'PERMIT_PIPELINE', 'CASH_OPERATION', 'SIP_MODULE',
    'HLD_MODULE', 'LLD_MODULE', 'CONTRACT_MANAGEMENT', 'AUDIT_LOG',
  ];

  const [ov, setOv] = useState<any>({});

  const loadOverview = useCallback(async () => {
    try {
      const [st, cl, sk, pr, audit, vr, ba, ord] = await Promise.all([
        apiFetch('/users/stats', {}, currentUser?.id),
        apiFetch('/clean-list/summary/isp', {}, currentUser?.id),
        apiFetch('/stock/summary', {}, currentUser?.id),
        apiFetch('/purchase-requests/inbox-count', {}, currentUser?.id),
        apiFetch('/audit-log?limit=50', {}, currentUser?.id),
        apiFetch('/visit-requests?page=1&limit=1', {}, currentUser?.id),
        apiFetch('/ba-open?page=1&limit=100', {}, currentUser?.id),
        apiFetch('/orders?page=1&limit=1&status=SUBMITTED,PARTIAL_STOCK,NO_STOCK', {}, currentUser?.id),
      ]);
      const next: any = {};
      if (st.ok) next.userStats = await st.json();
      if (cl.ok) next.ispSummary = await cl.json();
      if (sk.ok) next.stockSummary = await sk.json();
      if (pr.ok) next.prInbox = await pr.json();
      if (audit.ok) next.audit = await audit.json();
      if (vr.ok) {
        const j = await vr.json();
        next.vrTotal = j.meta?.total ?? j.total ?? 0;
      }
      if (ba.ok) {
        const j = await ba.json();
        const now = new Date();
        const m = now.getMonth();
        const y = now.getFullYear();
        const rows = j.data ?? [];
        next.baMonth = rows.filter((r: any) => {
          const d = new Date(r.createdAt);
          return d.getMonth() === m && d.getFullYear() === y;
        }).length;
      }
      if (ord.ok) {
        const j = await ord.json();
        next.orderPending = j.meta?.total ?? j.total ?? 0;
      }
      setOv(next);
    } catch {
      /* ignore */
    }
  }, [currentUser?.id]);

  useEffect(() => {
    if (tab === 'overview') loadOverview();
  }, [tab, loadOverview]);

  const canManageGeneralSettings = currentUser?.role === 'GENERAL_MANAGER'; // NEW: preserve existing GM-only tabs
  const canAccessIspEmail =
    currentUser?.role === 'GENERAL_MANAGER' ||
    currentUser?.role === 'PM_SENIOR' ||
    currentUser?.role === 'PM_FTTH' ||
    currentUser?.role === 'PM_FTTB' ||
    currentUser?.role === 'PM_FTTT' ||
    currentUser?.role === 'ADMIN'; // NEW: ISP email tab role access

  if (!currentUser || (!canManageGeneralSettings && !canAccessIspEmail)) return null;
  useEffect(() => {
    if (!canManageGeneralSettings && canAccessIspEmail && tab !== 'isp-email') {
      setTab('isp-email'); // FIX: non-GM users should land on the only visible tab
    }
  }, [canManageGeneralSettings, canAccessIspEmail, tab]);

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-black text-slate-800">Pengaturan</h1>
        <p className="text-sm text-slate-500 mt-0.5">Kontrol sistem — hanya General Manager</p>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-2">
        {TABS.filter((t) => {
          if (t.id === 'isp-email') return canAccessIspEmail; // NEW: expose Email ISP to PM/Admin/GM
          return canManageGeneralSettings;
        }).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 rounded-xl text-sm font-bold transition-colors ${
              tab === t.id ? 'bg-[#0F1B2D] text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'isp' && (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
            <h2 className="font-black text-slate-700">ISP Customer</h2>
            <button
              type="button"
              onClick={() => {
                setShowIspForm(true);
                setEditIspId(null);
                setIspForm({ name: '', code: '', contactEmail: '' });
              }}
              className="flex items-center gap-2 px-4 py-2 bg-[#00D4B4] text-[#0F1B2D] rounded-xl font-bold text-sm"
            >
              <Plus className="w-4 h-4" />
              Tambah ISP
            </button>
          </div>

          {showIspForm && (
            <form onSubmit={saveIsp} className="px-6 py-4 bg-slate-50 border-b border-slate-100 grid sm:grid-cols-3 gap-3">
              <input
                className="rounded-xl border px-3 py-2 text-sm"
                placeholder="Nama"
                value={ispForm.name}
                onChange={(e) => setIspForm({ ...ispForm, name: e.target.value })}
                required
              />
              <input
                className="rounded-xl border px-3 py-2 text-sm uppercase"
                placeholder="Kode"
                value={ispForm.code}
                onChange={(e) => setIspForm({ ...ispForm, code: e.target.value.toUpperCase() })}
                required
              />
              <input
                className="rounded-xl border px-3 py-2 text-sm"
                placeholder="Email kontak"
                type="email"
                value={ispForm.contactEmail}
                onChange={(e) => setIspForm({ ...ispForm, contactEmail: e.target.value })}
              />
              <div className="sm:col-span-3 flex gap-2">
                <button type="submit" disabled={ispSaving} className="px-4 py-2 rounded-xl bg-[#0F1B2D] text-white text-sm font-bold">
                  {ispSaving ? 'Menyimpan…' : 'Simpan'}
                </button>
                <button type="button" className="px-4 py-2 rounded-xl border text-sm" onClick={() => { setShowIspForm(false); setEditIspId(null); }}>
                  Batal
                </button>
              </div>
            </form>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold">Nama</th>
                  <th className="px-4 py-3 text-left font-semibold">Kode</th>
                  <th className="px-4 py-3 text-left font-semibold">Email</th>
                  <th className="px-4 py-3 text-left font-semibold">Status</th>
                  <th className="px-4 py-3 text-left font-semibold">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {ispLoading ? (
                  <tr><td colSpan={5} className="px-4 py-10 text-center text-slate-500">Memuat…</td></tr>
                ) : isps.length === 0 ? (
                  <tr><td colSpan={5} className="px-4 py-10 text-center text-slate-500">Belum ada data</td></tr>
                ) : (
                  isps.map((row: any) => (
                    <tr key={row.id} className="border-t border-slate-100">
                      <td className="px-4 py-3 font-medium">{row.name}</td>
                      <td className="px-4 py-3 font-mono text-xs">{row.code}</td>
                      <td className="px-4 py-3">{row.contactEmail ?? '—'}</td>
                      <td className="px-4 py-3">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${row.isActive ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-600'}`}>
                          {row.isActive ? 'Aktif' : 'Nonaktif'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            className="p-1.5 rounded-lg hover:bg-slate-100"
                            onClick={() => {
                              setShowIspForm(true);
                              setEditIspId(row.id);
                              setIspForm({ name: row.name, code: row.code, contactEmail: row.contactEmail ?? '' });
                            }}
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            className="p-1.5 rounded-lg hover:bg-slate-100"
                            onClick={() => toggleIsp(row, !row.isActive)}
                          >
                            <Power className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'users' && (
        <div className="space-y-4">
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap: 12,
              marginBottom: 20,
            }}
            className="max-md:grid-cols-2"
          >
            {[
              { label: 'Total Pengguna', value: userStats?.total ?? '—', color: 'var(--color-text-info)', sub: '' },
              { label: 'Aktif', value: userStats?.active ?? '—', color: 'var(--color-text-success)', sub: '' },
              {
                label: 'Nonaktif',
                value: userStats?.inactive ?? '—',
                color: (userStats?.inactive || 0) > 0 ? 'var(--color-text-danger)' : 'var(--color-text-secondary)',
                sub: '',
              },
              {
                label: 'Role Terbanyak',
                value: topRole ? `${ROLE_LABELS[topRole.role] || topRole.role}` : '—',
                sub: topRole ? `${topRole.count} orang` : '',
                color: 'var(--color-text-primary)',
              },
            ].map((card) => (
              <div
                key={card.label}
                style={{
                  background: 'var(--color-background-secondary)',
                  borderRadius: 'var(--border-radius-md)',
                  padding: '12px 16px',
                }}
              >
                <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 4 }}>{card.label}</div>
                <div style={{ fontSize: 22, fontWeight: 500, color: card.color }}>
                  {userStats === null ? '...' : card.value}
                </div>
                {card.sub ? <div style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>{card.sub}</div> : null}
              </div>
            ))}
          </div>

          <div
            style={{
              display: 'flex',
              gap: 10,
              marginBottom: 16,
              alignItems: 'center',
              flexWrap: 'wrap',
            }}
          >
            <input
              value={userSearch}
              onChange={(e) => setUserSearch(e.target.value)}
              placeholder="Cari nama atau email..."
              style={{ flex: 1, minWidth: 200, padding: '8px 12px', borderRadius: 8, border: '1px solid var(--color-border-tertiary)' }}
            />
            <select
              value={userRoleFilter}
              onChange={(e) => {
                setUserRoleFilter(e.target.value);
                setUserPage(1);
              }}
              style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--color-border-tertiary)' }}
            >
              <option value="">Semua Role</option>
              <optgroup label="Surveyor">
                <option value="SURVEYOR_FTTH">Surveyor FTTH</option>
                <option value="SURVEYOR_FTTB">Surveyor FTTB</option>
                <option value="SURVEYOR_FTTT">Surveyor FTTT</option>
              </optgroup>
              <optgroup label="PM">
                <option value="PM_FTTH">PM FTTH</option>
                <option value="PM_FTTB">PM FTTB</option>
                <option value="PM_FTTT">PM FTTT</option>
                <option value="PM_SENIOR">PM Senior</option>
              </optgroup>
              <optgroup label="Design Team">{/* FIX Issue 10: expose DESIGNER in role filter */}
                <option value="DESIGNER">Designer (HLD/LLD)</option>
              </optgroup>
              <optgroup label="Admin">
                <option value="ADMIN">Admin</option>
                <option value="ADMIN_STOCK">Admin Stok</option>
              </optgroup>
              <optgroup label="Marketing">
                <option value="MARKETING">Marketing</option>
                <option value="MARKETING_HEAD">Marketing Head</option>
              </optgroup>
              <option value="FINANCE">Finance</option>
              <option value="GENERAL_MANAGER">General Manager</option>
              <option value="OPERATIONAL_MANAGER">Operational Manager</option>
            </select>
            {(['all', 'active', 'inactive'] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => {
                  setUserStatusFilter(s);
                  setUserPage(1);
                }}
                style={{
                  padding: '6px 14px',
                  borderRadius: 20,
                  fontSize: 13,
                  fontWeight: 500,
                  background: userStatusFilter === s ? 'var(--color-background-info)' : 'var(--color-background-secondary)',
                  color: userStatusFilter === s ? 'var(--color-text-info)' : 'var(--color-text-secondary)',
                  border: '0.5px solid var(--color-border-tertiary)',
                  cursor: 'pointer',
                }}
              >
                {{ all: 'Semua', active: 'Aktif', inactive: 'Nonaktif' }[s]}
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                setUserForm({
                  name: '',
                  email: '',
                  role: '',
                  fiberType: '',
                  password: '',
                  confirmPassword: '',
                  isActive: true,
                });
                setFormError('');
                setEmailAvailable(null);
                setAddPanelOpen(true);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '8px 16px',
                borderRadius: 'var(--border-radius-md)',
                background: 'var(--color-background-info)',
                color: 'var(--color-text-info)',
                border: 'none',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: 500,
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <line x1="19" y1="8" x2="19" y2="14" />
                <line x1="22" y1="11" x2="16" y2="11" />
              </svg>
              Tambah User
            </button>
          </div>

          <div
            style={{
              background: 'var(--color-background-primary)',
              border: '0.5px solid var(--color-border-tertiary)',
              borderRadius: 'var(--border-radius-lg)',
              overflow: 'hidden',
            }}
          >
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead>
                <tr
                  style={{
                    background: 'var(--color-background-secondary)',
                    borderBottom: '0.5px solid var(--color-border-tertiary)',
                  }}
                >
                  {['Pengguna', 'Role', 'Fiber Type', 'Status', 'Bergabung', 'Aksi'].map((h) => (
                    <th
                      key={h}
                      style={{
                        padding: '10px 16px',
                        textAlign: 'left',
                        fontSize: 11,
                        fontWeight: 500,
                        color: 'var(--color-text-secondary)',
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {usersLoading
                  ? Array(5)
                      .fill(null)
                      .map((_, i) => (
                        <tr key={i} style={{ borderBottom: '0.5px solid var(--color-border-tertiary)' }}>
                          {Array(6)
                            .fill(null)
                            .map((_, j) => (
                              <td key={j} style={{ padding: '12px 16px' }}>
                                <div
                                  style={{
                                    height: 16,
                                    borderRadius: 4,
                                    background: 'var(--color-background-secondary)',
                                    width: j === 0 ? 160 : j === 5 ? 80 : 100,
                                  }}
                                />
                              </td>
                            ))}
                        </tr>
                      ))
                  : !users?.data.length
                    ? (
                        <tr>
                          <td
                            colSpan={6}
                            style={{
                              padding: '40px 16px',
                              textAlign: 'center',
                              color: 'var(--color-text-secondary)',
                            }}
                          >
                            {userSearch || userRoleFilter || userStatusFilter !== 'all'
                              ? 'Tidak ada hasil yang cocok'
                              : 'Belum ada pengguna'}
                          </td>
                        </tr>
                      )
                    : users.data.map((u) => {
                        const isSelf = u.id === currentUser?.id;
                        const isGmAccount = u.role === 'GENERAL_MANAGER';
                        const gmReadOnly = isGmAccount;
                        return (
                          <tr
                            key={u.id}
                            style={{
                              borderBottom: '0.5px solid var(--color-border-tertiary)',
                              opacity: u.isActive ? 1 : 0.6,
                              transition: 'background 100ms',
                              background: isGmAccount ? 'rgba(124, 58, 237, 0.06)' : 'transparent',
                            }}
                            onMouseOver={(e) => {
                              e.currentTarget.style.background = 'var(--color-background-secondary)';
                            }}
                            onMouseOut={(e) => {
                              e.currentTarget.style.background = 'transparent';
                            }}
                          >
                            <td style={{ padding: '12px 16px' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                <UserAvatar name={u.name} role={u.role} />
                                <div>
                                  <div
                                    style={{
                                      fontWeight: 500,
                                      color: 'var(--color-text-primary)',
                                      textDecoration: u.isActive ? 'none' : 'line-through',
                                    }}
                                  >
                                    {u.name}
                                  </div>
                                  <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>{u.email}</div>
                                </div>
                              </div>
                            </td>
                            <td style={{ padding: '12px 16px' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                <RoleBadge role={u.role} />
                                {isGmAccount ? (
                                  <span
                                    style={{
                                      padding: '2px 6px',
                                      borderRadius: 4,
                                      fontSize: 10,
                                      fontWeight: 700,
                                      background: '#7C3AED22',
                                      color: '#7C3AED',
                                      border: '0.5px solid #7C3AED55',
                                    }}
                                  >
                                    GM
                                  </span>
                                ) : null}
                              </div>
                            </td>
                            <td style={{ padding: '12px 16px' }}>
                              {u.fiberType ? (
                                <span
                                  style={{
                                    padding: '2px 8px',
                                    borderRadius: 4,
                                    fontSize: 11,
                                    fontWeight: 500,
                                    background: '#0F766E18',
                                    color: '#0F766E',
                                    border: '0.5px solid #0F766E40',
                                  }}
                                >
                                  {u.fiberType}
                                </span>
                              ) : (
                                <span style={{ color: 'var(--color-text-secondary)' }}>—</span>
                              )}
                            </td>
                            <td style={{ padding: '12px 16px' }}>
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 13 }}>
                                <span
                                  style={{
                                    width: 7,
                                    height: 7,
                                    borderRadius: '50%',
                                    background: u.isActive ? '#22C55E' : '#EF4444',
                                  }}
                                />
                                <span
                                  style={{
                                    color: u.isActive ? 'var(--color-text-success)' : 'var(--color-text-danger)',
                                  }}
                                >
                                  {u.isActive ? 'Aktif' : 'Nonaktif'}
                                </span>
                              </span>
                            </td>
                            <td style={{ padding: '12px 16px', color: 'var(--color-text-secondary)', fontSize: 13 }}>
                              {new Date(u.createdAt).toLocaleDateString('id-ID', {
                                day: 'numeric',
                                month: 'short',
                                year: 'numeric',
                              })}
                            </td>
                            <td style={{ padding: '12px 16px' }}>
                              <div style={{ display: 'flex', gap: 4 }}>
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (gmReadOnly) return;
                                    setFormError('');
                                    setEditTarget(u);
                                    setUserForm({
                                      name: u.name,
                                      email: u.email,
                                      role: u.role,
                                      fiberType: u.fiberType || '',
                                      password: '',
                                      confirmPassword: '',
                                      isActive: u.isActive,
                                    });
                                  }}
                                  disabled={gmReadOnly}
                                  title={gmReadOnly ? 'Akun GM tidak dapat diubah' : 'Edit pengguna'}
                                  style={{
                                    width: 32,
                                    height: 32,
                                    borderRadius: 6,
                                    background: 'none',
                                    border: '0.5px solid var(--color-border-tertiary)',
                                    cursor: gmReadOnly ? 'not-allowed' : 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    color: 'var(--color-text-secondary)',
                                    opacity: gmReadOnly ? 0.4 : 1,
                                  }}
                                >
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                                  </svg>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (gmReadOnly) return;
                                    setPasswordTarget(u);
                                    setNewPassword('');
                                    setConfirmNewPassword('');
                                  }}
                                  disabled={gmReadOnly}
                                  title={gmReadOnly ? 'Akun GM tidak dapat diubah' : 'Ganti password'}
                                  style={{
                                    width: 32,
                                    height: 32,
                                    borderRadius: 6,
                                    background: 'none',
                                    border: '0.5px solid var(--color-border-tertiary)',
                                    cursor: gmReadOnly ? 'not-allowed' : 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    color: 'var(--color-text-secondary)',
                                    opacity: gmReadOnly ? 0.4 : 1,
                                  }}
                                >
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                                  </svg>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => !isSelf && !gmReadOnly && setToggleTarget(u)}
                                  title={
                                    gmReadOnly
                                      ? 'Akun GM tidak dapat dihapus'
                                      : isSelf
                                        ? 'Tidak bisa menonaktifkan akun sendiri'
                                        : u.isActive
                                          ? 'Nonaktifkan'
                                          : 'Aktifkan kembali'
                                  }
                                  disabled={isSelf || gmReadOnly}
                                  style={{
                                    width: 32,
                                    height: 32,
                                    borderRadius: 6,
                                    background: 'none',
                                    border: '0.5px solid var(--color-border-tertiary)',
                                    cursor: isSelf || gmReadOnly ? 'not-allowed' : 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    color: isSelf || gmReadOnly
                                      ? 'var(--color-border-secondary)'
                                      : u.isActive
                                        ? 'var(--color-text-danger)'
                                        : 'var(--color-text-success)',
                                    opacity: isSelf || gmReadOnly ? 0.4 : 1,
                                  }}
                                >
                                  {u.isActive ? (
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                                      <circle cx="9" cy="7" r="4" />
                                      <line x1="17" y1="8" x2="23" y2="14" />
                                      <line x1="23" y1="8" x2="17" y2="14" />
                                    </svg>
                                  ) : (
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                                      <circle cx="9" cy="7" r="4" />
                                      <polyline points="16 11 18 13 22 9" />
                                    </svg>
                                  )}
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
              </tbody>
            </table>
          </div>

          {users && users.meta.totalPages > 1 ? (
            <div
              style={{
                marginTop: 12,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                fontSize: 13,
                color: 'var(--color-text-secondary)',
              }}
            >
              <span>
                Menampilkan {(userPage - 1) * 20 + 1}–{Math.min(userPage * 20, users.meta.total)} dari {users.meta.total}
              </span>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  type="button"
                  disabled={userPage <= 1}
                  onClick={() => setUserPage((p) => p - 1)}
                  style={{
                    padding: '4px 12px',
                    borderRadius: 6,
                    border: '0.5px solid var(--color-border-tertiary)',
                    background: 'none',
                    cursor: userPage <= 1 ? 'not-allowed' : 'pointer',
                    opacity: userPage <= 1 ? 0.4 : 1,
                  }}
                >
                  ←
                </button>
                <span style={{ padding: '4px 12px' }}>
                  {userPage} / {users.meta.totalPages}
                </span>
                <button
                  type="button"
                  disabled={userPage >= users.meta.totalPages}
                  onClick={() => setUserPage((p) => p + 1)}
                  style={{
                    padding: '4px 12px',
                    borderRadius: 6,
                    border: '0.5px solid var(--color-border-tertiary)',
                    background: 'none',
                    cursor: userPage >= users.meta.totalPages ? 'not-allowed' : 'pointer',
                    opacity: userPage >= users.meta.totalPages ? 0.4 : 1,
                  }}
                >
                  →
                </button>
              </div>
            </div>
          ) : null}

          {addPanelOpen ? (
            <>
              <div
                style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 40 }}
                onClick={() => setAddPanelOpen(false)}
                role="presentation"
              />
              <div
                style={{
                  position: 'fixed',
                  top: 0,
                  right: 0,
                  bottom: 0,
                  width: 420,
                  background: '#FFFFFF',
                  borderLeft: '0.5px solid var(--color-border-tertiary)',
                  zIndex: 50,
                  display: 'flex',
                  flexDirection: 'column',
                  boxShadow: '-4px 0 24px rgba(0,0,0,0.12)',
                }}
              >
                <div
                  style={{
                    padding: '16px 20px',
                    borderBottom: '0.5px solid var(--color-border-tertiary)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    background: '#FFFFFF',
                  }}
                >
                  <h3 style={{ fontSize: 16, fontWeight: 500, margin: 0, color: 'var(--color-text-primary)' }}>
                    Tambah Pengguna Baru
                  </h3>
                  <button
                    type="button"
                    onClick={() => setAddPanelOpen(false)}
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 6,
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      color: 'var(--color-text-secondary)',
                      fontSize: 18,
                    }}
                  >
                    ✕
                  </button>
                </div>
                <div style={{ flex: 1, overflow: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
                  {formError ? (
                    <div
                      style={{
                        padding: '10px 14px',
                        borderRadius: 8,
                        background: 'var(--color-background-danger)',
                        color: 'var(--color-text-danger)',
                        fontSize: 13,
                      }}
                    >
                      {formError}
                    </div>
                  ) : null}
                  <div>
                    <label
                      style={{
                        display: 'block',
                        fontSize: 12,
                        fontWeight: 500,
                        color: 'var(--color-text-secondary)',
                        marginBottom: 6,
                      }}
                    >
                      NAMA LENGKAP *
                    </label>
                    <input
                      value={userForm.name}
                      onChange={(e) => setUserForm((f) => ({ ...f, name: e.target.value }))}
                      placeholder="Nama lengkap pengguna"
                      style={{ width: '100%', boxSizing: 'border-box', padding: 8, borderRadius: 8, border: '1px solid var(--color-border-tertiary)' }}
                    />
                  </div>
                  <div>
                    <label
                      style={{
                        display: 'block',
                        fontSize: 12,
                        fontWeight: 500,
                        color: 'var(--color-text-secondary)',
                        marginBottom: 6,
                      }}
                    >
                      EMAIL *
                    </label>
                    <input
                      type="email"
                      value={userForm.email}
                      onChange={(e) => {
                        setUserForm((f) => ({ ...f, email: e.target.value }));
                        setEmailAvailable(null);
                      }}
                      onBlur={async () => {
                        if (!userForm.email) return;
                        try {
                          const res = await apiGetPaginated<SafeUser>('/users', { search: userForm.email, limit: 5, page: 1 });
                          const exact = res.data.find(
                            (x) => x.email.toLowerCase() === userForm.email.toLowerCase(),
                          );
                          setEmailAvailable(!exact);
                        } catch {
                          setEmailAvailable(null);
                        }
                      }}
                      placeholder="email@permatrax.com"
                      style={{ width: '100%', boxSizing: 'border-box', padding: 8, borderRadius: 8, border: '1px solid var(--color-border-tertiary)' }}
                    />
                    {emailAvailable === true ? (
                      <div style={{ fontSize: 11, color: '#22C55E', marginTop: 4 }}>✓ Email tersedia</div>
                    ) : null}
                    {emailAvailable === false ? (
                      <div style={{ fontSize: 11, color: '#EF4444', marginTop: 4 }}>✗ Email sudah digunakan</div>
                    ) : null}
                  </div>
                  <div>
                    <label
                      style={{
                        display: 'block',
                        fontSize: 12,
                        fontWeight: 500,
                        color: 'var(--color-text-secondary)',
                        marginBottom: 6,
                      }}
                    >
                      ROLE *
                    </label>
                    <select
                      value={userForm.role}
                      onChange={(e) => setUserForm((f) => ({ ...f, role: e.target.value, fiberType: '' }))}
                      style={{ width: '100%', boxSizing: 'border-box', padding: 8, borderRadius: 8, border: '1px solid var(--color-border-tertiary)' }}
                    >
                      <option value="">Pilih role...</option>
                      <optgroup label="Surveyor">
                        <option value="SURVEYOR_FTTH">Surveyor FTTH</option>
                        <option value="SURVEYOR_FTTB">Surveyor FTTB</option>
                        <option value="SURVEYOR_FTTT">Surveyor FTTT</option>
                      </optgroup>
                      <optgroup label="PM">
                        <option value="PM_FTTH">PM FTTH</option>
                        <option value="PM_FTTB">PM FTTB</option>
                        <option value="PM_FTTT">PM FTTT</option>
                        <option value="PM_SENIOR">PM Senior</option>
                      </optgroup>
                      <optgroup label="Design Team">{/* FIX Issue 10: expose DESIGNER role option */}
                        <option value="DESIGNER">Designer (HLD/LLD)</option>
                      </optgroup>
                      <optgroup label="Admin">
                        <option value="ADMIN">Admin</option>
                        <option value="ADMIN_STOCK">Admin Stok</option>
                      </optgroup>
                      <optgroup label="Marketing">
                        <option value="MARKETING">Marketing</option>
                        <option value="MARKETING_HEAD">Marketing Head</option>
                      </optgroup>
                      <option value="FINANCE">Finance</option>
                      <option value="GENERAL_MANAGER">General Manager</option>
                      <option value="OPERATIONAL_MANAGER">Operational Manager</option>
                    </select>
                  </div>
                  {FIBER_ROLES.includes(userForm.role) ? (
                    <div>
                      <label
                        style={{
                          display: 'block',
                          fontSize: 12,
                          fontWeight: 500,
                          color: 'var(--color-text-secondary)',
                          marginBottom: 6,
                        }}
                      >
                        FIBER TYPE *
                      </label>
                      <div style={{ display: 'flex', gap: 8 }}>
                        {(['FTTH', 'FTTB', 'FTTT'] as const).map((ft) => (
                          <button
                            key={ft}
                            type="button"
                            onClick={() => setUserForm((f) => ({ ...f, fiberType: ft }))}
                            style={{
                              flex: 1,
                              padding: '8px 0',
                              borderRadius: 8,
                              fontSize: 13,
                              fontWeight: 500,
                              border: `1.5px solid ${userForm.fiberType === ft ? '#0F766E' : 'var(--color-border-tertiary)'}`,
                              background: userForm.fiberType === ft ? '#0F766E18' : 'none',
                              color: userForm.fiberType === ft ? '#0F766E' : 'var(--color-text-secondary)',
                              cursor: 'pointer',
                            }}
                          >
                            {ft}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  <div>
                    <label
                      style={{
                        display: 'block',
                        fontSize: 12,
                        fontWeight: 500,
                        color: 'var(--color-text-secondary)',
                        marginBottom: 6,
                      }}
                    >
                      PASSWORD *
                    </label>
                    <input
                      type="password"
                      value={userForm.password}
                      onChange={(e) => setUserForm((f) => ({ ...f, password: e.target.value }))}
                      placeholder="Min. 8 karakter"
                      style={{ width: '100%', boxSizing: 'border-box', padding: 8, borderRadius: 8, border: '1px solid var(--color-border-tertiary)' }}
                    />
                    <PasswordStrength password={userForm.password} />
                  </div>
                  <div>
                    <label
                      style={{
                        display: 'block',
                        fontSize: 12,
                        fontWeight: 500,
                        color: 'var(--color-text-secondary)',
                        marginBottom: 6,
                      }}
                    >
                      KONFIRMASI PASSWORD *
                    </label>
                    <input
                      type="password"
                      value={userForm.confirmPassword}
                      onChange={(e) => setUserForm((f) => ({ ...f, confirmPassword: e.target.value }))}
                      placeholder="Ulangi password"
                      style={{
                        width: '100%',
                        boxSizing: 'border-box',
                        padding: 8,
                        borderRadius: 8,
                        border:
                          userForm.confirmPassword && userForm.confirmPassword !== userForm.password
                            ? '1px solid #EF4444'
                            : '1px solid var(--color-border-tertiary)',
                      }}
                    />
                    {userForm.confirmPassword && userForm.confirmPassword !== userForm.password ? (
                      <div style={{ fontSize: 11, color: '#EF4444', marginTop: 4 }}>Password tidak cocok</div>
                    ) : null}
                  </div>
                </div>
                <div
                  style={{
                    padding: '16px 20px',
                    borderTop: '0.5px solid var(--color-border-tertiary)',
                    display: 'flex',
                    gap: 10,
                    justifyContent: 'flex-end',
                  }}
                >
                  <button
                    type="button"
                    onClick={() => setAddPanelOpen(false)}
                    style={{
                      padding: '8px 20px',
                      borderRadius: 8,
                      border: '0.5px solid var(--color-border-tertiary)',
                      background: 'none',
                      cursor: 'pointer',
                      fontSize: 14,
                      color: 'var(--color-text-secondary)',
                    }}
                  >
                    Batal
                  </button>
                  <button
                    type="button"
                    disabled={formLoading}
                    onClick={async () => {
                      setFormError('');
                      if (!userForm.name || !userForm.email || !userForm.role || !userForm.password) {
                        setFormError('Semua field wajib diisi');
                        return;
                      }
                      if (FIBER_ROLES.includes(userForm.role) && !userForm.fiberType) {
                        setFormError('Pilih Fiber Type untuk role ini');
                        return;
                      }
                      if (userForm.password !== userForm.confirmPassword) {
                        setFormError('Password tidak cocok');
                        return;
                      }
                      if (userForm.password.length < 8) {
                        setFormError('Password minimal 8 karakter');
                        return;
                      }
                      setFormLoading(true);
                      try {
                        await apiPost('/users', {
                          name: userForm.name,
                          email: userForm.email,
                          role: userForm.role,
                          fiberType: userForm.fiberType || null,
                          password: userForm.password,
                        });
                        setAddPanelOpen(false);
                        toast.success('Pengguna berhasil dibuat');
                        await fetchUsers();
                        await fetchUserStats();
                      } catch (err: any) {
                        setFormError(err?.message || 'Gagal membuat pengguna');
                      } finally {
                        setFormLoading(false);
                      }
                    }}
                    style={{
                      padding: '8px 24px',
                      borderRadius: 8,
                      background: 'var(--color-background-info)',
                      color: 'var(--color-text-info)',
                      border: 'none',
                      cursor: formLoading ? 'wait' : 'pointer',
                      fontSize: 14,
                      fontWeight: 500,
                      opacity: formLoading ? 0.7 : 1,
                    }}
                  >
                    {formLoading ? 'Menyimpan...' : 'Buat Pengguna'}
                  </button>
                </div>
              </div>
            </>
          ) : null}

          {editTarget ? (
            <>
              <div
                style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 40 }}
                onClick={() => setEditTarget(null)}
                role="presentation"
              />
              <div
                style={{
                  position: 'fixed',
                  top: 0,
                  right: 0,
                  bottom: 0,
                  width: 420,
                  background: '#FFFFFF',
                  borderLeft: '0.5px solid var(--color-border-tertiary)',
                  zIndex: 50,
                  display: 'flex',
                  flexDirection: 'column',
                  boxShadow: '-4px 0 24px rgba(0,0,0,0.12)',
                }}
              >
                <div
                  style={{
                    padding: '16px 20px',
                    borderBottom: '0.5px solid var(--color-border-tertiary)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    background: '#FFFFFF',
                  }}
                >
                  <h3 style={{ fontSize: 16, fontWeight: 500, margin: 0, color: 'var(--color-text-primary)' }}>
                    Edit Pengguna — {editTarget.name}
                  </h3>
                  <button
                    type="button"
                    onClick={() => setEditTarget(null)}
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 6,
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      color: 'var(--color-text-secondary)',
                      fontSize: 18,
                    }}
                  >
                    ✕
                  </button>
                </div>
                <div style={{ flex: 1, overflow: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
                  {formError ? (
                    <div
                      style={{
                        padding: '10px 14px',
                        borderRadius: 8,
                        background: 'var(--color-background-danger)',
                        color: 'var(--color-text-danger)',
                        fontSize: 13,
                      }}
                    >
                      {formError}
                    </div>
                  ) : null}
                  <p style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
                    Email: <strong>{editTarget.email}</strong> (tidak dapat diubah)
                  </p>
                  <div>
                    <label
                      style={{
                        display: 'block',
                        fontSize: 12,
                        fontWeight: 500,
                        color: 'var(--color-text-secondary)',
                        marginBottom: 6,
                      }}
                    >
                      NAMA *
                    </label>
                    <input
                      value={userForm.name}
                      onChange={(e) => setUserForm((f) => ({ ...f, name: e.target.value }))}
                      style={{ width: '100%', boxSizing: 'border-box', padding: 8, borderRadius: 8, border: '1px solid var(--color-border-tertiary)' }}
                    />
                  </div>
                  <div>
                    <label
                      style={{
                        display: 'block',
                        fontSize: 12,
                        fontWeight: 500,
                        color: 'var(--color-text-secondary)',
                        marginBottom: 6,
                      }}
                    >
                      ROLE *
                    </label>
                    <select
                      value={userForm.role}
                      onChange={(e) => setUserForm((f) => ({ ...f, role: e.target.value, fiberType: '' }))}
                      style={{ width: '100%', boxSizing: 'border-box', padding: 8, borderRadius: 8, border: '1px solid var(--color-border-tertiary)' }}
                    >
                      <option value="">Pilih role...</option>
                      <optgroup label="Surveyor">
                        <option value="SURVEYOR_FTTH">Surveyor FTTH</option>
                        <option value="SURVEYOR_FTTB">Surveyor FTTB</option>
                        <option value="SURVEYOR_FTTT">Surveyor FTTT</option>
                      </optgroup>
                      <optgroup label="PM">
                        <option value="PM_FTTH">PM FTTH</option>
                        <option value="PM_FTTB">PM FTTB</option>
                        <option value="PM_FTTT">PM FTTT</option>
                        <option value="PM_SENIOR">PM Senior</option>
                      </optgroup>
                      <optgroup label="Design Team">{/* FIX Issue 10: expose DESIGNER role option */}
                        <option value="DESIGNER">Designer (HLD/LLD)</option>
                      </optgroup>
                      <optgroup label="Admin">
                        <option value="ADMIN">Admin</option>
                        <option value="ADMIN_STOCK">Admin Stok</option>
                      </optgroup>
                      <optgroup label="Marketing">
                        <option value="MARKETING">Marketing</option>
                        <option value="MARKETING_HEAD">Marketing Head</option>
                      </optgroup>
                      <option value="FINANCE">Finance</option>
                      <option value="GENERAL_MANAGER">General Manager</option>
                      <option value="OPERATIONAL_MANAGER">Operational Manager</option>
                    </select>
                  </div>
                  {FIBER_ROLES.includes(userForm.role) ? (
                    <div>
                      <label
                        style={{
                          display: 'block',
                          fontSize: 12,
                          fontWeight: 500,
                          color: 'var(--color-text-secondary)',
                          marginBottom: 6,
                        }}
                      >
                        FIBER TYPE *
                      </label>
                      <div style={{ display: 'flex', gap: 8 }}>
                        {(['FTTH', 'FTTB', 'FTTT'] as const).map((ft) => (
                          <button
                            key={ft}
                            type="button"
                            onClick={() => setUserForm((f) => ({ ...f, fiberType: ft }))}
                            style={{
                              flex: 1,
                              padding: '8px 0',
                              borderRadius: 8,
                              fontSize: 13,
                              fontWeight: 500,
                              border: `1.5px solid ${userForm.fiberType === ft ? '#0F766E' : 'var(--color-border-tertiary)'}`,
                              background: userForm.fiberType === ft ? '#0F766E18' : 'none',
                              color: userForm.fiberType === ft ? '#0F766E' : 'var(--color-text-secondary)',
                              cursor: 'pointer',
                            }}
                          >
                            {ft}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={!userForm.isActive}
                      onChange={(e) => setUserForm((f) => ({ ...f, isActive: !e.target.checked }))}
                    />
                    Nonaktifkan akun ini
                  </label>
                </div>
                <div
                  style={{
                    padding: '16px 20px',
                    borderTop: '0.5px solid var(--color-border-tertiary)',
                    display: 'flex',
                    gap: 10,
                    justifyContent: 'flex-end',
                  }}
                >
                  <button
                    type="button"
                    onClick={() => setEditTarget(null)}
                    style={{
                      padding: '8px 20px',
                      borderRadius: 8,
                      border: '0.5px solid var(--color-border-tertiary)',
                      background: 'none',
                      cursor: 'pointer',
                      fontSize: 14,
                      color: 'var(--color-text-secondary)',
                    }}
                  >
                    Batal
                  </button>
                  <button
                    type="button"
                    disabled={formLoading}
                    onClick={async () => {
                      setFormError('');
                      if (!userForm.name || !userForm.role) {
                        setFormError('Nama dan role wajib diisi');
                        return;
                      }
                      if (FIBER_ROLES.includes(userForm.role) && !userForm.fiberType) {
                        setFormError('Pilih Fiber Type untuk role ini');
                        return;
                      }
                      setFormLoading(true);
                      try {
                        await apiPatch(`/users/${editTarget.id}`, {
                          name: userForm.name,
                          role: userForm.role,
                          fiberType: FIBER_ROLES.includes(userForm.role) ? userForm.fiberType || null : null,
                          isActive: userForm.isActive,
                        });
                        setEditTarget(null);
                        toast.success('Perubahan disimpan');
                        await fetchUsers();
                        await fetchUserStats();
                      } catch (err: any) {
                        setFormError(err?.message || 'Gagal menyimpan');
                      } finally {
                        setFormLoading(false);
                      }
                    }}
                    style={{
                      padding: '8px 24px',
                      borderRadius: 8,
                      background: 'var(--color-background-info)',
                      color: 'var(--color-text-info)',
                      border: 'none',
                      cursor: formLoading ? 'wait' : 'pointer',
                      fontSize: 14,
                      fontWeight: 500,
                    }}
                  >
                    {formLoading ? 'Menyimpan...' : 'Simpan'}
                  </button>
                </div>
              </div>
            </>
          ) : null}

          {passwordTarget ? (
            <>
              <div
                style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 40 }}
                onClick={() => setPasswordTarget(null)}
                role="presentation"
              />
              <div
                style={{
                  position: 'fixed',
                  top: '50%',
                  left: '50%',
                  transform: 'translate(-50%, -50%)',
                  width: 400,
                  background: '#FFFFFF',
                  borderRadius: 16,
                  border: '0.5px solid var(--color-border-tertiary)',
                  zIndex: 50,
                  overflow: 'hidden',
                  boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
                }}
              >
                <div
                  style={{
                    padding: '16px 20px',
                    borderBottom: '0.5px solid var(--color-border-tertiary)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    background: '#FFFFFF',
                  }}
                >
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--color-text-primary)' }}>Ganti Password</div>
                    <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>{passwordTarget.name}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setPasswordTarget(null)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--color-text-secondary)' }}
                  >
                    ✕
                  </button>
                </div>
                <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div>
                    <label
                      style={{
                        display: 'block',
                        fontSize: 12,
                        fontWeight: 500,
                        color: 'var(--color-text-secondary)',
                        marginBottom: 6,
                      }}
                    >
                      PASSWORD BARU *
                    </label>
                    <input
                      type="password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="Min. 8 karakter"
                      style={{ width: '100%', boxSizing: 'border-box', padding: 8, borderRadius: 8, border: '1px solid var(--color-border-tertiary)' }}
                    />
                    <PasswordStrength password={newPassword} />
                  </div>
                  <div>
                    <label
                      style={{
                        display: 'block',
                        fontSize: 12,
                        fontWeight: 500,
                        color: 'var(--color-text-secondary)',
                        marginBottom: 6,
                      }}
                    >
                      KONFIRMASI *
                    </label>
                    <input
                      type="password"
                      value={confirmNewPassword}
                      onChange={(e) => setConfirmNewPassword(e.target.value)}
                      placeholder="Ulangi password baru"
                      style={{ width: '100%', boxSizing: 'border-box', padding: 8, borderRadius: 8, border: '1px solid var(--color-border-tertiary)' }}
                    />
                    {confirmNewPassword && confirmNewPassword !== newPassword ? (
                      <div style={{ fontSize: 11, color: '#EF4444', marginTop: 4 }}>Password tidak cocok</div>
                    ) : null}
                  </div>
                </div>
                <div
                  style={{
                    padding: '14px 20px',
                    borderTop: '0.5px solid var(--color-border-tertiary)',
                    display: 'flex',
                    gap: 8,
                    justifyContent: 'flex-end',
                  }}
                >
                  <button
                    type="button"
                    onClick={() => setPasswordTarget(null)}
                    style={{
                      padding: '8px 16px',
                      borderRadius: 8,
                      border: '0.5px solid var(--color-border-tertiary)',
                      background: 'none',
                      cursor: 'pointer',
                      fontSize: 13,
                    }}
                  >
                    Batal
                  </button>
                  <button
                    type="button"
                    disabled={
                      pwLoading ||
                      !newPassword ||
                      newPassword !== confirmNewPassword ||
                      newPassword.length < 8 ||
                      !/[A-Z]/.test(newPassword) ||
                      !/[0-9]/.test(newPassword)
                    }
                    onClick={async () => {
                      setPwLoading(true);
                      try {
                        await apiPost(`/users/${passwordTarget.id}/change-password`, { newPassword });
                        setPasswordTarget(null);
                        toast.success('Password berhasil diubah');
                        await fetchUsers();
                      } catch {
                        toast.error('Gagal mengubah password');
                      } finally {
                        setPwLoading(false);
                      }
                    }}
                    style={{
                      padding: '8px 20px',
                      borderRadius: 8,
                      background: 'var(--color-background-info)',
                      color: 'var(--color-text-info)',
                      border: 'none',
                      cursor: 'pointer',
                      fontSize: 13,
                      fontWeight: 500,
                      opacity:
                        pwLoading || !newPassword || newPassword !== confirmNewPassword || newPassword.length < 8 || !/[A-Z]/.test(newPassword) || !/[0-9]/.test(newPassword)
                          ? 0.5
                          : 1,
                    }}
                  >
                    {pwLoading ? 'Menyimpan...' : 'Simpan Password'}
                  </button>
                </div>
              </div>
            </>
          ) : null}

          {toggleTarget ? (
            <>
              <div
                style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 40 }}
                onClick={() => setToggleTarget(null)}
                role="presentation"
              />
              <div
                style={{
                  position: 'fixed',
                  top: '50%',
                  left: '50%',
                  transform: 'translate(-50%, -50%)',
                  width: 380,
                  background: 'var(--color-background-primary)',
                  borderRadius: 16,
                  border: '0.5px solid var(--color-border-tertiary)',
                  zIndex: 50,
                  padding: 24,
                }}
              >
                <h3 style={{ fontSize: 16, fontWeight: 500, color: 'var(--color-text-primary)', marginBottom: 8 }}>
                  {toggleTarget.isActive ? `Nonaktifkan ${toggleTarget.name}?` : `Aktifkan kembali ${toggleTarget.name}?`}
                </h3>
                <p style={{ fontSize: 14, color: 'var(--color-text-secondary)', marginBottom: 20 }}>
                  {toggleTarget.isActive
                    ? 'Pengguna tidak akan bisa login setelah dinonaktifkan. Semua sesi aktif akan diakhiri.'
                    : 'Pengguna akan bisa login kembali setelah diaktifkan.'}
                </p>
                <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                  <button
                    type="button"
                    onClick={() => setToggleTarget(null)}
                    style={{
                      padding: '8px 16px',
                      borderRadius: 8,
                      border: '0.5px solid var(--color-border-tertiary)',
                      background: 'none',
                      cursor: 'pointer',
                      fontSize: 14,
                    }}
                  >
                    Batal
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        const endpoint = toggleTarget.isActive ? 'deactivate' : 'reactivate';
                        await apiPost(`/users/${toggleTarget.id}/${endpoint}`, {});
                        const wasActive = toggleTarget.isActive;
                        setToggleTarget(null);
                        toast.success(wasActive ? 'Pengguna dinonaktifkan' : 'Pengguna diaktifkan kembali');
                        await fetchUsers();
                        await fetchUserStats();
                      } catch {
                        toast.error('Gagal mengubah status pengguna');
                      }
                    }}
                    style={{
                      padding: '8px 20px',
                      borderRadius: 8,
                      border: 'none',
                      cursor: 'pointer',
                      fontSize: 14,
                      fontWeight: 500,
                      background: toggleTarget.isActive ? 'var(--color-background-danger)' : 'var(--color-background-success)',
                      color: toggleTarget.isActive ? 'var(--color-text-danger)' : 'var(--color-text-success)',
                    }}
                  >
                    {toggleTarget.isActive ? 'Nonaktifkan' : 'Aktifkan'}
                  </button>
                </div>
              </div>
            </>
          ) : null}
        </div>
      )}

      {tab === 'features' && (
        // FIX Fix 2B: modern card-based permission matrix — human-readable labels, toggle switches, colored role chips
        <div className="space-y-5">
          <div>
            <h2 className="text-lg font-black text-slate-800">Akses Fitur</h2>
            <p className="text-sm text-slate-500 mt-0.5">
              Atur fitur mana yang dapat diakses oleh setiap role. General Manager selalu punya akses dan tidak bisa dihapus dari matriks.
            </p>
          </div>

          {flagsLoading ? (
            <div className="py-20 text-center text-slate-500">Memuat…</div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {flags
                .filter((f) => FEATURE_KEYS_SHOW.includes(f.featureKey))
                .sort((a, b) => {
                  // FIX Fix 2B: stable ordering using the curated FEATURE_KEYS_SHOW list
                  const ia = FEATURE_KEYS_SHOW.indexOf(a.featureKey);
                  const ib = FEATURE_KEYS_SHOW.indexOf(b.featureKey);
                  return ia - ib;
                })
                .map((f) => {
                  const draft = flagDrafts[f.featureKey];
                  if (!draft) return null;

                  // FIX Fix 2B: pull human-readable metadata, fall back to best-effort humanize
                  const meta = FEATURE_LABELS[f.featureKey] || {
                    label: f.featureKey.replace(/_/g, ' '),
                    description: f.description || 'Pengaturan fitur sistem.',
                    icon: '⚙️',
                  };

                  return (
                    <div
                      key={f.featureKey}
                      className={`bg-white rounded-2xl border shadow-sm overflow-hidden transition-shadow ${
                        draft.isEnabled ? 'border-slate-200' : 'border-slate-100 opacity-75'
                      }`}
                    >
                      {/* Header: icon + label + toggle switch */}
                      <div className="flex items-start justify-between gap-3 p-5 border-b border-slate-100">
                        <div className="flex items-start gap-3 flex-1 min-w-0">
                          <div
                            className="flex-shrink-0 w-11 h-11 rounded-xl flex items-center justify-center text-xl"
                            style={{ background: '#0F1B2D08' }}
                          >
                            {meta.icon}
                          </div>
                          <div className="flex-1 min-w-0">
                            {/* FIX Fix 2B: human label (e.g. "Pipeline Perizinan") instead of raw "PERMIT_PIPELINE" */}
                            <h3 className="font-black text-slate-800 text-[15px] leading-tight">
                              {meta.label}
                            </h3>
                            <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                              {meta.description}
                            </p>
                          </div>
                        </div>

                        {/* FIX Fix 2B: iOS-style toggle switch */}
                        <button
                          type="button"
                          onClick={() =>
                            setFlagDrafts((prev) => ({
                              ...prev,
                              [f.featureKey]: {
                                ...prev[f.featureKey],
                                isEnabled: !prev[f.featureKey]?.isEnabled,
                              },
                            }))
                          }
                          className={`relative flex-shrink-0 w-11 h-6 rounded-full transition-colors ${
                            draft.isEnabled ? 'bg-[#00D4B4]' : 'bg-slate-300'
                          }`}
                          aria-label={`Toggle ${meta.label}`}
                        >
                          <span
                            className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                              draft.isEnabled ? 'translate-x-5' : 'translate-x-0.5'
                            }`}
                          />
                        </button>
                      </div>

                      {/* Body: role chips */}
                      <div className="p-5">
                        <div className="flex items-center justify-between mb-3">
                          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                            Role yang dapat akses
                          </span>
                          <span className="text-[11px] font-bold text-slate-400">
                            {draft.roles.length}/{RoleEnum().length}
                          </span>
                        </div>

                        <div className="flex flex-wrap gap-1.5">
                          {RoleEnum().map((role) => {
                            const isGm = role === 'GENERAL_MANAGER';
                            const isOn = isGm || draft.roles.includes(role);
                            const label = ROLE_LABELS[role] || role.replace(/_/g, ' ');
                            const color = ROLE_COLORS[role] || '#475569';
                            const locked = isGm || !draft.isEnabled;
                            return (
                              <button
                                type="button"
                                key={role}
                                title={isGm ? 'General Manager selalu punya akses' : undefined}
                                onClick={() => toggleRoleInFlag(f.featureKey, role, !isOn)}
                                disabled={locked}
                                className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all ${
                                  isOn
                                    ? 'shadow-sm'
                                    : 'bg-slate-50 text-slate-400 border border-slate-200 hover:bg-slate-100'
                                } ${isGm ? 'cursor-not-allowed' : !draft.isEnabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
                                style={
                                  isOn
                                    ? { background: `${color}18`, color, border: `1px solid ${color}40` }
                                    : undefined
                                }
                              >
                                {isOn ? '✓ ' : ''}{label}{isGm ? ' 🔒' : ''}
                              </button>
                            );
                          })}
                        </div>

                        <button
                          type="button"
                          onClick={() => saveFlag(f.featureKey)}
                          disabled={!draft.isEnabled}
                          className={`w-full mt-4 py-2.5 rounded-xl text-sm font-bold transition-colors ${
                            draft.isEnabled
                              ? 'bg-[#0F1B2D] text-white hover:bg-[#1a2638]'
                              : 'bg-slate-100 text-slate-400 cursor-not-allowed'
                          }`}
                        >
                          💾 Simpan Perubahan
                        </button>
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
        </div>
      )}

      {tab === 'overview' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Metric label="Total Pengguna" value={ov.userStats?.total ?? '—'} />
            <Metric label="Pengguna Aktif" value={ov.userStats?.active ?? '—'} />
            <Metric label="Surveyor" value={ov.userStats?.surveyorCount ?? '—'} />
            <Metric label="PM" value={ov.userStats?.pmCount ?? '—'} />
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Metric label="Visit Request (total)" value={ov.vrTotal ?? '—'} />
            <Metric label="BA Open bulan ini" value={ov.baMonth ?? '—'} />
            <Metric label="Order (pending est.)" value={ov.orderPending ?? '—'} />
            <Metric label="PR inbox" value={ov.prInbox?.count ?? '—'} />
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Metric label="Total item stok" value={ov.stockSummary?.totalItems ?? '—'} />
            <Metric label="Stok rendah" value={ov.stockSummary?.lowStockCount ?? '—'} />
            <Metric label="Nilai stok" value={ov.stockSummary?.totalValue != null ? String(ov.stockSummary.totalValue) : '—'} />
          </div>

          <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 font-black text-slate-800">Aktivitas terbaru</div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-600">
                  <tr>
                    <th className="px-4 py-2 text-left">Waktu</th>
                    <th className="px-4 py-2 text-left">User</th>
                    <th className="px-4 py-2 text-left">Aksi</th>
                    <th className="px-4 py-2 text-left">Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {(ov.audit ?? []).length === 0 ? (
                    <tr><td colSpan={4} className="px-4 py-8 text-center text-slate-500">Belum ada data</td></tr>
                  ) : (
                    ov.audit.map((row: any, i: number) => (
                      <tr key={i} className="border-t border-slate-100 hover:bg-slate-50/80">
                        <td className="px-4 py-2 text-xs text-slate-500">{new Date(row.timestamp).toLocaleString('id-ID')}</td>
                        <td className="px-4 py-2">{row.actorName} <span className="text-[10px] text-slate-400">({row.actorRole})</span></td>
                        <td className="px-4 py-2 text-xs">{row.action}</td>
                        <td className="px-4 py-2 text-xs max-w-[320px]">
                          {row.href ? (
                            <Link
                              href={row.href}
                              className="text-[#0969DA] hover:underline font-medium"
                              title={row.detail}
                            >
                              {row.detail}
                            </Link>
                          ) : (
                            <span className="truncate block" title={row.detail}>{row.detail}</span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {tab === 'isp-email' && canAccessIspEmail && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 500 }}>Konfigurasi Email ISP</h3>
              <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--color-text-secondary)' }}>
                Atur alamat email untuk pengiriman dokumen ke setiap ISP
              </p>
            </div>
            <button
              onClick={() => {
                setAddingIsp(true); // NEW: open add ISP email form
                setEditingIsp(null); // NEW: reset edit mode
                setIspEmailForm({ ispName: '', emailTo: '', emailCc: '', smtpNotes: '' }); // NEW: clear ISP email form
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '7px 14px',
                borderRadius: 8,
                background: 'var(--color-background-info)',
                color: 'var(--color-text-info)',
                border: 'none',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: 500,
              }}
            >
              <Plus style={{ width: 14, height: 14 }} />
              Tambah ISP
            </button>
          </div>

          {addingIsp && (
            <div style={{ background: 'var(--color-background-secondary)', borderRadius: 8, padding: 16, marginBottom: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 12 }}>Tambah Konfigurasi ISP Baru</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                {[
                  { label: 'Nama ISP *', key: 'ispName', placeholder: 'FiberStar' },
                  { label: 'Email To * (pisahkan dengan koma)', key: 'emailTo', placeholder: 'permit@isp.com, ops@isp.com' },
                  { label: 'Email CC (opsional)', key: 'emailCc', placeholder: 'cc@isp.com' },
                  { label: 'Catatan', key: 'smtpNotes', placeholder: 'Catatan pengiriman email...' },
                ].map((field) => (
                  <div key={field.key} style={{ gridColumn: field.key === 'smtpNotes' ? '1 / -1' : 'auto' }}>
                    <label
                      style={{
                        display: 'block',
                        fontSize: 11,
                        fontWeight: 500,
                        color: 'var(--color-text-secondary)',
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                        marginBottom: 5,
                      }}
                    >
                      {field.label}
                    </label>
                    <input
                      value={(ispEmailForm as any)[field.key]}
                      onChange={(e) => setIspEmailForm((prev) => ({ ...prev, [field.key]: e.target.value }))}
                      placeholder={field.placeholder}
                      style={{ width: '100%', boxSizing: 'border-box' }}
                    />
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button
                  onClick={async () => {
                    try {
                      await apiPost('/isp-email-config', {
                        ispName: ispEmailForm.ispName,
                        emailTo: ispEmailForm.emailTo.split(',').map((e) => e.trim()).filter(Boolean),
                        emailCc: ispEmailForm.emailCc.split(',').map((e) => e.trim()).filter(Boolean),
                        smtpNotes: ispEmailForm.smtpNotes || undefined,
                      });
                      toast.success('Konfigurasi ISP disimpan');
                      setAddingIsp(false);
                      await fetchIspConfigs();
                    } catch {
                      toast.error('Gagal menyimpan');
                    }
                  }}
                  style={{
                    padding: '7px 20px',
                    borderRadius: 8,
                    background: 'var(--color-background-info)',
                    color: 'var(--color-text-info)',
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: 13,
                  }}
                >
                  Simpan
                </button>
                <button
                  onClick={() => setAddingIsp(false)}
                  style={{
                    padding: '7px 20px',
                    borderRadius: 8,
                    background: 'none',
                    border: '0.5px solid var(--color-border-tertiary)',
                    cursor: 'pointer',
                    fontSize: 13,
                  }}
                >
                  Batal
                </button>
              </div>
            </div>
          )}

          {editingIsp && (
            <div style={{ background: 'var(--color-background-secondary)', borderRadius: 8, padding: 16, marginBottom: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 12 }}>Edit Konfigurasi Email ISP</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                {[
                  { label: 'Nama ISP *', key: 'ispName', placeholder: 'FiberStar' },
                  { label: 'Email To * (pisahkan dengan koma)', key: 'emailTo', placeholder: 'permit@isp.com, ops@isp.com' },
                  { label: 'Email CC (opsional)', key: 'emailCc', placeholder: 'cc@isp.com' },
                  { label: 'Catatan', key: 'smtpNotes', placeholder: 'Catatan pengiriman email...' },
                ].map((field) => (
                  <div key={field.key} style={{ gridColumn: field.key === 'smtpNotes' ? '1 / -1' : 'auto' }}>
                    <label
                      style={{
                        display: 'block',
                        fontSize: 11,
                        fontWeight: 500,
                        color: 'var(--color-text-secondary)',
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                        marginBottom: 5,
                      }}
                    >
                      {field.label}
                    </label>
                    <input
                      value={(ispEmailForm as any)[field.key]}
                      onChange={(e) => setIspEmailForm((prev) => ({ ...prev, [field.key]: e.target.value }))}
                      placeholder={field.placeholder}
                      style={{ width: '100%', boxSizing: 'border-box' }}
                    />
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button
                  onClick={async () => {
                    try {
                      await apiPatch(`/isp-email-config/${encodeURIComponent(editingIsp)}`, {
                        ispName: ispEmailForm.ispName,
                        emailTo: ispEmailForm.emailTo.split(',').map((e) => e.trim()).filter(Boolean),
                        emailCc: ispEmailForm.emailCc.split(',').map((e) => e.trim()).filter(Boolean),
                        smtpNotes: ispEmailForm.smtpNotes || undefined,
                      });
                      toast.success('Konfigurasi ISP diperbarui');
                      setEditingIsp(null);
                      await fetchIspConfigs();
                    } catch {
                      toast.error('Gagal memperbarui');
                    }
                  }}
                  style={{
                    padding: '7px 20px',
                    borderRadius: 8,
                    background: 'var(--color-background-info)',
                    color: 'var(--color-text-info)',
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: 13,
                  }}
                >
                  Simpan Perubahan
                </button>
                <button
                  onClick={() => setEditingIsp(null)}
                  style={{
                    padding: '7px 20px',
                    borderRadius: 8,
                    background: 'none',
                    border: '0.5px solid var(--color-border-tertiary)',
                    cursor: 'pointer',
                    fontSize: 13,
                  }}
                >
                  Batal
                </button>
              </div>
            </div>
          )}

          {ispEmailLoading ? (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--color-text-secondary)' }}>Memuat...</div>
          ) : ispConfigs.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--color-text-secondary)' }}>
              Belum ada konfigurasi email ISP. Klik "+ Tambah ISP" untuk mulai.
            </div>
          ) : (
            <div style={{ border: '0.5px solid var(--color-border-tertiary)', borderRadius: 8, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: 'var(--color-background-secondary)' }}>
                    {['ISP', 'Email To', 'Email CC', 'Catatan', 'Diperbarui', 'Aksi'].map((head) => (
                      <th
                        key={head}
                        style={{
                          padding: '8px 14px',
                          textAlign: 'left',
                          fontSize: 11,
                          fontWeight: 500,
                          color: 'var(--color-text-secondary)',
                          textTransform: 'uppercase',
                        }}
                      >
                        {head}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ispConfigs.map((cfg) => (
                    <tr key={cfg.id} style={{ borderBottom: '0.5px solid var(--color-border-tertiary)' }}>
                      <td style={{ padding: '10px 14px', fontWeight: 500 }}>{cfg.ispName}</td>
                      <td style={{ padding: '10px 14px', fontSize: 12 }}>{cfg.emailTo.join(', ') || '—'}</td>
                      <td style={{ padding: '10px 14px', fontSize: 12, color: 'var(--color-text-secondary)' }}>{cfg.emailCc.join(', ') || '—'}</td>
                      <td style={{ padding: '10px 14px', fontSize: 12, color: 'var(--color-text-secondary)' }}>{cfg.smtpNotes || '—'}</td>
                      <td style={{ padding: '10px 14px', fontSize: 12, color: 'var(--color-text-secondary)' }}>
                        {new Date(cfg.updatedAt).toLocaleDateString('id-ID')}
                      </td>
                      <td style={{ padding: '10px 14px' }}>
                        <button
                          onClick={() => {
                            setEditingIsp(cfg.ispName); // NEW: open edit form for specific ISP
                            setAddingIsp(false); // NEW: close add form when editing
                            setIspEmailForm({
                              ispName: cfg.ispName,
                              emailTo: cfg.emailTo.join(', '),
                              emailCc: cfg.emailCc.join(', '),
                              smtpNotes: cfg.smtpNotes || '',
                            });
                          }}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-info)', fontSize: 13 }}
                        >
                          Edit
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function RoleEnum(): string[] {
  return [
    'SURVEYOR_FTTH', 'SURVEYOR_FTTB', 'SURVEYOR_FTTT',
    'PM_FTTH', 'PM_FTTB', 'PM_FTTT', 'PM_SENIOR',
    'ADMIN', 'ADMIN_STOCK', 'FINANCE', 'GENERAL_MANAGER',
    'MARKETING', 'MARKETING_HEAD', 'OPERATIONAL_MANAGER', // NEW: cash operation roles
    'DESIGNER', // FIX Fix 2B: include Designer role in permission picker
  ];
}

// FIX Fix 2B: human-readable feature labels + descriptions (replaces raw BA_OPEN / PERMIT_PIPELINE keys)
const FEATURE_LABELS: Record<string, { label: string; description: string; icon: string }> = {
  CLEAN_LIST:          { label: 'Clean List',           description: 'Kelola daftar lokasi siap survey dari Marketing.', icon: '📋' },
  VISIT_REQUEST:       { label: 'Visit Request',        description: 'Permintaan kunjungan lapangan oleh Surveyor.',      icon: '🚗' },
  BA_OPEN:             { label: 'Berita Acara Open',    description: 'Pembuatan BA Open sebelum survey lapangan.',        icon: '📄' },
  BA_SURVEY:           { label: 'Berita Acara Survey',  description: 'BA Survey setelah kunjungan lapangan selesai.',     icon: '📝' },
  STOCK_MODULE:        { label: 'Modul Stok',           description: 'Manajemen stok material untuk konstruksi.',         icon: '📦' },
  ORDER_MODULE:        { label: 'Modul Order',          description: 'Pengajuan order material dari Surveyor/Teknisi.',   icon: '🛒' },
  SURAT_JALAN:         { label: 'Surat Jalan',          description: 'Pencatatan pengeluaran stok via surat jalan.',      icon: '🧾' },
  PURCHASE_REQUEST:    { label: 'Purchase Request',     description: 'Pengajuan pembelian material.',                     icon: '💰' },
  GIS_MAP:             { label: 'GIS Map',              description: 'Peta geospasial lokasi cluster & jaringan.',        icon: '🗺️' },
  PERMIT_PIPELINE:     { label: 'Pipeline Perizinan',   description: 'Workflow end-to-end perizinan cluster.',            icon: '🔄' },
  CASH_OPERATION:      { label: 'Cash Operation',       description: 'Pencairan dana operasional perizinan.',             icon: '💵' },
  SIP_MODULE:          { label: 'Modul SIP',            description: 'Pengajuan SIP ke Marketing.',                       icon: '📮' },
  HLD_MODULE:          { label: 'Modul HLD',            description: 'Upload dan review High Level Design.',              icon: '📐' },
  LLD_MODULE:          { label: 'Modul LLD',            description: 'Upload dan review Low Level Design.',               icon: '📊' },
  CONTRACT_MANAGEMENT: { label: 'Manajemen Kontrak',    description: 'Kontrak ISP dan dokumen terkait.',                  icon: '📑' },
  AUDIT_LOG:           { label: 'Audit Log',            description: 'Riwayat aktivitas sistem.',                         icon: '🔍' },
};

// FIX Fix 2B: role labels + colors are reused from the top-of-file ROLE_LABELS / ROLE_COLORS maps (single source of truth)

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-100 p-5 shadow-sm">
      <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">{label}</p>
      <p className="text-2xl font-black text-slate-800 mt-1">{value}</p>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<div className="p-8 text-slate-500">Memuat…</div>}>
      <SettingsPageContent />
    </Suspense>
  );
}
