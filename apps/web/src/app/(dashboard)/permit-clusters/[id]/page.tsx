'use client';

import { useState, useEffect, useCallback, useRef } from 'react'; // FIX: useRef — single PR/BR auto-init attempt per cluster load
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuthStore } from '../../../../store/authStore';
import { apiGet, apiPost, apiPatch, fixFileUrl } from '../../../../lib/api'; // FIX Issue 3/4/6/7: import fixFileUrl for ngrok-aware file URLs
import { toast } from 'sonner';
import {
  Lock, ChevronDown, Download, RefreshCw,
} from 'lucide-react';
import type {
  BaOpen, ClaimPackage, Hld, InvoicePackage, Lld, PrBrRecord,
  Sip, SurveyData, SurveyEvidence, SurveyorDocPackage, SkomBudget,
} from '../../../../types/api.types'; // FIX PR/BR→PO flow: ContractRecord no longer used; workflow is a single PrBrWorkflow object
import { uploadFile } from '../../../../lib/api'; // FIX PR/BR→PO flow: used by PR/BR + PO upload sub-components
import {
  PHASE_ORDER, PHASE_LABELS,
} from '../../../../types/api.types';
import { BakGenerationPhasePanel } from './bak-generation-phase'; // FIX: phase 16 BAK agreement UI (hooks in dedicated component)
import BakpCompilationPhasePanel from './bakp-compilation-phase'; // FIX: phase 17 BAKP compilation panel
import ClaimSubmissionPhasePanel from './claim-submission-phase'; // FIX: phase 18 claim submission panel
import PipelineProgress from '../../../../components/pipeline/PipelineProgress'; // NEW: Phase 3A
import { isPmRole, isSurveyorRole } from '../../../../lib/roles';

const PHASE_GROUP_COLOR: Record<string, string> = {
  CLUSTER_INTAKE: '#3B82F6', VISIT_REQUEST: '#3B82F6',
  BA_OPEN: '#3B82F6', SITE_VISIT: '#3B82F6',
  SURVEY_INPUT: '#3B82F6', ROUTE_SURVEY: '#3B82F6',
  BA_SURVEY: '#3B82F6', SIP_REQUEST: '#3B82F6',
  HLD_SUBMISSION: '#8B5CF6', LLD_SUBMISSION: '#8B5CF6',
  PR_BR_ISSUANCE: '#F59E0B', CONTRACT_MANAGEMENT: '#F59E0B',
  SKOM_BUDGET: '#F59E0B', MANAGEMENT_APPROVAL: '#F59E0B',
  FUND_DISBURSEMENT: '#F59E0B',
  BAK_GENERATION: '#EC4899', BAKP_COMPILATION: '#EC4899',
  CLAIM_SUBMISSION: '#EC4899',
  INVOICE_PACKAGE: '#22C55E', PERMIT_DONE: '#22C55E',
};

