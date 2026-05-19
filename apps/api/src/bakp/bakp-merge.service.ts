import { Injectable } from '@nestjs/common';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { StorageService } from '../storage/storage.service';

type MergeInput = {
  key: string;
  url: string;
};

@Injectable()
export class BakpMergeService {
  constructor(private readonly storageService: StorageService) {}

  private isPdf(url: string): boolean {
    return /\.pdf(\?|$)/i.test(url);
  }

  private isImage(url: string): boolean {
    return /\.(png|jpg|jpeg)(\?|$)/i.test(url);
  }

  async mergeDocuments(documentNumber: string, files: MergeInput[]): Promise<string> {
    const out = await PDFDocument.create();
    const font = await out.embedFont(StandardFonts.Helvetica);

    for (const file of files) {
      const buffer = this.storageService.downloadBuffer(file.url);
      if (this.isPdf(file.url)) {
        const src = await PDFDocument.load(buffer);
        const pages = await out.copyPages(src, src.getPageIndices());
        pages.forEach((page) => out.addPage(page));
        continue;
      }

      if (this.isImage(file.url)) {
        const page = out.addPage([595.28, 841.89]);
        const img = /\.png(\?|$)/i.test(file.url) ? await out.embedPng(buffer) : await out.embedJpg(buffer);
        const maxW = 535.28;
        const maxH = 761.89;
        const ratio = Math.min(maxW / img.width, maxH / img.height);
        const drawW = img.width * ratio;
        const drawH = img.height * ratio;
        page.drawImage(img, {
          x: (595.28 - drawW) / 2,
          y: (841.89 - drawH) / 2,
          width: drawW,
          height: drawH,
        });
        continue;
      }

      const page = out.addPage([595.28, 841.89]);
      page.drawText('Dokumen tidak dapat digabung otomatis.', {
        x: 48,
        y: 760,
        size: 14,
        font,
        color: rgb(0.8, 0.1, 0.1),
      });
      page.drawText(`Kunci: ${file.key}`, { x: 48, y: 730, size: 12, font });
      page.drawText(`URL: ${file.url}`, { x: 48, y: 710, size: 10, font });
    }

    const bytes = await out.save();
    const key = `bakp/${new Date().getFullYear()}/${documentNumber}-final-merged.pdf`;
    return this.storageService.uploadBuffer(Buffer.from(bytes), key, 'application/pdf');
  }
}
