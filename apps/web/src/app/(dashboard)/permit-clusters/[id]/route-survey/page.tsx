'use client';

// FIX: full modern UI rewrite — large homepass number input, km auto-conversion, next-step banner
import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuthStore } from '../../../../../store/authStore';
import { apiGet, apiPost } from '../../../../../lib/api';
import { toast } from 'sonner';
import {
  ArrowLeft, Save, Route as RouteIcon, Ruler,
  ChevronRight, CheckCircle,
} from 'lucide-react';
import { isPmOrSurveyorRole } from '../../../../../lib/roles';

const SURVEY_STEPS = ['BA Open', 'Kunjungan', 'Data Survey', 'Route', 'SIP', 'Dokumen'];

function FormTextarea({
  label, value, onChange, placeholder, rows = 3, hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
  hint?: string;
}) {
  const [focused, setFocused] = useState(false); // FIX: focus accent for textarea
  return (
    <div>
      <label
        style={{
          display: 'block',
          fontSize: 11,
          fontWeight: 600,
          color: 'var(--color-text-secondary)',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          marginBottom: 6,
        }}
      >
        {label}
      </label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={placeholder}
        rows={rows}
        style={{
          width: '100%',
          boxSizing: 'border-box',
          padding: '10px 12px',
          borderRadius: 8,
          fontSize: 14,
          border: `1.5px solid ${focused ? '#00D4B4' : 'var(--color-border-tertiary)'}`,
          background: 'var(--color-background-primary)',
          color: 'var(--color-text-primary)',
          outline: 'none',
          resize: 'vertical',
          transition: 'border-color 150ms',
          fontFamily: 'inherit',
        }}
      />
      {hint ? (
        <p style={{ fontSize: 11, color: 'var(--color-text-secondary)', margin: '4px 0 0' }}>
          💡 {hint}
        </p>
      ) : null}
    </div>
  );
}

function StepIndicator({ current }: { current: number }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        background: 'var(--color-background-secondary)',
        borderRadius: 10,
        padding: '10px 16px',
        marginBottom: 24,
        overflowX: 'auto',
      }}
    >
      {SURVEY_STEPS.map((step, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            <div
              style={{
                width: 24,
                height: 24,
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 10,
                fontWeight: 700,
                background: i < current ? '#00D4B4' : i === current ? '#00D4B420' : 'transparent',
                color: i < current ? 'white' : i === current ? '#00D4B4' : 'var(--color-text-secondary)',
                border: i === current
                  ? '1.5px solid #00D4B4'
                  : i < current
                    ? 'none'
                    : '1px solid var(--color-border-tertiary)',
              }}
            >
              {i < current ? '✓' : i + 1}
            </div>
            <span
              style={{
                fontSize: 11,
                whiteSpace: 'nowrap',
                fontWeight: i === current ? 600 : 400,
                color:
                  i === current ? 'var(--color-text-primary)'
                    : i < current ? '#00D4B4'
                      : 'var(--color-text-secondary)',
              }}
            >
              {step}
            </span>
          </div>
          {i < SURVEY_STEPS.length - 1 ? (
            <div
              style={{
                flex: 1,
                height: 1,
                margin: '0 6px',
                background: i < current ? '#00D4B4' : 'var(--color-border-tertiary)',
                minWidth: 8,
              }}
            />
          ) : null}
        </div>
      ))}
    </div>
  );
}