export default function PermitClusterDetailPage() {
  const { id: clusterId } = useParams<{ id: string }>();
  const { user } = useAuthStore();
  const router = useRouter();

  // FIX: all hooks live at top-level — child renderers are pure functions, not components
  const [cluster, setCluster] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [expandedPhases, setExpandedPhases] = useState<Set<string>>(new Set());

  const [surveyData, setSurveyData] = useState<SurveyData | null>(null);
  const [docPackage, setDocPackage] = useState<SurveyorDocPackage | null>(null);
  const [sip, setSip] = useState<Sip | null>(null);
  const [hld, setHld] = useState<Hld | null>(null);
  const [lld, setLld] = useState<Lld | null>(null);
  const [prBr, setPrBr] = useState<PrBrRecord[]>([]);
  const [workflow, setWorkflow] = useState<PrBrWorkflow | null>(null); // FIX PR/BR→PO flow: new unified workflow state (PrBrWorkflow row)
  const [workflowLoading, setWorkflowLoading] = useState(false); // FIX: PR/BR workflow fetch + auto-init loading gate
  const [skom, setSkom] = useState<SkomBudget | null>(null);
  const [claim, setClaim] = useState<ClaimPackage | null>(null);
  const [invoice, setInvoice] = useState<InvoicePackage | null>(null);
  const [surveyEvidences, setSurveyEvidences] = useState<SurveyEvidence[]>([]);

  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // FIX: BA Open inline form kept (small, page-scoped) — all other inline forms moved to sub-pages
  const [baOpenForm, setBaOpenForm] = useState({
    tanggal: '',
    tempat: '',
    topik: '',
    description: '',
  });
  const [notesInput, setNotesInput] = useState(''); // FIX: retained for approve/reject notes

  const isSurveyor = isSurveyorRole(user?.role);
  const isPM = isPmRole(user?.role);
  const isAdmin = user?.role === 'ADMIN';
  const isDesigner = user?.role === 'DESIGNER'; // FIX Issue 10: dedicated DESIGNER role for HLD/LLD uploads
  const isSurveyorOrPM = isSurveyor || isPM; // FIX: shared permission flag

  const fetchContract = useCallback(
    async (currentPhase: string) => {
      const phasesNeedingContract = [
        'PR_BR_ISSUANCE', 'CONTRACT_MANAGEMENT',
        'SKOM_BUDGET', 'MANAGEMENT_APPROVAL', 'FUND_DISBURSEMENT',
      ]; // FIX: phases that render PR/BR→PO workflow-dependent UI
      if (!phasesNeedingContract.includes(currentPhase)) return;

      setWorkflowLoading(true); // FIX: drive PR/BR panel loading states
      try {
        const row = await apiGet<PrBrWorkflow | null>(`/permit-clusters/${clusterId}/contract`);
        setWorkflow(row ?? null); // FIX: null ⇒ not initialized — auto-init or manual /contract/init
      } catch (err: unknown) {
        const e = err as { status?: number; message?: string };
        if (e.status === 404 || e.message?.includes('404')) {
          setWorkflow(null); // FIX: treat legacy 404 as uninitialized
        }
      } finally {
        setWorkflowLoading(false); // FIX
      }
    },
    [clusterId],
  );

  const prBrAutoInitAttemptedRef = useRef<string | null>(null); // FIX: prevent infinite auto-init loops

  useEffect(() => {
    prBrAutoInitAttemptedRef.current = null; // FIX: new cluster detail ⇒ allow auto-init again
  }, [clusterId]);

  useEffect(() => {
    if (
      cluster?.currentPhase !== 'PR_BR_ISSUANCE' ||
      workflow !== null ||
      workflowLoading ||
      prBrAutoInitAttemptedRef.current === clusterId
    ) {
      return; // FIX: only auto-heal when workflow row is missing in PR/BR phase
    }
    prBrAutoInitAttemptedRef.current = clusterId; // FIX: mark before async (idempotent server upsert)
    let cancelled = false;
    void (async () => {
      setWorkflowLoading(true); // FIX: show “initializing…” while POST /contract/init runs
      try {
        await apiPost(`/permit-clusters/${clusterId}/contract/init`, {}); // FIX: create PrBrWorkflow for legacy clusters
        const row = await apiGet<PrBrWorkflow | null>(`/permit-clusters/${clusterId}/contract`);
        if (!cancelled) setWorkflow(row ?? null); // FIX
      } catch {
        try {
          const row = await apiGet<PrBrWorkflow | null>(`/permit-clusters/${clusterId}/contract`);
          if (!cancelled && row) setWorkflow(row); // FIX: another session may have initialized
        } catch {
          /* ignore */ // FIX
        }
      } finally {
        if (!cancelled) setWorkflowLoading(false); // FIX
      }
    })();
    return () => {
      cancelled = true; // FIX: teardown
    };
  }, [cluster?.currentPhase, workflow, workflowLoading, clusterId]);

  const fetchCluster = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiGet<any>(`/permit-clusters/${clusterId}`);
      setCluster(data);
      setExpandedPhases(new Set([data.currentPhase]));
      const idx = PHASE_ORDER.indexOf(data.currentPhase);

      const loads: Promise<unknown>[] = [];
      if (idx >= PHASE_ORDER.indexOf('SITE_VISIT')) {
        loads.push(apiGet<SurveyData>(`/permit-clusters/${clusterId}/survey`).then((row) => {
          setSurveyData(row);
          if ((row as any)?.evidenceFiles) setSurveyEvidences((row as any).evidenceFiles);
        }).catch(() => null));
        loads.push(apiGet<SurveyEvidence[]>(`/permit-clusters/${clusterId}/survey/evidence`).then(setSurveyEvidences).catch(() => []));
      }
      if (idx >= PHASE_ORDER.indexOf('BA_SURVEY')) {
        loads.push(apiGet<SurveyorDocPackage>(`/permit-clusters/${clusterId}/doc-package`).then(setDocPackage).catch(() => null));
      }
      if (idx >= PHASE_ORDER.indexOf('SIP_REQUEST')) {
        loads.push(apiGet<Sip>(`/permit-clusters/${clusterId}/sip`).then(setSip).catch(() => null)); // FIX: no sipForm sync
      }
      if (idx >= PHASE_ORDER.indexOf('HLD_SUBMISSION')) {
        loads.push(apiGet<Hld>(`/permit-clusters/${clusterId}/hld`).then(setHld).catch(() => null));
      }
      if (idx >= PHASE_ORDER.indexOf('LLD_SUBMISSION')) {
        loads.push(apiGet<Lld>(`/permit-clusters/${clusterId}/lld`).then(setLld).catch(() => null));
      }
      if (idx >= PHASE_ORDER.indexOf('PR_BR_ISSUANCE')) {
        loads.push(apiGet<PrBrRecord[]>(`/permit-clusters/${clusterId}/pr-br`).then(setPrBr).catch(() => []));
      }
      if (idx >= PHASE_ORDER.indexOf('SKOM_BUDGET')) {
        loads.push(apiGet<SkomBudget>(`/permit-clusters/${clusterId}/skom-budget`).then(setSkom).catch(() => null));
      }
      if (idx >= PHASE_ORDER.indexOf('CLAIM_SUBMISSION')) {
        loads.push(apiGet<ClaimPackage>(`/permit-clusters/${clusterId}/claim-package`).then(setClaim).catch(() => null));
      }
      if (idx >= PHASE_ORDER.indexOf('INVOICE_PACKAGE')) {
        loads.push(apiGet<InvoicePackage>(`/permit-clusters/${clusterId}/invoice`).then(setInvoice).catch(() => null));
      }

      await Promise.allSettled(loads);
      await fetchContract(data.currentPhase); // FIX: load PrBrWorkflow after core cluster payload (correct null + 404 handling)
    } catch {
      toast.error('Gagal memuat data cluster');
    } finally {
      setLoading(false);
    }
  }, [clusterId, fetchContract]);

  useEffect(() => {
    void fetchCluster();
  }, [fetchCluster]);

  // FIX: listen for real-time phase updates from backend socket broadcast
  useEffect(() => {
    if (typeof window === 'undefined') return;
    // Access socket via the global registered on connect (store-agnostic)
    const anyWin = window as any;
    const socket = anyWin.__permatrack_socket;
    if (!socket) return;

    const handlePhaseAdvanced = (data: any) => {
      if (data.clusterId === clusterId || data.newPhase) {
        // FIX: refresh cluster data when phase changes
        void fetchCluster();
      }
    };

    socket.on('cluster:phaseAdvanced', handlePhaseAdvanced);
    socket.on('cluster:updated', handlePhaseAdvanced);

    return () => {
      socket.off('cluster:phaseAdvanced', handlePhaseAdvanced);
      socket.off('cluster:updated', handlePhaseAdvanced);
    };
  }, [clusterId, fetchCluster]);

  const doAction = useCallback(async (key: string, fn: () => Promise<any>) => { // FIX: stable reference via useCallback
    setActionLoading(key);
    try {
      await fn();
      toast.success('Berhasil');
      await fetchCluster();
    } catch (err: any) {
      toast.error(err?.message || 'Gagal melakukan aksi');
    } finally {
      setActionLoading(null);
    }
  }, [fetchCluster]);

  // FIX: pure JSX helpers — no component declarations inside the render body
  const InfoGrid = ({ items }: { items: { label: string; value?: any }[] }) => (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 16px' }}>
      {items.map(({ label, value }) => (
        <div key={label}>
          <div
            style={{
              fontSize: 11,
              color: 'var(--color-text-secondary)',
              fontWeight: 500,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              marginBottom: 2,
            }}
          >
            {label}
          </div>
          <div style={{ fontSize: 14, color: 'var(--color-text-primary)' }}>{value ?? '—'}</div>
        </div>
      ))}
    </div>
  );

  const ActionBtn = ({
    label,
    onClick,
    loading,
    variant = 'primary',
    disabled = false,
  }: {
    label: string;
    onClick: () => void;
    loading?: boolean;
    variant?: 'primary' | 'success' | 'danger' | 'ghost';
    disabled?: boolean;
  }) => {
    const bg: Record<string, string> = {
      primary: 'var(--color-background-info)',
      success: 'var(--color-background-success)',
      danger: 'var(--color-background-danger)',
      ghost: 'var(--color-background-secondary)',
    };
    const color: Record<string, string> = {
      primary: 'var(--color-text-info)',
      success: 'var(--color-text-success)',
      danger: 'var(--color-text-danger)',
      ghost: 'var(--color-text-primary)',
    };
    return (
      <button
        onClick={onClick}
        disabled={loading || disabled}
        style={{
          padding: '7px 16px',
          borderRadius: 8,
          border: 'none',
          cursor: loading || disabled ? 'not-allowed' : 'pointer',
          fontSize: 13,
          fontWeight: 500,
          background: bg[variant],
          color: color[variant],
          opacity: loading || disabled ? 0.5 : 1,
        }}
      >
        {loading ? '⏳ Memproses...' : label}
      </button>
    );
  };

  const FileLink = ({ url, label }: { url?: string; label: string }) => {
    if (!url) {
      return (
        <span style={{ fontSize: 12, color: 'var(--color-text-secondary)', fontStyle: 'italic' }}>
          {label}: belum diupload
        </span>
      );
    }
    const safeUrl = fixFileUrl(url); // FIX Issue 3/4/6/7: rewrite localhost URLs to API_HOST so ngrok/LAN clients can open files
    return (
      <a
        href={safeUrl}
        target="_blank"
        rel="noreferrer"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          color: 'var(--color-text-info)',
          fontSize: 13,
          textDecoration: 'none',
        }}
      >
        <Download style={{ width: 13, height: 13 }} />
        {label}
      </a>
    );
  };

  const ApprovalStatusBar = ({
    steps,
  }: {
    steps: { label: string; status: 'done' | 'active' | 'pending' | 'rejected' }[];
  }) => {
    const colors = { done: '#00D4B4', active: '#F59E0B', pending: '#9CA3AF', rejected: '#EF4444' };
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 0, margin: '12px 0' }}>
        {steps.map((step, i) => (
          <div key={step.label} style={{ display: 'flex', alignItems: 'center', flex: 1 }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 0 }}>
              <div
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: '50%',
                  background: `${colors[step.status]}20`,
                  border: `1.5px solid ${colors[step.status]}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 11,
                  color: colors[step.status],
                  fontWeight: 600,
                }}
              >
                {step.status === 'done' ? '✓' : step.status === 'rejected' ? '✗' : i + 1}
              </div>
              <span style={{ fontSize: 10, color: colors[step.status], marginTop: 3, whiteSpace: 'nowrap' }}>
                {step.label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div
                style={{
                  flex: 1,
                  height: 1.5,
                  background: step.status === 'done' ? '#00D4B4' : '#E5E7EB',
                  margin: '0 4px',
                  marginBottom: 14,
                }}
              />
            )}
          </div>
        ))}
      </div>
    );
  };

  const ProgressBar = ({ currentPhase }: { currentPhase: string }) => {
    const idx = PHASE_ORDER.indexOf(currentPhase as any);
    const pct = Math.round((idx / (PHASE_ORDER.length - 1)) * 100);
    return (
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 5 }}>
          <span style={{ color: 'var(--color-text-secondary)' }}>
            Fase {idx + 1} dari 20 - {PHASE_LABELS[currentPhase as any] || currentPhase}
          </span>
          <span style={{ fontWeight: 500, color: currentPhase === 'PERMIT_DONE' ? '#22C55E' : '#00D4B4' }}>
            {pct}% selesai
          </span>
        </div>
        <div style={{ height: 6, background: 'var(--color-background-secondary)', borderRadius: 3, overflow: 'hidden' }}>
          <div
            style={{
              height: '100%',
              width: `${pct}%`,
              background: currentPhase === 'PERMIT_DONE' ? '#22C55E' : '#00D4B4',
              borderRadius: 3,
              transition: 'width 500ms',
            }}
          />
        </div>
        <div style={{ display: 'flex', gap: 2, marginTop: 3 }}>
          {PHASE_ORDER.map((p, i) => (
            <div
              key={p}
              style={{
                flex: 1,
                height: 2,
                borderRadius: 1,
                background: i < idx ? '#00D4B4' : i === idx ? '#F59E0B' : 'var(--color-background-secondary)',
              }}
            />
          ))}
        </div>
      </div>
    );
  };

  // FIX: "Isi/Update Data" navigation button used by survey phases (no inline form = no focus loss)
  const navigateBtn = (label: string, href: string, filled: boolean) => (
    <button
      onClick={() => router.push(href)}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: '9px 18px',
        borderRadius: 8,
        border: 'none',
        background: 'var(--color-background-info)',
        color: 'var(--color-text-info)',
        cursor: 'pointer',
        fontSize: 13,
        fontWeight: 500,
        alignSelf: 'flex-start',
      }}
    >
      {filled ? '✏ ' : '📝 '}{label}
    </button>
  );

  // FIX: summary chip — shows green checkmark summary when data already saved
  const summaryChip = (text: string) => (
    <div
      style={{
        padding: '10px 14px',
        borderRadius: 8,
        background: 'var(--color-background-success)',
        border: '0.5px solid var(--color-border-success)',
      }}
    >
      <div style={{ fontSize: 12, color: 'var(--color-text-success)', fontWeight: 500, marginBottom: 4 }}>
        ✓ Data sudah diisi
      </div>
      <div style={{ fontSize: 13, color: 'var(--color-text-primary)' }}>{text}</div>
    </div>
  );

  // FIX: renderPhaseContent is a plain function returning JSX — NOT a React component.
  // Calling it as `{renderPhaseContent(phase)}` avoids the new-function-reference-on-every-render
  // unmount/remount cycle that was causing input focus loss.
  function renderPhaseContent(phase: string) {
    switch (phase) {
      case 'CLUSTER_INTAKE':
        return (
          <InfoGrid
            items={[
              { label: 'Kode Cluster', value: cluster?.clusterCode },
              { label: 'ISP Customer', value: cluster?.ispCustomer },
              { label: 'Fiber Type', value: cluster?.fiberType },
              { label: 'Homepass Plan', value: cluster?.visitRequest?.cleanList?.homepasCount },
              { label: 'Kelurahan', value: cluster?.visitRequest?.cleanList?.kelurahan },
              { label: 'Kota', value: cluster?.visitRequest?.cleanList?.kotaKabupaten },
              { label: 'Koordinat', value: cluster?.visitRequest?.cleanList?.coordinates },
            ]}
          />
        );

      case 'VISIT_REQUEST':
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <InfoGrid
              items={[
                { label: 'Status', value: cluster?.visitRequest?.status },
                {
                  label: 'Tanggal',
                  value: cluster?.visitRequest?.visitDate
                    ? new Date(cluster.visitRequest.visitDate).toLocaleDateString('id-ID', {
                        weekday: 'long',
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                      })
                    : '—',
                },
                { label: 'Surveyor', value: cluster?.visitRequest?.requester?.name },
                { label: 'Respon Stakeholder', value: cluster?.visitRequest?.stakeholderResponse },
                { label: 'Catatan', value: cluster?.visitRequest?.surveyNotes },
              ]}
            />
          </div>
        );

      case 'BA_OPEN':
        if (cluster?.baOpen) {
          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <InfoGrid
                items={[
                  { label: 'Nomor Dokumen', value: (cluster.baOpen as BaOpen).documentNumber },
                  {
                    label: 'Hari/Tanggal',
                    value: cluster.baOpen.tanggal
                      ? new Date(cluster.baOpen.tanggal).toLocaleDateString('id-ID', {
                          weekday: 'long',
                          year: 'numeric',
                          month: 'long',
                          day: 'numeric',
                        })
                      : '—',
                  },
                  { label: 'Tempat', value: cluster.baOpen.tempat },
                  { label: 'Topik', value: cluster.baOpen.topik },
                  { label: 'Description', value: cluster.baOpen.description },
                ]}
              />
              <FileLink url={cluster.baOpen.pdfUrl} label="Download BA Open PDF" />
            </div>
          );
        }
        if (!isSurveyorOrPM) {
          return <div style={{ color: 'var(--color-text-secondary)', fontSize: 13 }}>BA Open belum dibuat</div>;
        }
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', margin: 0 }}>
              Isi form berikut untuk membuat Berita Acara Open Cluster
            </p>
            {[
              { label: 'Hari / Tanggal *', key: 'tanggal', type: 'datetime-local' },
              { label: 'Tempat *', key: 'tempat', type: 'text', placeholder: 'Contoh: Balai RW 08, Jl. Cihideung Udik' },
              { label: 'Berita Acara / Topik *', key: 'topik', type: 'text', placeholder: 'Sosialisasi pemasangan fiber optik...' },
            ].map((field) => (
              <div key={field.key}>
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
                  type={field.type}
                  value={(baOpenForm as any)[field.key]}
                  onChange={(e) => setBaOpenForm((prev) => ({ ...prev, [field.key]: e.target.value }))}
                  placeholder={(field as any).placeholder}
                  style={{ width: '100%', boxSizing: 'border-box' }}
                />
              </div>
            ))}
            <div>
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
                Issues / Description *
              </label>
              <textarea
                value={baOpenForm.description}
                rows={4}
                onChange={(e) => setBaOpenForm((prev) => ({ ...prev, description: e.target.value }))}
                placeholder="Uraikan hasil diskusi, isu yang ditemukan, dan kesepakatan..."
                style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical' }}
              />
            </div>
            <ActionBtn
              label="Buat BA Open"
              loading={actionLoading === 'ba-open'}
              disabled={!baOpenForm.tanggal || !baOpenForm.tempat || !baOpenForm.topik || !baOpenForm.description}
              onClick={() => doAction('ba-open', () => apiPost('/ba-open', {
                visitRequestId: cluster?.visitRequest?.id,
                tanggal: new Date(baOpenForm.tanggal).toISOString(),
                tempat: baOpenForm.tempat,
                topik: baOpenForm.topik,
                description: baOpenForm.description,
              }))}
            />
          </div>
        );

      case 'SITE_VISIT': { // FIX: inline form removed — navigation to /site-visit sub-page
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {surveyData?.rwName && summaryChip(
              `RW: ${surveyData.rwName}${surveyData.rtName ? ` · RT: ${surveyData.rtName}` : ''}${surveyData.pengelolaName ? ` · Pengelola: ${surveyData.pengelolaName}` : ''}`,
            )}
            {isSurveyorOrPM
              ? navigateBtn(
                surveyData?.rwName ? 'Update Data Kunjungan' : 'Isi Data Kunjungan',
                `/permit-clusters/${clusterId}/site-visit`,
                !!surveyData?.rwName,
              )
              : (
                <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', fontStyle: 'italic', margin: 0 }}>
                  Data kunjungan diisi oleh Surveyor / PM lapangan.
                </p>
              )}
          </div>
        );
      }

      case 'SURVEY_INPUT': { // FIX: inline form + evidence uploader removed — two nav buttons
        const hasInput = !!(surveyData?.areaCondition || surveyData?.accessDifficulty || surveyData?.surveyNotes);
        const hasEvidence = surveyEvidences.length > 0;
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {hasInput && summaryChip(
              `Akses: ${surveyData?.accessDifficulty || '—'}${surveyData?.areaCondition ? ` · ${surveyData.areaCondition.slice(0, 80)}` : ''}`,
            )}
            {hasEvidence && (
              <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
                📷 {surveyEvidences.length} foto evidence tersimpan
              </div>
            )}
            {isSurveyorOrPM && (
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {navigateBtn(
                  hasInput ? 'Update Data Survey' : 'Isi Data Survey',
                  `/permit-clusters/${clusterId}/survey-input`,
                  hasInput,
                )}
                {navigateBtn(
                  hasEvidence ? 'Kelola Foto Evidence' : 'Upload Foto Evidence',
                  `/permit-clusters/${clusterId}/evidence`,
                  hasEvidence,
                )}
              </div>
            )}
            {!isSurveyorOrPM && !hasInput && (
              <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', fontStyle: 'italic', margin: 0 }}>
                Data survey diisi oleh Surveyor / PM lapangan.
              </p>
            )}
          </div>
        );
      }

      case 'ROUTE_SURVEY': { // FIX: inline form removed — navigation to /route-survey sub-page
        const hasRoute = !!(surveyData?.homepasCount || surveyData?.routeDistanceM || surveyData?.routeGeoJson);
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {hasRoute && summaryChip(
              `Homepass: ${surveyData?.homepasCount ?? '—'} · Jarak: ${surveyData?.routeDistanceM ? `${surveyData.routeDistanceM} m` : '—'}`,
            )}
            {isSurveyorOrPM
              ? navigateBtn(
                hasRoute ? 'Update Route Survey' : 'Isi Route Survey',
                `/permit-clusters/${clusterId}/route-survey`,
                hasRoute,
              )
              : (
                <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', fontStyle: 'italic', margin: 0 }}>
                  Route survey diisi oleh Surveyor / PM lapangan.
                </p>
              )}
          </div>
        );
      }

      case 'BA_SURVEY':
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {isSurveyor && (
              <div>
                <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 10 }}>Kelengkapan Dokumen</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {[
                    { key: 'hasBaOpen', label: 'BA Open sudah dibuat', done: docPackage?.hasBaOpen },
                    { key: 'hasSurveyData', label: 'Data survey lapangan sudah diisi', done: docPackage?.hasSurveyData },
                    { key: 'hasEvidencePhotos', label: 'Foto evidence sudah diupload (wajib)', done: docPackage?.hasEvidencePhotos },
                    { key: 'hasRouteData', label: 'Route survey sudah selesai', done: docPackage?.hasRouteData },
                  ].map((item) => (
                    <div
                      key={item.key}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        padding: '8px 12px',
                        borderRadius: 8,
                        background: item.done ? 'var(--color-background-success)' : 'var(--color-background-secondary)',
                        border: `0.5px solid ${item.done ? 'var(--color-border-success)' : 'var(--color-border-tertiary)'}`,
                      }}
                    >
                      <span style={{ fontSize: 16 }}>{item.done ? '✅' : '⬜'}</span>
                      <span style={{ fontSize: 13, color: 'var(--color-text-primary)' }}>{item.label}</span>
                    </div>
                  ))}
                </div>
                {docPackage?.status === 'PM_REJECTED' && (
                  <div
                    style={{
                      marginTop: 12,
                      padding: '10px 14px',
                      borderRadius: 8,
                      background: 'var(--color-background-danger)',
                      color: 'var(--color-text-danger)',
                      fontSize: 13,
                    }}
                  >
                    ❌ Ditolak oleh PM: {docPackage.pmNotes || 'Lihat catatan PM'}
                  </div>
                )}
                {(!docPackage || docPackage.status === 'ASSEMBLING' || docPackage.status === 'PM_REJECTED') && (
                  <ActionBtn
                    label="Submit Dokumen ke PM"
                    variant="primary"
                    loading={actionLoading === 'doc-submit'}
                    disabled={!docPackage?.hasBaOpen || !docPackage?.hasSurveyData || !docPackage?.hasEvidencePhotos || !docPackage?.hasRouteData}
                    onClick={() => doAction('doc-submit', () => apiPost(`/permit-clusters/${clusterId}/doc-package/submit`, {}))}
                  />
                )}
              </div>
            )}

            {isPM && docPackage?.status === 'SUBMITTED' && (
              <div style={{ border: '0.5px solid var(--color-border-tertiary)', borderRadius: 8, padding: 14 }}>
                <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 10 }}>Pengecekan Dokumen Surveyor</div>
                <InfoGrid
                  items={[
                    { label: 'BA Open', value: docPackage.hasBaOpen ? '✓ Ada' : '✗ Belum' },
                    { label: 'Data Survey', value: docPackage.hasSurveyData ? '✓ Ada' : '✗ Belum' },
                    { label: 'Foto Evidence', value: docPackage.hasEvidencePhotos ? '✓ Ada' : '✗ Belum' },
                    { label: 'Route Survey', value: docPackage.hasRouteData ? '✓ Ada' : '✗ Belum' },
                  ]}
                />
                <div style={{ marginTop: 12 }}>
                  <textarea
                    placeholder="Catatan (wajib untuk tolak)"
                    value={notesInput}
                    onChange={(e) => setNotesInput(e.target.value)}
                    rows={2}
                    style={{ width: '100%', boxSizing: 'border-box', marginBottom: 8, resize: 'none' }}
                  />
                  <div style={{ display: 'flex', gap: 8 }}>
                    <ActionBtn
                      label="✓ Setujui"
                      variant="success"
                      loading={actionLoading === 'pkg-pm-approve'}
                      onClick={() => doAction('pkg-pm-approve', () => apiPost(`/permit-clusters/${clusterId}/doc-package/pm-review`, { action: 'APPROVE' }))}
                    />
                    <ActionBtn
                      label="✗ Tolak"
                      variant="danger"
                      loading={actionLoading === 'pkg-pm-reject'}
                      disabled={!notesInput}
                      onClick={() => doAction('pkg-pm-reject', () => apiPost(`/permit-clusters/${clusterId}/doc-package/pm-review`, { action: 'REJECT', notes: notesInput }))}
                    />
                  </div>
                </div>
              </div>
            )}

            {isAdmin && docPackage?.status === 'PM_APPROVED' && (
              <div style={{ border: '0.5px solid var(--color-border-tertiary)', borderRadius: 8, padding: 14 }}>
                <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 10 }}>Pengecekan Final (Admin)</div>
                <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', margin: '0 0 12px' }}>
                  PM telah menyetujui. Lakukan pengecekan akhir sebelum lanjut ke SIP.
                </p>
                <div style={{ display: 'flex', gap: 8 }}>
                  <ActionBtn
                    label="✓ Setujui → Lanjut ke SIP"
                    variant="success"
                    loading={actionLoading === 'pkg-admin-approve'}
                    onClick={() => doAction('pkg-admin-approve', () => apiPost(`/permit-clusters/${clusterId}/doc-package/admin-review`, { action: 'APPROVE' }))}
                  />
                  <ActionBtn
                    label="✗ Tolak"
                    variant="danger"
                    loading={actionLoading === 'pkg-admin-reject'}
                    onClick={() => doAction('pkg-admin-reject', () => apiPost(`/permit-clusters/${clusterId}/doc-package/admin-review`, { action: 'REJECT', notes: notesInput || 'Dokumen tidak lengkap' }))}
                  />
                </div>
              </div>
            )}
          </div>
        );

      case 'SIP_REQUEST': { // FIX: inline SIP form replaced by navigation to /sip sub-page
        const sipApprovalSteps = [
          { label: 'Draft Admin', status: sip ? 'done' : 'active' },
          {
            label: 'Kirim ke ISP',
            status: !sip
              ? 'pending'
              : sip.status === 'SUBMITTED' || sip.status === 'UNDER_REVIEW'
                ? 'active'
                : sip.status === 'REJECTED' || sip.status === 'ISP_REVISION'
                  ? 'rejected'
                  : sip.status === 'DRAFT'
                    ? 'pending'
                    : 'done',
          },
          {
            label: 'ISP Approved',
            status: sip?.status === 'APPROVED'
              ? 'done'
              : sip?.status === 'REJECTED' || sip?.status === 'ISP_REVISION'
                ? 'rejected'
                : 'pending',
          },
        ] as any;

        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {sip && <ApprovalStatusBar steps={sipApprovalSteps} />}
            {sip && (
              <InfoGrid
                items={[
                  { label: 'Nomor SIP', value: sip.documentNumber },
                  { label: 'Status', value: sip.status },
                  { label: 'Site Name', value: sip.siteName },
                  { label: 'Koordinat', value: sip.coordinates },
                  { label: 'Tipe Hunian', value: sip.residenceType },
                  { label: 'Classing', value: sip.classing },
                  { label: 'Metode Kerja', value: sip.workMethod },
                  { label: 'Homepass', value: sip.homepasCount },
                  { label: 'Occupancy', value: sip.occupancyPercent ? `${sip.occupancyPercent}%` : '—' },
                  { label: 'Existing ISP', value: sip.existingCompetitors },
                  { label: 'PIC Kawasan', value: sip.picKawasan },
                  { label: 'Provinsi', value: sip.provinsi },
                  { label: 'Kota', value: sip.kota },
                  { label: 'Kecamatan', value: sip.kecamatan },
                  { label: 'Kelurahan', value: sip.kelurahan },
                ]}
              />
            )}
            {sip && (
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <FileLink url={sip.pdfUrl} label="Download SIP PDF" />
                <FileLink url={sip.boundaryKmzUrl} label="Download KMZ Boundary" />
              </div>
            )}

            {/* FIX: Admin / Surveyor / PM — akses form SIP (termasuk setelah REJECTED) */}
            {(isAdmin || isSurveyor || isPM) &&
              navigateBtn(
                sip ? 'Update Data SIP' : 'Isi Data SIP',
                `/permit-clusters/${clusterId}/sip`,
                !!sip,
              )}

            {isAdmin && (sip?.status === 'DRAFT' || sip?.status === 'ISP_REVISION' || sip?.status === 'REJECTED') && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <ActionBtn
                  label="Generate PDF SIP"
                  loading={actionLoading === 'sip-pdf'}
                  onClick={async () => {
                    setActionLoading('sip-pdf'); // FIX Issue 6/7: manual loading control to also reload SIP + auto-open PDF
                    try {
                      await apiPost(`/permit-clusters/${clusterId}/sip/${sip.id}/generate-pdf`, {}); // FIX Issue 6/7: generate PDF
                      const updatedSip = await apiGet<any>(`/permit-clusters/${clusterId}/sip`); // FIX Issue 6/7: reload SIP to pick up stored pdfUrl
                      setSip(updatedSip); // FIX Issue 6/7: refresh local state
                      if (updatedSip?.pdfUrl) {
                        toast.success('✅ PDF berhasil digenerate'); // FIX Issue 6/7: success toast + auto-open
                        if (typeof window !== 'undefined') {
                          window.open(fixFileUrl(updatedSip.pdfUrl), '_blank'); // FIX Issue 6/7: auto-open PDF via fixed URL
                        }
                      } else {
                        toast.success('PDF digenerate — klik Download untuk membuka'); // FIX Issue 6/7: graceful fallback
                      }
                      await fetchCluster(); // FIX Issue 6/7: refresh cluster state
                    } catch (err: any) {
                      toast.error(err?.message || 'Gagal generate PDF'); // FIX Issue 6/7: surface generation error
                    } finally {
                      setActionLoading(null);
                    }
                  }}
                />
                <ActionBtn
                  label="Submit ke ISP"
                  variant="success"
                  loading={actionLoading === 'sip-submit'}
                  onClick={() => doAction('sip-submit', () => apiPost(`/permit-clusters/${clusterId}/sip/${sip.id}/submit-to-isp`, {}))}
                />
              </div>
            )}
            {isAdmin && (sip?.status === 'SUBMITTED' || sip?.status === 'UNDER_REVIEW') && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
                  Catatan keputusan ISP (wajib untuk menolak):
                </div>
                <textarea
                  placeholder="Alasan penolakan / feedback dari ISP…"
                  value={notesInput}
                  onChange={(e) => setNotesInput(e.target.value)}
                  rows={3}
                  style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical', borderRadius: 8, padding: 10 }}
                />
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <ActionBtn
                    label="✓ ISP Approved"
                    variant="success"
                    loading={actionLoading === 'sip-isp-approve'}
                    onClick={() => doAction('sip-isp-approve', () => apiPost(`/permit-clusters/${clusterId}/sip/${sip!.id}/isp-decision`, { action: 'APPROVE' }))}
                  />
                  <ActionBtn
                    label="ISP Rejected"
                    variant="danger"
                    loading={actionLoading === 'sip-isp-reject'}
                    disabled={!notesInput.trim()}
                    onClick={() =>
                      doAction('sip-isp-reject', () =>
                        apiPost(`/permit-clusters/${clusterId}/sip/${sip!.id}/isp-decision`, {
                          action: 'REJECT',
                          feedback: notesInput.trim(),
                        }),
                      )
                    }
                  />
                </div>
              </div>
            )}
            {!sip && !isAdmin && (
              <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', margin: 0 }}>Menunggu Admin membuat SIP</p>
            )}
          </div>
        );
      }

      case 'HLD_SUBMISSION': {
        const hldSteps = [
          { label: 'Draft', status: !hld ? 'active' : 'done' },
          { label: 'PM Review', status: !hld ? 'pending' : hld.status === 'SUBMITTED_FOR_REVIEW' ? 'active' : hld.status === 'PM_REJECTED' ? 'rejected' : ['PM_APPROVED', 'ADMIN_APPROVED', 'ADMIN_REJECTED', 'PENDING_ISP', 'ISP_REVISION', 'ISP_APPROVED'].includes(hld.status) ? 'done' : 'pending' },
          { label: 'Admin Review', status: hld?.status === 'PM_APPROVED' ? 'active' : hld?.status === 'ADMIN_REJECTED' ? 'rejected' : ['ADMIN_APPROVED', 'PENDING_ISP', 'ISP_REVISION', 'ISP_APPROVED'].includes(hld?.status || '') ? 'done' : 'pending' },
          { label: 'ISP Pending', status: hld?.status === 'PENDING_ISP' ? 'active' : hld?.status === 'ISP_REVISION' ? 'rejected' : hld?.status === 'ISP_APPROVED' ? 'done' : 'pending' },
          { label: 'ISP Approved', status: hld?.status === 'ISP_APPROVED' ? 'done' : 'pending' },
        ] as any;
        const slaStatus = hld?.slaDeadline
          ? (() => {
              const diff = new Date(hld.slaDeadline).getTime() - Date.now();
              const days = Math.ceil(diff / 86400000);
              return { days, breached: days < 0 };
            })()
          : null;

        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <ApprovalStatusBar steps={hldSteps} />
            {slaStatus && (
              <div
                style={{
                  padding: '6px 12px',
                  borderRadius: 8,
                  fontSize: 12,
                  fontWeight: 500,
                  background: slaStatus.breached ? 'var(--color-background-danger)' : 'var(--color-background-warning)',
                  color: slaStatus.breached ? 'var(--color-text-danger)' : 'var(--color-text-warning)',
                }}
              >
                {slaStatus.breached ? `⚠ SLA TERLEWAT ${Math.abs(slaStatus.days)} hari` : `⏰ SLA: ${slaStatus.days} hari tersisa (deadline 1 minggu)`}
              </div>
            )}
            {/* FIX 3: navigate to dedicated /hld upload page */}
            {(isDesigner || isPM || isAdmin) && navigateBtn( // FIX Issue 10: designer can upload/update HLD
              hld ? '📋 Lihat / Update HLD' : '⬆️ Upload HLD (KMZ + BOQ)',
              `/permit-clusters/${clusterId}/hld`,
              !!hld,
            )}
            {hld ? (
              <>
                <InfoGrid
                  items={[
                    { label: 'Status', value: hld.status },
                    { label: 'Versi', value: `v${hld.version}` },
                    { label: 'ISP Feedback', value: hld.ispFeedback },
                  ]}
                />
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  <FileLink url={hld.kmzFileUrl} label="KMZ File" />
                  <FileLink url={hld.boqFileUrl} label="BOQ File" />
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {isPM && hld.status === 'SUBMITTED_FOR_REVIEW' && (
                    <>
                      <ActionBtn
                        label="✓ Setujui HLD"
                        variant="success"
                        loading={actionLoading === 'hld-pm-approve'}
                        onClick={() => doAction('hld-pm-approve', () => apiPost(`/permit-clusters/${clusterId}/hld/${hld.id}/pm-approve`, {}))}
                      />
                      <ActionBtn
                        label="✗ Tolak"
                        variant="danger"
                        loading={actionLoading === 'hld-pm-reject'}
                        onClick={() => doAction('hld-pm-reject', () => apiPost(`/permit-clusters/${clusterId}/hld/${hld.id}/pm-reject`, { notes: notesInput }))}
                      />
                    </>
                  )}
                  {isAdmin && hld.status === 'PM_APPROVED' && (
                    <>
                      <ActionBtn
                        label="✓ Setujui (ke ISP)"
                        variant="success"
                        loading={actionLoading === 'hld-admin-approve'}
                        onClick={() => doAction('hld-admin-approve', () => apiPost(`/permit-clusters/${clusterId}/hld/${hld.id}/admin-approve`, {}))}
                      />
                      <ActionBtn
                        label="✗ Tolak"
                        variant="danger"
                        loading={actionLoading === 'hld-admin-reject'}
                        onClick={() => doAction('hld-admin-reject', () => apiPost(`/permit-clusters/${clusterId}/hld/${hld.id}/admin-reject`, { notes: notesInput }))}
                      />
                    </>
                  )}
                  {isAdmin && hld.status === 'PENDING_ISP' && (
                    <>
                      <ActionBtn
                        label="✓ ISP Setujui"
                        variant="success"
                        loading={actionLoading === 'hld-isp-approve'}
                        onClick={() => doAction('hld-isp-approve', () => apiPost(`/permit-clusters/${clusterId}/hld/${hld.id}/isp-decision`, { action: 'APPROVE' }))}
                      />
                      <ActionBtn
                        label="↺ ISP Minta Revisi"
                        variant="ghost"
                        loading={actionLoading === 'hld-isp-revise'}
                        onClick={() => doAction('hld-isp-revise', () => apiPost(`/permit-clusters/${clusterId}/hld/${hld.id}/isp-decision`, { action: 'REVISE', notes: notesInput }))}
                      />
                    </>
                  )}
                </div>
              </>
            ) : (
              <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', margin: 0 }}>
                {isPM ? 'Upload HLD (KMZ + BOQ) untuk memulai.' : 'HLD belum diupload oleh Design Team / PM.'}
              </p>
            )}
            <textarea
              placeholder="Catatan untuk approval/rejection (isi jika perlu)"
              rows={2}
              value={notesInput}
              onChange={(e) => setNotesInput(e.target.value)}
              style={{ width: '100%', boxSizing: 'border-box', resize: 'none', fontSize: 13 }}
            />
          </div>
        );
      }

      case 'LLD_SUBMISSION': {
        // FIX Fix 1: 5-step approval chain — Designer Upload → PM Review → Admin Review → ISP Pending → ISP Approved
        const lldSteps = [
          { label: 'Designer Upload', status: !lld ? 'active' : 'done' }, // FIX Fix 1: first step is Designer upload (not generic Draft)
          { label: 'PM Review', status: !lld ? 'pending' : lld.status === 'SUBMITTED_FOR_REVIEW' ? 'active' : lld.status === 'PM_REJECTED' ? 'rejected' : ['PM_APPROVED', 'ADMIN_APPROVED', 'PENDING_ISP', 'ISP_REVISION', 'ISP_APPROVED'].includes(lld.status) ? 'done' : 'pending' },
          { label: 'Admin Review', status: lld?.status === 'PM_APPROVED' ? 'active' : lld?.status === 'ADMIN_REJECTED' ? 'rejected' : ['ADMIN_APPROVED', 'PENDING_ISP', 'ISP_REVISION', 'ISP_APPROVED'].includes(lld?.status || '') ? 'done' : 'pending' },
          { label: 'ISP Pending', status: lld?.status === 'PENDING_ISP' ? 'active' : lld?.status === 'ISP_REVISION' ? 'rejected' : lld?.status === 'ISP_APPROVED' ? 'done' : 'pending' },
          { label: 'ISP Approved', status: lld?.status === 'ISP_APPROVED' ? 'done' : 'pending' },
        ] as any;

        // FIX Fix 1: Designer is the PRIMARY uploader; PM/Admin are fallback uploaders per spec
        const canUploadLLD = isDesigner || isPM || isAdmin;

        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <ApprovalStatusBar steps={lldSteps} />
            {lld && ( // FIX Fix 1: status banner — human-readable, no raw enum
              <div
                style={{
                  padding: '8px 14px',
                  borderRadius: 8,
                  background: 'var(--color-background-secondary)',
                  fontSize: 13,
                }}
              >
                Status: <strong>{String(lld.status).replace(/_/g, ' ')}</strong>
                {` · v${lld.version || 1}`}
              </div>
            )}
            {canUploadLLD && navigateBtn( // FIX Fix 1: deep-link to /lld for Designer-led upload flow
              lld ? '📋 Lihat / Update LLD' : '⬆️ Upload LLD (APD + Schematic + Core)',
              `/permit-clusters/${clusterId}/lld`,
              !!lld,
            )}
            {lld ? (
              <>
                <InfoGrid
                  items={[
                    { label: 'Status', value: String(lld.status).replace(/_/g, ' ') }, // FIX Fix 1: humanize enum in grid
                    { label: 'Versi', value: `v${lld.version}` },
                    { label: 'ISP Feedback', value: lld.ispFeedback },
                  ]}
                />
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  <FileLink url={lld.apdFileUrl} label="APD File" />
                  <FileLink url={lld.schematicFileUrl} label="Schematic" />
                  <FileLink url={lld.coreConnectionUrl} label="Core Connection" />
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {isPM && lld.status === 'SUBMITTED_FOR_REVIEW' && ( // FIX Fix 1: PM approves Designer's submission
                    <>
                      <ActionBtn
                        label="✓ Setujui LLD → Teruskan ke Admin"
                        variant="success"
                        loading={actionLoading === 'lld-pm-approve'}
                        onClick={() => doAction('lld-pm-approve', () => apiPost(`/permit-clusters/${clusterId}/lld/${lld.id}/pm-approve`, {}))}
                      />
                      <ActionBtn
                        label="✗ Tolak"
                        variant="danger"
                        loading={actionLoading === 'lld-pm-reject'}
                        onClick={() => doAction('lld-pm-reject', () => apiPost(`/permit-clusters/${clusterId}/lld/${lld.id}/pm-reject`, { notes: notesInput }))}
                      />
                    </>
                  )}
                  {isAdmin && lld.status === 'PM_APPROVED' && ( // FIX Fix 1: Admin ships PM-approved LLD to ISP
                    <ActionBtn
                      label="✓ Setujui (kirim ke ISP)"
                      variant="success"
                      loading={actionLoading === 'lld-admin-approve'}
                      onClick={() => doAction('lld-admin-approve', () => apiPost(`/permit-clusters/${clusterId}/lld/${lld.id}/admin-approve`, {}))}
                    />
                  )}
                  {isAdmin && lld.status === 'PENDING_ISP' && (
                    <>
                      <ActionBtn
                        label="✓ ISP Setujui"
                        variant="success"
                        loading={actionLoading === 'lld-isp-approve'}
                        onClick={() => doAction('lld-isp-approve', () => apiPost(`/permit-clusters/${clusterId}/lld/${lld.id}/isp-decision`, { action: 'APPROVE' }))}
                      />
                      <ActionBtn
                        label="↺ ISP Minta Revisi"
                        variant="ghost"
                        loading={actionLoading === 'lld-isp-revise'}
                        onClick={() => doAction('lld-isp-revise', () => apiPost(`/permit-clusters/${clusterId}/lld/${lld.id}/isp-decision`, { action: 'REVISE', notes: notesInput }))}
                      />
                    </>
                  )}
                </div>
              </>
            ) : (
              <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', margin: 0 }}>
                {/* FIX Fix 1: role-aware CTA copy */}
                {isDesigner ? 'Upload LLD (APD + Schematic + Core Connection) untuk memulai review PM.' : 'LLD belum diupload oleh Design Team.'}
              </p>
            )}
            <textarea
              placeholder="Catatan approval / revisi..."
              rows={2}
              value={notesInput}
              onChange={(e) => setNotesInput(e.target.value)}
              style={{ width: '100%', boxSizing: 'border-box', resize: 'none', fontSize: 13 }}
            />
          </div>
        );
      }

      // FIX PR/BR→PO flow: PR/BR upload + Admin review — single workflow row per cluster
      case 'PR_BR_ISSUANCE': {
        if (workflowLoading) {
          return (
            <div
              style={{
                padding: '20px',
                textAlign: 'center',
                color: 'var(--color-text-secondary)',
                fontSize: 13,
              }}
            >
              ⏳ Menginisialisasi workflow PR/BR... {/* FIX: visible feedback during fetch + auto-init */}
            </div>
          );
        }

        if (!workflow) {
          return (
            <div
              style={{
                padding: '20px 24px',
                borderRadius: 12,
                background: 'var(--color-background-secondary)',
                border: '0.5px solid var(--color-border-tertiary)',
                textAlign: 'center',
              }}
            >
              <div style={{ fontSize: 32, marginBottom: 12 }}>📄</div>
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 600,
                  color: 'var(--color-text-primary)',
                  marginBottom: 6,
                }}
              >
                Workflow PR/BR Belum Diinisialisasi {/* FIX: row missing — upload would 404 without init */}
              </div>
              <div
                style={{
                  fontSize: 13,
                  color: 'var(--color-text-secondary)',
                  marginBottom: 16,
                }}
              >
                Klik tombol di bawah untuk memulai proses upload PR/BR {/* FIX */}
              </div>
              <button
                type="button"
                onClick={async () => {
                  try {
                    await apiPost(`/permit-clusters/${clusterId}/contract/init`, {}); // FIX: recovery path
                    await fetchContract('PR_BR_ISSUANCE'); // FIX: refresh workflow state
                    toast.success('Workflow PR/BR berhasil diinisialisasi');
                  } catch (err: unknown) {
                    const msg = err instanceof Error ? err.message : 'Gagal inisialisasi';
                    toast.error(msg); // FIX
                  }
                }}
                style={{
                  padding: '10px 24px',
                  borderRadius: 10,
                  border: 'none',
                  background: '#00D4B4',
                  color: 'white',
                  cursor: 'pointer',
                  fontSize: 14,
                  fontWeight: 600,
                }}
              >
                🚀 Mulai Proses PR/BR {/* FIX */}
              </button>
            </div>
          );
        }

        const isPMOrAdmin = isPM || isAdmin; // FIX PR/BR→PO flow: PM or Admin can upload PR/BR
        const status = workflow?.status;

        // FIX PR/BR→PO flow: 5-step chain indicator for the whole PR/BR→PO journey
        const chainStatus = (s: typeof status): { prbr: 'done' | 'active' | 'pending' | 'rejected'; admin: 'done' | 'active' | 'pending' | 'rejected'; po: 'done' | 'active' | 'pending' | 'rejected'; ops: 'done' | 'active' | 'pending' | 'rejected' } => {
          if (!s || s === 'PENDING_UPLOAD') return { prbr: 'active', admin: 'pending', po: 'pending', ops: 'pending' };
          if (s === 'UPLOADED')             return { prbr: 'done',   admin: 'active',  po: 'pending', ops: 'pending' };
          if (s === 'ADMIN_REJECTED')       return { prbr: 'rejected', admin: 'rejected', po: 'pending', ops: 'pending' };
          return { prbr: 'done', admin: 'done', po: 'pending', ops: 'pending' };
        };
        const cs = chainStatus(status);
        const prBrChainSteps: { label: string; status: 'done' | 'active' | 'pending' | 'rejected' }[] = [
          { label: 'Upload PR/BR', status: cs.prbr },
          { label: 'Review Admin', status: cs.admin },
          { label: 'Buat PO',      status: cs.po },
          { label: 'Setujui Ops',  status: cs.ops },
        ];

        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <ApprovalStatusBar steps={prBrChainSteps} />

            {/* FIX PR/BR→PO flow: status banner in plain Indonesian */}
            <div style={{
              padding: '14px 18px', borderRadius: 10,
              background: status === 'ADMIN_REJECTED' ? '#EF444415' : '#F59E0B15',
              border: `0.5px solid ${status === 'ADMIN_REJECTED' ? '#EF444440' : '#F59E0B40'}`,
            }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: status === 'ADMIN_REJECTED' ? '#EF4444' : '#F59E0B' }}>
                {(!status || status === 'PENDING_UPLOAD') && '📄 Menunggu Upload PR/BR dari ISP'}
                {status === 'UPLOADED'       && '⏳ Menunggu Review Admin'}
                {status === 'ADMIN_REJECTED' && '❌ PR/BR Ditolak — Perlu Upload Ulang'}
                {status === 'ADMIN_APPROVED' && '✅ PR/BR Disetujui — Admin Membuat PO'}
              </div>
              {workflow?.adminNotes && status === 'ADMIN_REJECTED' && (
                <div style={{ fontSize: 13, marginTop: 6, color: 'var(--color-text-secondary)' }}>
                  Catatan Admin: {workflow.adminNotes}
                </div>
              )}
            </div>

            {/* FIX PR/BR→PO flow: PM/Admin upload form — shown while PENDING_UPLOAD or after rejection */}
            {isPMOrAdmin && (!status || status === 'PENDING_UPLOAD' || status === 'ADMIN_REJECTED') && (
              <PrBrUploadForm
                clusterId={clusterId}
                onSuccess={() => void fetchCluster()}
              />
            )}

            {/* FIX PR/BR→PO flow: Admin review panel — only when PR/BR is uploaded */}
            {isAdmin && status === 'UPLOADED' && workflow && (
              <AdminPrBrReview
                clusterId={clusterId}
                workflow={workflow}
                onSuccess={() => void fetchCluster()}
              />
            )}

            {/* FIX PR/BR→PO flow: expose uploaded files for everyone */}
            {(workflow?.prFileUrl || workflow?.brFileUrl) && (
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {workflow?.prFileUrl && (
                  <a href={fixFileUrl(workflow.prFileUrl)} target="_blank" rel="noreferrer"
                     style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 8, fontSize: 13, background: '#3B82F615', color: '#3B82F6', textDecoration: 'none' }}>
                    📄 Download PR
                  </a>
                )}
                {workflow?.brFileUrl && (
                  <a href={fixFileUrl(workflow.brFileUrl)} target="_blank" rel="noreferrer"
                     style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 8, fontSize: 13, background: '#8B5CF615', color: '#8B5CF6', textDecoration: 'none' }}>
                    📄 Download BR
                  </a>
                )}
              </div>
            )}

            {/* FIX PR/BR→PO flow: legacy PrBrRecord list (shown only if legacy records exist) */}
            {prBr.length > 0 && (
              <div style={{ marginTop: 6 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
                  Legacy PR/BR Records
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <tbody>
                    {prBr.map((doc) => (
                      <tr key={doc.id} style={{ borderBottom: '0.5px solid var(--color-border-tertiary)' }}>
                        <td style={{ padding: '6px 8px' }}>
                          <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 11, background: doc.type === 'PR' ? '#EFF6FF' : '#F5F3FF', color: doc.type === 'PR' ? '#1D4ED8' : '#6D28D9' }}>{doc.type}</span>
                        </td>
                        <td style={{ padding: '6px 8px' }}>{doc.documentNumber}</td>
                        <td style={{ padding: '6px 8px' }}>{doc.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      }

      // FIX PR/BR→PO flow: Admin creates PO → Ops Manager approves → phase advances to SKOM_BUDGET
      case 'CONTRACT_MANAGEMENT': {
        const isOps = user?.role === 'OPERATIONAL_MANAGER';
        const status = workflow?.status;

        const poChainSteps: { label: string; status: 'done' | 'active' | 'pending' | 'rejected' }[] = [
          { label: 'Upload PR/BR',   status: 'done' }, // FIX PR/BR→PO flow: by definition we're past PR/BR upload once in CONTRACT_MANAGEMENT
          { label: 'Review Admin',   status: 'done' },
          { label: 'Buat PO',        status: status === 'ADMIN_APPROVED' ? 'active' : status === 'OPS_REJECTED' ? 'rejected' : ['PO_CREATED','OPS_APPROVED'].includes(status || '') ? 'done' : 'pending' },
          { label: 'Setujui Ops',    status: status === 'PO_CREATED' ? 'active' : status === 'OPS_APPROVED' ? 'done' : status === 'OPS_REJECTED' ? 'rejected' : 'pending' },
        ];

        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <ApprovalStatusBar steps={poChainSteps} />

            <div style={{
              padding: '14px 18px', borderRadius: 10,
              background: status === 'OPS_REJECTED' ? '#EF444415' : '#3B82F615',
              border: `0.5px solid ${status === 'OPS_REJECTED' ? '#EF444440' : '#3B82F640'}`,
            }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: status === 'OPS_REJECTED' ? '#EF4444' : '#3B82F6' }}>
                {status === 'ADMIN_APPROVED' && '📑 Admin Perlu Membuat Dokumen PO'}
                {status === 'PO_CREATED'     && '⏳ PO Menunggu Persetujuan Ops Manager'}
                {status === 'OPS_REJECTED'   && '❌ PO Ditolak — Perlu Direvisi'}
                {status === 'OPS_APPROVED'   && '✅ PO Disetujui — Berlanjut ke SKOM'}
                {!status && '📑 Menunggu Data Kontrak'}
              </div>
              {workflow?.opsNotes && status === 'OPS_REJECTED' && (
                <div style={{ fontSize: 13, marginTop: 6, color: 'var(--color-text-secondary)' }}>
                  Catatan Ops: {workflow.opsNotes}
                </div>
              )}
            </div>

            {/* FIX PR/BR→PO flow: Admin creates PO (also available after Ops rejection) */}
            {isAdmin && (status === 'ADMIN_APPROVED' || status === 'OPS_REJECTED') && (
              <PoUploadForm
                clusterId={clusterId}
                onSuccess={() => void fetchCluster()}
              />
            )}

            {/* FIX PR/BR→PO flow: Ops reviews PO */}
            {isOps && status === 'PO_CREATED' && workflow && (
              <OpsPoReview
                clusterId={clusterId}
                workflow={workflow}
                onSuccess={() => void fetchCluster()}
              />
            )}

            {/* FIX PR/BR→PO flow: expose all three documents for everyone */}
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {workflow?.prFileUrl && (
                <a href={fixFileUrl(workflow.prFileUrl)} target="_blank" rel="noreferrer"
                   style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 8, fontSize: 13, background: '#3B82F615', color: '#3B82F6', textDecoration: 'none' }}>
                  📄 PR Document
                </a>
              )}
              {workflow?.brFileUrl && (
                <a href={fixFileUrl(workflow.brFileUrl)} target="_blank" rel="noreferrer"
                   style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 8, fontSize: 13, background: '#8B5CF615', color: '#8B5CF6', textDecoration: 'none' }}>
                  📄 BR Document
                </a>
              )}
              {workflow?.poFileUrl && (
                <a href={fixFileUrl(workflow.poFileUrl)} target="_blank" rel="noreferrer"
                   style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 8, fontSize: 13, background: '#22C55E15', color: '#22C55E', textDecoration: 'none' }}>
                  📑 PO Document
                </a>
              )}
            </div>
          </div>
        );
      }

      case 'SKOM_BUDGET':
      case 'MANAGEMENT_APPROVAL':
      case 'FUND_DISBURSEMENT': {
        const isOps = user?.role === 'OPERATIONAL_MANAGER';
        const isGM  = user?.role === 'GENERAL_MANAGER';

        // FIX: roles that cannot take action in SKOM phase
        const isReadOnly = !isPM && !isOps && !isGM && !isAdmin;

        // FIX: Status map — shown to ALL roles
        const statusInfoMap: Record<string, { label: string; color: string }> = {
          'DRAFT':                { label: 'PM sedang menyiapkan dokumen SKOM', color: '#6B7280' },
          'PENDING_OPS_APPROVAL': { label: 'Menunggu review Ops Manager', color: '#F59E0B' },
          'OPS_APPROVED':         { label: 'Disetujui Ops — menunggu GM', color: '#3B82F6' },
          'OPS_REJECTED':         { label: 'Ditolak Ops Manager — PM merevisi', color: '#EF4444' },
          'PENDING_GM_APPROVAL':  { label: 'Menunggu approval GM', color: '#8B5CF6' },
          'GM_APPROVED':          { label: 'Disetujui GM — Ops menjadwalkan pencairan', color: '#22C55E' },
          'GM_REJECTED':          { label: 'Ditolak GM — PM merevisi', color: '#EF4444' },
          'DISBURSED':            { label: 'Dana dicairkan — berlanjut ke pencairan', color: '#00D4B4' },
        };
        const currentSkomStatus = (skom?.status as string) || 'DRAFT';
        const statusInfo = statusInfoMap[currentSkomStatus] || statusInfoMap['DRAFT'];

        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Step indicator */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 0,
              padding: '10px 16px', borderRadius: 10,
              background: 'var(--color-background-secondary)',
              overflowX: 'auto',
            }}>
              {[
                { label: 'PM Upload Dokumen', done: !!skom && skom.status !== 'DRAFT', active: !skom || skom.status === 'DRAFT' || skom.status === 'OPS_REJECTED' || skom.status === 'GM_REJECTED' },
                { label: 'Ops Manager Review',
                  done: ['OPS_APPROVED','PENDING_GM_APPROVAL',
                         'GM_APPROVED','DISBURSED'].includes(skom?.status || ''),
                  active: skom?.status === 'PENDING_OPS_APPROVAL' },
                { label: 'GM Approval',
                  done: ['GM_APPROVED','DISBURSED'].includes(skom?.status || ''),
                  active: skom?.status === 'PENDING_GM_APPROVAL' },
                { label: 'Pencairan Dana',
                  done: skom?.status === 'DISBURSED',
                  active: skom?.status === 'GM_APPROVED' },
              ].map((step, i, arr) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{
                      width: 24, height: 24, borderRadius: '50%',
                      display: 'flex', alignItems: 'center',
                      justifyContent: 'center', fontSize: 10, fontWeight: 700,
                      background: step.done ? '#00D4B4'
                                : step.active ? '#F59E0B20' : 'transparent',
                      color: step.done ? 'white'
                           : step.active ? '#F59E0B' : 'var(--color-text-secondary)',
                      border: step.active ? '1.5px solid #F59E0B'
                            : step.done ? 'none'
                            : '1px solid var(--color-border-tertiary)',
                    }}>
                      {step.done ? '✓' : i + 1}
                    </div>
                    <span style={{
                      fontSize: 11, whiteSpace: 'nowrap',
                      fontWeight: step.active ? 600 : 400,
                      color: step.active ? 'var(--color-text-primary)'
                           : step.done ? '#00D4B4'
                           : 'var(--color-text-secondary)',
                    }}>
                      {step.label}
                    </span>
                  </div>
                  {i < arr.length - 1 && (
                    <div style={{
                      flex: 1, height: 1, margin: '0 6px',
                      background: step.done
                        ? '#00D4B4' : 'var(--color-border-tertiary)',
                    }} />
                  )}
                </div>
              ))}
            </div>

            {/* FIX: Status visible to ALL roles */}
            <div style={{
              padding: '12px 16px', borderRadius: 10,
              background: `${statusInfo.color}15`,
              border: `0.5px solid ${statusInfo.color}40`,
              display: 'flex', alignItems: 'center', gap: 10,
            }}>
              <div style={{
                width: 10, height: 10, borderRadius: '50%',
                background: statusInfo.color, flexShrink: 0,
              }} />
              <div>
                <div style={{ fontSize: 13, fontWeight: 600,
                              color: 'var(--color-text-primary)' }}>
                  SKOM Budget — {statusInfo.label}
                </div>
                {skom?.totalBudget && (
                  <div style={{ fontSize: 11,
                                color: 'var(--color-text-secondary)',
                                marginTop: 2 }}>
                    Anggaran: Rp {Number(skom.totalBudget).toLocaleString('id-ID')}
                  </div>
                )}
                {((skom as any)?.opsNotes || (skom as any)?.gmNotes) && (
                  <div style={{ fontSize: 12, marginTop: 4,
                                color: 'var(--color-text-secondary)' }}>
                    Catatan: {(skom as any).opsNotes || (skom as any).gmNotes}
                  </div>
                )}
              </div>
            </div>

            {/* FIX: Read-only info for Surveyor and other non-action roles */}
            {isReadOnly && (
              <div style={{
                padding: '12px 16px', borderRadius: 10,
                background: 'var(--color-background-secondary)',
                fontSize: 13, color: 'var(--color-text-secondary)',
                display: 'flex', alignItems: 'center', gap: 8,
              }}>
                <span>ℹ️</span>
                <span>
                  Fase ini dikelola oleh PM dan Ops Manager.
                  Anda akan mendapat notifikasi ketika pencairan dana selesai.
                </span>
              </div>
            )}

            {/* FIX: PM Upload Form — shown when DRAFT or REJECTED */}
            {isPM && (!skom ||
                      skom.status === 'DRAFT' ||
                      skom.status === 'OPS_REJECTED' ||
                      skom.status === 'GM_REJECTED') && (
              <SkomUploadForm
                clusterId={clusterId}
                skom={skom}
                onSuccess={() => void fetchCluster()}
              />
            )}

            {/* Ops Review */}
            {isOps && skom?.status === 'PENDING_OPS_APPROVAL' && (
              <SkomOpsReview
                clusterId={clusterId}
                skom={skom}
                onSuccess={() => void fetchCluster()}
              />
            )}

            {/* GM Approval */}
            {isGM && skom?.status === 'PENDING_GM_APPROVAL' && (
              <SkomGmApproval
                clusterId={clusterId}
                skom={skom}
                onSuccess={() => void fetchCluster()}
              />
            )}

            {/* FIX: Ops Manager fills disbursement schedule after GM_APPROVED */}
            {isOps && skom?.status === 'GM_APPROVED' && (
              <SkomDisbursementForm
                clusterId={clusterId}
                skom={skom}
                onSuccess={() => void fetchCluster()}
              />
            )}

            {/* FIX: after DISBURSED show compact success card — hide Mulai/Selesai/Total grid */}
            {skom?.status === 'DISBURSED' && (
              <div
                style={{
                  padding: '16px 20px',
                  borderRadius: 12,
                  background: '#22C55E15',
                  border: '0.5px solid #22C55E40',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 14,
                }}
              >
                <div
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: '50%',
                    background: '#22C55E20',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 22,
                    flexShrink: 0,
                  }}
                >
                  ✅
                </div>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#22C55E' }}>
                    Dana Berhasil Dicairkan
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: 'var(--color-text-secondary)',
                      marginTop: 2,
                    }}
                  >
                    Proses perizinan berlanjut ke fase BAK (fase 16). Semua pihak telah diberitahu.
                  </div>
                </div>
              </div>
            )}

            {/* Document links for all roles */}
            {skom && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {[
                  { url: (skom as any).budgetFileUrl, label: 'SKOM Budget', icon: '📊' },
                  { url: skom.rabFileUrl,    label: 'RAB',         icon: '📋' },
                  { url: skom.timelineFileUrl, label: 'Timeline',  icon: '📅' },
                  { url: skom.kurvaSFileUrl, label: 'Kurva-S',     icon: '📈' },
                ].filter(d => d.url).map(doc => (
                  <a key={doc.label} href={fixFileUrl(doc.url as string)}
                     target="_blank" rel="noreferrer"
                     style={{
                       display: 'inline-flex', alignItems: 'center', gap: 6,
                       padding: '7px 14px', borderRadius: 8, fontSize: 13,
                       background: '#3B82F615', color: '#3B82F6',
                       textDecoration: 'none',
                     }}>
                    {doc.icon} {doc.label}
                  </a>
                ))}
              </div>
            )}

            {skom && (
              <div style={{ marginTop: 12 }}>
                <InfoGrid
                  items={[
                    { label: 'Total Budget', value: `Rp ${Number((skom as any).budgetAmount || skom.totalBudget || 0).toLocaleString('id-ID')}` },
                    { label: 'Status', value: String(skom.status).replace(/_/g, ' ') },
                    { label: 'Mulai', value: skom.startDate ? new Date(skom.startDate).toLocaleDateString('id-ID') : '—' },
                    { label: 'Selesai', value: skom.endDate ? new Date(skom.endDate).toLocaleDateString('id-ID') : '—' },
                    { label: 'Total Dicairkan', value: skom.totalDisbursed ? `Rp ${Number(skom.totalDisbursed).toLocaleString('id-ID')}` : 'Rp 0' },
                  ]}
                />
              </div>
            )}
          </div>
        );
      }

      case 'BAK_GENERATION':
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <BakGenerationPhasePanel clusterId={clusterId} fetchCluster={fetchCluster} />
            {cluster?.bak && (
              <div
                style={{
                  padding: 12,
                  borderRadius: 10,
                  background: 'var(--color-background-secondary)',
                  border: '0.5px solid var(--color-border-tertiary)',
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, color: 'var(--color-text-secondary)' }}>
                  BAK Kompensasi (Finance)
                </div>
                <InfoGrid
                  items={[
                    { label: 'Nomor BAK', value: cluster.bak.documentNumber },
                    {
                      label: 'Nominal',
                      value: cluster.bak.finalAmount
                        ? `Rp ${Number(cluster.bak.finalAmount).toLocaleString('id-ID')}`
                        : '—',
                    },
                    { label: 'Status', value: cluster.bak.status },
                  ]}
                />
                <FileLink url={cluster.bak.pdfUrl} label="Download BAK PDF (kompensasi)" />
              </div>
            )}
            {cluster?.bakp && (
              <div style={{ marginTop: 8, paddingTop: 12, borderTop: '0.5px solid var(--color-border-tertiary)' }}>
                <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>BAKP</div>
                <InfoGrid
                  items={[
                    { label: 'Status BAKP', value: cluster.bakp.status },
                    {
                      label: 'Field Team Submit',
                      value: cluster.bakp.fieldTeamSubmittedAt
                        ? new Date(cluster.bakp.fieldTeamSubmittedAt).toLocaleDateString('id-ID')
                        : '—',
                    },
                    {
                      label: 'PM Approve',
                      value: cluster.bakp.pmBakpApprovedAt
                        ? new Date(cluster.bakp.pmBakpApprovedAt).toLocaleDateString('id-ID')
                        : '—',
                    },
                    {
                      label: 'Admin Approve',
                      value: cluster.bakp.adminBakpApprovedAt
                        ? new Date(cluster.bakp.adminBakpApprovedAt).toLocaleDateString('id-ID')
                        : '—',
                    },
                  ]}
                />
                <FileLink url={cluster.bakp.bundlePdfUrl} label="Download BAKP" />
              </div>
            )}
          </div>
        );

      case 'BAKP_COMPILATION':
        return <BakpCompilationPhasePanel clusterId={clusterId} userRole={user?.role || ''} />;

      case 'CLAIM_SUBMISSION':
        return <ClaimSubmissionPhasePanel clusterId={clusterId} userRole={user?.role || ''} />;

      case 'INVOICE_PACKAGE':
        return invoice ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <InfoGrid
              items={[
                { label: 'Nomor Invoice', value: invoice.invoiceNumber },
                { label: 'Jumlah', value: `Rp ${Number(invoice.amount).toLocaleString('id-ID')}` },
                { label: 'Status', value: invoice.status },
                { label: 'Dikirim ke Finance', value: invoice.submittedToFinanceAt ? new Date(invoice.submittedToFinanceAt).toLocaleDateString('id-ID') : '—' },
                { label: 'Dibayar', value: invoice.paidAt ? new Date(invoice.paidAt).toLocaleDateString('id-ID') : '—' },
                { label: 'Follow-up', value: `${invoice.followUpCount}x` },
              ]}
            />
            <FileLink url={invoice.invoicePdfUrl} label="Download Invoice PDF" />
          </div>
        ) : (
          <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', margin: 0 }}>Invoice belum digenerate.</p>
        );

      case 'PERMIT_DONE':
        return (
          <div
            style={{
              textAlign: 'center',
              padding: '28px 16px',
              background: 'linear-gradient(135deg, #F0FDF4, #ECFDF5)',
              borderRadius: 12,
            }}
          >
            <div style={{ fontSize: 52, marginBottom: 8 }}>🎉</div>
            <h3 style={{ fontSize: 20, fontWeight: 500, color: '#15803D', margin: '0 0 8px' }}>Permit Selesai!</h3>
            <p style={{ color: '#166534', fontSize: 14, margin: 0 }}>
              Semua tahapan perizinan telah berhasil diselesaikan.
            </p>
            {cluster?.readyForConstructionAt && (
              <p style={{ color: '#22C55E', fontSize: 13, marginTop: 8 }}>
                Selesai: {new Date(cluster.readyForConstructionAt).toLocaleDateString('id-ID', {
                  weekday: 'long',
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                })}
              </p>
            )}
          </div>
        );

      default:
        return (
          <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', fontStyle: 'italic', margin: 0 }}>
            Data fase ini belum tersedia
          </p>
        );
    }
  }

  // FIX: pure function (not component) so parent re-renders don't unmount/remount children
  function renderPhaseSection({
    phase,
    isActive,
    isCompleted,
    isFuture,
    isSkipped,
    isExpanded,
    onToggle,
  }: {
    phase: string;
    isActive: boolean;
    isCompleted: boolean;
    isFuture: boolean;
    isSkipped: boolean;
    isExpanded: boolean;
    onToggle: () => void;
  }) {
    const canExpand = (isActive || isCompleted) && !isSkipped;
    const phaseColor = PHASE_GROUP_COLOR[phase] || '#6B7280';

    return (
      <div
        key={phase}
        id={`phase-${phase}`}
        style={{
          background: 'var(--color-background-primary)',
          border: `0.5px solid ${
            isSkipped
              ? '#9CA3AF40'
              : isActive
                ? '#F59E0B60'
                : isCompleted
                  ? '#00D4B440'
                  : 'var(--color-border-tertiary)'
          }`,
          borderLeft: isSkipped ? '3px solid #9CA3AF' : isActive ? '3px solid #F59E0B' : isCompleted ? '3px solid #00D4B4' : '3px solid transparent',
          borderRadius: 'var(--border-radius-lg)',
          overflow: 'hidden',
          opacity: isSkipped ? 0.75 : isFuture ? 0.55 : 1,
          transition: 'opacity 200ms',
        }}
      >
        <div
          onClick={canExpand ? onToggle : undefined}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '11px 16px',
            cursor: canExpand ? 'pointer' : 'default',
            background: isActive ? 'rgba(245,158,11,0.03)' : 'transparent',
          }}
        >
          <div
            style={{
              width: 26,
              height: 26,
              borderRadius: '50%',
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: isSkipped ? '#9CA3AF18' : isCompleted ? '#00D4B418' : isActive ? '#F59E0B18' : '#F3F4F6',
              color: isSkipped ? '#6B7280' : isCompleted ? '#00D4B4' : isActive ? '#F59E0B' : '#9CA3AF',
              fontSize: 11,
              fontWeight: 600,
              border: `1px solid ${isSkipped ? '#9CA3AF40' : isCompleted ? '#00D4B440' : isActive ? '#F59E0B40' : '#E5E7EB'}`,
              boxShadow: isActive ? `0 0 0 2px ${phaseColor}12` : 'none',
            }}
          >
            {isSkipped ? '⤼' : isCompleted ? '✓' : isFuture ? <Lock style={{ width: 10, height: 10 }} /> : '●'}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--color-text-primary)', lineHeight: 1.3 }}>
              {PHASE_LABELS[phase as any] || phase}
            </div>
            <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginTop: 1 }}>
              {isSkipped ? 'Tidak diperlukan (selesai via BAKP ISP)' : isCompleted ? 'Selesai' : isActive ? 'Tahap aktif sekarang' : 'Belum dimulai'}
            </div>
          </div>
          {isActive && (
            <span
              style={{
                padding: '2px 8px',
                borderRadius: 20,
                fontSize: 10,
                fontWeight: 600,
                background: '#F59E0B18',
                color: '#F59E0B',
              }}
            >
              AKTIF
            </span>
          )}
          {canExpand && (
            <ChevronDown
              style={{
                width: 15,
                height: 15,
                color: 'var(--color-text-secondary)',
                transform: isExpanded ? 'rotate(180deg)' : 'none',
                transition: 'transform 150ms',
              }}
            />
          )}
        </div>

        {isExpanded && canExpand && (
          <div style={{ borderTop: '0.5px solid var(--color-border-tertiary)', padding: 16 }}>
            {renderPhaseContent(phase)}
          </div>
        )}
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-secondary)' }}>
        Memuat data cluster...
      </div>
    );
  }

  if (!cluster) {
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <p>Cluster tidak ditemukan</p>
        <Link href="/permit-clusters" style={{ color: 'var(--color-text-info)' }}>
          ← Kembali
        </Link>
      </div>
    );
  }

  const currentIdx = PHASE_ORDER.indexOf(cluster.currentPhase);
  const isBakpDirectDone =
    cluster.currentPhase === 'PERMIT_DONE' && cluster?.bakp?.status === 'DONE' && cluster?.bakp?.ispDecision === 'ACCEPTED';

  return (
    <div>
      <div style={{ marginBottom: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, fontSize: 13, color: 'var(--color-text-secondary)' }}>
            <Link href="/permit-clusters" style={{ color: 'var(--color-text-secondary)', textDecoration: 'none' }}>
              Pipeline
            </Link>
            <span>/</span>
            <span style={{ color: 'var(--color-text-primary)' }}>{cluster.clusterCode}</span>
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 500, margin: 0, color: 'var(--color-text-primary)' }}>
            {cluster.clusterCode}
          </h1>
          <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
            {[
              { label: cluster.ispCustomer, color: '#0369A1', bg: '#E0F2FE' },
              { label: cluster.fiberType, color: '#166534', bg: '#F0FDF4' },
              {
                label: cluster.status,
                color: cluster.status === 'COMPLETED' ? '#166534' : '#92400E',
                bg: cluster.status === 'COMPLETED' ? '#F0FDF4' : '#FFFBEB',
              },
            ].map((badge) => (
              <span key={badge.label} style={{ padding: '2px 10px', borderRadius: 20, fontSize: 12, background: badge.bg, color: badge.color }}>
                {badge.label}
              </span>
            ))}
          </div>
        </div>
        <button
          onClick={() => void fetchCluster()}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '7px 14px',
            borderRadius: 8,
            border: '0.5px solid var(--color-border-tertiary)',
            background: 'none',
            cursor: 'pointer',
            fontSize: 13,
          }}
        >
          <RefreshCw style={{ width: 13, height: 13 }} />
          Refresh
        </button>
      </div>

      {cluster.pipelineTemplateId ? (
        <PipelineProgress clusterId={cluster.id} />
      ) : (
        <>
          <ProgressBar currentPhase={cluster.currentPhase} />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 264px', gap: 16, alignItems: 'start' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {PHASE_ORDER.map((phase, idx) =>
                // FIX: call the renderer as a function (not JSX component) so children aren't unmounted on re-render
                renderPhaseSection({
                  phase,
                  isActive: idx === currentIdx,
                  isCompleted: idx < currentIdx && !(isBakpDirectDone && (phase === 'CLAIM_SUBMISSION' || phase === 'INVOICE_PACKAGE')),
                  isFuture: idx > currentIdx,
                  isSkipped: isBakpDirectDone && (phase === 'CLAIM_SUBMISSION' || phase === 'INVOICE_PACKAGE'),
                  isExpanded: expandedPhases.has(phase),
                  onToggle: () => setExpandedPhases((prev) => {
                    const next = new Set(prev);
                    if (next.has(phase)) next.delete(phase);
                    else next.add(phase);
                    return next;
                  }),
                }),
              )}
            </div>

            <div
              style={{
                position: 'sticky',
                top: 76,
                background: 'var(--color-background-primary)',
                border: '0.5px solid var(--color-border-tertiary)',
                borderRadius: 'var(--border-radius-lg)',
                overflow: 'hidden',
                maxHeight: 'calc(100vh - 100px)',
              }}
            >
              <div
                style={{
                  padding: '10px 14px',
                  borderBottom: '0.5px solid var(--color-border-tertiary)',
                  fontSize: 11,
                  fontWeight: 500,
                  color: 'var(--color-text-secondary)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                }}
              >
                Timeline
              </div>
              <div style={{ overflowY: 'auto', maxHeight: 'calc(100vh - 156px)' }}>
                {PHASE_ORDER.map((phase, idx) => {
                  const done = idx < currentIdx;
                  const active = idx === currentIdx;
                  return (
                    <div
                      key={phase}
                      onClick={() => {
                        setExpandedPhases((prev) => {
                          const next = new Set(prev);
                          next.add(phase);
                          return next;
                        });
                        setTimeout(() => {
                          document.getElementById(`phase-${phase}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        }, 80);
                      }}
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 8,
                        padding: '6px 14px',
                        cursor: 'pointer',
                        background: active ? 'rgba(245,158,11,0.06)' : 'transparent',
                        borderLeft: active ? '2px solid #F59E0B' : '2px solid transparent',
                      }}
                    >
                      <div
                        style={{
                          width: 17,
                          height: 17,
                          borderRadius: '50%',
                          flexShrink: 0,
                          marginTop: 1,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 8,
                          fontWeight: 700,
                          background: done ? '#00D4B4' : active ? '#F59E0B' : '#F3F4F6',
                          color: done || active ? 'white' : '#9CA3AF',
                        }}
                      >
                        {done ? '✓' : idx + 1}
                      </div>
                      <span
                        style={{
                          fontSize: 11,
                          lineHeight: 1.35,
                          color: done ? 'var(--color-text-primary)' : active ? '#F59E0B' : 'var(--color-text-secondary)',
                          fontWeight: active ? 500 : 400,
                        }}
                      >
                        {(PHASE_LABELS[phase as any] || phase).replace(/^\d+\. /, '')}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}


