'use client'; // FIX: client component
// FIX: Daftar Dokumen — grouped by ISP → RW list
import { useState, useEffect, useCallback } from 'react'; // FIX: hooks
import { useRouter } from 'next/navigation'; // FIX: router
import { useAuthStore } from '../../../store/authStore'; // FIX: auth
import { apiGet } from '../../../lib/api'; // FIX: API helper

interface ClusterRow {
  id: string; // FIX
  clusterCode: string; // FIX
  fiberType: string; // FIX
  currentPhase: string; // FIX
  status: string; // FIX
  rwName: string | null; // FIX
  kelurahan: string | null; // FIX
  kecamatan: string | null; // FIX
  kotaKabupaten: string | null; // FIX
  docCount: number; // FIX
  approvedDocs: number; // FIX
  bakpStatus: string | null; // FIX
  claimStatus: string | null; // FIX
}

interface IspGroup {
  ispName: string; // FIX
  clusters: ClusterRow[]; // FIX
  docCount: number; // FIX
}

// FIX: fiber type color
const FIBER_COLOR: Record<string, string> = {
  FTTH: '#3B82F6', // FIX
  FTTB: '#8B5CF6', // FIX
  FTTT: '#F59E0B', // FIX
};

// FIX: phase label short
const PHASE_SHORT: Record<string, string> = {
  SITE_VISIT: 'Survey', // FIX
  SURVEY_INPUT: 'Survey', // FIX
  ROUTE_SURVEY: 'Route', // FIX
  BA_SURVEY: 'BA Surv', // FIX
  SIP_REQUEST: 'SIP', // FIX
  HLD_SUBMISSION: 'HLD', // FIX
  LLD_SUBMISSION: 'LLD', // FIX
  BAK_GENERATION: 'BAK', // FIX
  BAKP_COMPILATION: 'BAKP', // FIX
  CLAIM_SUBMISSION: 'Klaim', // FIX
  INVOICE_PACKAGE: 'Invoice', // FIX
  PERMIT_DONE: 'Selesai', // FIX
};

