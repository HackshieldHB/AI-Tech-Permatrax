import { toast as sonnerToast } from 'sonner';

// NEW: Typed Indonesian wrappers around Sonner
export const notify = {
  success: (message: string) => sonnerToast.success(message),
  error: (message: string) => sonnerToast.error(message),
  loading: (message: string) => sonnerToast.loading(message),
  info: (message: string) => sonnerToast.info(message),
  warning: (message: string) => sonnerToast.warning(message),
  promise: <T,>(
    promise: Promise<T>,
    messages: { loading: string; success: string; error: string }
  ) => sonnerToast.promise(promise, messages),

  apiError: (err: unknown) => {
    const message = err instanceof Error ? err.message : 'Terjadi kesalahan';
    sonnerToast.error(message);
  },
  saved: () => sonnerToast.success('Perubahan disimpan'),
  deleted: () => sonnerToast.success('Data berhasil dihapus'),
  submitted: () => sonnerToast.success('Data berhasil dikirim'),
  unauthorized: () => sonnerToast.error('Anda tidak memiliki akses'),
  networkError: () => sonnerToast.error('Gagal terhubung ke server. Periksa koneksi Anda.'),
};