// ─────────────────────────────────────────────────────────────
// FIX PR/BR→PO flow: shared workflow type + upload/review sub-components
// These sub-components live at module scope so their local useState
// is preserved across parent re-renders (prevents input focus loss).
// ─────────────────────────────────────────────────────────────

// FIX PR/BR→PO flow: mirror of backend PrBrWorkflow model
type PrBrWorkflow = {
  id: string;
  permitClusterId: string;
  prFileUrl?: string | null;
  brFileUrl?: string | null;
  prBrNotes?: string | null;
  poFileUrl?: string | null;
  poNotes?: string | null;
  status:
    | 'PENDING_UPLOAD'
    | 'UPLOADED'
    | 'ADMIN_APPROVED'
    | 'ADMIN_REJECTED'
    | 'PO_CREATED'
    | 'OPS_APPROVED'
    | 'OPS_REJECTED';
  uploadedBy?: string | null;
  uploadedAt?: string | null;
  adminReviewedBy?: string | null;
  adminReviewedAt?: string | null;
  adminNotes?: string | null;
  opsApprovedBy?: string | null;
  opsApprovedAt?: string | null;
  opsNotes?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

// FIX PR/BR→PO flow: PM/Admin upload PR (required) + BR (optional) + notes → /contract/upload-prbr
function PrBrUploadForm({
  clusterId,
  onSuccess,
}: {
  clusterId: string;
  onSuccess: () => void;
}) {
  const [prUrl, setPrUrl]         = useState('');
  const [brUrl, setBrUrl]         = useState('');
  const [notes, setNotes]         = useState('');
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving]       = useState(false);

  const handlePrUpload = async (file: File) => {
    setUploading(true);
    try {
      const url = await uploadFile(file, 'contract', 'pr'); // FIX PR/BR→PO flow: contract/<year>/pr/<ts>-<file>
      setPrUrl(url);
      toast.success('PR diupload');
    } catch (err: any) {
      toast.error(`Upload gagal: ${err.message ?? 'error tidak diketahui'}`);
    } finally {
      setUploading(false);
    }
  };

  const handleBrUpload = async (file: File) => {
    setUploading(true);
    try {
      const url = await uploadFile(file, 'contract', 'br');
      setBrUrl(url);
      toast.success('BR diupload');
    } catch (err: any) {
      toast.error(`Upload gagal: ${err.message ?? 'error tidak diketahui'}`);
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = async () => {
    if (!prUrl) {
      toast.error('Upload dokumen PR terlebih dahulu');
      return;
    }
    setSaving(true);
    try {
      await apiPost(`/permit-clusters/${clusterId}/contract/upload-prbr`, {
        prFileUrl: prUrl,
        brFileUrl: brUrl || undefined,
        prBrNotes: notes || undefined,
      });
      toast.success('✅ Dokumen PR/BR berhasil disubmit untuk review Admin');
      onSuccess();
    } catch (err: any) {
      toast.error(err?.message || 'Gagal submit PR/BR');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{
      background: 'var(--color-background-primary)',
      border: '0.5px solid var(--color-border-tertiary)',
      borderLeft: '3px solid #F59E0B',
      borderRadius: 12,
      padding: 20,
    }}>
      <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 16, color: 'var(--color-text-primary)' }}>
        📄 Upload Dokumen PR/BR dari ISP
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <UploadSlot
          label="Purchase Request (PR) *"
          uploaded={prUrl}
          uploading={uploading}
          onPick={handlePrUpload}
          onClear={() => setPrUrl('')}
          accept=".pdf,.doc,.docx"
          hint="PDF, maksimal 20MB"
        />
        <UploadSlot
          label="Budget Request (BR) — Opsional"
          uploaded={brUrl}
          uploading={uploading}
          onPick={handleBrUpload}
          onClear={() => setBrUrl('')}
          accept=".pdf,.doc,.docx"
          hint="PDF, maksimal 20MB"
        />

        <div>
          <label style={{
            display: 'block', fontSize: 11, fontWeight: 600, marginBottom: 6,
            color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em',
          }}>
            Catatan (opsional)
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="Catatan terkait dokumen PR/BR..."
            style={{
              width: '100%', boxSizing: 'border-box', padding: '9px 12px', borderRadius: 8,
              border: '1.5px solid var(--color-border-tertiary)',
              background: 'var(--color-background-primary)',
              color: 'var(--color-text-primary)', fontSize: 13, resize: 'vertical',
            }}
          />
        </div>

        <button
          disabled={!prUrl || saving || uploading}
          onClick={handleSubmit}
          style={{
            padding: '11px 24px', borderRadius: 10, border: 'none',
            background: !prUrl || saving ? 'var(--color-background-secondary)' : '#00D4B4',
            color: !prUrl || saving ? 'var(--color-text-secondary)' : 'white',
            cursor: !prUrl || saving ? 'not-allowed' : 'pointer',
            fontSize: 14, fontWeight: 600,
          }}
        >
          {saving ? 'Menyimpan...' : '📤 Submit PR/BR untuk Review Admin'}
        </button>
      </div>
    </div>
  );
}