export default function DocumentListPage() {
  const router = useRouter(); // FIX: nav
  const { user } = useAuthStore(); // FIX: user

  const [groups, setGroups] = useState<IspGroup[]>([]); // FIX: state
  const [loading, setLoading] = useState(true); // FIX
  const [search, setSearch] = useState(''); // FIX
  const [fiberFilter, setFiber] = useState(''); // FIX
  const [ispFilter, setIsp] = useState(''); // FIX
  const [bakpDoneOnly, setBakpDoneOnly] = useState(false); // FIX
  const [expanded, setExpanded] = useState<Set<string>>(new Set()); // FIX
  const [total, setTotal] = useState(0); // FIX

  const load = useCallback(async () => {
    if (!user) return; // FIX: guard
    setLoading(true); // FIX
    try {
      const params = new URLSearchParams(); // FIX: qs
      if (search) params.set('search', search); // FIX
      if (fiberFilter) params.set('fiberType', fiberFilter); // FIX
      if (ispFilter) params.set('isp', ispFilter); // FIX
      if (bakpDoneOnly) params.set('bakpIspApproved', 'true'); // FIX

      const data = await apiGet<{
        groups: IspGroup[]; // FIX
        total: number; // FIX
      }>(`/document-list/grouped?${params.toString()}`); // FIX: endpoint

      setGroups(data.groups || []); // FIX
      setTotal(data.total || 0); // FIX

      // FIX: auto-expand if only 1 group
      if ((data.groups || []).length === 1) {
        setExpanded(new Set([data.groups![0].ispName])); // FIX
      }
    } catch {
      setGroups([]); // FIX: empty on error
    } finally {
      setLoading(false); // FIX
    }
  }, [user, search, fiberFilter, ispFilter, bakpDoneOnly]); // FIX: deps

  useEffect(() => {
    const t = setTimeout(load, 300); // FIX: debounce
    return () => clearTimeout(t); // FIX
  }, [load]); // FIX

  const toggleExpand = (ispName: string) => {
    setExpanded((prev) => {
      const next = new Set(prev); // FIX: clone
      if (next.has(ispName)) next.delete(ispName); // FIX
      else next.add(ispName); // FIX
      return next; // FIX
    });
  };

  // FIX: unique ISPs for filter
  const allIsps = Array.from(new Set(groups.map((g) => g.ispName))); // FIX

  if (!user) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-secondary)' }}>
        Memuat sesi…
      </div>
    ); // FIX: hydration guard
  }

  return (
    <div>
      {/* Header */}
      <div
        style={{
          display: 'flex', // FIX
          alignItems: 'flex-start', // FIX
          justifyContent: 'space-between', // FIX
          marginBottom: 24, // FIX
          flexWrap: 'wrap', // FIX
          gap: 12, // FIX
        }}
      >
        <div>
          <h1
            style={{
              fontSize: 22, // FIX
              fontWeight: 700, // FIX
              margin: 0, // FIX
              color: 'var(--color-text-primary)', // FIX
            }}
          >
            📁 Daftar Dokumen
          </h1>
          <p
            style={{
              fontSize: 13, // FIX
              color: 'var(--color-text-secondary)', // FIX
              margin: '4px 0 0', // FIX
            }}
          >
            {total} cluster · dikelompokkan per ISP dan RW
          </p>
        </div>
      </div>

      {/* Search + Filters */}
      <div
        style={{
          display: 'flex', // FIX
          gap: 10, // FIX
          marginBottom: 20, // FIX
          flexWrap: 'wrap', // FIX
        }}
      >
        {/* Search */}
        <div
          style={{
            flex: 1, // FIX
            minWidth: 220, // FIX
            display: 'flex', // FIX
            alignItems: 'center', // FIX
            gap: 8, // FIX
            padding: '9px 14px', // FIX
            borderRadius: 10, // FIX
            background: 'var(--color-background-primary)', // FIX
            border: '0.5px solid var(--color-border-tertiary)', // FIX
          }}
        >
          <span style={{ fontSize: 14 }}>🔍</span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari cluster, RW, ISP, kecamatan..."
            style={{
              flex: 1, // FIX
              border: 'none', // FIX
              outline: 'none', // FIX
              fontSize: 13, // FIX
              background: 'transparent', // FIX
              color: 'var(--color-text-primary)', // FIX
            }}
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              style={{
                border: 'none', // FIX
                background: 'none', // FIX
                cursor: 'pointer', // FIX
                color: '#9CA3AF', // FIX
                fontSize: 16, // FIX
              }}
            >
              ×
            </button>
          )}
        </div>

        {/* ISP filter */}
        <select
          value={ispFilter}
          onChange={(e) => setIsp(e.target.value)}
          style={{
            padding: '9px 12px', // FIX
            borderRadius: 10, // FIX
            fontSize: 13, // FIX
            border: '0.5px solid var(--color-border-tertiary)', // FIX
            background: 'var(--color-background-primary)', // FIX
            color: 'var(--color-text-primary)', // FIX
            outline: 'none', // FIX
          }}
        >
          <option value="">Semua ISP</option>
          {allIsps.map((isp) => (
            <option key={isp} value={isp}>
              {isp}
            </option>
          ))}
        </select>

        {/* Fiber filter */}
        <select
          value={fiberFilter}
          onChange={(e) => setFiber(e.target.value)}
          style={{
            padding: '9px 12px', // FIX
            borderRadius: 10, // FIX
            fontSize: 13, // FIX
            border: '0.5px solid var(--color-border-tertiary)', // FIX
            background: 'var(--color-background-primary)', // FIX
            color: 'var(--color-text-primary)', // FIX
            outline: 'none', // FIX
          }}
        >
          <option value="">Semua Tipe</option>
          <option value="FTTH">FTTH</option>
          <option value="FTTB">FTTB</option>
          <option value="FTTT">FTTT</option>
        </select>

        <label
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '9px 12px',
            borderRadius: 10,
            border: '0.5px solid var(--color-border-tertiary)',
            background: 'var(--color-background-primary)',
            color: 'var(--color-text-primary)',
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          <input
            type="checkbox"
            checked={bakpDoneOnly}
            onChange={(e) => setBakpDoneOnly(e.target.checked)}
          />
          BAKP ISP Approved
        </label>
      </div>

      {/* Groups */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--color-text-secondary)' }}>
          ⏳ Memuat data...
        </div>
      ) : groups.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--color-text-secondary)' }}>
          Tidak ada data dokumen ditemukan
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {groups.map((group) => (
            <div
              key={group.ispName}
              style={{
                background: 'var(--color-background-primary)', // FIX
                border: '0.5px solid var(--color-border-tertiary)', // FIX
                borderRadius: 14, // FIX
                overflow: 'hidden', // FIX
              }}
            >
              {/* ISP Header — clickable to expand */}
              <button
                type="button"
                onClick={() => toggleExpand(group.ispName)}
                style={{
                  width: '100%', // FIX
                  padding: '14px 20px', // FIX
                  display: 'flex', // FIX
                  alignItems: 'center', // FIX
                  gap: 12, // FIX
                  background: expanded.has(group.ispName) ? '#00D4B408' : 'var(--color-background-secondary)', // FIX
                  border: 'none', // FIX
                  cursor: 'pointer', // FIX
                  borderBottom: expanded.has(group.ispName) ? '0.5px solid var(--color-border-tertiary)' : 'none', // FIX
                  textAlign: 'left', // FIX
                }}
              >
                <div
                  style={{
                    width: 38, // FIX
                    height: 38, // FIX
                    borderRadius: 10, // FIX
                    background: '#00D4B415', // FIX
                    display: 'flex', // FIX
                    alignItems: 'center', // FIX
                    justifyContent: 'center', // FIX
                    flexShrink: 0, // FIX
                    fontSize: 18, // FIX
                  }}
                >
                  🏢
                </div>

                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--color-text-primary)' }}>{group.ispName}</div>
                  <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginTop: 2 }}>
                    {group.clusters.length} cluster · {group.docCount} dokumen
                  </div>
                </div>

                <div style={{ textAlign: 'right', marginRight: 8 }}>
                  <div style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>
                    {group.clusters.filter((c) => c.currentPhase === 'PERMIT_DONE').length} / {group.clusters.length}{' '}
                    selesai
                  </div>
                </div>

                <span
                  style={{
                    fontSize: 14, // FIX
                    color: 'var(--color-text-secondary)', // FIX
                    transition: 'transform 200ms', // FIX
                    transform: expanded.has(group.ispName) ? 'rotate(180deg)' : 'none', // FIX
                  }}
                >
                  ▾
                </span>
              </button>

              {expanded.has(group.ispName) && (
                <div style={{ padding: '8px 0' }}>
                  {group.clusters.map((cluster, idx) => (
                    <div
                      key={cluster.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => router.push(`/document-list/${cluster.id}`)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') router.push(`/document-list/${cluster.id}`); // FIX: a11y
                      }}
                      style={{
                        display: 'flex', // FIX
                        alignItems: 'center', // FIX
                        gap: 12, // FIX
                        padding: '10px 20px', // FIX
                        cursor: 'pointer', // FIX
                        borderBottom:
                          idx < group.clusters.length - 1 ? '0.5px solid var(--color-border-tertiary)' : 'none', // FIX
                        transition: 'background 150ms', // FIX
                      }}
                      onMouseEnter={(e) => {
                        (e.currentTarget as HTMLElement).style.background = 'var(--color-background-secondary)'; // FIX
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLElement).style.background = 'transparent'; // FIX
                      }}
                    >
                      <span style={{ fontSize: 16, flexShrink: 0 }}>📍</span>

                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary)' }}>
                            {cluster.rwName || cluster.clusterCode}
                          </span>
                          <span
                            style={{
                              padding: '1px 6px', // FIX
                              borderRadius: 6, // FIX
                              background: `${FIBER_COLOR[cluster.fiberType] || '#6B7280'}15`, // FIX
                              color: FIBER_COLOR[cluster.fiberType] || '#6B7280', // FIX
                              fontSize: 10, // FIX
                              fontWeight: 700, // FIX
                            }}
                          >
                            {cluster.fiberType}
                          </span>
                        </div>
                        <div
                          style={{
                            fontSize: 11, // FIX
                            color: 'var(--color-text-secondary)', // FIX
                            marginTop: 2, // FIX
                            overflow: 'hidden', // FIX
                            textOverflow: 'ellipsis', // FIX
                            whiteSpace: 'nowrap', // FIX
                          }}
                        >
                          {[cluster.kelurahan, cluster.kecamatan, cluster.kotaKabupaten].filter(Boolean).join(' · ')}
                        </div>
                      </div>

                      <span
                        style={{
                          padding: '3px 8px', // FIX
                          borderRadius: 8, // FIX
                          background: cluster.currentPhase === 'PERMIT_DONE' ? '#22C55E15' : '#F59E0B15', // FIX
                          color: cluster.currentPhase === 'PERMIT_DONE' ? '#22C55E' : '#F59E0B', // FIX
                          fontSize: 10, // FIX
                          fontWeight: 600, // FIX
                          flexShrink: 0, // FIX
                        }}
                      >
                        {PHASE_SHORT[cluster.currentPhase] || cluster.currentPhase}
                      </span>

                      <div style={{ textAlign: 'right', flexShrink: 0, minWidth: 60 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text-primary)' }}>
                          {cluster.docCount}
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--color-text-secondary)' }}>dokumen</div>
                      </div>

                      <span style={{ fontSize: 14, color: 'var(--color-text-secondary)' }}>›</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
