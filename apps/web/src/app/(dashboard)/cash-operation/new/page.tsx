'use client'; // FIX: modern cash operation form + live approval preview
import { useState, useCallback, useMemo, useEffect } from 'react'; // FIX
import type { CSSProperties } from 'react'; // FIX
import { useRouter } from 'next/navigation'; // FIX
import { useAuthStore } from '../../../../store/authStore'; // FIX: relative path (matches web tsconfig)
import { apiPost, uploadFile, fixFileUrl, apiGetPaginated } from '../../../../lib/api'; // FIX
import { toast } from 'sonner'; // FIX
import { FinanceProjectPicker } from '../../../../components/finance/FinanceProjectPicker'; // M5
import { z } from 'zod'; // M5: align validation with API DTO
import {
  PlusCircle, // FIX
  Trash2, // FIX
  ArrowLeft, // FIX
  ChevronRight, // FIX
  Send, // FIX
  X, // FIX
  Upload, // FIX
  CheckCircle, // FIX
  AlertCircle, // FIX
} from 'lucide-react'; // FIX

type CashCategory = 'CASH_ADVANCE' | 'REIMBURSEMENT'; // FIX

interface LineItem {
  // FIX
  no: number; // FIX
  item: string; // FIX
  date: string; // FIX
  nominal: number; // FIX
} // FIX

type FinanceProjectPick = { id: string; code: string; name: string; isDefaultUncategorized: boolean };

const cashAdvancePeriodSchema = z
  .object({
    periodeFrom: z.string().min(1, 'Tanggal mulai wajib diisi'),
    periodeTo: z.string().min(1, 'Tanggal selesai wajib diisi'),
  })
  .superRefine((d, ctx) => {
    const fromMs = new Date(`${d.periodeFrom}T00:00:00.000Z`).getTime();
    const toMs = new Date(`${d.periodeTo}T00:00:00.000Z`).getTime();
    if (Number.isNaN(fromMs)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Tanggal mulai tidak valid', path: ['periodeFrom'] });
    }
    if (Number.isNaN(toMs)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Tanggal selesai tidak valid', path: ['periodeTo'] });
    }
    if (!Number.isNaN(fromMs) && !Number.isNaN(toMs) && fromMs > toMs) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Tanggal selesai harus sama atau setelah tanggal mulai',
        path: ['periodeTo'],
      });
    }
  });

const reimbursementPhotoUrlsSchema = z.array(z.string().url('URL foto tidak valid'));

// FIX: Approval flow step (UI preview — server uses its own chain on submit)
interface FlowStep {
  // FIX
  role: string; // FIX
  label: string; // FIX
  icon: string; // FIX
  color: string; // FIX
  isCurrentUser?: boolean; // FIX
} // FIX

// FIX: Format rupiah
function formatRp(n: number): string {
  // FIX
  if (!n) return 'Rp 0'; // FIX
  return `Rp ${n.toLocaleString('id-ID')}`; // FIX
} // FIX

function parseNominal(v: string): number {
  // FIX
  return Number(v.replace(/[^0-9]/g, '')) || 0; // FIX
} // FIX

// FIX: Surveyor line → responsible PM (matches API resolvePmRoleFromRequester)
function pmRoleForSurveyor(surveyorRole: string): string {
  // FIX
  if (surveyorRole === 'SURVEYOR_FTTB') return 'PM_FTTB'; // FIX
  if (surveyorRole === 'SURVEYOR_FTTT') return 'PM_FTTT'; // FIX
  return 'PM_FTTH'; // FIX: SURVEYOR_FTTH & fallback
} // FIX

// ── APPROVAL FLOW ENGINE ────────────────────────────────── // FIX
function getApprovalFlow(role: string, totalAmount: number, _category: CashCategory): FlowStep[] {
  // FIX: role + amount → ordered preview; _category reserved for future SLA copy
  const isHigh = totalAmount > 1_000_000; // FIX

  const ROLE_DISPLAY: Record<string, { label: string; icon: string; color: string }> = {
    // FIX: role-to-label map
    SURVEYOR_FTTH: { label: 'Surveyor FTTH', icon: '📍', color: '#22C55E' }, // FIX
    SURVEYOR_FTTB: { label: 'Surveyor FTTB', icon: '📍', color: '#22C55E' }, // FIX
    SURVEYOR_FTTT: { label: 'Surveyor FTTT', icon: '📍', color: '#22C55E' }, // FIX
    PM_FTTH: { label: 'PM FTTH', icon: '👔', color: '#3B82F6' }, // FIX
    PM_FTTB: { label: 'PM FTTB', icon: '👔', color: '#3B82F6' }, // FIX
    PM_FTTT: { label: 'PM FTTT', icon: '👔', color: '#3B82F6' }, // FIX
    PM_SENIOR: { label: 'Senior PM', icon: '👔', color: '#3B82F6' }, // FIX
    ADMIN: { label: 'Admin', icon: '🛡️', color: '#8B5CF6' }, // FIX
    ADMIN_STOCK: { label: 'Admin Stok', icon: '🛡️', color: '#8B5CF6' }, // FIX
    MARKETING: { label: 'Marketing', icon: '📣', color: '#EC4899' }, // FIX
    MARKETING_HEAD: { label: 'Kepala Marketing', icon: '📣', color: '#EC4899' }, // FIX
    OPERATIONAL_MANAGER: { label: 'Ops Manager', icon: '⚙️', color: '#F59E0B' }, // FIX
    GENERAL_MANAGER: { label: 'General Manager', icon: '👑', color: '#EF4444' }, // FIX
    FINANCE: { label: 'Finance', icon: '💳', color: '#06B6D4' }, // FIX
    DESIGNER: { label: 'Design Team', icon: '🎨', color: '#8B5CF6' }, // FIX
  }; // FIX

  const step = (roleKey: string, isMe = false): FlowStep => ({
    // FIX
    role: roleKey, // FIX
    label: ROLE_DISPLAY[roleKey]?.label || roleKey.replace(/_/g, ' '), // FIX
    icon: ROLE_DISPLAY[roleKey]?.icon || '👤', // FIX
    color: ROLE_DISPLAY[roleKey]?.color || '#6B7280', // FIX
    isCurrentUser: isMe, // FIX
  }); // FIX

  switch (role) {
    // FIX: define flows per role
    case 'SURVEYOR_FTTH': // FIX
    case 'SURVEYOR_FTTB': // FIX
    case 'SURVEYOR_FTTT': {
      // FIX
      const pm = pmRoleForSurveyor(role); // FIX
      return isHigh // FIX
        ? [step(role, true), step(pm), step('ADMIN'), step('OPERATIONAL_MANAGER'), step('GENERAL_MANAGER'), step('FINANCE')] // FIX
        : [step(role, true), step(pm), step('ADMIN'), step('OPERATIONAL_MANAGER'), step('FINANCE')]; // FIX
    }
    case 'PM_FTTH': // FIX
    case 'PM_FTTB': // FIX
    case 'PM_FTTT': // FIX
    case 'PM_SENIOR': // FIX
      return isHigh // FIX
        ? [step(role, true), step('ADMIN'), step('OPERATIONAL_MANAGER'), step('GENERAL_MANAGER'), step('FINANCE')] // FIX
        : [step(role, true), step('ADMIN'), step('OPERATIONAL_MANAGER'), step('FINANCE')]; // FIX
    case 'ADMIN': // FIX
    case 'ADMIN_STOCK': // FIX
      return isHigh // FIX
        ? [step(role, true), step('OPERATIONAL_MANAGER'), step('GENERAL_MANAGER'), step('FINANCE')] // FIX
        : [step(role, true), step('OPERATIONAL_MANAGER'), step('FINANCE')]; // FIX
    case 'MARKETING': // FIX
      return isHigh // FIX
        ? [step('MARKETING', true), step('MARKETING_HEAD'), step('ADMIN'), step('OPERATIONAL_MANAGER'), step('GENERAL_MANAGER'), step('FINANCE')] // FIX
        : [step('MARKETING', true), step('MARKETING_HEAD'), step('ADMIN'), step('OPERATIONAL_MANAGER'), step('FINANCE')]; // FIX
    case 'MARKETING_HEAD': // FIX
      return isHigh // FIX
        ? [step('MARKETING_HEAD', true), step('ADMIN'), step('OPERATIONAL_MANAGER'), step('GENERAL_MANAGER'), step('FINANCE')] // FIX
        : [step('MARKETING_HEAD', true), step('ADMIN'), step('OPERATIONAL_MANAGER'), step('FINANCE')]; // FIX
    case 'OPERATIONAL_MANAGER': // FIX
      return [step('OPERATIONAL_MANAGER', true), step('GENERAL_MANAGER'), step('FINANCE')]; // FIX
    case 'FINANCE': // FIX
      return [step('FINANCE', true), step('OPERATIONAL_MANAGER'), step('GENERAL_MANAGER')]; // FIX
    case 'DESIGNER': // FIX
      return isHigh // FIX
        ? [step('DESIGNER', true), step('PM_SENIOR'), step('ADMIN'), step('OPERATIONAL_MANAGER'), step('GENERAL_MANAGER'), step('FINANCE')] // FIX
        : [step('DESIGNER', true), step('PM_SENIOR'), step('ADMIN'), step('OPERATIONAL_MANAGER'), step('FINANCE')]; // FIX
    case 'GENERAL_MANAGER': // FIX
      return [step('GENERAL_MANAGER', true), step('FINANCE')]; // FIX
    default: // FIX
      return isHigh // FIX
        ? [step(role, true), step('ADMIN'), step('OPERATIONAL_MANAGER'), step('GENERAL_MANAGER'), step('FINANCE')] // FIX
        : [step(role, true), step('ADMIN'), step('OPERATIONAL_MANAGER'), step('FINANCE')]; // FIX
  }
} // FIX

