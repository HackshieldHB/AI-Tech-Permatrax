'use client';

// FIX: full modern UI rewrite — card-style access difficulty selector, step indicator, next-step banner
import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuthStore } from '../../../../../store/authStore';
import { apiGet, apiPost } from '../../../../../lib/api';
import { toast } from 'sonner';
import {
  ArrowLeft, Save, ClipboardList, Construction,
  ChevronRight, CheckCircle,
} from 'lucide-react';
import { isPmOrSurveyorRole } from '../../../../../lib/roles';

// FIX: shared 6-step indicator labels
const SURVEY_STEPS = ['BA Open', 'Kunjungan', 'Data Survey', 'Route', 'SIP', 'Dokumen'];

// FIX: visual access difficulty cards — replaces native <select> for better UX
const ACCESS_OPTIONS = [
  { value: 'EASY',      label: 'Mudah',   desc: 'Jalan besar, akses kendaraan roda 4', icon: '🟢', color: '#22C55E' },
  { value: 'MODERATE',  label: 'Sedang',  desc: 'Jalan kecil, akses motor',            icon: '🟡', color: '#F59E0B' },
  { value: 'DIFFICULT', label: 'Sulit',   desc: 'Gang sempit, jalan kaki saja',        icon: '🔴', color: '#EF4444' },
];

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
  const [focused, setFocused] = useState(false); // FIX: focus-accent
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

export default function SurveyInputPage() {
  const { id: clusterId } = useParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuthStore();

  const [cluster, setCluster] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false); // FIX: post-save banner state

  const [form, setForm] = useState({
    areaCondition: '',
    accessDifficulty: 'EASY' as 'EASY' | 'MODERATE' | 'DIFFICULT',
    existingInfra: '',
    surveyNotes: '',
  });

  const setField = useCallback(
    <K extends keyof typeof form>(key: K) =>
      (value: (typeof form)[K]) =>
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
              areaCondition:    survey.areaCondition || '',
              accessDifficulty: (survey.accessDifficulty || 'EASY') as any,
              existingInfra:    survey.existingInfra || '',
              surveyNotes:      survey.surveyNotes || '',
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
      await apiPost(`/permit-clusters/${clusterId}/survey/survey-input`, form);
      setSaved(true); // FIX: show next-step banner instead of immediate navigation
      toast.success('Data survey berhasil disimpan');
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
          <span style={{ color: 'var(--color-text-primary)' }}>Data Survey</span>
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
              Input Data Survey Lapangan
            </h1>
            <p
              style={{
                fontSize: 13,
                color: 'var(--color-text-secondary)',
                margin: '4px 0 0',
              }}
            >
              Phase 5 — Kondisi area, kesulitan akses, dan infrastruktur existing
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
            {cl?.ispCustomer ? (
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
                {cl.ispCustomer}
              </span>
            ) : null}
          </div>
        </div>
      </div>

      <StepIndicator current={2} />

      {canEdit ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* FIX: Section 1 — Kondisi Area + Access Difficulty (teal accent, card selector) */}
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
                marginBottom: 20,
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
                <ClipboardList style={{ width: 16, height: 16, color: '#00D4B4' }} />
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
                  Kondisi Area
                </h3>
                <p
                  style={{
                    fontSize: 12,
                    color: 'var(--color-text-secondary)',
                    margin: 0,
                  }}
                >
                  Deskripsikan situasi lapangan dan tingkat kesulitan akses
                </p>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              <FormTextarea
                label="Deskripsi Kondisi Area"
                value={form.areaCondition}
                onChange={setField('areaCondition')}
                placeholder="Jelaskan karakter area: tipe jalan, kepadatan, kondisi bangunan, dll."
                rows={3}
              />

              <div>
                <label
                  style={{
                    display: 'block',
                    fontSize: 11,
                    fontWeight: 600,
                    color: 'var(--color-text-secondary)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                    marginBottom: 10,
                  }}
                >
                  Tingkat Kesulitan Akses
                </label>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                    gap: 10,
                  }}
                >
                  {ACCESS_OPTIONS.map((opt) => {
                    const selected = form.accessDifficulty === opt.value;
                    return (
                      <div
                        key={opt.value}
                        onClick={() =>
                          setForm((p) => ({ ...p, accessDifficulty: opt.value as any }))
                        }
                        role="button"
                        tabIndex={0}
                        style={{
                          padding: '14px 14px',
                          borderRadius: 10,
                          cursor: 'pointer',
                          border: `2px solid ${selected ? opt.color : 'var(--color-border-tertiary)'}`,
                          background: selected ? `${opt.color}15` : 'var(--color-background-primary)',
                          transition: 'all 150ms',
                          userSelect: 'none',
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            marginBottom: 4,
                          }}
                        >
                          <div style={{ fontSize: 20 }}>{opt.icon}</div>
                          {selected ? (
                            <CheckCircle
                              style={{ width: 16, height: 16, color: opt.color }}
                            />
                          ) : null}
                        </div>
                        <div
                          style={{
                            fontSize: 13,
                            fontWeight: 600,
                            color: 'var(--color-text-primary)',
                          }}
                        >
                          {opt.label}
                        </div>
                        <div
                          style={{
                            fontSize: 11,
                            color: 'var(--color-text-secondary)',
                            marginTop: 3,
                            lineHeight: 1.4,
                          }}
                        >
                          {opt.desc}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* FIX: Section 2 — Infrastruktur Existing (blue accent) */}
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
                <Construction
                  style={{ width: 16, height: 16, color: '#3B82F6' }}
                />
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
                  Infrastruktur Existing
                </h3>
                <p
                  style={{
                    fontSize: 12,
                    color: 'var(--color-text-secondary)',
                    margin: 0,
                  }}
                >
                  Jaringan competitor, tiang, duct yang sudah ada
                </p>
              </div>
            </div>
            <FormTextarea
              label="Competitor / Tiang / Duct"
              value={form.existingInfra}
              onChange={setField('existingInfra')}
              placeholder="Contoh: Ada Indihome di RT 01, MyRepublic di sepanjang jalan utama. Tiang PLN di setiap 40m."
              rows={3}
              hint="Info ini dipakai untuk perencanaan jalur kabel dan strategi bisnis"
            />
          </div>

          {/* FIX: Section 3 — Catatan Survey (amber accent) */}
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
                  Catatan Survey
                </h3>
                <p
                  style={{
                    fontSize: 12,
                    color: 'var(--color-text-secondary)',
                    margin: 0,
                  }}
                >
                  Temuan teknis tambahan, permintaan khusus, risiko
                </p>
              </div>
            </div>
            <FormTextarea
              label="Catatan"
              value={form.surveyNotes}
              onChange={setField('surveyNotes')}
              placeholder="Contoh: Ada sungai kecil di tengah cluster — perlu kabel khusus. Warga keberatan pole di depan masjid."
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
                {saving ? 'Menyimpan...' : 'Simpan Data Survey'}
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
                    Data survey berhasil disimpan!
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
                    Langkah berikutnya: Survey Route & Homepass
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <button
                  onClick={() => router.push(`/permit-clusters/${clusterId}/route-survey`)}
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
                  Lanjut: Route Survey →
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
                  Kembali ke Pipeline
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', fontStyle: 'italic' }}>
          Hanya Surveyor atau PM lapangan yang dapat mengedit survey input.
        </p>
      )}
    </div>
  );
}
