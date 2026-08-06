import { promises as fs } from 'node:fs';
import path from 'node:path';
import { ValidationError } from '../errors';

/** Maximum upload size accepted by the API (hard limit, 25 MB). */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/** Input for a file upload: either an on-disk file or an in-memory buffer. */
export type FileUploadSource =
    | { filePath: string; fileName?: string }
    | { buffer: Buffer; fileName: string };

/** Input accepted by PDF document/template uploads. */
export type DocumentUploadSource = FileUploadSource;

/** Resolve an upload source into a `{ buffer, fileName }` pair. */
export async function loadSource(
    source: FileUploadSource,
    options: { maxBytes?: number } = {},
): Promise<{ buffer: Buffer; fileName: string }> {
    if (!source || typeof source !== 'object') {
        throw new ValidationError('Upload source is required');
    }
    if ('buffer' in source) {
        if (!Buffer.isBuffer(source.buffer)) {
            throw new ValidationError('buffer must be a Node Buffer');
        }
        if (typeof source.fileName !== 'string' || !source.fileName.trim()) {
            throw new ValidationError('fileName is required when uploading a Buffer');
        }
        if (options.maxBytes !== undefined && source.buffer.byteLength > options.maxBytes) {
            throw fileTooLarge(source.buffer.byteLength, options.maxBytes);
        }
        return { buffer: source.buffer, fileName: source.fileName };
    }
    if (typeof source.filePath !== 'string' || !source.filePath.trim()) {
        throw new ValidationError('filePath is required');
    }
    if (
        source.fileName !== undefined &&
        (typeof source.fileName !== 'string' || !source.fileName.trim())
    ) {
        throw new ValidationError('fileName cannot be empty');
    }

    let fileSize: number;
    try {
        const stats = await fs.stat(source.filePath);
        if (!stats.isFile()) {
            throw new ValidationError('Upload path must reference a regular file', {
                filePath: source.filePath,
            });
        }
        fileSize = stats.size;
    } catch (error) {
        if (error instanceof ValidationError) throw error;
        throw new ValidationError('Unable to access upload file', {
            filePath: source.filePath,
            reason: error instanceof Error ? error.message : String(error),
        });
    }

    if (options.maxBytes !== undefined && fileSize > options.maxBytes) {
        throw fileTooLarge(fileSize, options.maxBytes);
    }

    let buffer: Buffer;
    try {
        buffer = await fs.readFile(source.filePath);
    } catch (error) {
        throw new ValidationError('Unable to read upload file', {
            filePath: source.filePath,
            reason: error instanceof Error ? error.message : String(error),
        });
    }
    return { buffer, fileName: source.fileName ?? path.basename(source.filePath) };
}

/** Reject an empty upload before making a network request. */
export function validateFileNotEmpty(buffer: Buffer, fileName: string): void {
    if (!Buffer.isBuffer(buffer) || buffer.byteLength === 0) {
        throw new ValidationError('File buffer is empty', { fileName });
    }
}

/** Validate an upload buffer: non-empty, `.pdf`, within the size limit. */
export function validateUpload(buffer: Buffer, fileName: string): void {
    validateFileNotEmpty(buffer, fileName);
    if (!fileName.toLowerCase().endsWith('.pdf')) {
        throw new ValidationError('Only PDF files are supported', { fileName });
    }
    if (buffer.byteLength > MAX_UPLOAD_BYTES) {
        throw fileTooLarge(buffer.byteLength, MAX_UPLOAD_BYTES);
    }
    if (buffer.byteLength < 5 || !buffer.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
        throw new ValidationError('File content is not a valid PDF', { fileName });
    }
}

function fileTooLarge(fileSize: number, maxSize: number): ValidationError {
    return new ValidationError(`File size exceeds maximum allowed (${formatMegabytes(maxSize)})`, {
        fileSize,
        maxSize,
    });
}

function formatMegabytes(bytes: number): string {
    const megabytes = bytes / (1024 * 1024);
    return `${Number.isInteger(megabytes) ? megabytes : megabytes.toFixed(2)}MB`;
}

/** Build a one-part multipart body without copying the Buffer's bytes. */
export function buildFileForm(
    buffer: Buffer,
    fileName: string,
    contentType: string,
): FormData {
    const form = new FormData();
    const view = new Uint8Array(
        buffer.buffer as ArrayBuffer,
        buffer.byteOffset,
        buffer.byteLength,
    );
    form.append('file', new Blob([view], { type: contentType }), fileName);
    return form;
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
    const partName = options.name === undefined ? fileName : toUploadFileName(options.name);
    // `buildFileForm` deliberately preserves the Buffer window instead of
    // copying its backing allocation (which may be a pooled Buffer).
    const form = buildFileForm(buffer, partName, 'application/pdf');
    if (options.metadata) {
        form.append('metadata', JSON.stringify(options.metadata));
    }
    return form;
}