// ── APPROVAL FLOW VISUALIZER ────────────────────────────── // FIX
function ApprovalFlowBadge({ flow, totalAmount }: { flow: FlowStep[]; totalAmount: number }) {
  // FIX
  const isHigh = totalAmount > 1_000_000; // FIX

  return (
    <div
      style={{
        // FIX
        background: 'var(--color-background-primary)', // FIX
        border: '0.5px solid var(--color-border-tertiary)', // FIX
        borderLeft: '3px solid #00D4B4', // FIX
        borderRadius: 12, // FIX
        padding: 20, // FIX
      }}
    >
      <div
        style={{
          display: 'flex', // FIX
          alignItems: 'center', // FIX
          justifyContent: 'space-between', // FIX
          marginBottom: 16, // FIX
        }}
      >
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-primary)' }}>🔄 Alur Approval</div>
          <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginTop: 2 }}>
            {totalAmount === 0 // FIX
              ? 'Masukkan nominal untuk melihat alur approval' // FIX
              : isHigh // FIX
                ? 'Total > Rp 1.000.000 — memerlukan approval GM' // FIX
                : 'Total ≤ Rp 1.000.000 — tidak memerlukan GM'} // FIX
          </div>
        </div>
        {totalAmount > 0 && (
          <span
            style={{
              padding: '4px 12px', // FIX
              borderRadius: 20, // FIX
              fontSize: 11, // FIX
              fontWeight: 600, // FIX
              background: isHigh ? '#EF444415' : '#22C55E15', // FIX
              color: isHigh ? '#EF4444' : '#22C55E', // FIX
              border: `0.5px solid ${isHigh ? '#EF444440' : '#22C55E40'}`, // FIX
            }}
          >
            {isHigh ? '⚠ Butuh GM' : '✓ Tanpa GM'} // FIX
          </span>
        )}
      </div>

      {totalAmount > 0 ? (
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 4 }}>
          {flow.map((st, i) => (
            <div key={`${st.role}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <div
                style={{
                  display: 'flex', // FIX
                  alignItems: 'center', // FIX
                  gap: 6, // FIX
                  padding: '6px 12px', // FIX
                  borderRadius: 20, // FIX
                  background: st.isCurrentUser ? st.color : `${st.color}15`, // FIX
                  border: `1px solid ${st.color}40`, // FIX
                  transition: 'all 150ms', // FIX
                }}
              >
                <span style={{ fontSize: 14 }}>{st.icon}</span>
                <span
                  style={{
                    fontSize: 12, // FIX
                    fontWeight: st.isCurrentUser ? 700 : 500, // FIX
                    color: st.isCurrentUser ? 'white' : st.color, // FIX
                    whiteSpace: 'nowrap', // FIX
                  }}
                >
                  {st.label}
                  {st.isCurrentUser && <span style={{ marginLeft: 4, fontSize: 10, opacity: 0.9 }}>(Anda)</span>}
                </span>
              </div>
              {i < flow.length - 1 && (
                <ChevronRight style={{ width: 14, height: 14, color: 'var(--color-text-secondary)', flexShrink: 0 }} />
              )}
            </div>
          ))}
        </div>
      ) : (
        <div
          style={{
            padding: '16px', // FIX
            textAlign: 'center', // FIX
            color: 'var(--color-text-secondary)', // FIX
            fontSize: 13, // FIX
            fontStyle: 'italic', // FIX
            background: 'var(--color-background-secondary)', // FIX
            borderRadius: 8, // FIX
          }}
        >
          Isi nominal item untuk melihat alur approval
        </div>
      )}

      <div style={{ display: 'flex', gap: 12, marginTop: 14, flexWrap: 'wrap' }}>
        <div
          style={{
            flex: 1, // FIX
            minWidth: 140, // FIX
            padding: '10px 14px', // FIX
            borderRadius: 8, // FIX
            background: '#22C55E10', // FIX
            border: '0.5px solid #22C55E30', // FIX
          }}
        >
          <div
            style={{
              fontSize: 10, // FIX
              fontWeight: 600, // FIX
              color: '#22C55E', // FIX
              marginBottom: 3, // FIX
              textTransform: 'uppercase', // FIX
              letterSpacing: '0.05em', // FIX
            }}
          >
            ≤ Rp 1.000.000
          </div>
          <div style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>Tanpa approval GM</div>
        </div>
        <div
          style={{
            flex: 1, // FIX
            minWidth: 140, // FIX
            padding: '10px 14px', // FIX
            borderRadius: 8, // FIX
            background: '#EF444410', // FIX
            border: '0.5px solid #EF444430', // FIX
          }}
        >
          <div
            style={{
              fontSize: 10, // FIX
              fontWeight: 600, // FIX
              color: '#EF4444', // FIX
              marginBottom: 3, // FIX
              textTransform: 'uppercase', // FIX
              letterSpacing: '0.05em', // FIX
            }}
          >
            &gt; Rp 1.000.000
          </div>
          <div style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>Memerlukan approval GM</div>
        </div>
      </div>
    </div>
  );
} // FIX

// ── CATEGORY SELECTOR ───────────────────────────────────── // FIX
function CategorySelector({ onSelect }: { onSelect: (cat: CashCategory) => void }) {
  // FIX
  const router = useRouter(); // FIX
  const [hovered, setHovered] = useState<CashCategory | null>(null); // FIX

  const cats = [
    // FIX
    {
      value: 'CASH_ADVANCE' as CashCategory, // FIX
      label: 'Cash Advance', // FIX
      sublabel: 'Uang Muka Operasional', // FIX
      desc: 'Dana diberikan terlebih dahulu sebelum kegiatan dilaksanakan. Bukti pengeluaran dapat diserahkan setelahnya.', // FIX
      icon: '💵', // FIX
      badge: 'Bukti Opsional', // FIX
      badgeColor: '#22C55E', // FIX
      badgeBg: '#22C55E15', // FIX
      color: '#00D4B4', // FIX
      gradient: 'linear-gradient(135deg, #00D4B420, #00D4B405)', // FIX
      border: '#00D4B440', // FIX
      points: ['Tidak perlu bukti saat pengajuan', 'Dana lebih dulu, bukti belakangan', 'Cocok untuk biaya perjalanan dinas'], // FIX
    },
    {
      value: 'REIMBURSEMENT' as CashCategory, // FIX
      label: 'Reimbursement', // FIX
      sublabel: 'Penggantian Biaya', // FIX
      desc: 'Penggantian atas biaya yang sudah dikeluarkan dari kantong sendiri. Wajib melampirkan bukti pembayaran.', // FIX
      icon: '🧾', // FIX
      badge: 'Bukti Wajib', // FIX
      badgeColor: '#EF4444', // FIX
      badgeBg: '#EF444415', // FIX
      color: '#3B82F6', // FIX
      gradient: 'linear-gradient(135deg, #3B82F620, #3B82F605)', // FIX
      border: '#3B82F640', // FIX
      points: ['Wajib foto nota/kwitansi', 'Biaya sudah dikeluarkan', 'Cocok untuk pembelian mendadak'], // FIX
    },
  ]; // FIX

  return (
    <div style={{ maxWidth: 640, margin: '0 auto', paddingBottom: 60 }}>
      <button
        type="button"
        onClick={() => router.push('/cash-operation')}
        style={{
          display: 'inline-flex', // FIX
          alignItems: 'center', // FIX
          gap: 6, // FIX
          padding: '7px 14px', // FIX
          borderRadius: 8, // FIX
          marginBottom: 28, // FIX
          border: '0.5px solid var(--color-border-tertiary)', // FIX
          background: 'none', // FIX
          cursor: 'pointer', // FIX
          fontSize: 13, // FIX
          color: 'var(--color-text-secondary)', // FIX
          transition: 'all 150ms', // FIX
        }}
      >
        <ArrowLeft style={{ width: 14, height: 14 }} />
        Kembali
      </button>

      <div style={{ textAlign: 'center', marginBottom: 36 }}>
        <div style={{ fontSize: 42, marginBottom: 12 }}>💰</div>
        <h1
          style={{
            fontSize: 26, // FIX
            fontWeight: 800, // FIX
            margin: 0, // FIX
            color: 'var(--color-text-primary)', // FIX
            letterSpacing: '-0.5px', // FIX
          }}
        >
          Buat Pengajuan Dana
        </h1>
        <p style={{ fontSize: 14, color: 'var(--color-text-secondary)', margin: '10px 0 0', lineHeight: 1.6 }}>
          Pilih jenis pengajuan yang sesuai dengan kebutuhan Anda
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {cats.map((cat) => (
          <div
            key={cat.value}
            role="button"
            tabIndex={0}
            onClick={() => onSelect(cat.value)}
            onKeyDown={(e) => e.key === 'Enter' && onSelect(cat.value)}
            onMouseEnter={() => setHovered(cat.value)}
            onMouseLeave={() => setHovered(null)}
            style={{
              padding: '24px', // FIX
              borderRadius: 18, // FIX
              background: hovered === cat.value ? cat.gradient : 'var(--color-background-primary)', // FIX
              border: `1.5px solid ${hovered === cat.value ? cat.color : 'var(--color-border-tertiary)'}`, // FIX
              cursor: 'pointer', // FIX
              transition: 'all 200ms', // FIX
              transform: hovered === cat.value ? 'translateY(-3px)' : 'none', // FIX
              boxShadow: hovered === cat.value ? `0 12px 32px ${cat.border}` : 'none', // FIX
            }}
          >
            <div style={{ display: 'flex', gap: 16 }}>
              <div
                style={{
                  width: 60, // FIX
                  height: 60, // FIX
                  borderRadius: 16, // FIX
                  flexShrink: 0, // FIX
                  background: cat.gradient, // FIX
                  border: `1.5px solid ${cat.border}`, // FIX
                  display: 'flex', // FIX
                  alignItems: 'center', // FIX
                  justifyContent: 'center', // FIX
                  fontSize: 28, // FIX
                }}
              >
                {cat.icon}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                  <span style={{ fontSize: 18, fontWeight: 700, color: cat.color }}>{cat.label}</span>
                  <span
                    style={{
                      padding: '3px 10px', // FIX
                      borderRadius: 20, // FIX
                      fontSize: 11, // FIX
                      fontWeight: 700, // FIX
                      background: cat.badgeBg, // FIX
                      color: cat.badgeColor, // FIX
                      border: `0.5px solid ${cat.badgeColor}30`, // FIX
                    }}
                  >
                    {cat.badge}
                  </span>
                </div>
                <div
                  style={{
                    fontSize: 12, // FIX
                    fontWeight: 500, // FIX
                    color: 'var(--color-text-secondary)', // FIX
                    marginBottom: 8, // FIX
                  }}
                >
                  {cat.sublabel}
                </div>
                <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', margin: '0 0 12px', lineHeight: 1.5 }}>
                  {cat.desc}
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {cat.points.map((pt, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--color-text-secondary)' }}>
                      <div style={{ width: 5, height: 5, borderRadius: '50%', background: cat.color, flexShrink: 0 }} />
                      {pt}
                    </div>
                  ))}
                </div>
              </div>
              <div
                style={{
                  alignSelf: 'center', // FIX
                  flexShrink: 0, // FIX
                  width: 32, // FIX
                  height: 32, // FIX
                  borderRadius: '50%', // FIX
                  background: `${cat.color}15`, // FIX
                  display: 'flex', // FIX
                  alignItems: 'center', // FIX
                  justifyContent: 'center', // FIX
                  transition: 'all 200ms', // FIX
                  transform: hovered === cat.value ? 'translateX(4px)' : 'none', // FIX
                }}
              >
                <ChevronRight style={{ width: 16, height: 16, color: cat.color }} />
              </div>
            </div>
          </div>
        ))}
      </div>

      <div
        style={{
          marginTop: 20, // FIX
          padding: '14px 18px', // FIX
          borderRadius: 12, // FIX
          background: 'var(--color-background-secondary)', // FIX
          border: '0.5px solid var(--color-border-tertiary)', // FIX
          display: 'flex', // FIX
          gap: 12, // FIX
          alignItems: 'flex-start', // FIX
        }}
      >
        <span style={{ fontSize: 18, flexShrink: 0 }}>ℹ️</span>
        <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>
          Pengajuan di atas <strong style={{ color: 'var(--color-text-primary)' }}>Rp 1.000.000</strong> akan memerlukan persetujuan tambahan dari{' '}
          <strong style={{ color: 'var(--color-text-primary)' }}>General Manager</strong>.
        </div>
      </div>
    </div>
  );
} // FIX

// ── FORM ────────────────────────────────────────────────── // FIX
function CashOperationForm({ category, onBack }: { category: CashCategory; onBack: () => void }) {
  // FIX
  const router = useRouter(); // FIX
  const { user } = useAuthStore(); // FIX

  const isCashAdvance = category === 'CASH_ADVANCE'; // FIX
  const isReimbursement = category === 'REIMBURSEMENT'; // FIX
  const accentColor = isCashAdvance ? '#00D4B4' : '#3B82F6'; // FIX

  const [lineItems, setLineItems] = useState<LineItem[]>([{ no: 1, item: '', date: '', nominal: 0 }]); // FIX
  const [title, setTitle] = useState(''); // FIX
  const [notes, setNotes] = useState(''); // FIX
  const [photos, setPhotos] = useState<string[]>([]); // FIX
  const [photoNames, setPhotoNames] = useState<string[]>([]); // FIX
  const [uploading, setUploading] = useState(false); // FIX
  const [saving, setSaving] = useState(false); // FIX
  const [financeProjectId, setFinanceProjectId] = useState(''); // FIX
  const [caAmountInput, setCaAmountInput] = useState(''); // M4: CA Stage 1 single amount
  const [periodeFrom, setPeriodeFrom] = useState('');
  const [periodeTo, setPeriodeTo] = useState('');
  const [nomorRekeningPengaju, setNomorRekeningPengaju] = useState('');

  useEffect(() => {
    let c = false;
    void (async () => {
      try {
        const res = await apiGetPaginated<FinanceProjectPick>('/finance-projects', { limit: 100, status: 'ACTIVE' });
        if (c) return;
        const g = res.data.find((p) => p.isDefaultUncategorized);
        if (g) setFinanceProjectId(g.id);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      c = true;
    };
  }, []);

  const reimburseTotal = useMemo(() => lineItems.reduce((s, l) => s + (l.nominal || 0), 0), [lineItems]);

  const cashAdvancePeriodOk = useMemo(
    () => cashAdvancePeriodSchema.safeParse({ periodeFrom, periodeTo }).success,
    [periodeFrom, periodeTo],
  );

  const reimbursementPhotoUrlsOk = useMemo(
    () => (isReimbursement ? reimbursementPhotoUrlsSchema.safeParse(photos).success : true),
    [isReimbursement, photos],
  );

  const caTotal = useMemo(() => parseNominal(caAmountInput), [caAmountInput]);

  const total = isCashAdvance ? caTotal : reimburseTotal;

  const hasValidLine = useMemo(() => lineItems.some((l) => l.item.trim() && l.nominal > 0), [lineItems]);

  const approvalFlow = useMemo(
    () => getApprovalFlow(user?.role || '', total, category),
    [user?.role, total, category],
  );

  const addLine = () =>
    setLineItems((prev) => [...prev, { no: prev.length + 1, item: '', date: '', nominal: 0 }]); // FIX

  const removeLine = (idx: number) => {
    if (lineItems.length === 1) return; // FIX
    setLineItems((prev) => prev.filter((_, i) => i !== idx).map((it, i) => ({ ...it, no: i + 1 }))); // FIX
  }; // FIX

  const updateLine = useCallback((idx: number, field: keyof LineItem, value: string | number) => {
    setLineItems((prev) =>
      prev.map((it, i) =>
        i === idx ? { ...it, [field]: field === 'nominal' ? parseNominal(String(value)) : value } : it,
      ),
    ); // FIX
  }, []); // FIX

  const handlePhotoUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return; // FIX
    setUploading(true); // FIX
    try {
      for (const file of Array.from(files)) {
        if (file.size > 10 * 1024 * 1024) {
          toast.error(`${file.name} terlalu besar (max 10MB)`); // FIX
          continue; // FIX
        }
        const url = await uploadFile(file, 'cash-operation/photos', 'general'); // FIX
        setPhotos((p) => [...p, url]); // FIX
        setPhotoNames((p) => [...p, file.name]); // FIX
        toast.success(`✅ ${file.name} diupload`); // FIX
      }
    } catch (err: any) {
      toast.error(`Upload gagal: ${err.message}`); // FIX
    } finally {
      setUploading(false); // FIX
    }
  }; // FIX

  const canSubmit = isCashAdvance
    ? !saving && title.trim().length > 0 && caTotal > 0 && cashAdvancePeriodOk
    : !saving &&
      title.trim().length > 0 &&
      total > 0 &&
      hasValidLine &&
      !(isReimbursement && photos.length === 0) &&
      reimbursementPhotoUrlsOk;

  const handleSubmit = async () => {
    if (!title.trim()) {
      toast.error('Judul wajib diisi');
      return;
    }
    if (isCashAdvance) {
      if (caTotal <= 0) {
        toast.error('Nominal harus lebih dari 0');
        return;
      }
      if (!nomorRekeningPengaju.trim()) {
        toast.error('Nomor rekening wajib diisi untuk Cash Advance');
        return;
      }
      const periodParsed = cashAdvancePeriodSchema.safeParse({ periodeFrom, periodeTo });
      if (periodParsed.success === false) {
        toast.error(periodParsed.error.issues[0]?.message ?? 'Periode tidak valid');
        return;
      }
      setSaving(true);
      try {
        await apiPost('/cash-operation', {
          type: category,
          title,
          notes,
          amount: caTotal,
          totalAmount: caTotal,
          periodeFrom: new Date(`${periodeFrom}T00:00:00.000Z`).toISOString(),
          periodeTo: new Date(`${periodeTo}T23:59:59.999Z`).toISOString(),
          financeProjectId: financeProjectId || undefined,
          nomorRekeningPengaju: nomorRekeningPengaju.trim(),
        });
        toast.success('Cash Advance berhasil dibuat');
        router.push('/cash-operation');
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : 'Gagal submit');
      } finally {
        setSaving(false);
      }
      return;
    }
    if (!hasValidLine) {
      toast.error('Minimal 1 item dengan keterangan dan nominal');
      return;
    }
    if (total === 0) {
      toast.error('Minimal 1 item dengan nominal');
      return;
    }
    if (isReimbursement && photos.length === 0) {
      toast.error('Upload minimal 1 foto bukti untuk reimbursement');
      return;
    }
    const photoParsed = reimbursementPhotoUrlsSchema.safeParse(photos);
    if (photoParsed.success === false) {
      toast.error(photoParsed.error.issues[0]?.message ?? 'URL foto tidak valid');
      return;
    }
    setSaving(true);
    try {
      await apiPost('/cash-operation', {
        type: category,
        title,
        notes,
        lineItems: lineItems.filter((l) => l.item.trim()),
        totalAmount: total,
        amount: total,
        photoUrls: photos,
        financeProjectId: financeProjectId || undefined,
      });
      toast.success('Reimbursement berhasil diajukan');
      router.push('/cash-operation');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Gagal submit');
    } finally {
      setSaving(false);
    }
  };

  const inputStyle: CSSProperties = {
    width: '100%', // FIX
    boxSizing: 'border-box', // FIX
    padding: '9px 12px', // FIX
    borderRadius: 8, // FIX
    fontSize: 13, // FIX
    border: '1.5px solid var(--color-border-tertiary)', // FIX
    background: 'var(--color-background-primary)', // FIX
    color: 'var(--color-text-primary)', // FIX
    outline: 'none', // FIX
    transition: 'border-color 150ms', // FIX
  }; // FIX

  return (
    <div style={{ maxWidth: 820, margin: '0 auto', paddingBottom: 80 }}>
      <style>{`@keyframes cashOpSubmitSpin { to { transform: rotate(360deg); } }`}</style>

      <button
        type="button"
        onClick={onBack}
        style={{
          display: 'inline-flex', // FIX
          alignItems: 'center', // FIX
          gap: 6, // FIX
          padding: '7px 14px', // FIX
          borderRadius: 8, // FIX
          marginBottom: 24, // FIX
          border: '0.5px solid var(--color-border-tertiary)', // FIX
          background: 'none', // FIX
          cursor: 'pointer', // FIX
          fontSize: 13, // FIX
          color: 'var(--color-text-secondary)', // FIX
          transition: 'all 150ms', // FIX
        }}
      >
        <ArrowLeft style={{ width: 14, height: 14 }} />
        Ganti Jenis Pengajuan
      </button>

      <div
        style={{
          display: 'flex', // FIX
          alignItems: 'center', // FIX
          gap: 16, // FIX
          marginBottom: 28, // FIX
          padding: '16px 20px', // FIX
          borderRadius: 16, // FIX
          background: `linear-gradient(135deg, ${accentColor}15, ${accentColor}05)`, // FIX
          border: `1px solid ${accentColor}30`, // FIX
        }}
      >
        <div
          style={{
            width: 52, // FIX
            height: 52, // FIX
            borderRadius: 14, // FIX
            flexShrink: 0, // FIX
            background: `${accentColor}20`, // FIX
            border: `1.5px solid ${accentColor}40`, // FIX
            display: 'flex', // FIX
            alignItems: 'center', // FIX
            justifyContent: 'center', // FIX
            fontSize: 26, // FIX
          }}
        >
          {isCashAdvance ? '💵' : '🧾'}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--color-text-primary)', letterSpacing: '-0.3px' }}>
            {isCashAdvance ? 'Cash Advance' : 'Reimbursement'}
          </div>
          <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 2, lineHeight: 1.5 }}>
            {isCashAdvance ? (
              <>
                Tahap 1 tidak memerlukan rincian baris atau unggah bukti — lengkapi realisasi setelah dana disetujui dan
                periode kunjungan selesai.
              </>
            ) : (
              <>
                <span>Penggantian biaya — foto bukti wajib dilampirkan.</span>
                <br />
                <span style={{ display: 'block', marginTop: 6 }}>
                  Setelah disetujui, biaya tercatat sebagai realisasi tanpa pencairan terpisah sesuai alur reimbursement.
                </span>
              </>
            )}
          </div>
        </div>
        <div
          style={{
            padding: '6px 14px', // FIX
            borderRadius: 20, // FIX
            background: isCashAdvance ? '#22C55E15' : '#EF444415', // FIX
            color: isCashAdvance ? '#22C55E' : '#EF4444', // FIX
            border: `1px solid ${isCashAdvance ? '#22C55E30' : '#EF444430'}`, // FIX
            fontSize: 12, // FIX
            fontWeight: 700, // FIX
            display: 'flex', // FIX
            alignItems: 'center', // FIX
            gap: 5, // FIX
          }}
        >
          {isCashAdvance ? (
            <>
              <CheckCircle style={{ width: 12, height: 12 }} /> Tanpa bukti di tahap ini
            </>
          ) : (
            <>
              <AlertCircle style={{ width: 12, height: 12 }} /> Bukti Wajib
            </>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div
          style={{
            background: 'var(--color-background-primary)', // FIX
            border: '0.5px solid var(--color-border-tertiary)', // FIX
            borderRadius: 14, // FIX
            overflow: 'hidden', // FIX
          }}
        >
          <div
            style={{
              padding: '14px 20px', // FIX
              borderBottom: '0.5px solid var(--color-border-tertiary)', // FIX
              background: 'var(--color-background-secondary)', // FIX
              display: 'flex', // FIX
              alignItems: 'center', // FIX
              gap: 8, // FIX
            }}
          >
            <span style={{ fontSize: 16 }}>📝</span>
            <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-primary)' }}>Informasi Pengajuan</span>
          </div>
          <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label
                style={{
                  display: 'block', // FIX
                  fontSize: 11, // FIX
                  fontWeight: 600, // FIX
                  marginBottom: 6, // FIX
                  color: 'var(--color-text-secondary)', // FIX
                  textTransform: 'uppercase', // FIX
                  letterSpacing: '0.05em', // FIX
                }}
              >
                Judul Pengajuan *
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={
                  isCashAdvance ? 'Contoh: Cash advance survey lapangan Cluster RW-001' : 'Contoh: Reimbursement pembelian material survey'
                }
                style={inputStyle}
              />
            </div>
            <div>
              <label
                style={{
                  display: 'block', // FIX
                  fontSize: 11, // FIX
                  fontWeight: 600, // FIX
                  marginBottom: 6, // FIX
                  color: 'var(--color-text-secondary)', // FIX
                  textTransform: 'uppercase', // FIX
                  letterSpacing: '0.05em', // FIX
                }}
              >
                Proyek budget (finance)
              </label>
              <FinanceProjectPicker value={financeProjectId} onChange={setFinanceProjectId} />
              <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginTop: 6 }}>
                Pilih project untuk auto-deduct budget. Pilih GENERAL/Belum dialokasi jika belum pasti.
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <div>
                <label
                  style={{
                    display: 'block', // FIX
                    fontSize: 11, // FIX
                    fontWeight: 600, // FIX
                    marginBottom: 6, // FIX
                    color: 'var(--color-text-secondary)', // FIX
                    textTransform: 'uppercase', // FIX
                    letterSpacing: '0.05em', // FIX
                  }}
                >
                  Jenis Pengajuan
                </label>
                <div
                  style={{
                    padding: '9px 14px', // FIX
                    borderRadius: 8, // FIX
                    fontSize: 13, // FIX
                    background: `${accentColor}12`, // FIX
                    border: `1.5px solid ${accentColor}35`, // FIX
                    color: accentColor, // FIX
                    fontWeight: 600, // FIX
                    display: 'flex', // FIX
                    alignItems: 'center', // FIX
                    gap: 6, // FIX
                  }}
                >
                  {isCashAdvance ? '💵' : '🧾'}
                  {isCashAdvance ? 'Cash Advance' : 'Reimbursement'}
                </div>
              </div>
              <div>
                <label
                  style={{
                    display: 'block', // FIX
                    fontSize: 11, // FIX
                    fontWeight: 600, // FIX
                    marginBottom: 6, // FIX
                    color: 'var(--color-text-secondary)', // FIX
                    textTransform: 'uppercase', // FIX
                    letterSpacing: '0.05em', // FIX
                  }}
                >
                  Diajukan Oleh
                </label>
                <div
                  style={{
                    padding: '9px 14px', // FIX
                    borderRadius: 8, // FIX
                    fontSize: 13, // FIX
                    background: 'var(--color-background-secondary)', // FIX
                    border: '1.5px solid var(--color-border-tertiary)', // FIX
                    color: 'var(--color-text-primary)', // FIX
                    display: 'flex', // FIX
                    alignItems: 'center', // FIX
                    gap: 6, // FIX
                  }}
                >
                  👤 {user?.name || '-'}
                </div>
              </div>
            </div>
            <div>
              <label
                style={{
                  display: 'block', // FIX
                  fontSize: 11, // FIX
                  fontWeight: 600, // FIX
                  marginBottom: 6, // FIX
                  color: 'var(--color-text-secondary)', // FIX
                  textTransform: 'uppercase', // FIX
                  letterSpacing: '0.05em', // FIX
                }}
              >
                Catatan Tambahan
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                placeholder="Keterangan atau informasi tambahan..."
                style={{ ...inputStyle, resize: 'vertical' as const, fontFamily: 'inherit' }}
              />
            </div>
          </div>
        </div>

        {isCashAdvance ? (
          <div
            style={{
              background: 'var(--color-background-primary)',
              border: '0.5px solid var(--color-border-tertiary)',
              borderRadius: 14,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                padding: '14px 20px',
                borderBottom: '0.5px solid var(--color-border-tertiary)',
                background: 'var(--color-background-secondary)',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <span style={{ fontSize: 16 }}>💵</span>
              <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-primary)' }}>
                Nominal dan periode penggunaan
              </span>
            </div>
            <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label
                  style={{
                    display: 'block',
                    fontSize: 11,
                    fontWeight: 600,
                    marginBottom: 6,
                    color: 'var(--color-text-secondary)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                  }}
                >
                  Nominal diajukan (Rp) *
                </label>
                <input
                  type="text"
                  value={caAmountInput}
                  onChange={(e) => setCaAmountInput(e.target.value)}
                  placeholder="0"
                  style={inputStyle}
                />
              </div>
              <div>
                <label
                  style={{
                    display: 'block',
                    fontSize: 11,
                    fontWeight: 600,
                    marginBottom: 6,
                    color: 'var(--color-text-secondary)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                  }}
                >
                  Nomor Rekening <span style={{ color: '#EF4444' }}>*</span>
                </label>
                <input
                  type="text"
                  value={nomorRekeningPengaju}
                  onChange={(e) => setNomorRekeningPengaju(e.target.value)}
                  placeholder="Contoh: 1234567890 (BCA a/n Nama)"
                  style={inputStyle}
                />
                <p style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginTop: 6 }}>
                  Digunakan untuk pengembalian dana jika terdapat kelebihan penggunaan Cash Advance.
                </p>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <div>
                  <label
                    style={{
                      display: 'block',
                      fontSize: 11,
                      fontWeight: 600,
                      marginBottom: 6,
                      color: 'var(--color-text-secondary)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                    }}
                  >
                    Mulai periode *
                  </label>
                  <input
                    type="date"
                    value={periodeFrom}
                    min={new Date().toISOString().split('T')[0]}
                    onChange={(e) => setPeriodeFrom(e.target.value)}
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label
                    style={{
                      display: 'block',
                      fontSize: 11,
                      fontWeight: 600,
                      marginBottom: 6,
                      color: 'var(--color-text-secondary)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                    }}
                  >
                    Selesai periode *
                  </label>
                  <input
                    type="date"
                    value={periodeTo}
                    min={periodeFrom || new Date().toISOString().split('T')[0]}
                    onChange={(e) => setPeriodeTo(e.target.value)}
                    style={inputStyle}
                  />
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {isReimbursement ? (
        <div
          style={{
            background: 'var(--color-background-primary)', // FIX
            border: '0.5px solid var(--color-border-tertiary)', // FIX
            borderRadius: 14, // FIX
            overflow: 'hidden', // FIX
          }}
        >
          <div
            style={{
              padding: '14px 20px', // FIX
              borderBottom: '0.5px solid var(--color-border-tertiary)', // FIX
              background: 'var(--color-background-secondary)', // FIX
              display: 'flex', // FIX
              alignItems: 'center', // FIX
              justifyContent: 'space-between', // FIX
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 16 }}>📋</span>
              <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-primary)' }}>Rincian Kebutuhan Dana</span>
              <span
                style={{
                  padding: '2px 8px', // FIX
                  borderRadius: 10, // FIX
                  background: `${accentColor}15`, // FIX
                  color: accentColor, // FIX
                  fontSize: 11, // FIX
                  fontWeight: 600, // FIX
                }}
              >
                {lineItems.length} item
              </span>
            </div>
            <button
              type="button"
              onClick={addLine}
              style={{
                display: 'inline-flex', // FIX
                alignItems: 'center', // FIX
                gap: 5, // FIX
                padding: '6px 12px', // FIX
                borderRadius: 8, // FIX
                border: 'none', // FIX
                background: `${accentColor}15`, // FIX
                color: accentColor, // FIX
                cursor: 'pointer', // FIX
                fontSize: 12, // FIX
                fontWeight: 600, // FIX
                transition: 'all 150ms', // FIX
              }}
            >
              <PlusCircle style={{ width: 13, height: 13 }} />
              Tambah Baris
            </button>
          </div>

          <div style={{ padding: '0 20px 20px', overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 16 }}>
              <thead>
                <tr>
                  {[
                    { label: 'No', w: 40 },
                    { label: 'Item / Keterangan', w: undefined },
                    { label: 'Tanggal', w: 150 },
                    { label: 'Nominal (Rp)', w: 180 },
                    { label: '', w: 36 },
                  ].map((col, i) => (
                    <th
                      key={col.label}
                      style={{
                        padding: '8px 10px', // FIX
                        textAlign: i === 3 ? 'right' : 'left', // FIX
                        fontSize: 10, // FIX
                        fontWeight: 700, // FIX
                        color: 'var(--color-text-secondary)', // FIX
                        textTransform: 'uppercase', // FIX
                        letterSpacing: '0.05em', // FIX
                        borderBottom: '2px solid var(--color-border-tertiary)', // FIX
                        width: col.w, // FIX
                      }}
                    >
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lineItems.map((line, idx) => (
                  <tr key={idx} style={{ borderBottom: '0.5px solid var(--color-border-tertiary)', transition: 'background 150ms' }}>
                    <td style={{ padding: '10px 10px' }}>
                      <div
                        style={{
                          width: 24, // FIX
                          height: 24, // FIX
                          borderRadius: '50%', // FIX
                          background: `${accentColor}15`, // FIX
                          display: 'flex', // FIX
                          alignItems: 'center', // FIX
                          justifyContent: 'center', // FIX
                          fontSize: 11, // FIX
                          fontWeight: 700, // FIX
                          color: accentColor, // FIX
                        }}
                      >
                        {line.no}
                      </div>
                    </td>
                    <td style={{ padding: '10px 10px' }}>
                      <input
                        type="text"
                        value={line.item}
                        onChange={(e) => updateLine(idx, 'item', e.target.value)}
                        placeholder="Nama item atau keterangan..."
                        style={{ ...inputStyle, minWidth: 200 }}
                      />
                    </td>
                    <td style={{ padding: '10px 10px' }}>
                      <input
                        type="date"
                        value={line.date}
                        onChange={(e) => updateLine(idx, 'date', e.target.value)}
                        style={{ ...inputStyle, width: 140 }}
                      />
                    </td>
                    <td style={{ padding: '10px 10px' }}>
                      <input
                        type="text"
                        value={line.nominal ? line.nominal.toLocaleString('id-ID') : ''}
                        onChange={(e) => updateLine(idx, 'nominal', e.target.value)}
                        placeholder="0"
                        style={{ ...inputStyle, width: 160, textAlign: 'right' }}
                      />
                    </td>
                    <td style={{ padding: '10px 6px' }}>
                      <button
                        type="button"
                        onClick={() => removeLine(idx)}
                        disabled={lineItems.length === 1}
                        style={{
                          width: 28, // FIX
                          height: 28, // FIX
                          borderRadius: 8, // FIX
                          display: 'flex', // FIX
                          alignItems: 'center', // FIX
                          justifyContent: 'center', // FIX
                          background: lineItems.length === 1 ? 'none' : '#EF444415', // FIX
                          border: 'none', // FIX
                          cursor: lineItems.length === 1 ? 'not-allowed' : 'pointer', // FIX
                          color: lineItems.length === 1 ? 'var(--color-border-tertiary)' : '#EF4444', // FIX
                          transition: 'all 150ms', // FIX
                        }}
                      >
                        <Trash2 style={{ width: 13, height: 13 }} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ background: `${accentColor}08`, borderTop: `2px solid ${accentColor}30` }}>
                  <td colSpan={2} style={{ padding: '14px 10px' }}>
                    <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--color-text-primary)', letterSpacing: '-0.2px' }}>TOTAL</span>
                  </td>
                  <td style={{ padding: '14px 10px' }} />
                  <td style={{ padding: '14px 10px', textAlign: 'right' }}>
                    <span style={{ fontSize: 18, fontWeight: 800, color: accentColor }}>{formatRp(total)}</span>
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
        ) : null}

        <ApprovalFlowBadge flow={approvalFlow} totalAmount={total} />

        {isReimbursement ? (
        <div
          style={{
            background: 'var(--color-background-primary)', // FIX
            border:
              isReimbursement && photos.length === 0 ? '1.5px solid #EF444440' : '0.5px solid var(--color-border-tertiary)', // FIX
            borderRadius: 14, // FIX
            overflow: 'hidden', // FIX
          }}
        >
          <div
            style={{
              padding: '14px 20px', // FIX
              borderBottom: '0.5px solid var(--color-border-tertiary)', // FIX
              background: isReimbursement && photos.length === 0 ? '#EF444408' : 'var(--color-background-secondary)', // FIX
              display: 'flex', // FIX
              alignItems: 'center', // FIX
              justifyContent: 'space-between', // FIX
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 16 }}>{isReimbursement ? '🧾' : '📷'}</span>
              <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-primary)' }}>Foto Bukti / Lampiran</span>
            </div>
            <span
              style={{
                padding: '4px 12px', // FIX
                borderRadius: 20, // FIX
                fontSize: 11, // FIX
                fontWeight: 700, // FIX
                background: isReimbursement ? '#EF444415' : '#8B5CF615', // FIX
                color: isReimbursement ? '#EF4444' : '#8B5CF6', // FIX
                border: `0.5px solid ${isReimbursement ? '#EF444440' : '#8B5CF640'}`, // FIX
                display: 'flex', // FIX
                alignItems: 'center', // FIX
                gap: 4, // FIX
              }}
            >
              {isReimbursement ? (
                <>
                  <AlertCircle style={{ width: 10, height: 10 }} /> WAJIB
                </>
              ) : (
                <>
                  <CheckCircle style={{ width: 10, height: 10 }} /> OPSIONAL
                </>
              )}
            </span>
          </div>

          <div style={{ padding: 20 }}>
            <div
              style={{
                fontSize: 12, // FIX
                marginBottom: 14, // FIX
                color: isReimbursement && photos.length === 0 ? '#EF4444' : 'var(--color-text-secondary)', // FIX
              }}
            >
              {isReimbursement
                ? photos.length === 0
                  ? '⚠️ Wajib upload minimal 1 foto nota/kwitansi'
                  : `✅ ${photos.length} foto terlampir — persyaratan terpenuhi`
                : photos.length > 0
                  ? `📎 ${photos.length} foto terlampir`
                  : 'Lampirkan foto pendukung jika diperlukan'}
            </div>

            {photos.length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: 10, marginBottom: 14 }}>
                {photos.map((url, i) => (
                  <div key={url + i} style={{ position: 'relative' }}>
                    <img
                      src={fixFileUrl(url)}
                      alt={photoNames[i]}
                      style={{
                        width: '100%', // FIX
                        aspectRatio: '1', // FIX
                        objectFit: 'cover', // FIX
                        borderRadius: 10, // FIX
                        cursor: 'pointer', // FIX
                        border: '1px solid var(--color-border-tertiary)', // FIX
                        transition: 'opacity 150ms', // FIX
                      }}
                      onClick={() => window.open(fixFileUrl(url), '_blank')}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setPhotos((p) => p.filter((_, j) => j !== i)); // FIX
                        setPhotoNames((p) => p.filter((_, j) => j !== i)); // FIX
                      }}
                      style={{
                        position: 'absolute', // FIX
                        top: 5, // FIX
                        right: 5, // FIX
                        width: 22, // FIX
                        height: 22, // FIX
                        borderRadius: '50%', // FIX
                        background: '#EF4444', // FIX
                        color: 'white', // FIX
                        border: 'none', // FIX
                        cursor: 'pointer', // FIX
                        display: 'flex', // FIX
                        alignItems: 'center', // FIX
                        justifyContent: 'center', // FIX
                        boxShadow: '0 2px 6px rgba(0,0,0,0.3)', // FIX
                      }}
                    >
                      <X style={{ width: 11, height: 11 }} />
                    </button>
                    <div
                      style={{
                        fontSize: 9, // FIX
                        padding: '3px 6px', // FIX
                        color: 'var(--color-text-secondary)', // FIX
                        overflow: 'hidden', // FIX
                        textOverflow: 'ellipsis', // FIX
                        whiteSpace: 'nowrap', // FIX
                      }}
                    >
                      {photoNames[i]}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <label
              style={{
                display: 'flex', // FIX
                alignItems: 'center', // FIX
                gap: 14, // FIX
                padding: '16px 20px', // FIX
                borderRadius: 12, // FIX
                cursor: uploading ? 'wait' : 'pointer', // FIX
                border: `2px dashed ${
                  uploading ? accentColor : isReimbursement && photos.length === 0 ? '#EF4444' : 'var(--color-border-tertiary)'
                }`, // FIX
                background: uploading ? `${accentColor}05` : isReimbursement && photos.length === 0 ? '#EF444405' : 'var(--color-background-secondary)', // FIX
                transition: 'all 200ms', // FIX
              }}
            >
              <div
                style={{
                  width: 44, // FIX
                  height: 44, // FIX
                  borderRadius: 10, // FIX
                  flexShrink: 0, // FIX
                  background: uploading ? `${accentColor}20` : isReimbursement && photos.length === 0 ? '#EF444415' : 'var(--color-background-primary)', // FIX
                  display: 'flex', // FIX
                  alignItems: 'center', // FIX
                  justifyContent: 'center', // FIX
                  fontSize: 22, // FIX
                  border: '1px solid var(--color-border-tertiary)', // FIX
                }}
              >
                {uploading ? '⏳' : isReimbursement ? '🧾' : '📷'}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary)' }}>
                  {uploading ? 'Mengupload foto...' : isReimbursement ? 'Upload foto nota / kwitansi' : 'Upload foto pendukung (opsional)'}
                </div>
                <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginTop: 3 }}>JPG, PNG — Max 10MB per foto · Bisa pilih banyak</div>
              </div>
              <div
                style={{
                  display: 'flex', // FIX
                  alignItems: 'center', // FIX
                  gap: 6, // FIX
                  padding: '8px 14px', // FIX
                  borderRadius: 8, // FIX
                  background: isReimbursement && photos.length === 0 ? '#EF4444' : accentColor, // FIX
                  color: 'white', // FIX
                  fontSize: 12, // FIX
                  fontWeight: 600, // FIX
                  flexShrink: 0, // FIX
                }}
              >
                <Upload style={{ width: 13, height: 13 }} />
                Pilih Foto
              </div>
              <input
                type="file"
                multiple
                accept="image/*"
                disabled={uploading}
                style={{ display: 'none' }}
                onChange={(e) => {
                  handlePhotoUpload(e.target.files); // FIX
                  e.target.value = ''; // FIX
                }}
              />
            </label>
          </div>
        </div>
        ) : null}

        <div
          style={{
            background: 'var(--color-background-primary)', // FIX
            border: '0.5px solid var(--color-border-tertiary)', // FIX
            borderRadius: 16, // FIX
            overflow: 'hidden', // FIX
          }}
        >
          <div
            style={{
              padding: '20px 24px', // FIX
              background: canSubmit ? `linear-gradient(135deg, ${accentColor}15, ${accentColor}05)` : 'var(--color-background-secondary)', // FIX
              borderBottom: '0.5px solid var(--color-border-tertiary)', // FIX
              display: 'flex', // FIX
              alignItems: 'center', // FIX
              justifyContent: 'space-between', // FIX
              flexWrap: 'wrap', // FIX
              gap: 12, // FIX
            }}
          >
            <div>
              <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 2 }}>
                Total {isCashAdvance ? 'Cash Advance' : 'Reimbursement'}
              </div>
              <div
                style={{
                  fontSize: 30, // FIX
                  fontWeight: 800, // FIX
                  color: canSubmit ? accentColor : 'var(--color-text-secondary)', // FIX
                  letterSpacing: '-0.5px', // FIX
                }}
              >
                {formatRp(total)}
              </div>
              <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginTop: 3, display: 'flex', alignItems: 'center', gap: 8 }}>
                {isCashAdvance ? (
                  <span>
                    Periode: {periodeFrom || '—'} → {periodeTo || '—'}
                  </span>
                ) : (
                  <span>{lineItems.filter((l) => l.item.trim()).length} item</span>
                )}
                {isReimbursement && (
                  <span style={{ color: photos.length > 0 ? '#22C55E' : '#EF4444', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 3 }}>
                    {photos.length > 0 ? (
                      <>
                        <CheckCircle style={{ width: 10, height: 10 }} />
                        {photos.length} foto bukti
                      </>
                    ) : (
                      <>
                        <AlertCircle style={{ width: 10, height: 10 }} />
                        Foto belum diupload
                      </>
                    )}
                  </span>
                )}
              </div>
            </div>

            {total > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                {approvalFlow.slice(1).map((st, i) => (
                  <div key={`${st.role}-mini-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                    {i > 0 && <ChevronRight style={{ width: 10, height: 10, color: 'var(--color-text-secondary)' }} />}
                    <div
                      style={{
                        padding: '3px 8px', // FIX
                        borderRadius: 6, // FIX
                        background: `${st.color}15`, // FIX
                        border: `0.5px solid ${st.color}30`, // FIX
                        fontSize: 10, // FIX
                        color: st.color, // FIX
                        fontWeight: 600, // FIX
                        whiteSpace: 'nowrap', // FIX
                      }}
                    >
                      {st.icon} {st.label}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{ padding: '16px 24px', display: 'flex', gap: 12, alignItems: 'center' }}>
            <button
              type="button"
              onClick={onBack}
              disabled={saving}
              style={{
                display: 'inline-flex', // FIX
                alignItems: 'center', // FIX
                gap: 8, // FIX
                padding: '12px 24px', // FIX
                borderRadius: 12, // FIX
                border: '1.5px solid var(--color-border-tertiary)', // FIX
                background: 'none', // FIX
                cursor: saving ? 'not-allowed' : 'pointer', // FIX
                fontSize: 14, // FIX
                fontWeight: 600, // FIX
                color: 'var(--color-text-secondary)', // FIX
                transition: 'all 200ms', // FIX
                opacity: saving ? 0.6 : 1, // FIX
              }}
              onMouseEnter={(e) => {
                if (saving) return; // FIX
                (e.currentTarget as HTMLElement).style.borderColor = '#EF4444'; // FIX
                (e.currentTarget as HTMLElement).style.color = '#EF4444'; // FIX
                (e.currentTarget as HTMLElement).style.background = '#EF444408'; // FIX
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.borderColor = ''; // FIX
                (e.currentTarget as HTMLElement).style.color = ''; // FIX
                (e.currentTarget as HTMLElement).style.background = 'none'; // FIX
              }}
            >
              <X style={{ width: 16, height: 16 }} />
              Batal
            </button>

            <button
              type="button"
              onClick={handleSubmit}
              disabled={!canSubmit}
              style={{
                flex: 1, // FIX
                display: 'flex', // FIX
                alignItems: 'center', // FIX
                justifyContent: 'center', // FIX
                gap: 10, // FIX
                padding: '13px 28px', // FIX
                borderRadius: 12, // FIX
                border: 'none', // FIX
                background: canSubmit ? `linear-gradient(135deg, ${accentColor}, ${isCashAdvance ? '#00B89E' : '#2563EB'})` : 'var(--color-background-secondary)', // FIX
                color: canSubmit ? 'white' : 'var(--color-text-secondary)', // FIX
                cursor: canSubmit ? 'pointer' : 'not-allowed', // FIX
                fontSize: 15, // FIX
                fontWeight: 700, // FIX
                letterSpacing: '-0.2px', // FIX
                boxShadow: canSubmit ? `0 6px 20px ${accentColor}50` : 'none', // FIX
                transition: 'all 200ms', // FIX
              }}
              onMouseEnter={(e) => {
                if (!canSubmit) return; // FIX
                (e.currentTarget as HTMLElement).style.transform = 'translateY(-1px)'; // FIX
                (e.currentTarget as HTMLElement).style.boxShadow = `0 10px 28px ${accentColor}60`; // FIX
              }}
              onMouseLeave={(e) => {
                if (!canSubmit) return; // FIX
                (e.currentTarget as HTMLElement).style.transform = 'none'; // FIX
                (e.currentTarget as HTMLElement).style.boxShadow = `0 6px 20px ${accentColor}50`; // FIX
              }}
            >
              {saving ? (
                <>
                  <div
                    style={{
                      width: 18, // FIX
                      height: 18, // FIX
                      border: '2px solid white', // FIX
                      borderTopColor: 'transparent', // FIX
                      borderRadius: '50%', // FIX
                      animation: 'cashOpSubmitSpin 0.8s linear infinite', // FIX
                    }}
                  />
                  Memproses...
                </>
              ) : (
                <>
                  <Send style={{ width: 18, height: 18 }} />
                  {isCashAdvance ? 'Ajukan Cash Advance' : 'Ajukan Reimbursement'}
                </>
              )}
            </button>
          </div>

          {!canSubmit && (
            <div style={{ padding: '0 24px 16px' }}>
              {!title.trim() && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#F59E0B', padding: '6px 10px', borderRadius: 6, background: '#F59E0B08' }}>
                  <AlertCircle style={{ width: 12, height: 12 }} />
                  Judul pengajuan wajib diisi
                </div>
              )}
              {(!hasValidLine || total === 0) && (
                <div
                  style={{
                    display: 'flex', // FIX
                    alignItems: 'center', // FIX
                    gap: 6, // FIX
                    fontSize: 12, // FIX
                    color: '#F59E0B', // FIX
                    padding: '6px 10px', // FIX
                    borderRadius: 6, // FIX
                    background: '#F59E0B08', // FIX
                    marginTop: 4, // FIX
                  }}
                >
                  <AlertCircle style={{ width: 12, height: 12 }} />
                  Minimal 1 item dengan keterangan dan nominal
                </div>
              )}
              {isReimbursement && photos.length === 0 && (
                <div
                  style={{
                    display: 'flex', // FIX
                    alignItems: 'center', // FIX
                    gap: 6, // FIX
                    fontSize: 12, // FIX
                    color: '#EF4444', // FIX
                    padding: '6px 10px', // FIX
                    borderRadius: 6, // FIX
                    background: '#EF444408', // FIX
                    marginTop: 4, // FIX
                  }}
                >
                  <AlertCircle style={{ width: 12, height: 12 }} />
                  Upload minimal 1 foto bukti untuk reimbursement
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
} // FIX

export default function NewCashOperationPage() {
  // FIX
  const [category, setCategory] = useState<CashCategory | null>(null); // FIX

  if (!category) {
    return (
      <div style={{ padding: '0 0 40px' }}>
        <CategorySelector onSelect={setCategory} />
      </div>
    );
  }

  return (
    <div style={{ padding: '0 0 40px' }}>
      <CashOperationForm category={category} onBack={() => setCategory(null)} />
    </div>
  );
} // FIX