export default function RouteSurveyPage() {
  const { id: clusterId } = useParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuthStore();

  const [cluster, setCluster] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false); // FIX: post-save banner state

  const [form, setForm] = useState({
    homepasCount: '',
    routeDistanceM: '',
    routeNotes: '',
  });

  const setField = useCallback(
    (key: keyof typeof form) => (value: string) =>
      setForm((prev) => ({ ...prev, [key]: value })),
    [],
  );

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const data = await apiGet<any>(`/permit-clusters/${clusterId}`);
        setCluster(data);
        try {
          const survey = await apiGet<any>(`/permit-clusters/${clusterId}/survey`);
          if (survey) {
            setForm({
              homepasCount:   survey.homepasCount   != null ? String(survey.homepasCount)   : '',
              routeDistanceM: survey.routeDistanceM != null ? String(survey.routeDistanceM) : '',
              routeNotes:     survey.routeNotes || '',
            });
          }
        } catch {
          // no existing survey yet
        }
      } catch {
        toast.error('Gagal memuat data cluster');
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [clusterId]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await apiPost(`/permit-clusters/${clusterId}/survey/route-survey`, {
        homepasCount:   form.homepasCount   !== '' ? Number(form.homepasCount)   : undefined,
        routeDistanceM: form.routeDistanceM !== '' ? Number(form.routeDistanceM) : undefined,
        routeNotes:     form.routeNotes,
      });
      setSaved(true); // FIX: show next-step banner instead of immediate navigation
      toast.success('Route survey berhasil disimpan');
    } catch (err: any) {
      toast.error(err?.message || 'Gagal menyimpan');
    } finally {
      setSaving(false);
    }
  };

  const canEdit = isPmOrSurveyorRole(user?.role);

  if (loading) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: 300,
          color: 'var(--color-text-secondary)',
          fontSize: 14,
        }}
      >
        <div>⏳ Memuat data cluster...</div>
      </div>
    );
  }

  const cl = cluster?.visitRequest?.cleanList;
  const hpNum = Number(form.homepasCount) || 0;
  const targetHp = Number(cl?.homepasCount) || 0;
  const hpPct = targetHp > 0 ? Math.min(100, Math.round((hpNum / targetHp) * 100)) : 0;

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '0 0 60px' }}>
      <button
        onClick={() => router.push(`/permit-clusters/${clusterId}`)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '7px 14px',
          borderRadius: 8,
          border: '0.5px solid var(--color-border-tertiary)',
          background: 'none',
          cursor: 'pointer',
          fontSize: 13,
          color: 'var(--color-text-secondary)',
          marginBottom: 20,
        }}
      >
        <ArrowLeft style={{ width: 14, height: 14 }} />
        Kembali ke Pipeline
      </button>

      <div style={{ marginBottom: 24 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            marginBottom: 8,
            fontSize: 12,
            color: 'var(--color-text-secondary)',
          }}
        >
          <span
            onClick={() => router.push('/permit-clusters')}
            style={{ cursor: 'pointer', textDecoration: 'underline' }}
          >
            Pipeline
          </span>
          <ChevronRight style={{ width: 12, height: 12 }} />
          <span
            onClick={() => router.push(`/permit-clusters/${clusterId}`)}
            style={{ cursor: 'pointer', textDecoration: 'underline' }}
          >
            {cluster?.clusterCode}
          </span>
          <ChevronRight style={{ width: 12, height: 12 }} />
          <span style={{ color: 'var(--color-text-primary)' }}>Route Survey</span>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 12,
          }}
        >
          <div>
            <h1
              style={{
                fontSize: 22,
                fontWeight: 700,
                margin: 0,
                color: 'var(--color-text-primary)',
              }}
            >
              Route Survey & Homepass
            </h1>
            <p
              style={{
                fontSize: 13,
                color: 'var(--color-text-secondary)',
                margin: '4px 0 0',
              }}
            >
              Phase 6 — Jumlah homepass dan panjang jalur kabel fiber
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <span
              style={{
                padding: '5px 12px',
                borderRadius: 20,
                fontSize: 12,
                background: 'var(--color-background-secondary)',
                color: 'var(--color-text-primary)',
                fontWeight: 500,
              }}
            >
              📍 {cluster?.clusterCode}
            </span>
            {targetHp > 0 ? (
              <span
                style={{
                  padding: '5px 12px',
                  borderRadius: 20,
                  fontSize: 12,
                  background: '#00D4B415',
                  color: '#00D4B4',
                  fontWeight: 500,
                  border: '0.5px solid #00D4B440',
                }}
              >
                Target: {targetHp} HP
              </span>
            ) : null}
          </div>
        </div>
      </div>

      <StepIndicator current={3} />

      {/* FIX: Info / tips box */}
      <div
        style={{
          padding: '14px 18px',
          borderRadius: 10,
          background: '#3B82F615',
          border: '0.5px solid #3B82F640',
          marginBottom: 16,
        }}
      >
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: '#3B82F6',
            marginBottom: 4,
          }}
        >
          💡 Tips Survey Route
        </div>
        <div
          style={{
            fontSize: 12,
            color: 'var(--color-text-secondary)',
            lineHeight: 1.5,
          }}
        >
          Gunakan aplikasi lapangan untuk marking homepass dengan GPS secara akurat.
          Hitung homepass dari batas cluster sesuai KMZ boundary yang telah ditentukan.
        </div>
      </div>

      {canEdit ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* FIX: Homepass — large centered number input (teal accent) */}
          <div
            style={{
              background: 'var(--color-background-primary)',
              border: '0.5px solid var(--color-border-tertiary)',
              borderLeft: '3px solid #00D4B4',
              borderRadius: 12,
              padding: 24,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                marginBottom: 12,
              }}
            >
              <div
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 8,
                  background: '#00D4B415',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <RouteIcon style={{ width: 16, height: 16, color: '#00D4B4' }} />
              </div>
              <div>
                <h3
                  style={{
                    fontSize: 15,
                    fontWeight: 600,
                    margin: 0,
                    color: 'var(--color-text-primary)',
                  }}
                >
                  Jumlah Homepass
                </h3>
                <p
                  style={{
                    fontSize: 12,
                    color: 'var(--color-text-secondary)',
                    margin: 0,
                  }}
                >
                  Rumah / unit yang bisa dilayani fiber
                </p>
              </div>
            </div>

            <div style={{ textAlign: 'center', padding: '12px 0 8px' }}>
              <input
                type="number"
                value={form.homepasCount}
                onChange={(e) => setField('homepasCount')(e.target.value)}
                min={0}
                placeholder="0"
                style={{
                  fontSize: 48,
                  fontWeight: 700,
                  textAlign: 'center',
                  width: '100%',
                  border: 'none',
                  background: 'transparent',
                  color: '#00D4B4',
                  outline: 'none',
                  padding: 0,
                  fontFamily: 'inherit',
                }}
              />
              <div
                style={{
                  fontSize: 13,
                  color: 'var(--color-text-secondary)',
                  marginTop: 2,
                }}
              >
                rumah yang bisa dilayani
              </div>
              {targetHp > 0 ? (
                <div style={{ marginTop: 14, padding: '0 20px' }}>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      fontSize: 11,
                      color: 'var(--color-text-secondary)',
                      marginBottom: 4,
                    }}
                  >
                    <span>Terhadap target {targetHp} HP</span>
                    <span style={{ fontWeight: 600, color: '#00D4B4' }}>{hpPct}%</span>
                  </div>
                  <div
                    style={{
                      height: 6,
                      background: 'var(--color-background-secondary)',
                      borderRadius: 3,
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        height: '100%',
                        width: `${hpPct}%`,
                        background: '#00D4B4',
                        borderRadius: 3,
                        transition: 'width 400ms ease',
                      }}
                    />
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          {/* FIX: Route distance with km auto-conversion (blue accent) */}
          <div
            style={{
              background: 'var(--color-background-primary)',
              border: '0.5px solid var(--color-border-tertiary)',
              borderLeft: '3px solid #3B82F6',
              borderRadius: 12,
              padding: 24,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                marginBottom: 16,
              }}
            >
              <div
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 8,
                  background: '#3B82F615',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Ruler style={{ width: 16, height: 16, color: '#3B82F6' }} />
              </div>
              <div>
                <h3
                  style={{
                    fontSize: 15,
                    fontWeight: 600,
                    margin: 0,
                    color: 'var(--color-text-primary)',
                  }}
                >
                  Panjang Jalur Kabel
                </h3>
                <p
                  style={{
                    fontSize: 12,
                    color: 'var(--color-text-secondary)',
                    margin: 0,
                  }}
                >
                  Total panjang jalur fiber dalam meter
                </p>
              </div>
            </div>
            <RouteDistanceInput
              value={form.routeDistanceM}
              onChange={setField('routeDistanceM')}
            />
          </div>

          {/* FIX: Catatan Rute (amber accent) */}
          <div
            style={{
              background: 'var(--color-background-primary)',
              border: '0.5px solid var(--color-border-tertiary)',
              borderLeft: '3px solid #F59E0B',
              borderRadius: 12,
              padding: 24,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                marginBottom: 16,
              }}
            >
              <div
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 8,
                  background: '#F59E0B15',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 16,
                }}
              >
                📝
              </div>
              <div>
                <h3
                  style={{
                    fontSize: 15,
                    fontWeight: 600,
                    margin: 0,
                    color: 'var(--color-text-primary)',
                  }}
                >
                  Catatan Rute
                </h3>
                <p
                  style={{
                    fontSize: 12,
                    color: 'var(--color-text-secondary)',
                    margin: 0,
                  }}
                >
                  Titik hambatan, area khusus, permintaan warga
                </p>
              </div>
            </div>
            <FormTextarea
              label="Catatan"
              value={form.routeNotes}
              onChange={setField('routeNotes')}
              placeholder="Contoh: Jalur utama lewat Jl. Mawar (250m) · Gang sempit di RT 03 perlu kabel ATB · Ada underpass 20m."
              rows={4}
            />
          </div>

          {!saved ? (
            <div style={{ display: 'flex', gap: 10, paddingTop: 8 }}>
              <button
                onClick={handleSave}
                disabled={saving}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '12px 28px',
                  borderRadius: 10,
                  border: 'none',
                  background: saving ? 'var(--color-background-secondary)' : '#00D4B4',
                  color: saving ? 'var(--color-text-secondary)' : 'white',
                  cursor: saving ? 'not-allowed' : 'pointer',
                  fontSize: 14,
                  fontWeight: 600,
                  boxShadow: saving ? 'none' : '0 4px 14px #00D4B440',
                }}
              >
                <Save style={{ width: 16, height: 16 }} />
                {saving ? 'Menyimpan...' : 'Simpan Route Survey'}
              </button>
              <button
                onClick={() => router.push(`/permit-clusters/${clusterId}`)}
                style={{
                  padding: '12px 20px',
                  borderRadius: 10,
                  border: '0.5px solid var(--color-border-tertiary)',
                  background: 'none',
                  cursor: 'pointer',
                  fontSize: 14,
                  color: 'var(--color-text-secondary)',
                }}
              >
                Batal
              </button>
            </div>
          ) : (
            <div
              style={{
                padding: '16px 20px',
                borderRadius: 12,
                background: 'linear-gradient(135deg, #00D4B415, #3B82F615)',
                border: '0.5px solid #00D4B440',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  marginBottom: 12,
                }}
              >
                <CheckCircle style={{ width: 20, height: 20, color: '#00D4B4', flexShrink: 0 }} />
                <div>
                  <div
                    style={{
                      fontSize: 14,
                      fontWeight: 600,
                      color: 'var(--color-text-primary)',
                    }}
                  >
                    Route survey berhasil disimpan!
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
                    Langkah berikutnya: Isi Form SIP (19 Fields)
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <button
                  onClick={() => router.push(`/permit-clusters/${clusterId}/sip`)}
                  style={{
                    padding: '10px 20px',
                    borderRadius: 8,
                    border: 'none',
                    background: '#00D4B4',
                    color: 'white',
                    cursor: 'pointer',
                    fontSize: 13,
                    fontWeight: 600,
                  }}
                >
                  Lanjut: Isi Form SIP →
                </button>
                <button
                  onClick={() => router.push(`/permit-clusters/${clusterId}/evidence`)}
                  style={{
                    padding: '10px 16px',
                    borderRadius: 8,
                    border: '0.5px solid #00D4B440',
                    background: 'none',
                    cursor: 'pointer',
                    fontSize: 13,
                    color: '#00D4B4',
                  }}
                >
                  Upload Foto Evidence
                </button>
                <button
                  onClick={() => router.push(`/permit-clusters/${clusterId}`)}
                  style={{
                    padding: '10px 16px',
                    borderRadius: 8,
                    border: '0.5px solid var(--color-border-tertiary)',
                    background: 'none',
                    cursor: 'pointer',
                    fontSize: 13,
                    color: 'var(--color-text-secondary)',
                  }}
                >
                  Kembali
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', fontStyle: 'italic' }}>
          Hanya Surveyor atau PM lapangan yang dapat mengisi route survey.
        </p>
      )}
    </div>
  );
}

