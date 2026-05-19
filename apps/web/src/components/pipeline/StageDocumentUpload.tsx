'use client';

import React, { useState } from 'react';
import { apiFetch } from '../../lib/auth';
import { toast } from 'sonner';
import { 
  UploadCloud, 
  FileText, 
  Download, 
  CheckCircle2, 
  X,
  Loader2
} from 'lucide-react';

interface StageDocumentUploadProps {
  doc: any;
  clusterId: string;
  stageId: string;
  onUpload: () => void;
  canUpload: boolean;
}

export default function StageDocumentUpload({ 
  doc, 
  clusterId, 
  stageId, 
  onUpload, 
  canUpload 
}: StageDocumentUploadProps) {
  const [uploading, setUploading] = useState(false);
  const isUploaded = doc.uploads?.length > 0;

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate format if specified
    if (doc.formats?.length > 0) {
      const ext = file.name.split('.').pop()?.toUpperCase();
      if (!ext || !doc.formats.includes(ext)) {
        toast.error(`Format file harus salah satu dari: ${doc.formats.join(', ')}`);
        return;
      }
    }

    setUploading(true);
    const formData = new FormData();
    formData.append('file', file);
    formData.append('path', `pipeline/${clusterId}/${stageId}`);

    try {
      // 1. Upload to storage
      const storageRes = await apiFetch('/storage/upload', {
        method: 'POST',
        body: formData,
        // Don't set content-type for FormData, fetch handles it
      });

      if (!storageRes.ok) throw new Error('Gagal upload ke storage');
      const { url } = await storageRes.json();

      // 2. Link to pipeline stage
      const linkRes = await apiFetch(`/pipeline-engine/clusters/${clusterId}/stages/${stageId}/documents/${doc.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileUrl: url, fileName: file.name }),
      });

      if (linkRes.ok) {
        toast.success(`Berhasil upload: ${doc.name}`);
        onUpload();
      } else {
        toast.error('Gagal menghubungkan dokumen ke pipeline');
      }
    } catch (error) {
      toast.error('Terjadi kesalahan saat upload');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className={`p-3 border rounded-lg flex items-center justify-between gap-4 transition-colors ${isUploaded ? 'bg-green-50/50 border-green-200' : 'bg-white border-slate-200'}`}>
      <div className="flex items-center gap-3 min-w-0">
        <div className={`p-2 rounded-lg ${isUploaded ? 'bg-green-100 text-green-600' : 'bg-slate-100 text-slate-500'}`}>
          {isUploaded ? <CheckCircle2 className="w-4 h-4" /> : <FileText className="w-4 h-4" />}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium truncate">{doc.name}</p>
          {doc.formats?.length > 0 && (
            <p className="text-[10px] opacity-50 uppercase tracking-tight">{doc.formats.join(', ')}</p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {isUploaded ? (
          <a 
            href={doc.uploads[0].fileUrl} 
            target="_blank" 
            rel="noopener noreferrer"
            className="p-2 text-primary hover:bg-primary/10 rounded-lg transition-colors"
            title="Download Dokumen"
          >
            <Download className="w-4 h-4" />
          </a>
        ) : canUpload && (
          <label className="cursor-pointer">
            <input 
              type="file" 
              className="hidden" 
              onChange={handleFileChange}
              disabled={uploading}
            />
            <div className={`p-2 rounded-lg transition-colors ${uploading ? 'bg-slate-100' : 'bg-primary/10 text-primary hover:bg-primary/20'}`}>
              {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <UploadCloud className="w-4 h-4" />}
            </div>
          </label>
        )}
      </div>
    </div>
  );
}
