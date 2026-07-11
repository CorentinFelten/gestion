import { randomBytes } from 'crypto';
import { extname } from 'path';
import { mkdirSync } from 'fs';
import { diskStorage } from 'multer';
import { BadRequestException } from '@nestjs/common';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';

/**
 * SEC-10: attachment-upload hardening config. multer ships no types and
 * `@types/multer` is intentionally NOT added (no package.json changes), so the
 * runtime `diskStorage` engine is pulled loosely; the file param is typed with
 * a minimal local interface rather than `Express.Multer.File`.
 */

/** Minimal shape of a multer-populated upload (no @types/multer needed). */
export interface UploadedFileLike {
  originalname: string;
  mimetype: string;
  size: number;
  path: string;
  filename?: string;
}

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const DEFAULT_ALLOWED_MIME =
  'image/jpeg,image/png,image/gif,image/webp,application/pdf';

export function uploadDir(): string {
  const raw = process.env.UPLOAD_DIR;
  return raw && raw.trim().length > 0 ? raw.trim() : '/data/uploads';
}

export function maxUploadBytes(): number {
  const raw = Number(process.env.UPLOAD_MAX_BYTES);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MAX_BYTES;
}

export function allowedMimeTypes(): Set<string> {
  const list = (process.env.UPLOAD_ALLOWED_MIME ?? DEFAULT_ALLOWED_MIME)
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
  return new Set(list.length > 0 ? list : DEFAULT_ALLOWED_MIME.split(','));
}

/** Only allow a short, alphanumeric extension carried over onto the disk name. */
function safeExt(originalname: string): string {
  const ext = extname(originalname ?? '').toLowerCase();
  return /^\.[a-z0-9]{1,10}$/.test(ext) ? ext : '';
}

/** multer options for the single-file attachment upload endpoint. */
export function attachmentMulterOptions(): MulterOptions {
  const dir = uploadDir();
  const allowed = allowedMimeTypes();
  return {
    storage: diskStorage({
      destination: (_req, _file, cb) => {
        try {
          mkdirSync(dir, { recursive: true });
          cb(null, dir);
        } catch (err) {
          cb(err as Error, dir);
        }
      },
      filename: (_req, file, cb) => {
        // Randomized on-disk name, the client `originalname` is never used to
        // build the stored path.
        cb(null, `${randomBytes(16).toString('hex')}${safeExt(file.originalname)}`);
      },
    }),
    limits: { fileSize: maxUploadBytes(), files: 1 },
    fileFilter: (_req, file, cb) => {
      if (allowed.has((file.mimetype ?? '').toLowerCase())) {
        cb(null, true);
      } else {
        cb(new BadRequestException('Unsupported attachment type'), false);
      }
    },
  };
}
