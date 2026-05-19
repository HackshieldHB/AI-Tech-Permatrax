'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  User,
  Mail,
  Shield,
  Phone,
  MapPin,
  Save,
  Loader2,
  Camera,
  KeyRound,
  Eye,
  EyeOff,
  PenTool,
} from 'lucide-react';
import { useAuthStore } from '../../../../store/authStore';
import { apiGet, apiPatch, uploadFile, uploadAvatarFile, fixFileUrl, apiPost } from '../../../../lib/api';
import { ProfileAvatar } from '../../../../components/ProfileAvatar';
import { toast } from 'sonner';

type ProfileData = {
  id: string;
  email: string;
  name: string;
  role: string;
  fiberType: string | null;
  signatureUrl: string | null;
  avatarUrl: string | null;
  phone: string | null;
  address: string | null;
};

const ROLE_LABELS: Record<string, string> = {
  GENERAL_MANAGER: 'General Manager',
  DESIGNER: 'Designer',
};

export default function ProfilePage() {
  const { user: authUser, setUser, logout } = useAuthStore();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [pendingAvatarFile, setPendingAvatarFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    address: '',
    signatureUrl: '',
    avatarUrl: '' as string | null,
  });

  const [pwForm, setPwForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [showPw, setShowPw] = useState({ current: false, new: false, confirm: false });
  const [pwSaving, setPwSaving] = useState(false);

  const pwValid =
    pwForm.newPassword.length >= 8 &&
    pwForm.newPassword === pwForm.confirmPassword &&
    pwForm.currentPassword.length > 0;

  const applyProfile = (data: ProfileData) => {
    setFormData({
      name: data.name || '',
      phone: data.phone || '',
      address: data.address || '',
      signatureUrl: data.signatureUrl || '',
      avatarUrl: data.avatarUrl,
    });
    setUser({
      id: data.id,
      email: data.email,
      name: data.name,
      role: data.role,
      fiberType: data.fiberType,
      avatarUrl: data.avatarUrl,
      phone: data.phone,
      address: data.address,
      signatureUrl: data.signatureUrl,
    });
  };

  useEffect(() => {
    void (async () => {
      try {
        const data = await apiGet<ProfileData>('/auth/me');
        applyProfile(data);
      } catch {
        toast.error('Gagal memuat profil');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleAvatarPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      toast.error('Format file harus JPG, PNG, atau WebP');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error('Ukuran file maksimal 2MB');
      return;
    }
    setPendingAvatarFile(file);
    setAvatarPreview(URL.createObjectURL(file));
    e.target.value = '';
  };

  const handleSaveAvatar = async () => {
    if (!pendingAvatarFile) {
      toast.error('Pilih foto terlebih dahulu');
      return;
    }
    setUploadingAvatar(true);
    try {
      const res = await uploadAvatarFile(pendingAvatarFile);
      if (res.data) {
        applyProfile(res.data as ProfileData);
        setPendingAvatarFile(null);
        if (avatarPreview) URL.revokeObjectURL(avatarPreview);
        setAvatarPreview(null);
        toast.success('Foto profil berhasil disimpan');
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Gagal mengunggah foto');
    } finally {
      setUploadingAvatar(false);
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await apiPatch<{ success: boolean; data: ProfileData }>('/auth/profile', {
        name: formData.name.trim(),
        phone: formData.phone.trim() || null,
        address: formData.address.trim() || null,
        signatureUrl: formData.signatureUrl || null,
      });
      if (res.data) {
        applyProfile(res.data);
      }
      toast.success('Profil berhasil diperbarui');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Gagal menyimpan profil');
    } finally {
      setSaving(false);
    }
  };

  const handleSignatureUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSaving(true);
    try {
      const url = await uploadFile(file, 'signatures', authUser?.id);
      setFormData((prev) => ({ ...prev, signatureUrl: url }));
      toast.success('Tanda tangan berhasil diunggah');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Upload gagal');
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pwValid) return;
    setPwSaving(true);
    try {
      await apiPost('/auth/change-password', {
        currentPassword: pwForm.currentPassword,
        newPassword: pwForm.newPassword,
        confirmPassword: pwForm.confirmPassword,
      });
      toast.success('Password berhasil diubah. Silakan login kembali.', { duration: 4000 });
      setPwForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
      setTimeout(() => void logout(), 1500);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Gagal mengubah password');
    } finally {
      setPwSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-slate-400" />
      </div>
    );
  }

  const displayAvatarUrl = avatarPreview || formData.avatarUrl;
  const roleLabel = ROLE_LABELS[authUser?.role ?? ''] ?? authUser?.role?.replace(/_/g, ' ') ?? '';

  return (
    <div className="max-w-2xl mx-auto space-y-8 py-2 px-4">
      <div>
        <h1 className="text-2xl font-black text-slate-800">Profil Saya</h1>
        <p className="text-sm text-slate-500 mt-0.5">Kelola foto profil, informasi akun, dan keamanan</p>
      </div>

      {/* Foto profil */}
      <section className="bg-white rounded-3xl shadow-sm border border-slate-100 p-6">
        <h2 className="text-sm font-bold text-slate-800 mb-4">Foto Profil</h2>
        <div className="flex flex-col sm:flex-row items-center gap-6">
          <ProfileAvatar
            name={formData.name || authUser?.name || 'User'}
            role={authUser?.role ?? ''}
            avatarUrl={displayAvatarUrl}
            size={96}
            roleColor="#0D9488"
          />
          <div className="flex flex-col gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={handleAvatarPick}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              <Camera className="w-4 h-4" />
              Ganti Foto
            </button>
            {pendingAvatarFile ? (
              <button
                type="button"
                disabled={uploadingAvatar}
                onClick={() => void handleSaveAvatar()}
                className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-[#0D9488] text-white text-sm font-semibold disabled:opacity-50"
              >
                {uploadingAvatar ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Simpan Foto
              </button>
            ) : null}
            <p className="text-[11px] text-slate-400">JPG, PNG, atau WebP — maks. 2MB</p>
          </div>
        </div>
      </section>

      {/* Informasi profil */}
      <section className="bg-white rounded-3xl shadow-sm border border-slate-100 overflow-hidden">
        <form onSubmit={handleSaveProfile} className="p-6 space-y-5">
          <h2 className="text-sm font-bold text-slate-800">Informasi Profil</h2>

          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Nama Lengkap</label>
            <div className="relative">
              <User className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
              <input
                type="text"
                required
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full pl-10 pr-4 py-2 text-sm rounded-xl border border-slate-200 focus:ring-2 focus:ring-[#0D9488] outline-none"
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Email</label>
            <div className="relative">
              <Mail className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
              <input
                type="email"
                disabled
                value={authUser?.email || ''}
                className="w-full pl-10 pr-4 py-2 text-sm rounded-xl border border-slate-100 bg-slate-50 text-slate-500 outline-none"
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Role</label>
            <div className="relative">
              <Shield className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
              <input
                type="text"
                disabled
                value={roleLabel}
                className="w-full pl-10 pr-4 py-2 text-sm rounded-xl border border-slate-100 bg-slate-50 text-slate-500 outline-none"
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">No. Telepon</label>
            <div className="relative">
              <Phone className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
              <input
                type="tel"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                placeholder="08xxxxxxxxxx"
                className="w-full pl-10 pr-4 py-2 text-sm rounded-xl border border-slate-200 focus:ring-2 focus:ring-[#0D9488] outline-none"
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Alamat</label>
            <div className="relative">
              <MapPin className="absolute left-3 top-3 w-4 h-4 text-slate-400" />
              <textarea
                rows={3}
                value={formData.address}
                onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                placeholder="Alamat lengkap"
                className="w-full pl-10 pr-4 py-2 text-sm rounded-xl border border-slate-200 focus:ring-2 focus:ring-[#0D9488] outline-none resize-none"
              />
            </div>
          </div>

          <hr className="border-slate-100" />

          <div className="space-y-3">
            <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
              <PenTool className="w-4 h-4 text-[#0D9488]" />
              Tanda Tangan Elektronik
            </h3>
            <label className="cursor-pointer inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-50 border border-slate-200 text-xs font-bold text-slate-600">
              <input type="file" accept="image/*" className="hidden" onChange={handleSignatureUpload} disabled={saving} />
              <Camera className="w-3 h-3" />
              {formData.signatureUrl ? 'Ganti Tanda Tangan' : 'Unggah Tanda Tangan'}
            </label>
            {formData.signatureUrl ? (
              <img src={fixFileUrl(formData.signatureUrl)} alt="Signature" className="max-h-24 object-contain border border-dashed border-slate-200 rounded-lg p-2" />
            ) : null}
          </div>

          <button
            type="submit"
            disabled={saving || uploadingAvatar}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl bg-[#0D9488] text-white font-bold text-sm disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Simpan Perubahan
          </button>
        </form>
      </section>

      {/* Ganti password */}
      <section className="bg-white rounded-3xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center gap-3">
          <KeyRound className="w-5 h-5 text-[#F06A6A]" />
          <div>
            <h2 className="text-base font-bold text-slate-800">Ganti Password</h2>
            <p className="text-xs text-slate-500">Minimal 8 karakter</p>
          </div>
        </div>
        <form onSubmit={handleChangePassword} className="px-6 py-6 space-y-4">
          {(['current', 'new', 'confirm'] as const).map((key) => (
            <div key={key} className="space-y-1">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                {key === 'current' ? 'Password Lama' : key === 'new' ? 'Password Baru' : 'Konfirmasi Password Baru'}
              </label>
              <div className="relative">
                <input
                  type={showPw[key] ? 'text' : 'password'}
                  value={pwForm[key === 'current' ? 'currentPassword' : key === 'new' ? 'newPassword' : 'confirmPassword']}
                  onChange={(e) =>
                    setPwForm((p) => ({
                      ...p,
                      [key === 'current' ? 'currentPassword' : key === 'new' ? 'newPassword' : 'confirmPassword']: e.target.value,
                    }))
                  }
                  className="w-full pr-10 pl-4 py-2.5 text-sm rounded-xl border border-slate-200 outline-none focus:ring-2 focus:ring-[#F06A6A]"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPw((s) => ({ ...s, [key]: !s[key] }))}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400"
                >
                  {showPw[key] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
          ))}
          {pwForm.confirmPassword && pwForm.newPassword !== pwForm.confirmPassword ? (
            <p className="text-xs text-rose-500">Password tidak cocok</p>
          ) : null}
          <button
            type="submit"
            disabled={!pwValid || pwSaving}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl bg-[#F06A6A] text-white font-bold text-sm disabled:opacity-40"
          >
            {pwSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
            Ganti Password
          </button>
        </form>
      </section>
    </div>
  );
}