// FIX: dedicated distance input component — shows live km auto-conversion
function RouteDistanceInput({
  value, onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [focused, setFocused] = useState(false);
  const meters = Number(value) || 0;
  const km = meters / 1000;
  return (
    <div>
      <label
        style={{
          display: 'block',
          fontSize: 11,
          fontWeight: 600,
          color: 'var(--color-text-secondary)',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          marginBottom: 6,
        }}
      >
        Panjang Rute (meter)
      </label>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        min={0}
        placeholder="Contoh: 1250"
        style={{
          width: '100%',
          boxSizing: 'border-box',
          padding: '10px 12px',
          borderRadius: 8,
          fontSize: 14,
          border: `1.5px solid ${focused ? '#3B82F6' : 'var(--color-border-tertiary)'}`,
          background: 'var(--color-background-primary)',
          color: 'var(--color-text-primary)',
          outline: 'none',
          transition: 'border-color 150ms',
          fontFamily: 'inherit',
        }}
      />
      <div
        style={{
          fontSize: 12,
          color: 'var(--color-text-secondary)',
          marginTop: 6,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        <span>≈</span>
        <strong style={{ color: '#3B82F6', fontWeight: 600 }}>{km.toFixed(2)} km</strong>
        <span>· auto-converted</span>
      </div>
    </div>
  );
}