// FIX PR/BR→PO flow: Admin approves/rejects uploaded PR/BR → /contract/admin-review
function AdminPrBrReview({
  clusterId,
  workflow,
  onSuccess,
}: {
  clusterId: string;
  workflow: PrBrWorkflow;
  onSuccess: () => void;
}) {
  const [notes, setNotes]   = useState('');
  const [saving, setSaving] = useState(false);

  const handleReview = async (action: 'APPROVE' | 'REJECT') => {
    if (action === 'REJECT' && !notes.trim()) {
      toast.error('Isi catatan alasan penolakan terlebih dahulu');
      return;
    }
    setSaving(true);
    try {
      await apiPost(`/permit-clusters/${clusterId}/contract/admin-review`, { action, notes });
      toast.success(
        action === 'APPROVE'
          ? '✅ PR/BR disetujui — silakan buat dokumen PO'
          : '❌ PR/BR ditolak — PM akan diminta upload ulang',
      );
      onSuccess();
    } catch (err: any) {
      toast.error(err?.message || 'Gagal review');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{
      background: 'var(--color-background-primary)',
      border: '0.5px solid var(--color-border-tertiary)',
      borderLeft: '3px solid #3B82F6',
      borderRadius: 12,
      padding: 20,
    }}>
      <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 16, color: 'var(--color-text-primary)' }}>
        🔍 Review Dokumen PR/BR
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        {workflow.prFileUrl && (
          <a href={fixFileUrl(workflow.prFileUrl)} target="_blank" rel="noreferrer"
             style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 8, background: '#3B82F615', color: '#3B82F6', textDecoration: 'none', fontSize: 13, fontWeight: 500 }}>
            📄 Buka Dokumen PR
          </a>
        )}
        {workflow.brFileUrl && (
          <a href={fixFileUrl(workflow.brFileUrl)} target="_blank" rel="noreferrer"
             style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 8, background: '#8B5CF615', color: '#8B5CF6', textDecoration: 'none', fontSize: 13, fontWeight: 500 }}>
            📄 Buka Dokumen BR
          </a>
        )}
      </div>

      <ReviewNotesField notes={notes} setNotes={setNotes} />

      <div style={{ display: 'flex', gap: 10 }}>
        <button
          disabled={saving}
          onClick={() => handleReview('APPROVE')}
          style={{
            flex: 1, padding: '11px 16px', borderRadius: 10, border: 'none',
            background: '#22C55E', color: 'white',
            cursor: saving ? 'not-allowed' : 'pointer',
            fontSize: 14, fontWeight: 600,
          }}
        >
          ✅ Setujui PR/BR
        </button>
        <button
          disabled={saving}
          onClick={() => handleReview('REJECT')}
          style={{
            flex: 1, padding: '11px 16px', borderRadius: 10, border: 'none',
            background: '#EF444415', color: '#EF4444',
            cursor: saving ? 'not-allowed' : 'pointer',
            fontSize: 14, fontWeight: 600,
          }}
        >
          ❌ Tolak PR/BR
        </button>
      </div>
    </div>
  );
}

