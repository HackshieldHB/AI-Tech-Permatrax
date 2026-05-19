'use client'; // FIX: phase 16 — surveyor BAK form + PM/Admin review (BakAgreement API)

import { useState, useEffect, useCallback, type CSSProperties } from 'react'; // FIX
import { useAuthStore } from '../../../../store/authStore'; // FIX
import { apiGet, apiPost, fixFileUrl, uploadFile } from '../../../../lib/api'; // FIX
import { toast } from 'sonner'; // FIX
import { isPmRole, isSurveyorRole } from '../../../../lib/roles';

type BakAgreementRow = Record<string, any>; // FIX

export function BakGenerationPhasePanel({ // FIX
  clusterId, // FIX
  fetchCluster, // FIX
}: {
  clusterId: string; // FIX
  fetchCluster: () => Promise<void>; // FIX
}) {
  const { user } = useAuthStore(); // FIX

  const isSurveyor = isSurveyorRole(user?.role);
  const isPM = isPmRole(user?.role);
  const isAdmin = user?.role === 'ADMIN'; // FIX

  const [bak, setBak] = useState<BakAgreementRow | null>(null); // FIX
  const [bakLoading, setBakLoading] = useState(true); // FIX
  const [bakSaving, setBakSaving] = useState(false); // FIX
  const [showReject, setShowReject] = useState(false); // FIX
  const [rejectNotes, setRejectNotes] = useState(''); // FIX
  const [useDigitalSign, setUseDigitalSign] = useState(false); // FIX

  const [form, setForm] = useState({
    wpNama: '',
    wpNoKtp: '',
    wpJabatan: '',
    wpAlamat: '',
    wpNoTelp: '',
    tipeLokasiType: '',
    tipeLokasiOther: '',
    namaLokasi: '',
    alamatLokasi: '',
    alamatKantorPemasaran: '',
    jangkaWaktu: '',
    homepasExisting: '',
    kategoriPerumahan: '',
    occupancy: '',
    penempatanKabel: '',
    existingCompetitor: '',
    benefitIsp: '',
    areaDimeterM: '',
    benefitPemilik: '',
    ketentuanListrik: 'Pembayaran langsung ke PLN dengan KWH meter yang terpakai',
    ketentuanTambahan: '',
    signatureIspName: '',
    signaturePemilikName: '',
    signatureIspUrl: '',
    signaturePemilikUrl: '',
    ktpPhotoUrls: [] as string[],
    stempelPhotoUrl: '',
  }); // FIX

  const [uploadingKtp, setUploadingKtp] = useState(false); // FIX
  const [uploadingSign, setUploadingSign] = useState(''); // FIX
  const [uploadingBak, setUploadingBak] = useState(false); // FIX

  const loadBak = useCallback(async () => {
    try {
      const data = await apiGet<BakAgreementRow>(`/permit-clusters/${clusterId}/bak`); // FIX
      setBak(data); // FIX
      if (data) {
        setForm((prev) => ({
          ...prev,
          wpNama: data.wpNama || '',
          wpNoKtp: data.wpNoKtp || '',
          wpJabatan: data.wpJabatan || '',
          wpAlamat: data.wpAlamat || '',
          wpNoTelp: data.wpNoTelp || '',
          tipeLokasiType: data.tipeLokasiType || '',
          tipeLokasiOther: data.tipeLokasiOther || '',
          namaLokasi: data.namaLokasi || '',
          alamatLokasi: data.alamatLokasi || '',
          alamatKantorPemasaran: data.alamatKantorPemasaran || '',
          jangkaWaktu: data.jangkaWaktu || '',
          homepasExisting: String(data.homepasExisting ?? ''),
          kategoriPerumahan: data.kategoriPerumahan || '',
          occupancy: String(data.occupancy ?? ''),
          penempatanKabel: data.penempatanKabel || '',
          existingCompetitor: data.existingCompetitor || '',
          benefitIsp: data.benefitIsp || '',
          areaDimeterM: data.areaDimeterM || '',
          benefitPemilik: data.benefitPemilik || '',
          ketentuanListrik:
            data.ketentuanListrik ||
            'Pembayaran langsung ke PLN dengan KWH meter yang terpakai',
          ketentuanTambahan: data.ketentuanTambahan || '',
          signatureIspName: data.signatureIspName || '',
          signaturePemilikName: data.signaturePemilikName || '',
          signatureIspUrl: data.signatureIspUrl || '',
          signaturePemilikUrl: data.signaturePemilikUrl || '',
          ktpPhotoUrls: Array.isArray(data.ktpPhotoUrls) ? data.ktpPhotoUrls : [],
          stempelPhotoUrl: data.stempelPhotoUrl || '',
        })); // FIX
        setUseDigitalSign(!!data.useDigitalSignature); // FIX
      }
    } catch {
      /* FIX: BAK not yet created — empty form */
    }
  }, [clusterId]); // FIX

  useEffect(() => {
    let cancelled = false; // FIX
    void (async () => {
      setBakLoading(true); // FIX
      await loadBak(); // FIX
      if (!cancelled) setBakLoading(false); // FIX
    })(); // FIX
    return () => {
      cancelled = true; // FIX
    };
  }, [loadBak]); // FIX

  const updateForm = (key: string, value: any) =>
    setForm((prev) => ({ ...prev, [key]: value })); // FIX

  const handleSave = async () => {
    setBakSaving(true); // FIX
    try {
      await apiPost(`/permit-clusters/${clusterId}/bak/save-form`, {
        ...form,
        homepasExisting: Number(form.homepasExisting) || null,
        occupancy: Number(form.occupancy) || null,
        useDigitalSignature: useDigitalSign,
        ktpPhotoUrls: form.ktpPhotoUrls,
      }); // FIX
      toast.success('Draft BAK disimpan'); // FIX
      await loadBak(); // FIX
    } catch (err: any) {
      toast.error(err.message || 'Gagal simpan'); // FIX
    } finally {
      setBakSaving(false); // FIX
    }
  }; // FIX

  const handleComplete = async () => {
    if (!form.wpNama || !form.namaLokasi) {
      toast.error('Minimal Nama WP dan Nama Lokasi harus diisi'); // FIX
      return; // FIX
    }
    setBakSaving(true); // FIX
    try {
      await apiPost(`/permit-clusters/${clusterId}/bak/save-form`, {
        ...form,
        homepasExisting: Number(form.homepasExisting) || null,
        occupancy: Number(form.occupancy) || null,
        useDigitalSignature: useDigitalSign,
        ktpPhotoUrls: form.ktpPhotoUrls,
      }); // FIX
      const result = await apiPost<BakAgreementRow>(
        `/permit-clusters/${clusterId}/bak/complete`,
        {},
      ); // FIX
      setBak(result); // FIX
      toast.success('✅ BAK selesai — PDF siap diunduh'); // FIX
    } catch (err: any) {
      toast.error(err.message || 'Gagal'); // FIX
    } finally {
      setBakSaving(false); // FIX
    }
  }; // FIX

  const handleUploadKtp = async (files: FileList | null) => {
    if (!files) return; // FIX
    setUploadingKtp(true); // FIX
    try {
      for (const file of Array.from(files)) {
        const url = await uploadFile(file, 'bak/ktp', clusterId); // FIX
        setForm((prev) => ({ ...prev, ktpPhotoUrls: [...prev.ktpPhotoUrls, url] })); // FIX
        toast.success(`✅ KTP ${file.name} diupload`); // FIX
      }
    } catch (err: any) {
      toast.error(`Upload KTP gagal: ${err.message}`); // FIX
    } finally {
      setUploadingKtp(false); // FIX
    }
  }; // FIX

  const handleUploadSignedBak = async (file: File) => {
    setUploadingBak(true); // FIX
    try {
      const url = await uploadFile(file, 'bak/signed', clusterId); // FIX
      const result = await apiPost<BakAgreementRow>(
        `/permit-clusters/${clusterId}/bak/upload-signed`,
        { signedPdfUrl: url },
      ); // FIX
      setBak(result); // FIX
      toast.success('✅ BAK bertanda tangan diupload — menunggu review PM'); // FIX
    } catch (err: any) {
      toast.error(`Upload BAK gagal: ${err.message}`); // FIX
    } finally {
      setUploadingBak(false); // FIX
    }
  }; // FIX

  const inputStyle: CSSProperties = {
    width: '100%',
    boxSizing: 'border-box',
    padding: '9px 12px',
    borderRadius: 8,
    fontSize: 13,
    border: '1.5px solid var(--color-border-tertiary)',
    background: 'var(--color-background-primary)',
    color: 'var(--color-text-primary)',
    outline: 'none',
  }; // FIX

  const sectionHeader = (num: number, title: string) => (
    <div
      style={{
        fontSize: 13,
        fontWeight: 700,
        color: 'var(--color-text-primary)',
        padding: '10px 0 6px',
        borderBottom: '1px solid var(--color-border-tertiary)',
        marginBottom: 12,
      }}
    >
      {num}. {title}
    </div>
  ); // FIX

  const label = (text: string, required = false) => (
    <label
      style={{
        display: 'block',
        fontSize: 11,
        fontWeight: 600,
        marginBottom: 5,
        color: 'var(--color-text-secondary)',
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
      }}
    >
      {text}
      {required && <span style={{ color: '#EF4444' }}> *</span>}
    </label>
  ); // FIX

  if (bakLoading) {
    return (
      <div
        style={{
          padding: 24,
          textAlign: 'center',
          color: 'var(--color-text-secondary)',
          fontSize: 13,
        }}
      >
        ⏳ Memuat data BAK...
      </div>
    ); // FIX
  }

  const canEdit =
    isSurveyor &&
    (!bak?.status ||
      bak?.status === 'DRAFT' ||
      bak?.status === 'PM_REJECTED' ||
      bak?.status === 'ADMIN_REJECTED'); // FIX

  const isPdfReady = // FIX: show PDF section when PDF workflow applies (incl. after rejection + re-generation)
    bak?.status === 'PDF_GENERATED' ||
    bak?.status === 'SIGNED_UPLOADED' ||
    bak?.status === 'PM_REVIEW' ||
    bak?.status === 'PM_REJECTED' ||
    bak?.status === 'ADMIN_REVIEW' ||
    bak?.status === 'ADMIN_REJECTED' ||
    bak?.status === 'APPROVED'; // FIX

  const canUploadSigned = // FIX: show upload when surveyor can submit / re-submit signed BAK
    bak?.status === 'PDF_GENERATED' ||
    bak?.status === 'PM_REJECTED' ||
    bak?.status === 'ADMIN_REJECTED'; // FIX

  const showSurveyorWaiting = isSurveyor && bak?.status === 'FORM_COMPLETE'; // FIX: only transient “generating PDF” (PDF panel covers PM/Admin review)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {bak?.status && bak.status !== 'DRAFT' && (
        <div
          style={{
            padding: '12px 16px',
            borderRadius: 10,
            background:
              bak.status === 'APPROVED'
                ? '#22C55E15'
                : String(bak.status).includes('REJECTED')
                  ? '#EF444415'
                  : '#F59E0B15',
            border: `0.5px solid ${
              bak.status === 'APPROVED'
                ? '#22C55E40'
                : String(bak.status).includes('REJECTED')
                  ? '#EF444440'
                  : '#F59E0B40'
            }`,
            fontSize: 13,
            fontWeight: 600,
            color:
              bak.status === 'APPROVED'
                ? '#22C55E'
                : String(bak.status).includes('REJECTED')
                  ? '#EF4444'
                  : '#F59E0B',
          }}
        >
          {bak.status === 'DRAFT' && '📝 Draft BAK — belum selesai'}
          {bak.status === 'FORM_COMPLETE' && '📋 Form lengkap — generating PDF...'}
          {bak.status === 'PDF_GENERATED' && '📄 PDF siap — silakan download & print'}
          {bak.status === 'SIGNED_UPLOADED' && '⏳ BAK ditanda tangan — menunggu review PM'}
          {bak.status === 'PM_REVIEW' && '⏳ Menunggu approval PM'}
          {bak.status === 'PM_REJECTED' &&
            `❌ Ditolak PM — ${bak.pmNotes || 'revisi diperlukan'}`}
          {bak.status === 'ADMIN_REVIEW' && '⏳ Menunggu approval Admin'}
          {bak.status === 'ADMIN_REJECTED' &&
            `❌ Ditolak Admin — ${bak.adminNotes || 'revisi diperlukan'}`}
          {bak.status === 'APPROVED' && '✅ BAK disetujui — berlanjut ke fase berikutnya'}
        </div>
      )}

      {isSurveyor && canEdit && (
        <div
          style={{
            background: 'var(--color-background-primary)',
            border: '0.5px solid var(--color-border-tertiary)',
            borderLeft: '3px solid #00D4B4',
            borderRadius: 12,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              padding: '14px 20px',
              borderBottom: '0.5px solid var(--color-border-tertiary)',
              background: 'var(--color-background-secondary)',
              fontSize: 15,
              fontWeight: 600,
              color: 'var(--color-text-primary)',
            }}
          >
            📋 Berita Acara Kesepakatan (BAK)
          </div>

          <div
            style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 20 }}
          >
            <div>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  marginBottom: 10,
                  color: 'var(--color-text-primary)',
                }}
              >
                📷 Upload Foto KTP Peserta SKOM
              </div>
              {form.ktpPhotoUrls.length > 0 && (
                <div
                  style={{
                    display: 'flex',
                    gap: 8,
                    flexWrap: 'wrap',
                    marginBottom: 10,
                  }}
                >
                  {form.ktpPhotoUrls.map((url, i) => (
                    <div key={url + i} style={{ position: 'relative' }}>
                      <img
                        src={fixFileUrl(url)}
                        alt={`KTP ${i + 1}`}
                        style={{
                          width: 120,
                          height: 80,
                          objectFit: 'cover',
                          borderRadius: 8,
                          border: '1px solid var(--color-border-tertiary)',
                        }}
                        onClick={() => window.open(fixFileUrl(url), '_blank')}
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setForm((p) => ({
                            ...p,
                            ktpPhotoUrls: p.ktpPhotoUrls.filter((_, j) => j !== i),
                          }))
                        }
                        style={{
                          position: 'absolute',
                          top: 2,
                          right: 2,
                          width: 18,
                          height: 18,
                          borderRadius: '50%',
                          background: '#EF4444',
                          color: 'white',
                          border: 'none',
                          cursor: 'pointer',
                          fontSize: 11,
                          fontWeight: 700,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '10px 14px',
                  borderRadius: 8,
                  cursor: uploadingKtp ? 'wait' : 'pointer',
                  border: '1.5px dashed var(--color-border-tertiary)',
                  background: 'var(--color-background-secondary)',
                }}
              >
                <span style={{ fontSize: 20 }}>{uploadingKtp ? '⏳' : '📷'}</span>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>
                    {uploadingKtp ? 'Mengupload...' : '+ Upload foto KTP'}
                  </div>
                  <div
                    style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}
                  >
                    Bisa pilih beberapa foto sekaligus
                  </div>
                </div>
                <input
                  type="file"
                  multiple
                  accept="image/*"
                  disabled={uploadingKtp}
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    void handleUploadKtp(e.target.files);
                    e.target.value = '';
                  }}
                />
              </label>
            </div>

            <div>
              {sectionHeader(1, 'Warga Penghuni / WP')}
              <div
                style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}
              >
                <div>
                  {label('Nama WP', true)}
                  <input
                    value={form.wpNama}
                    style={inputStyle}
                    onChange={(e) => updateForm('wpNama', e.target.value)}
                    placeholder="Nama lengkap"
                  />
                </div>
                <div>
                  {label('No KTP')}
                  <input
                    value={form.wpNoKtp}
                    style={inputStyle}
                    onChange={(e) => updateForm('wpNoKtp', e.target.value)}
                    placeholder="16 digit"
                  />
                </div>
                <div>
                  {label('Jabatan WP')}
                  <input
                    value={form.wpJabatan}
                    style={inputStyle}
                    onChange={(e) => updateForm('wpJabatan', e.target.value)}
                    placeholder="RT/RW/Ketua Paguyuban/dll"
                  />
                </div>
                <div>
                  {label('No Telp/HP')}
                  <input
                    value={form.wpNoTelp}
                    style={inputStyle}
                    onChange={(e) => updateForm('wpNoTelp', e.target.value)}
                    placeholder="08xx"
                  />
                </div>
              </div>
              <div style={{ marginTop: 10 }}>
                {label('Alamat WP')}
                <textarea
                  value={form.wpAlamat}
                  rows={2}
                  style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
                  onChange={(e) => updateForm('wpAlamat', e.target.value)}
                  placeholder="Alamat lengkap"
                />
              </div>
            </div>

            <div>
              {sectionHeader(2, 'Lokasi / Kawasan')}
              <div>
                {label('Tipe Lokasi', true)}
                <select
                  value={form.tipeLokasiType}
                  style={inputStyle}
                  onChange={(e) => updateForm('tipeLokasiType', e.target.value)}
                >
                  <option value="">-- Pilih Tipe --</option>
                  {[
                    'APARTEMEN',
                    'OFFICE_TOWER',
                    'CLUSTER_RESIDENTIAL',
                    'WAREHOUSE_AREA',
                    'SHOP_HOUSE',
                    'SUPERBLOCK',
                    'MALL',
                    'OPEN_AREA',
                    'OTHERS',
                  ].map((t) => (
                    <option key={t} value={t}>
                      {t.replace(/_/g, ' ')}
                    </option>
                  ))}
                </select>
              </div>
              {form.tipeLokasiType === 'OTHERS' && (
                <div style={{ marginTop: 8 }}>
                  {label('Jelaskan Tipe Lokasi *')}
                  <input
                    value={form.tipeLokasiOther}
                    style={inputStyle}
                    onChange={(e) => updateForm('tipeLokasiOther', e.target.value)}
                    placeholder="Tuliskan tipe lokasi"
                  />
                </div>
              )}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: 10,
                  marginTop: 10,
                }}
              >
                <div>
                  {label('Nama Lokasi', true)}
                  <input
                    value={form.namaLokasi}
                    style={inputStyle}
                    onChange={(e) => updateForm('namaLokasi', e.target.value)}
                    placeholder="Nama perumahan/gedung"
                  />
                </div>
                <div>
                  {label('Alamat Kantor Pemasaran')}
                  <input
                    value={form.alamatKantorPemasaran}
                    style={inputStyle}
                    onChange={(e) =>
                      updateForm('alamatKantorPemasaran', e.target.value)
                    }
                    placeholder="Alamat kantor pemasaran"
                  />
                </div>
              </div>
              <div style={{ marginTop: 10 }}>
                {label('Alamat Lokasi')}
                <textarea
                  value={form.alamatLokasi}
                  rows={2}
                  style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
                  onChange={(e) => updateForm('alamatLokasi', e.target.value)}
                  placeholder="Alamat lengkap lokasi"
                />
              </div>
            </div>

            <div>
              {sectionHeader(3, 'Jangka Waktu Perjanjian / Kesepakatan')}
              <input
                value={form.jangkaWaktu}
                style={inputStyle}
                onChange={(e) => updateForm('jangkaWaktu', e.target.value)}
                placeholder="Contoh: 5 tahun (2026-2031)"
              />
            </div>

            <div>
              {sectionHeader(4, 'Jumlah dan Kriteria Homepass')}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr 1fr',
                  gap: 10,
                }}
              >
                <div>
                  {label('Homepass Existing')}
                  <input
                    type="number"
                    value={form.homepasExisting}
                    style={inputStyle}
                    onChange={(e) => updateForm('homepasExisting', e.target.value)}
                    placeholder="0"
                  />
                </div>
                <div>
                  {label('Kategori Perumahan')}
                  <select
                    value={form.kategoriPerumahan}
                    style={inputStyle}
                    onChange={(e) => updateForm('kategoriPerumahan', e.target.value)}
                  >
                    <option value="">-- Pilih --</option>
                    <option value="MENENGAH_KE_BAWAH">Menengah ke Bawah</option>
                    <option value="MENENGAH">Menengah</option>
                    <option value="MENENGAH_KE_ATAS">Menengah ke Atas</option>
                    <option value="PREMIUM">Premium</option>
                  </select>
                </div>
                <div>
                  {label('Occupancy (%)')}
                  <input
                    type="number"
                    value={form.occupancy}
                    style={inputStyle}
                    min={0}
                    max={100}
                    onChange={(e) => updateForm('occupancy', e.target.value)}
                    placeholder="0-100"
                  />
                </div>
              </div>
            </div>

            <div>
              {sectionHeader(5, 'Penempatan Kabel')}
              <div style={{ display: 'flex', gap: 10 }}>
                {['AERIAL', 'UNDERGROUND', 'AERIAL_UNDERGROUND'].map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => updateForm('penempatanKabel', k)}
                    style={{
                      flex: 1,
                      padding: '10px',
                      borderRadius: 8,
                      border: `2px solid ${
                        form.penempatanKabel === k
                          ? '#00D4B4'
                          : 'var(--color-border-tertiary)'
                      }`,
                      background:
                        form.penempatanKabel === k ? '#00D4B415' : 'none',
                      color:
                        form.penempatanKabel === k
                          ? '#00D4B4'
                          : 'var(--color-text-secondary)',
                      cursor: 'pointer',
                      fontSize: 12,
                      fontWeight: 600,
                    }}
                  >
                    {k === 'AERIAL'
                      ? '🏗️ Aerial'
                      : k === 'UNDERGROUND'
                        ? '⛏️ Underground'
                        : '🔀 Aerial & Underground'}
                  </button>
                ))}
              </div>
            </div>

            <div>
              {sectionHeader(6, 'Existing Competitor')}
              <input
                value={form.existingCompetitor}
                style={inputStyle}
                onChange={(e) => updateForm('existingCompetitor', e.target.value)}
                placeholder="Nama ISP/operator yang sudah ada"
              />
            </div>

            <div>
              {sectionHeader(7, 'Benefit yang Diperoleh ISP')}
              <div style={{ marginBottom: 10 }}>
                {label('Luas Area untuk Perangkat (m × m)')}
                <input
                  value={form.areaDimeterM}
                  style={inputStyle}
                  onChange={(e) => updateForm('areaDimeterM', e.target.value)}
                  placeholder="Contoh: 2 x 3 meter"
                />
              </div>
              {label('Keterangan Benefit ISP')}
              <textarea
                value={form.benefitIsp}
                rows={4}
                style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
                onChange={(e) => updateForm('benefitIsp', e.target.value)}
                placeholder="Benefit yang diperoleh ISP..."
              />
            </div>

            <div>
              {sectionHeader(8, 'Benefit yang Diperoleh Pemilik Kawasan')}
              <textarea
                value={form.benefitPemilik}
                rows={3}
                style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
                onChange={(e) => updateForm('benefitPemilik', e.target.value)}
                placeholder="Benefit yang diperoleh pemilik kawasan..."
              />
            </div>

            <div>
              {sectionHeader(9, 'Listrik')}
              <textarea
                value={form.ketentuanListrik}
                rows={2}
                style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
                onChange={(e) => updateForm('ketentuanListrik', e.target.value)}
              />
            </div>

            <div>
              {sectionHeader(10, 'Ketentuan Tambahan (Additional)')}
              <textarea
                value={form.ketentuanTambahan}
                rows={3}
                style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
                onChange={(e) => updateForm('ketentuanTambahan', e.target.value)}
                placeholder="Ketentuan tambahan lainnya..."
              />
            </div>

            <div
              style={{
                padding: '14px 16px',
                borderRadius: 10,
                background: 'var(--color-background-secondary)',
                border: '0.5px solid var(--color-border-tertiary)',
              }}
            >
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={useDigitalSign}
                  onChange={(e) => setUseDigitalSign(e.target.checked)}
                  style={{ width: 16, height: 16 }}
                />
                <span
                  style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary)' }}
                >
                  Tanda Tangan Digital
                </span>
                <span style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>
                  (opsional — centang jika ingin tanda tangan digital)
                </span>
              </label>

              {useDigitalSign && (
                <div
                  style={{
                    marginTop: 14,
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: 12,
                  }}
                >
                  <div>
                    {label('Nama Penanda Tangan ISP')}
                    <input
                      value={form.signatureIspName}
                      style={inputStyle}
                      onChange={(e) => updateForm('signatureIspName', e.target.value)}
                      placeholder="Nama ISP"
                    />
                    <div style={{ marginTop: 8 }}>
                      {label('Upload Tanda Tangan ISP')}
                      <label
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          padding: '8px 12px',
                          borderRadius: 7,
                          cursor: 'pointer',
                          border: '1.5px dashed var(--color-border-tertiary)',
                          background: 'var(--color-background-primary)',
                        }}
                      >
                        <span>✍️</span>
                        <span style={{ fontSize: 12 }}>
                          {uploadingSign === 'isp'
                            ? '⏳...'
                            : form.signatureIspUrl
                              ? '✅ Tanda tangan ISP'
                              : 'Upload foto TTD ISP'}
                        </span>
                        <input
                          type="file"
                          accept="image/*"
                          style={{ display: 'none' }}
                          onChange={async (e) => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            setUploadingSign('isp');
                            try {
                              const url = await uploadFile(file, 'bak/signature', clusterId);
                              updateForm('signatureIspUrl', url);
                            } catch {
                              toast.error('Upload gagal');
                            } finally {
                              setUploadingSign('');
                            }
                          }}
                        />
                      </label>
                    </div>
                  </div>

                  <div>
                    {label('Nama Penanda Tangan Pemilik')}
                    <input
                      value={form.signaturePemilikName}
                      style={inputStyle}
                      onChange={(e) =>
                        updateForm('signaturePemilikName', e.target.value)
                      }
                      placeholder="Nama pemilik kawasan"
                    />
                    <div style={{ marginTop: 8 }}>
                      {label('Upload Tanda Tangan Pemilik')}
                      <label
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          padding: '8px 12px',
                          borderRadius: 7,
                          cursor: 'pointer',
                          border: '1.5px dashed var(--color-border-tertiary)',
                          background: 'var(--color-background-primary)',
                        }}
                      >
                        <span>✍️</span>
                        <span style={{ fontSize: 12 }}>
                          {uploadingSign === 'pemilik'
                            ? '⏳...'
                            : form.signaturePemilikUrl
                              ? '✅ Tanda tangan pemilik'
                              : 'Upload foto TTD pemilik'}
                        </span>
                        <input
                          type="file"
                          accept="image/*"
                          style={{ display: 'none' }}
                          onChange={async (e) => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            setUploadingSign('pemilik');
                            try {
                              const url = await uploadFile(file, 'bak/signature', clusterId);
                              updateForm('signaturePemilikUrl', url);
                            } catch {
                              toast.error('Upload gagal');
                            } finally {
                              setUploadingSign('');
                            }
                          }}
                        />
                      </label>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <button
                type="button"
                disabled={bakSaving}
                onClick={() => void handleSave()}
                style={{
                  padding: '10px 20px',
                  borderRadius: 10,
                  border: '0.5px solid var(--color-border-tertiary)',
                  background: 'none',
                  cursor: 'pointer',
                  fontSize: 13,
                  color: 'var(--color-text-secondary)',
                }}
              >
                💾 Simpan Draft
              </button>
              <button
                type="button"
                disabled={bakSaving}
                onClick={() => void handleComplete()}
                style={{
                  flex: 1,
                  padding: '11px 24px',
                  borderRadius: 10,
                  border: 'none',
                  background: bakSaving
                    ? 'var(--color-background-secondary)'
                    : 'linear-gradient(135deg, #00D4B4, #00B89E)',
                  color: bakSaving ? 'var(--color-text-secondary)' : 'white',
                  cursor: bakSaving ? 'not-allowed' : 'pointer',
                  fontSize: 14,
                  fontWeight: 700,
                  boxShadow: bakSaving ? 'none' : '0 4px 14px #00D4B440',
                }}
              >
                {bakSaving ? 'Memproses...' : '✅ Selesai — Generate PDF BAK'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* FIX: PDF panel — isPdfReady + canUploadSigned (revision after PM/Admin reject) */}
      {isSurveyor && isPdfReady && (
        <div
          style={{
            background: 'var(--color-background-primary)',
            border: '0.5px solid var(--color-border-tertiary)',
            borderLeft: `3px solid ${
              bak?.status === 'PM_REJECTED' || bak?.status === 'ADMIN_REJECTED'
                ? '#F59E0B'
                : '#3B82F6'
            }`,
            borderRadius: 12,
            padding: 20,
          }}
        >
          <div
            style={{
              fontSize: 15,
              fontWeight: 600,
              marginBottom: 6,
              color: 'var(--color-text-primary)',
            }}
          >
            📄 BAK PDF
            {(bak?.status === 'PM_REJECTED' || bak?.status === 'ADMIN_REJECTED') && (
              <span
                style={{
                  marginLeft: 10,
                  fontSize: 11,
                  fontWeight: 600,
                  padding: '2px 8px',
                  borderRadius: 8,
                  background: '#F59E0B15',
                  color: '#F59E0B',
                  border: '0.5px solid #F59E0B40',
                }}
              >
                ↺ Revisi
              </span>
            )}
          </div>

          <p
            style={{
              fontSize: 12,
              color: 'var(--color-text-secondary)',
              marginBottom: 16,
              lineHeight: 1.5,
            }}
          >
            {bak?.status === 'PM_REJECTED' && (
              <>
                <span style={{ color: '#EF4444', fontWeight: 600 }}>↺ BAK ditolak PM.</span>{' '}
                Unduh BAK revisi → print → minta tanda tangan & stempel ulang → upload kembali.
              </>
            )}
            {bak?.status === 'ADMIN_REJECTED' && (
              <>
                <span style={{ color: '#EF4444', fontWeight: 600 }}>↺ BAK ditolak Admin.</span>{' '}
                Unduh BAK revisi → print → minta tanda tangan & stempel ulang → upload kembali.
              </>
            )}
            {bak?.status === 'PDF_GENERATED' &&
              'Download BAK → Print → Minta tanda tangan & stempel → Upload kembali.'}
            {bak?.status === 'SIGNED_UPLOADED' && 'BAK sudah diupload. Menunggu review PM.'}
            {bak?.status === 'PM_REVIEW' && 'BAK sedang direview PM.'}
            {bak?.status === 'ADMIN_REVIEW' && 'BAK sedang direview Admin.'}
            {bak?.status === 'APPROVED' && '✅ BAK telah disetujui.'}
          </p>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {bak?.pdfUrl && (
              <button
                type="button"
                onClick={async () => {
                  try {
                    const data = await apiGet<{ url: string }>(
                      `/permit-clusters/${clusterId}/bak/download-pdf`,
                    );
                    if (data?.url) window.open(fixFileUrl(data.url), '_blank', 'noopener,noreferrer');
                  } catch (err: any) {
                    toast.error(`Gagal download: ${err.message}`);
                  }
                }}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 7,
                  padding: '10px 18px',
                  borderRadius: 9,
                  border: '0.5px solid #3B82F640',
                  background: '#3B82F615',
                  color: '#3B82F6',
                  cursor: 'pointer',
                  fontSize: 13,
                  fontWeight: 600,
                }}
              >
                ⬇ Unduh BAK PDF
                {(bak?.status === 'PM_REJECTED' || bak?.status === 'ADMIN_REJECTED') && (
                  <span
                    style={{
                      fontSize: 10,
                      background: '#F59E0B20',
                      color: '#F59E0B',
                      padding: '1px 5px',
                      borderRadius: 4,
                    }}
                  >
                    revisi
                  </span>
                )}
              </button>
            )}

            {canUploadSigned && (
              <label
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 7,
                  padding: '10px 18px',
                  borderRadius: 9,
                  background: uploadingBak ? '#E5E7EB' : '#00D4B4',
                  color: uploadingBak ? '#9CA3AF' : 'white',
                  cursor: uploadingBak ? 'wait' : 'pointer',
                  fontSize: 13,
                  fontWeight: 600,
                  opacity: uploadingBak ? 0.8 : 1,
                  transition: 'all 150ms',
                }}
              >
                {uploadingBak
                  ? '⏳ Mengupload...'
                  : bak?.status === 'PM_REJECTED' || bak?.status === 'ADMIN_REJECTED'
                    ? '📤 Upload BAK Revisi'
                    : '📤 Upload BAK Bertanda Tangan'}
                <input
                  type="file"
                  accept=".pdf,image/*"
                  disabled={uploadingBak}
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void handleUploadSignedBak(file);
                    e.target.value = '';
                  }}
                />
              </label>
            )}

            {bak?.signedPdfUrl &&
              bak?.status !== 'PM_REJECTED' &&
              bak?.status !== 'ADMIN_REJECTED' && (
                <a
                  href={fixFileUrl(bak.signedPdfUrl)}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 7,
                    padding: '10px 18px',
                    borderRadius: 9,
                    background: '#22C55E15',
                    color: '#22C55E',
                    textDecoration: 'none',
                    fontSize: 13,
                    fontWeight: 600,
                    border: '0.5px solid #22C55E40',
                  }}
                >
                  ✅ Lihat BAK yang Diupload
                </a>
              )}
          </div>

          {bak?.pmNotes && bak?.status === 'PM_REJECTED' && (
            <div
              style={{
                marginTop: 14,
                padding: '10px 14px',
                borderRadius: 8,
                background: '#EF444412',
                border: '0.5px solid #EF444440',
                fontSize: 12,
              }}
            >
              <span style={{ fontWeight: 700, color: '#EF4444' }}>Catatan PM: </span>
              <span style={{ color: 'var(--color-text-primary)' }}>{bak.pmNotes}</span>
            </div>
          )}
          {bak?.adminNotes && bak?.status === 'ADMIN_REJECTED' && (
            <div
              style={{
                marginTop: 14,
                padding: '10px 14px',
                borderRadius: 8,
                background: '#EF444412',
                border: '0.5px solid #EF444440',
                fontSize: 12,
              }}
            >
              <span style={{ fontWeight: 700, color: '#EF4444' }}>Catatan Admin: </span>
              <span style={{ color: 'var(--color-text-primary)' }}>{bak.adminNotes}</span>
            </div>
          )}
        </div>
      )}

      {showSurveyorWaiting && (
        <div
          style={{
            padding: '14px 18px',
            borderRadius: 10,
            background: 'var(--color-background-secondary)',
            border: '0.5px solid var(--color-border-tertiary)',
            fontSize: 13,
            color: 'var(--color-text-secondary)',
          }}
        >
          {bak?.status === 'FORM_COMPLETE'
            ? '⏳ Membuat PDF...'
            : '⏳ Menunggu review — Anda akan mendapat notifikasi setelah disetujui.'}
          {bak?.signedPdfUrl && bak?.status !== 'FORM_COMPLETE' && (
            <div style={{ marginTop: 10 }}>
              <a
                href={fixFileUrl(bak.signedPdfUrl)}
                target="_blank"
                rel="noreferrer"
                style={{ color: '#3B82F6', fontWeight: 600 }}
              >
                📄 Lihat BAK yang diupload
              </a>
            </div>
          )}
        </div>
      )}

      {isPM && bak?.status === 'PM_REVIEW' && (
        <div
          style={{
            background: 'var(--color-background-primary)',
            border: '0.5px solid var(--color-border-tertiary)',
            borderLeft: '3px solid #3B82F6',
            borderRadius: 12,
            padding: 20,
          }}
        >
          <div
            style={{
              fontSize: 15,
              fontWeight: 600,
              marginBottom: 10,
              color: 'var(--color-text-primary)',
            }}
          >
            🔍 Review BAK (PM)
          </div>
          {bak.signedPdfUrl && (
            <a
              href={fixFileUrl(bak.signedPdfUrl)}
              target="_blank"
              rel="noreferrer"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '8px 14px',
                borderRadius: 8,
                marginBottom: 14,
                background: '#3B82F615',
                color: '#3B82F6',
                textDecoration: 'none',
                fontSize: 13,
                border: '0.5px solid #3B82F640',
              }}
            >
              📄 Lihat BAK Bertanda Tangan
            </a>
          )}
          {showReject && (
            <div style={{ marginBottom: 12 }}>
              <textarea
                value={rejectNotes}
                onChange={(e) => setRejectNotes(e.target.value)}
                rows={3}
                placeholder="Alasan penolakan..."
                style={{
                  ...inputStyle,
                  resize: 'vertical',
                  fontFamily: 'inherit',
                  borderColor: '#EF444440',
                }}
              />
            </div>
          )}
          {!showReject ? (
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                type="button"
                disabled={bakSaving}
                onClick={async () => {
                  setBakSaving(true);
                  try {
                    await apiPost(`/permit-clusters/${clusterId}/bak/pm-approve`, {});
                    toast.success('✅ BAK disetujui PM');
                    await loadBak();
                    await fetchCluster();
                  } catch (err: any) {
                    toast.error(err.message);
                  } finally {
                    setBakSaving(false);
                  }
                }}
                style={{
                  flex: 1,
                  padding: '11px',
                  borderRadius: 10,
                  border: 'none',
                  background: '#00D4B4',
                  color: 'white',
                  cursor: 'pointer',
                  fontSize: 14,
                  fontWeight: 600,
                }}
              >
                ✅ Setujui BAK
              </button>
              <button
                type="button"
                onClick={() => setShowReject(true)}
                style={{
                  padding: '11px 20px',
                  borderRadius: 10,
                  border: '1px solid #EF444440',
                  background: '#EF444412',
                  color: '#EF4444',
                  cursor: 'pointer',
                  fontSize: 14,
                  fontWeight: 600,
                }}
              >
                ❌ Tolak
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                type="button"
                disabled={!rejectNotes.trim() || bakSaving}
                onClick={async () => {
                  if (!rejectNotes.trim()) {
                    toast.error('Isi alasan penolakan');
                    return;
                  }
                  setBakSaving(true);
                  try {
                    await apiPost(`/permit-clusters/${clusterId}/bak/pm-reject`, {
                      notes: rejectNotes,
                    });
                    toast.success('↺ BAK dikembalikan ke Surveyor');
                    setShowReject(false);
                    setRejectNotes('');
                    await loadBak();
                    await fetchCluster();
                  } catch (err: any) {
                    toast.error(err.message);
                  } finally {
                    setBakSaving(false);
                  }
                }}
                style={{
                  flex: 1,
                  padding: '11px',
                  borderRadius: 10,
                  border: 'none',
                  background: '#EF4444',
                  color: 'white',
                  cursor: 'pointer',
                  fontSize: 14,
                  fontWeight: 600,
                }}
              >
                Konfirmasi Tolak
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowReject(false);
                  setRejectNotes('');
                }}
                style={{
                  padding: '11px 18px',
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
          )}
        </div>
      )}

      {isAdmin && bak?.status === 'ADMIN_REVIEW' && (
        <div
          style={{
            background: 'var(--color-background-primary)',
            border: '0.5px solid var(--color-border-tertiary)',
            borderLeft: '3px solid #00D4B4',
            borderRadius: 12,
            padding: 20,
          }}
        >
          <div
            style={{
              fontSize: 15,
              fontWeight: 600,
              marginBottom: 10,
              color: 'var(--color-text-primary)',
            }}
          >
            🔍 Review Final BAK (Admin)
          </div>
          {bak.signedPdfUrl && (
            <a
              href={fixFileUrl(bak.signedPdfUrl)}
              target="_blank"
              rel="noreferrer"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '8px 14px',
                borderRadius: 8,
                marginBottom: 14,
                background: '#3B82F615',
                color: '#3B82F6',
                textDecoration: 'none',
                fontSize: 13,
                border: '0.5px solid #3B82F640',
              }}
            >
              📄 Lihat BAK Bertanda Tangan
            </a>
          )}
          {showReject && (
            <div style={{ marginBottom: 12 }}>
              <textarea
                value={rejectNotes}
                onChange={(e) => setRejectNotes(e.target.value)}
                rows={3}
                placeholder="Alasan penolakan..."
                style={{
                  ...inputStyle,
                  resize: 'vertical',
                  fontFamily: 'inherit',
                  borderColor: '#EF444440',
                }}
              />
            </div>
          )}
          {!showReject ? (
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                type="button"
                disabled={bakSaving}
                onClick={async () => {
                  setBakSaving(true);
                  try {
                    await apiPost(`/permit-clusters/${clusterId}/bak/admin-approve`, {});
                    toast.success('✅ BAK disetujui Admin — berlanjut ke fase selanjutnya');
                    await loadBak();
                    await fetchCluster();
                  } catch (err: any) {
                    toast.error(err.message);
                  } finally {
                    setBakSaving(false);
                  }
                }}
                style={{
                  flex: 1,
                  padding: '11px',
                  borderRadius: 10,
                  border: 'none',
                  background: '#00D4B4',
                  color: 'white',
                  cursor: 'pointer',
                  fontSize: 14,
                  fontWeight: 600,
                }}
              >
                ✅ Setujui → Fase Selanjutnya
              </button>
              <button
                type="button"
                onClick={() => setShowReject(true)}
                style={{
                  padding: '11px 20px',
                  borderRadius: 10,
                  border: '1px solid #EF444440',
                  background: '#EF444412',
                  color: '#EF4444',
                  cursor: 'pointer',
                  fontSize: 14,
                  fontWeight: 600,
                }}
              >
                ❌ Tolak
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                type="button"
                disabled={!rejectNotes.trim() || bakSaving}
                onClick={async () => {
                  if (!rejectNotes.trim()) {
                    toast.error('Isi alasan penolakan');
                    return;
                  }
                  setBakSaving(true);
                  try {
                    await apiPost(`/permit-clusters/${clusterId}/bak/admin-reject`, {
                      notes: rejectNotes,
                    });
                    toast.success('↺ BAK dikembalikan ke Surveyor');
                    setShowReject(false);
                    setRejectNotes('');
                    await loadBak();
                    await fetchCluster();
                  } catch (err: any) {
                    toast.error(err.message);
                  } finally {
                    setBakSaving(false);
                  }
                }}
                style={{
                  flex: 1,
                  padding: '11px',
                  borderRadius: 10,
                  border: 'none',
                  background: '#EF4444',
                  color: 'white',
                  cursor: 'pointer',
                  fontSize: 14,
                  fontWeight: 600,
                }}
              >
                Konfirmasi Tolak
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowReject(false);
                  setRejectNotes('');
                }}
                style={{
                  padding: '11px 18px',
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
          )}
        </div>
      )}

      {bak?.status === 'APPROVED' && (
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
          <span style={{ fontSize: 28 }}>✅</span>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#22C55E' }}>BAK Disetujui</div>
            <div
              style={{
                fontSize: 12,
                color: 'var(--color-text-secondary)',
                marginTop: 2,
              }}
            >
              Proses berlanjut ke Fase 17 (BAKP Compilation)
            </div>
          </div>
          {bak.signedPdfUrl && (
            <a
              href={fixFileUrl(bak.signedPdfUrl)}
              target="_blank"
              rel="noreferrer"
              style={{
                marginLeft: 'auto',
                padding: '7px 14px',
                borderRadius: 8,
                background: '#22C55E15',
                color: '#22C55E',
                textDecoration: 'none',
                fontSize: 12,
                border: '0.5px solid #22C55E40',
              }}
            >
              📄 Lihat BAK
            </a>
          )}
        </div>
      )}
    </div>
  );
}
