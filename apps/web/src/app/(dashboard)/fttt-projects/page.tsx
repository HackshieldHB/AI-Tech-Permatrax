'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Plus, RefreshCw } from 'lucide-react';
import { apiGetPaginated } from '../../../lib/api';
import { useAuthStore } from '../../../store/authStore';
import {
  FtttProject,
  FTTT_COMPANY_LABELS,
  FTTT_PHASE_LABELS,
  FTTT_PROJECT_STATUS_LABELS,
  FtttPhaseStatus,
} from '../../../types/api.types';
import { io, Socket } from 'socket.io-client';
import { API_HOST } from '../../../lib/api';

// ─── Phase progress bar ───────────────────────────────────────────────────────
function PhaseBar({ project }: { project: FtttProject }) {
  const phases = project.phaseProgresses.filter((p) => p.status !== 'SKIPPED');
  const completed = phases.filter((p) => p.status === 'COMPLETED').length;
  const pct = phases.length > 0 ? Math.round((completed / phases.length) * 100) : 0;

  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#57606a', marginBottom: 4 }}>
        <span>{FTTT_PHASE_LABELS[project.currentPhase]}</span>
        <span>{pct}%</span>
      </div>
      <div style={{ height: 6, background: '#EAEEF2', borderRadius: 3, overflow: 'hidden' }}>
        <div
          style={{
            height: '100%',
            width: `${pct}%`,
            background: project.status === 'COMPLETED' ? '#1a7f37' : '#0969DA',
            borderRadius: 3,
            transition: 'width 0.4s ease',
          }}
        />
      </div>
      <div style={{ display: 'flex', gap: 3, marginTop: 4 }}>
        {phases.map((p) => (
          <div
            key={p.phase}
            title={FTTT_PHASE_LABELS[p.phase]}
            style={{
              flex: 1,
              height: 4,
              borderRadius: 2,
              background:
                p.status === 'COMPLETED' ? '#1a7f37' :
                p.status === 'ACTIVE' ? '#0969DA' :
                '#EAEEF2',
            }}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Status badge ─────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const cfg = FTTT_PROJECT_STATUS_LABELS[status as keyof typeof FTTT_PROJECT_STATUS_LABELS] ?? { label: status, color: 'gray' };
  const colorMap: Record<string, { bg: string; text: string }> = {
    blue:   { bg: '#DDF4FF', text: '#0969DA' },
    green:  { bg: '#DAFBE1', text: '#1a7f37' },
    orange: { bg: '#FFF8C5', text: '#9a6700' },
    red:    { bg: '#FFEBE9', text: '#cf222e' },
    gray:   { bg: '#F6F8FA', text: '#57606a' },
  };
  const c = colorMap[cfg.color] ?? colorMap.gray;
  return (
    <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 999, background: c.bg, color: c.text }}>
      {cfg.label}
    </span>
  );
}

// ─── Company badge ────────────────────────────────────────────────────────────
const COMPANY_COLORS: Record<string, { bg: string; text: string }> = {
  TELKOM_INFRA: { bg: '#FFF8C5', text: '#9a6700' },
  IFORTE:       { bg: '#DDF4FF', text: '#0969DA' },
  PST:          { bg: '#FAEBD7', text: '#8B4513' },
};

// ─── Main page ────────────────────────────────────────────────────────────────
export default function FtttProjectsPage() {
  const { user } = useAuthStore();
  const [projects, setProjects] = useState<FtttProject[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const socketRef = useRef<Socket | null>(null);

  const load = useCallback(async (p = 1) => {
    setLoading(true);
    try {
      const res = await apiGetPaginated<FtttProject>('/fttt-projects', { page: p, limit: 20, status: 'all' });
      setProjects(res.data ?? []);
      setTotal(res.meta?.total ?? 0);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(page); }, [load, page]);

  // Socket.IO: live updates when phase advances
  useEffect(() => {
    const token = useAuthStore.getState().accessToken;
    if (!token) return;
    const socket: Socket = io(API_HOST, { auth: { token } });
    socketRef.current = socket;

    socket.on('fttt:phase_advanced', (payload: { projectId: string; currentPhase: string; phases: any[] }) => {
      setProjects((prev) =>
        prev.map((proj) =>
          proj.id === payload.projectId
            ? { ...proj, currentPhase: payload.currentPhase as any, phaseProgresses: payload.phases }
            : proj,
        ),
      );
    });

    socket.on('fttt:project_created', () => void load(1));

    return () => { socket.disconnect(); };
  }, [load]);

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>FTTT Projects</h1>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: '#57606a' }}>
            {total} project · live progress via WebSocket
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => void load(page)}
            style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #D0D7DE', background: '#F6F8FA', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
          >
            <RefreshCw size={14} /> Refresh
          </button>
          {/* Issue #5: Only PM_FTTT can create project */}
          {user?.role === 'PM_FTTT' && (
            <Link
              href="/fttt-projects/new"
              style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: '#0969DA', color: '#fff', fontWeight: 600, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <Plus size={14} /> Buat Project
            </Link>
          )}
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', color: '#57606a', padding: 40 }}>Memuat…</div>
      ) : projects.length === 0 ? (
        <div style={{ textAlign: 'center', color: '#57606a', padding: 60 }}>
          <p>Belum ada FTTT project.</p>
          {user?.role === 'PM_FTTT' && <Link href="/fttt-projects/new" style={{ color: '#0969DA' }}>Buat yang pertama →</Link>}
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          {projects.map((proj) => {
            const cc = COMPANY_COLORS[proj.ftttCompany] ?? { bg: '#F6F8FA', text: '#57606a' };
            return (
              <Link
                key={proj.id}
                href={`/fttt-projects/${proj.id}`}
                style={{ textDecoration: 'none', color: 'inherit' }}
              >
                <div
                  style={{
                    background: '#fff',
                    border: '1px solid #D0D7DE',
                    borderRadius: 12,
                    padding: 16,
                    transition: 'box-shadow 0.15s',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)')}
                  onMouseLeave={(e) => (e.currentTarget.style.boxShadow = 'none')}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span
                          style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: cc.bg, color: cc.text }}
                        >
                          {FTTT_COMPANY_LABELS[proj.ftttCompany]}
                        </span>
                        <StatusBadge status={proj.status} />
                        <span style={{ fontSize: 12, color: '#57606a' }}>
                          PM: {proj.pm?.name ?? '-'}
                        </span>
                      </div>
                      <p style={{ margin: '6px 0 0', fontWeight: 600, fontSize: 15 }}>
                        {proj.projectName ?? `Project ${proj.id.slice(-6).toUpperCase()}`}
                      </p>
                      {proj.cleanList && (
                        <p style={{ margin: '2px 0 0', fontSize: 12, color: '#57606a' }}>
                          {proj.cleanList.kelurahan} · {proj.cleanList.rwCode}
                        </p>
                      )}
                    </div>
                    <span style={{ fontSize: 11, color: '#57606a', whiteSpace: 'nowrap', marginLeft: 12 }}>
                      {new Date(proj.updatedAt).toLocaleDateString('id-ID')}
                    </span>
                  </div>
                  <PhaseBar project={proj} />
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {total > 20 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 24 }}>
          <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} style={{ padding: '6px 16px', borderRadius: 8, border: '1px solid #D0D7DE', cursor: page > 1 ? 'pointer' : 'not-allowed', opacity: page <= 1 ? 0.5 : 1 }}>← Prev</button>
          <span style={{ padding: '6px 0', fontSize: 13 }}>Hal {page} / {Math.ceil(total / 20)}</span>
          <button disabled={page * 20 >= total} onClick={() => setPage((p) => p + 1)} style={{ padding: '6px 16px', borderRadius: 8, border: '1px solid #D0D7DE', cursor: page * 20 < total ? 'pointer' : 'not-allowed', opacity: page * 20 >= total ? 0.5 : 1 }}>Next →</button>
        </div>
      )}
    </div>
  );
}