// FIX PR/BR→PO flow: Admin uploads PO document → /contract/create-po
function PoUploadForm({
  clusterId,
  onSuccess,
}: {
  clusterId: string;
  onSuccess: () => void;
}) {
  const [poUrl, setPoUrl]         = useState('');
  const [notes, setNotes]         = useState('');
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving]       = useState(false);

  const handleUpload = async (file: File) => {
    setUploading(true);
    try {
      const url = await uploadFile(file, 'contract', 'po'); // FIX PR/BR→PO flow: contract/<year>/po/<ts>-<file>
      setPoUrl(url);
      toast.success('PO diupload');
    } catch (err: any) {
      toast.error(`Upload gagal: ${err.message ?? 'error tidak diketahui'}`);
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = async () => {
    if (!poUrl) {
      toast.error('Upload dokumen PO terlebih dahulu');
      return;
    }
    setSaving(true);
    try {
      await apiPost(`/permit-clusters/${clusterId}/contract/create-po`, {
        poFileUrl: poUrl,
        poNotes: notes || undefined,
      });
      toast.success('✅ PO berhasil dibuat dan dikirim ke Ops Manager untuk approval');
      onSuccess();
    } catch (err: any) {
      toast.error(err?.message || 'Gagal buat PO');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{
      background: 'var(--color-background-primary)',
      border: '0.5px solid var(--color-border-tertiary)',
      borderLeft: '3px solid #00D4B4',
      borderRadius: 12,
      padding: 20,
    }}>
      <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 16, color: 'var(--color-text-primary)' }}>
        📑 Buat Dokumen PO (Purchase Order)
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <UploadSlot
          label="Dokumen PO *"
          uploaded={poUrl}
          uploading={uploading}
          onPick={handleUpload}
          onClear={() => setPoUrl('')}
          accept=".pdf,.xlsx,.xls,.doc,.docx"
          hint="PDF, Excel — maks 20MB"
        />

        <div>
          <label style={{
            display: 'block', fontSize: 11, fontWeight: 600, marginBottom: 6,
            color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em',
          }}>
            Catatan PO
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="Catatan terkait PO..."
            style={{
              width: '100%', boxSizing: 'border-box', padding: '9px 12px', borderRadius: 8,
              border: '1.5px solid var(--color-border-tertiary)',
              background: 'var(--color-background-primary)',
              color: 'var(--color-text-primary)', fontSize: 13, resize: 'vertical',
            }}
          />
        </div>

        <button
          disabled={!poUrl || saving || uploading}
          onClick={handleSubmit}
          style={{
            padding: '11px 24px', borderRadius: 10, border: 'none',
            background: !poUrl || saving ? 'var(--color-background-secondary)' : '#00D4B4',
            color: !poUrl || saving ? 'var(--color-text-secondary)' : 'white',
            cursor: !poUrl || saving ? 'not-allowed' : 'pointer',
            fontSize: 14, fontWeight: 600,
          }}
        >
          {saving ? 'Menyimpan...' : '📤 Submit PO ke Ops Manager untuk Approval'}
        </button>
      </div>
    </div>
  );
}

