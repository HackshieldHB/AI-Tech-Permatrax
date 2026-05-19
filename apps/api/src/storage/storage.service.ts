import { BadRequestException, Injectable, InternalServerErrorException, Logger, NotFoundException } from '@nestjs/common'; // FIX: throw on failed disk write
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name); // FIX: local storage logger

  private get uploadDir(): string { // FIX: Base upload directory — no cloud, just local filesystem
    return process.env.UPLOAD_DIR
      ? path.resolve(process.env.UPLOAD_DIR)
      : path.join(process.cwd(), 'uploads');
  }

  private get baseUrl(): string { // FIX: Base URL for serving files
    return (
      process.env.FILE_BASE_URL ||
      `http://localhost:${process.env.PORT || 3001}/api/files`
    );
  }

  async uploadBuffer(
    arg1: Buffer | string,
    arg2: string | Buffer,
    arg3: string,
  ): Promise<string> {
    const buffer = Buffer.isBuffer(arg1) ? arg1 : (arg2 as Buffer);
    const key = Buffer.isBuffer(arg1) ? (arg2 as string) : (arg1 as string);
    const mimeType = arg3; // FIX: wired through — used for logging and future metadata storage
    try {
      const fullPath = path.join(this.uploadDir, key);
      const dir = path.dirname(fullPath);

      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(fullPath, buffer);
      this.logger.log(`[Storage] Saved: ${fullPath} (${mimeType})`);
      return `${this.baseUrl}/${key}`;
    } catch (err: any) {
      this.logger.error(`[Storage] Save failed for ${key}: ${err?.message}`);
      throw new InternalServerErrorException(
        `Gagal menyimpan file: ${err?.message ?? 'unknown error'}`,
      );
    }
  }

  async uploadMulterFile( // FIX: Upload from Multer memory buffer
    file: Express.Multer.File,
    module: string,
    subfolder?: string,
  ): Promise<string> {
    const year = new Date().getFullYear();
    const ext = path.extname(file.originalname) || '.bin';
    const uniqueName = `${randomUUID()}${ext}`; // FIX: use built-in crypto uuid (no new package)
    const key = subfolder
      ? `${module}/${year}/${subfolder}/${uniqueName}`
      : `${module}/${year}/${uniqueName}`;

    return this.uploadBuffer(file.buffer, key, file.mimetype);
  }

  async deleteFile(urlOrKey: string): Promise<void> { // FIX: Delete a file by URL or key
    try {
      const key = urlOrKey.startsWith('http')
        ? urlOrKey.replace(`${this.baseUrl}/`, '')
        : urlOrKey;
      const fullPath = path.join(this.uploadDir, key);
      if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath);
        this.logger.log(`[Storage] Deleted: ${fullPath}`);
      }
    } catch (err: any) {
      this.logger.warn(`[Storage] Delete failed: ${err?.message}`);
    }
  }

  async generatePresignedUploadUrl( // FIX: Local presigned-style endpoint response
    key: string,
    _mimeType: string,
  ): Promise<{ uploadUrl: string; fileUrl: string }> {
    const apiBase =
      process.env.FILE_BASE_URL?.replace('/files', '') ||
      `http://localhost:${process.env.PORT || 3001}/api`;
    const uploadUrl = `${apiBase}/storage/upload?key=${encodeURIComponent(key)}`;
    const fileUrl = `${this.baseUrl}/${key}`;
    return { uploadUrl, fileUrl };
  }

  async generatePresignedUrl(fileKey: string, contentType: string): Promise<string> { // FIX: compatibility for existing callers
    const data = await this.generatePresignedUploadUrl(fileKey, contentType);
    return data.uploadUrl;
  }

  extractKeyFromUploadedUrl(fileUrl: string): string | null { // FIX: parse local file key from file URL
    const marker = `${this.baseUrl}/`;
    if (!fileUrl.startsWith(marker)) return null;
    return fileUrl.replace(marker, '');
  }

  async generatePresignedGetUrl(fileKey: string): Promise<string> { // FIX: compatibility get URL for local files
    return `${this.baseUrl}/${fileKey}`;
  }

  /** Baca PDF/binary dari URL publik yang dihasilkan upload (local storage). */
  downloadBuffer(fileUrl: string): Buffer {
    const key = this.extractKeyFromUploadedUrl(fileUrl);
    if (!key) {
      throw new BadRequestException('URL file tidak valid untuk pembacaan storage');
    }
    const buf = this.getFileBuffer(key);
    if (!buf) {
      throw new NotFoundException('Berkas tidak ditemukan di storage');
    }
    return buf;
  }

  getFileBuffer(key: string): Buffer | null { // FIX: Read file buffer for local storage
    try {
      const fullPath = path.join(this.uploadDir, key);
      if (fs.existsSync(fullPath)) return fs.readFileSync(fullPath);
    } catch {
      // FIX: ignore read errors and return null
    }
    return null;
  }

  fileExists(key: string): boolean { // FIX: Check if file exists
    return fs.existsSync(path.join(this.uploadDir, key));
  }

  absolutePathForKey(key: string): string { // FIX: disk path for streaming PDF (no HTTP round-trip)
    return path.join(this.uploadDir, key);
  }

  // FIX: Get file info for integrity validation
  async getFileInfo(fileUrl: string): Promise<{ exists: boolean; size: number }> {
    try {
      const key = this.extractKeyFromUploadedUrl(fileUrl);
      if (!key) {
        return { exists: false, size: 0 };
      }
      const fullPath = path.join(this.uploadDir, key);
      if (!fs.existsSync(fullPath)) {
        return { exists: false, size: 0 };
      }
      const stats = fs.statSync(fullPath);
      return { exists: true, size: stats.size };
    } catch {
      return { exists: false, size: 0 };
    }
  }
}
