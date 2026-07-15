import { promises as fs } from 'node:fs';
import path from 'node:path';
import { ValidationError } from '../errors';

/** Maximum upload size accepted by the API (hard limit, 25 MB). */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/** Input for an upload: either an on-disk file or an in-memory buffer. */
export type DocumentUploadSource =
    | { filePath: string; fileName?: string }
    | { buffer: Buffer; fileName: string };

/** Resolve an upload source into a `{ buffer, fileName }` pair. */
export async function loadSource(
    source: DocumentUploadSource,
): Promise<{ buffer: Buffer; fileName: string }> {
    if ('buffer' in source) {
        if (!source.fileName) {
            throw new ValidationError('fileName is required when uploading a Buffer');
        }
        return { buffer: source.buffer, fileName: source.fileName };
    }
    if (!source.filePath) {
        throw new ValidationError('filePath is required');
    }
    const buffer = await fs.readFile(source.filePath);
    return { buffer, fileName: source.fileName ?? path.basename(source.filePath) };
}

/** Validate an upload buffer: non-empty, `.pdf`, within the size limit. */
export function validateUpload(buffer: Buffer, fileName: string): void {
    if (!buffer || buffer.byteLength === 0) {
        throw new ValidationError('File buffer is empty', { fileName });
    }
    if (!fileName.toLowerCase().endsWith('.pdf')) {
        throw new ValidationError('Only PDF files are supported', { fileName });
    }
    if (buffer.byteLength > MAX_UPLOAD_BYTES) {
        throw new ValidationError('File size exceeds maximum allowed (25MB)', {
            fileSize: buffer.byteLength,
            maxSize: MAX_UPLOAD_BYTES,
        });
    }
}

/**
 * Normalise a display name into a filename the upload endpoints accept.
 *
 * `POST /accounts/{id}/templates` rejects a `file` part whose filename has no
 * `.pdf` extension (`415 Unsupported file extension`), so the extension is
 * appended when missing. `.pdf` is also the API's own naming convention — its
 * rename example is `"Service agreement.pdf"`.
 */
function toUploadFileName(name: string): string {
    return name.toLowerCase().endsWith('.pdf') ? name : `${name}.pdf`;
}

/**
 * Build the `multipart/form-data` body shared by document and template uploads:
 * a `file` part (the PDF) plus an optional JSON `metadata` field.
 *
 * The resource's display `name` is taken from the **filename of the `file`
 * part** — the API derives it from there and ignores any separate `name` field
 * in the body. `options.name` therefore rides on the part's filename, falling
 * back to `fileName` (the source file's own name) when not supplied.
 *
 * Two API-side behaviours worth knowing, both verified against the sandbox:
 * - The stored name always ends in `.pdf`; `'NDA template'` is stored as
 *   `'NDA template.pdf'`.
 * - Accents are transliterated: `'Contrato de Serviço.pdf'` is stored as
 *   `'Contrato de Servico.pdf'`.
 */
export function buildUploadForm(
    buffer: Buffer,
    fileName: string,
    options: { name?: string; metadata?: Record<string, unknown> } = {},
): FormData {
    const form = new FormData();
    // Blob copy-free view over the Buffer's underlying ArrayBuffer slice.
    const view = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const partName = options.name === undefined ? fileName : toUploadFileName(options.name);
    form.append('file', new Blob([view], { type: 'application/pdf' }), partName);
    if (options.metadata) {
        form.append('metadata', JSON.stringify(options.metadata));
    }
    return form;
}