// FIX PR/BR→PO flow: Ops Manager approves/rejects PO → /contract/ops-review
function OpsPoReview({
  clusterId,
  workflow,
  onSuccess,
}: {
  clusterId: string;
  workflow: PrBrWorkflow;
  onSuccess: () => void;
}) {
  const [notes, setNotes]   = useState('');
  const [saving, setSaving] = useState(false);

  const handleReview = async (action: 'APPROVE' | 'REJECT') => {
    if (action === 'REJECT' && !notes.trim()) {
      toast.error('Isi catatan alasan penolakan');
      return;
    }
    setSaving(true);
    try {
      await apiPost(`/permit-clusters/${clusterId}/contract/ops-review`, { action, notes });
      toast.success(
        action === 'APPROVE'
          ? '✅ PO disetujui — fase berlanjut ke SKOM'
          : '❌ PO ditolak — Admin akan merevisi',
      );
      onSuccess();
    } catch (err: any) {
      toast.error(err?.message || 'Gagal review');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{
      background: 'var(--color-background-primary)',
      border: '0.5px solid var(--color-border-tertiary)',
      borderLeft: '3px solid #F59E0B',
      borderRadius: 12,
      padding: 20,
    }}>
      <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 16, color: 'var(--color-text-primary)' }}>
        🔍 Review Dokumen PO
      </div>

      {workflow.poFileUrl && (
        <a href={fixFileUrl(workflow.poFileUrl)} target="_blank" rel="noreferrer"
           style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 8, marginBottom: 16, background: '#00D4B415', color: '#00D4B4', textDecoration: 'none', fontSize: 13, fontWeight: 500 }}>
          📑 Buka Dokumen PO
        </a>
      )}

      <ReviewNotesField notes={notes} setNotes={setNotes} />

      <div style={{ display: 'flex', gap: 10 }}>
        <button
          disabled={saving}
          onClick={() => handleReview('APPROVE')}
          style={{
            flex: 1, padding: '11px 16px', borderRadius: 10, border: 'none',
            background: '#22C55E', color: 'white',
            cursor: saving ? 'not-allowed' : 'pointer',
            fontSize: 14, fontWeight: 600,
          }}
        >
          ✅ Setujui PO
        </button>
        <button
          disabled={saving}
          onClick={() => handleReview('REJECT')}
          style={{
            flex: 1, padding: '11px 16px', borderRadius: 10, border: 'none',
            background: '#EF444415', color: '#EF4444',
            cursor: saving ? 'not-allowed' : 'pointer',
            fontSize: 14, fontWeight: 600,
          }}
        >
          ❌ Tolak PO
        </button>
      </div>
    </div>
  );
}

// FIX PR/BR→PO flow: reusable upload slot used by PR/BR and PO forms
function UploadSlot({
  label,
  uploaded,
  uploading,
  onPick,
  onClear,
  accept,
  hint,
}: {
  label: string;
  uploaded: string;
  uploading: boolean;
  onPick: (file: File) => void;
  onClear: () => void;
  accept: string;
  hint: string;
}) {
  return (
    <div>
      <label style={{
        display: 'block', fontSize: 11, fontWeight: 600, marginBottom: 6,
        color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em',
      }}>
        {label}
      </label>
      {uploaded ? (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '10px 14px', borderRadius: 8,
          background: '#22C55E15', border: '1px solid #22C55E30',
        }}>
          <span style={{ fontSize: 20 }}>📄</span>
          <span style={{ fontSize: 13, flex: 1, color: 'var(--color-text-primary)' }}>
            Dokumen berhasil diupload
          </span>
          <a href={fixFileUrl(uploaded)} target="_blank" rel="noreferrer"
             style={{ fontSize: 12, color: '#22C55E', textDecoration: 'none' }}>
            Lihat
          </a>
          <button onClick={onClear}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#EF4444', fontSize: 12 }}>
            Hapus
          </button>
        </div>
      ) : (
        <label style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '12px 16px', borderRadius: 8, cursor: 'pointer',
          border: '1.5px dashed var(--color-border-tertiary)',
          background: 'var(--color-background-secondary)',
        }}>
          <span style={{ fontSize: 24 }}>⬆️</span>
          <div>
            <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text-primary)' }}>
              {uploading ? 'Mengupload...' : 'Pilih file untuk upload'}
            </div>
            <div style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>
              {hint}
            </div>
          </div>
          <input
            type="file"
            accept={accept}
            disabled={uploading}
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onPick(f);
              e.target.value = '';
            }}
          />
        </label>
      )}
    </div>
  );
}

// FIX PR/BR→PO flow: reusable notes textarea used by admin + ops review forms
function ReviewNotesField({
  notes,
  setNotes,
}: {
  notes: string;
  setNotes: (v: string) => void;
}) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{
        display: 'block', fontSize: 11, fontWeight: 600, marginBottom: 6,
        color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em',
      }}>
        Catatan Review
      </label>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={3}
        placeholder="Catatan approval atau alasan penolakan..."
        style={{
          width: '100%', boxSizing: 'border-box', padding: '9px 12px', borderRadius: 8,
          border: '1.5px solid var(--color-border-tertiary)',
          background: 'var(--color-background-primary)',
          color: 'var(--color-text-primary)', fontSize: 13, resize: 'vertical',
        }}
      />
    </div>
  );
}

function SkomUploadForm({
  clusterId, skom, onSuccess
}: {
  clusterId: string;
  skom: any;
  onSuccess: () => void;
}) {
  const [files, setFiles] = useState({
    budgetFileUrl:   skom?.budgetFileUrl   || '',
    rabFileUrl:      skom?.rabFileUrl      || '',
    timelineFileUrl: skom?.timelineFileUrl || '',
    kurvaSFileUrl:   skom?.kurvaSFileUrl   || '',
  });
  const [fileNames, setFileNames] = useState({
    budget: '', rab: '', timeline: '', kurvaS: '',
  });
  const [uploading, setUploading] = useState('');
  const [budgetAmount, setBudgetAmount] = useState(
    skom?.budgetAmount?.toString() || skom?.totalBudget?.toString() || ''
  );
  const [notes, setNotes] = useState(skom?.notes || '');
  const [saving, setSaving] = useState(false);

  const handleUpload = async (
    file: File,
    field: keyof typeof files,
    nameKey: keyof typeof fileNames,
    pathPrefix: string
  ) => {
    setUploading(field);
    try {
      const url = await uploadFile(file, `skom`, pathPrefix);
      setFiles(p => ({ ...p, [field]: url }));
      setFileNames(p => ({ ...p, [nameKey]: file.name }));
      toast.success(`✅ ${file.name} diupload`);
    } catch (err: any) {
      toast.error(`Upload gagal: ${err.message}`);
    } finally { setUploading(''); }
  };

  const handleSaveAndSubmit = async (action: 'save' | 'submit') => {
    if (action === 'submit') {
      if (!files.budgetFileUrl) {
        toast.error('Upload dokumen SKOM Budget terlebih dahulu');
        return;
      }
      if (!files.rabFileUrl) {
        toast.error('Upload dokumen RAB terlebih dahulu');
        return;
      }
    }

    setSaving(true);
    try {
      // Create or update SKOM
      let skomId = skom?.id;
      if (!skomId) {
        const created = await apiPost<any>(
          `/permit-clusters/${clusterId}/skom-budget`,
          { ...files, budgetAmount: Number(budgetAmount) || null, totalBudget: Number(budgetAmount) || null, notes }
        );
        skomId = created.id;
      } else {
        await apiPatch(
          `/permit-clusters/${clusterId}/skom-budget/${skomId}`,
          { ...files, budgetAmount: Number(budgetAmount) || null, totalBudget: Number(budgetAmount) || null, notes }
        );
      }

      if (action === 'submit') {
        await apiPost(
          `/permit-clusters/${clusterId}/skom-budget/${skomId}/submit`,
          {}
        );
        toast.success(
          '✅ SKOM Budget berhasil disubmit ke Ops Manager untuk approval'
        );
      } else {
        toast.success('Draft SKOM disimpan');
      }
      onSuccess();
    } catch (err: any) {
      toast.error(err.message || 'Gagal menyimpan SKOM');
    } finally { setSaving(false); }
  };

  const docFields = [
    {
      key:    'budgetFileUrl' as const,
      nameKey:'budget' as const,
      label:  'SKOM Budget *',
      desc:   'Dokumen anggaran SKOM dari ISP',
      icon:   '📊',
      prefix: 'budget',
      required: true,
    },
    {
      key:    'rabFileUrl' as const,
      nameKey:'rab' as const,
      label:  'RAB (Rencana Anggaran Biaya) *',
      desc:   'Rincian biaya pelaksanaan proyek',
      icon:   '📋',
      prefix: 'rab',
      required: true,
    },
    {
      key:    'timelineFileUrl' as const,
      nameKey:'timeline' as const,
      label:  'Timeline / Jadwal Pelaksanaan',
      desc:   'Jadwal pelaksanaan proyek',
      icon:   '📅',
      prefix: 'timeline',
      required: false,
    },
    {
      key:    'kurvaSFileUrl' as const,
      nameKey:'kurvaS' as const,
      label:  'Kurva-S',
      desc:   'Kurva kemajuan proyek (S-Curve)',
      icon:   '📈',
      prefix: 'kurvas',
      required: false,
    },
  ];

  return (
    <div style={{
      background: 'var(--color-background-primary)',
      border: '0.5px solid var(--color-border-tertiary)',
      borderLeft: '3px solid #F59E0B',
      borderRadius: 12, padding: 20,
    }}>
      <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6,
                    color: 'var(--color-text-primary)' }}>
        📊 Upload Dokumen SKOM Budget
      </div>
      <div style={{ fontSize: 12, color: 'var(--color-text-secondary)',
                    marginBottom: 18 }}>
        Upload SKOM Budget, RAB, Timeline, dan Kurva-S untuk disetujui
        Ops Manager dan GM
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {docFields.map(doc => (
          <div key={doc.key}>
            <label style={{
              display: 'block', fontSize: 11, fontWeight: 600,
              marginBottom: 6, color: 'var(--color-text-secondary)',
              textTransform: 'uppercase', letterSpacing: '0.05em',
            }}>
              {doc.icon} {doc.label}
            </label>
            {files[doc.key] ? (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '9px 14px', borderRadius: 8,
                background: '#22C55E15', border: '1px solid #22C55E30',
              }}>
                <span style={{ flex: 1, fontSize: 13,
                               color: 'var(--color-text-primary)' }}>
                  ✓ {fileNames[doc.nameKey] || doc.label}
                </span>
                <a href={fixFileUrl(files[doc.key])}
                   target="_blank" rel="noreferrer"
                   style={{ fontSize: 12, color: '#22C55E',
                            textDecoration: 'none' }}>
                  Lihat
                </a>
                <button
                  onClick={() => setFiles(p => ({ ...p, [doc.key]: '' }))}
                  style={{ background: 'none', border: 'none',
                           cursor: 'pointer', color: '#EF4444', fontSize: 12 }}
                >
                  Hapus
                </button>
              </div>
            ) : (
              <label style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '10px 14px', borderRadius: 8,
                cursor: uploading ? 'wait' : 'pointer',
                border: `1.5px dashed ${
                  uploading === doc.key
                    ? '#F59E0B' : 'var(--color-border-tertiary)'
                }`,
                background: uploading === doc.key
                  ? '#F59E0B08' : 'var(--color-background-secondary)',
                transition: 'all 150ms',
              }}>
                <span style={{ fontSize: 20 }}>
                  {uploading === doc.key ? '⏳' : '⬆️'}
                </span>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500,
                                color: 'var(--color-text-primary)' }}>
                    {uploading === doc.key
                      ? 'Mengupload...' : `Upload ${doc.icon} ${doc.label}`}
                  </div>
                  <div style={{ fontSize: 11,
                                color: 'var(--color-text-secondary)' }}>
                    {doc.desc} · PDF, Excel — maks 20MB
                  </div>
                </div>
                <input
                  type="file"
                  accept=".pdf,.xlsx,.xls,.doc,.docx"
                  disabled={!!uploading}
                  style={{ display: 'none' }}
                  onChange={e => {
                    const f = e.target.files?.[0];
                    if (f) handleUpload(f, doc.key, doc.nameKey, doc.prefix);
                    e.target.value = '';
                  }}
                />
              </label>
            )}
          </div>
        ))}

        {/* Budget Amount */}
        <div>
          <label style={{
            display: 'block', fontSize: 11, fontWeight: 600,
            marginBottom: 6, color: 'var(--color-text-secondary)',
            textTransform: 'uppercase', letterSpacing: '0.05em',
          }}>
            💰 Total Anggaran (Rp)
          </label>
          <input
            type="number"
            value={budgetAmount}
            onChange={e => setBudgetAmount(e.target.value)}
            placeholder="Contoh: 150000000"
            style={{
              width: '100%', boxSizing: 'border-box',
              padding: '9px 12px', borderRadius: 8, fontSize: 14,
              border: '1.5px solid var(--color-border-tertiary)',
              background: 'var(--color-background-primary)',
              color: 'var(--color-text-primary)',
            }}
          />
          {budgetAmount && (
            <div style={{ fontSize: 11, color: '#00D4B4', marginTop: 3 }}>
              Rp {Number(budgetAmount).toLocaleString('id-ID')}
            </div>
          )}
        </div>

        {/* Notes */}
        <div>
          <label style={{
            display: 'block', fontSize: 11, fontWeight: 600,
            marginBottom: 6, color: 'var(--color-text-secondary)',
            textTransform: 'uppercase', letterSpacing: '0.05em',
          }}>
            Catatan
          </label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            rows={2}
            placeholder="Catatan terkait SKOM Budget..."
            style={{
              width: '100%', boxSizing: 'border-box',
              padding: '9px 12px', borderRadius: 8, fontSize: 13,
              border: '1.5px solid var(--color-border-tertiary)',
              background: 'var(--color-background-primary)',
              color: 'var(--color-text-primary)', resize: 'vertical',
            }}
          />
        </div>

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: 10, paddingTop: 4 }}>
          <button
            disabled={saving || !!uploading}
            onClick={() => handleSaveAndSubmit('save')}
            style={{
              padding: '10px 20px', borderRadius: 10,
              border: '0.5px solid var(--color-border-tertiary)',
              background: 'none', cursor: 'pointer',
              fontSize: 13, color: 'var(--color-text-secondary)',
            }}
          >
            💾 Simpan Draft
          </button>
          <button
            disabled={
              saving || !!uploading ||
              !files.budgetFileUrl || !files.rabFileUrl
            }
            onClick={() => handleSaveAndSubmit('submit')}
            style={{
              flex: 1, padding: '10px 20px', borderRadius: 10,
              border: 'none',
              background: (!files.budgetFileUrl || !files.rabFileUrl || saving)
                ? 'var(--color-background-secondary)' : '#F59E0B',
              color: (!files.budgetFileUrl || !files.rabFileUrl || saving)
                ? 'var(--color-text-secondary)' : 'white',
              cursor: (!files.budgetFileUrl || !files.rabFileUrl || saving)
                ? 'not-allowed' : 'pointer',
              fontSize: 14, fontWeight: 600,
            }}
          >
            {saving
              ? 'Memproses...'
              : '📤 Submit SKOM Budget ke Ops Manager'}
          </button>
        </div>
      </div>
    </div>
  );
}

// FIX: Ops Manager review component
function SkomOpsReview({
  clusterId, skom, onSuccess
}: {
  clusterId: string; skom: any; onSuccess: () => void;
}) {
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const handleReview = async (action: 'APPROVE' | 'REJECT') => {
    if (action === 'REJECT' && !notes.trim()) {
      toast.error('Isi catatan alasan penolakan');
      return;
    }
    setSaving(true);
    try {
      await apiPost(
        `/permit-clusters/${clusterId}/skom-budget/${skom.id}/ops-review`,
        { action, notes }
      );
      toast.success(
        action === 'APPROVE'
          ? '✅ SKOM disetujui — diteruskan ke GM'
          : '❌ SKOM ditolak — PM akan merevisi'
      );
      onSuccess();
    } catch (err: any) {
      toast.error(err.message || 'Gagal review');
    } finally { setSaving(false); }
  };

  return (
    <div style={{
      background: 'var(--color-background-primary)',
      border: '0.5px solid var(--color-border-tertiary)',
      borderLeft: '3px solid #8B5CF6', borderRadius: 12, padding: 20,
    }}>
      <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 16,
                    color: 'var(--color-text-primary)' }}>
        🔍 Review SKOM Budget (Ops Manager)
      </div>
      <textarea value={notes} onChange={e => setNotes(e.target.value)}
        rows={3} placeholder="Catatan approval atau alasan penolakan..."
        style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px',
                 borderRadius: 8, border: '1.5px solid var(--color-border-tertiary)',
                 background: 'var(--color-background-primary)',
                 color: 'var(--color-text-primary)',
                 fontSize: 13, resize: 'vertical', marginBottom: 12 }}
      />
      <div style={{ display: 'flex', gap: 10 }}>
        <button disabled={saving} onClick={() => handleReview('APPROVE')}
          style={{ flex: 1, padding: '11px', borderRadius: 10, border: 'none',
                   background: '#22C55E', color: 'white',
                   cursor: saving ? 'not-allowed' : 'pointer',
                   fontSize: 14, fontWeight: 600 }}>
          ✅ Setujui SKOM
        </button>
        <button disabled={saving} onClick={() => handleReview('REJECT')}
          style={{ flex: 1, padding: '11px', borderRadius: 10, border: 'none',
                   background: '#EF444415', color: '#EF4444',
                   cursor: saving ? 'not-allowed' : 'pointer',
                   fontSize: 14, fontWeight: 600 }}>
          ❌ Tolak SKOM
        </button>
      </div>
    </div>
  );
}

// FIX: GM approval component
function SkomGmApproval({
  clusterId, skom, onSuccess
}: {
  clusterId: string; skom: any; onSuccess: () => void;
}) {
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const handleApprove = async (action: 'APPROVE' | 'REJECT') => {
    if (action === 'REJECT' && !notes.trim()) {
      toast.error('Isi catatan alasan penolakan');
      return;
    }
    setSaving(true);
    try {
      await apiPost(
        `/permit-clusters/${clusterId}/skom-budget/${skom.id}/gm-review`,
        { action, notes }
      );
      toast.success(
        action === 'APPROVE'
          ? '✅ SKOM disetujui GM — fase berlanjut'
          : '❌ SKOM ditolak GM — PM akan merevisi'
      );
      onSuccess();
    } catch (err: any) {
      toast.error(err.message || 'Gagal review');
    } finally { setSaving(false); }
  };

  return (
    <div style={{
      background: 'var(--color-background-primary)',
      border: '0.5px solid var(--color-border-tertiary)',
      borderLeft: '3px solid #EF4444', borderRadius: 12, padding: 20,
    }}>
      <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 16,
                    color: 'var(--color-text-primary)' }}>
        🔍 Final Approval SKOM Budget (GM)
      </div>
      <textarea value={notes} onChange={e => setNotes(e.target.value)}
        rows={3} placeholder="Catatan approval GM..."
        style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px',
                 borderRadius: 8, border: '1.5px solid var(--color-border-tertiary)',
                 background: 'var(--color-background-primary)',
                 color: 'var(--color-text-primary)',
                 fontSize: 13, resize: 'vertical', marginBottom: 12 }}
      />
      <div style={{ display: 'flex', gap: 10 }}>
        <button disabled={saving} onClick={() => handleApprove('APPROVE')}
          style={{ flex: 1, padding: '11px', borderRadius: 10, border: 'none',
                   background: '#00D4B4', color: 'white',
                   cursor: saving ? 'not-allowed' : 'pointer',
                   fontSize: 14, fontWeight: 600 }}>
          ✅ Setujui SKOM (GM)
        </button>
        <button disabled={saving} onClick={() => handleApprove('REJECT')}
          style={{ flex: 1, padding: '11px', borderRadius: 10, border: 'none',
                   background: '#EF444415', color: '#EF4444',
                   cursor: saving ? 'not-allowed' : 'pointer',
                   fontSize: 14, fontWeight: 600 }}>
          ❌ Tolak SKOM (GM)
        </button>
      </div>
    </div>
  );
}

// FIX: Ops Manager disbursement schedule form — shown after GM_APPROVED
function SkomDisbursementForm({
  clusterId, skom, onSuccess
}: {
  clusterId: string; skom: any; onSuccess: () => void;
}) {
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate]     = useState('');
  const [amount, setAmount]       = useState('');
  const [notes, setNotes]         = useState('');
  const [saving, setSaving]       = useState(false);

  const handleSubmit = async () => {
    if (!startDate || !endDate || !amount) {
      toast.error('Tanggal mulai, selesai, dan total wajib diisi');
      return;
    }
    if (new Date(endDate) < new Date(startDate)) {
      toast.error('Tanggal selesai harus setelah tanggal mulai');
      return;
    }
    setSaving(true);
    try {
      await apiPost(
        `/permit-clusters/${clusterId}/skom-budget/${skom.id}/disburse`,
        {
          disbursementStartDate: startDate,
          disbursementEndDate:   endDate,
          disbursementAmount:    Number(amount.replace(/[^0-9]/g, '')),
          disbursementNotes:     notes,
        }
      );
      toast.success('✅ Jadwal pencairan dana berhasil disimpan');
      onSuccess();
    } catch (err: any) {
      toast.error(err.message || 'Gagal simpan jadwal');
    } finally { setSaving(false); }
  };

  const fieldStyle: React.CSSProperties = {
    width: '100%', boxSizing: 'border-box' as const,
    padding: '9px 12px', borderRadius: 8, fontSize: 13,
    border: '1.5px solid var(--color-border-tertiary)',
    background: 'var(--color-background-primary)',
    color: 'var(--color-text-primary)',
    outline: 'none',
  };

  const parsedAmount = Number(amount.replace(/[^0-9]/g, ''));

  return (
    <div style={{
      background: 'var(--color-background-primary)',
      border: '0.5px solid var(--color-border-tertiary)',
      borderLeft: '3px solid #22C55E',
      borderRadius: 12, padding: 20,
    }}>
      <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6,
                    color: 'var(--color-text-primary)' }}>
        💰 Jadwal Pencairan Dana
      </div>
      <div style={{ fontSize: 12, color: 'var(--color-text-secondary)',
                    marginBottom: 16 }}>
        SKOM Budget telah disetujui GM. Isi jadwal dan total pencairan dana.
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'grid',
                      gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label style={{ display: 'block', fontSize: 11,
                            fontWeight: 600, marginBottom: 5,
                            color: 'var(--color-text-secondary)',
                            textTransform: 'uppercase',
                            letterSpacing: '0.05em' }}>
              Tanggal Mulai Pencairan *
            </label>
            <input type="date" value={startDate}
              onChange={e => setStartDate(e.target.value)}
              style={fieldStyle} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 11,
                            fontWeight: 600, marginBottom: 5,
                            color: 'var(--color-text-secondary)',
                            textTransform: 'uppercase',
                            letterSpacing: '0.05em' }}>
              Tanggal Selesai Pencairan *
            </label>
            <input type="date" value={endDate}
              onChange={e => setEndDate(e.target.value)}
              min={startDate}
              style={fieldStyle} />
          </div>
        </div>

        <div>
          <label style={{ display: 'block', fontSize: 11,
                          fontWeight: 600, marginBottom: 5,
                          color: 'var(--color-text-secondary)',
                          textTransform: 'uppercase',
                          letterSpacing: '0.05em' }}>
            Total Dana yang Dicairkan (Rp) *
          </label>
          <input
            type="text"
            value={parsedAmount ? parsedAmount.toLocaleString('id-ID') : ''}
            onChange={e => setAmount(e.target.value)}
            placeholder="Contoh: 150.000.000"
            style={{ ...fieldStyle, textAlign: 'right' }}
          />
          {parsedAmount > 0 && (
            <div style={{ fontSize: 11, color: '#22C55E', marginTop: 3 }}>
              Rp {parsedAmount.toLocaleString('id-ID')}
            </div>
          )}
        </div>

        <div>
          <label style={{ display: 'block', fontSize: 11,
                          fontWeight: 600, marginBottom: 5,
                          color: 'var(--color-text-secondary)',
                          textTransform: 'uppercase',
                          letterSpacing: '0.05em' }}>
            Catatan
          </label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)}
            rows={2}
            placeholder="Catatan pencairan dana..."
            style={{ ...fieldStyle, resize: 'vertical' as const }}
          />
        </div>

        <button
          disabled={saving || !startDate || !endDate || !parsedAmount}
          onClick={handleSubmit}
          style={{
            padding: '11px 24px', borderRadius: 10, border: 'none',
            background: (!startDate || !endDate || !parsedAmount || saving)
              ? 'var(--color-background-secondary)' : '#22C55E',
            color: (!startDate || !endDate || !parsedAmount || saving)
              ? 'var(--color-text-secondary)' : 'white',
            cursor: (!startDate || !endDate || !parsedAmount || saving)
              ? 'not-allowed' : 'pointer',
            fontSize: 14, fontWeight: 600,
          }}
        >
          {saving
            ? 'Menyimpan...'
            : '✅ Simpan Jadwal & Lanjutkan ke Pencairan Dana'}
        </button>
      </div>
    </div>
  );
}

