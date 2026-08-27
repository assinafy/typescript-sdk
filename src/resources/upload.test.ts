import { describe, test, expect, spyOn } from 'bun:test';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildUploadForm, validateUpload, loadSource, MAX_UPLOAD_BYTES } from './upload';
import { ValidationError } from '../errors';

async function filePart(form: FormData): Promise<{ file: File; bytes: Buffer }> {
    const file = form.get('file') as File;
    return { file, bytes: Buffer.from(await file.arrayBuffer()) };
}

describe('buildUploadForm', () => {
    test('rejects malformed options with ValidationError', () => {
        expect(() => buildUploadForm(Buffer.from('%PDF'), 'a.pdf', null as never)).toThrow(
            ValidationError,
        );
        expect(() => buildUploadForm(Buffer.from('%PDF'), 'a.pdf', { name: '' })).toThrow(
            ValidationError,
        );
    });

    test('sends exactly the Buffer’s own bytes when it has a non-zero byteOffset', async () => {
        // Node pools small Buffers, so a Buffer's view often starts partway into
        // a larger ArrayBuffer. Ignoring byteOffset/byteLength would upload a
        // neighbouring allocation's bytes instead of the file.
        const pdf = Buffer.from('%PDF-1.4 real content');
        const backing = Buffer.alloc(pdf.byteLength + 512, 0xab);
        pdf.copy(backing, 512);
        const offsetBuf = backing.subarray(512);
        expect(offsetBuf.byteOffset).toBe(512);

        const form = buildUploadForm(offsetBuf, 'doc.pdf');
        const { bytes } = await filePart(form);
        expect(bytes.byteLength).toBe(pdf.byteLength);
        expect(Buffer.compare(bytes, pdf)).toBe(0);
        // Would be 0xab padding if the offset were dropped.
        expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
    });

    test('preserves the exact visible Buffer bytes in the multipart file', async () => {
        const pdf = Buffer.from('%PDF-1.4 exact bytes');
        const form = buildUploadForm(pdf, 'doc.pdf');
        const { bytes } = await filePart(form);
        expect(Buffer.compare(bytes, pdf)).toBe(0);
    });

    test('carries the display name as the file part filename, not a name field', async () => {
        const form = buildUploadForm(Buffer.from('%PDF-1.4'), 'src.pdf', { name: 'Display' });
        const { file } = await filePart(form);
        expect(file.name).toBe('Display.pdf');
        expect(form.get('name')).toBeNull();
    });

    test('falls back to the source file name when no display name is given', async () => {
        const form = buildUploadForm(Buffer.from('%PDF-1.4'), 'src.pdf');
        const { file } = await filePart(form);
        expect(file.name).toBe('src.pdf');
    });

    test('JSON-encodes metadata only when supplied', async () => {
        expect(buildUploadForm(Buffer.from('%PDF'), 'a.pdf').get('metadata')).toBeNull();
        const form = buildUploadForm(Buffer.from('%PDF'), 'a.pdf', { metadata: { orderId: 'A-1' } });
        expect(form.get('metadata')).toBe('{"orderId":"A-1"}');
    });

    test('rejects non-record or circular metadata with ValidationError', () => {
        expect(() =>
            buildUploadForm(Buffer.from('%PDF'), 'a.pdf', { metadata: [] as never }),
        ).toThrow(ValidationError);
        const metadata: Record<string, unknown> = {};
        metadata['self'] = metadata;
        expect(() => buildUploadForm(Buffer.from('%PDF'), 'a.pdf', { metadata })).toThrow(
            'metadata must be JSON-serializable',
        );
    });

    test('marks the file part as application/pdf', async () => {
        const { file } = await filePart(buildUploadForm(Buffer.from('%PDF'), 'a.pdf'));
        expect(file.type).toBe('application/pdf');
    });
});

describe('validateUpload', () => {
    test('rejects an empty buffer', () => {
        expect(() => validateUpload(Buffer.alloc(0), 'a.pdf')).toThrow(ValidationError);
    });

    test('requires both a PDF extension and PDF magic bytes', () => {
        expect(() => validateUpload(Buffer.from('%PDF-1.4'), 'a.docx')).toThrow(ValidationError);
        expect(() => validateUpload(Buffer.from('not-a-pdf'), 'a.PDF')).toThrow(ValidationError);
        expect(() => validateUpload(Buffer.from('%PDF-1.7'), 'a.PDF')).not.toThrow();
    });

    test('rejects a file over the API’s 25 MB hard limit but accepts one exactly at it', () => {
        expect(MAX_UPLOAD_BYTES).toBe(25 * 1024 * 1024);
        expect(() => validateUpload(pdfBuffer(MAX_UPLOAD_BYTES + 1), 'a.pdf')).toThrow(ValidationError);
        expect(() => validateUpload(pdfBuffer(MAX_UPLOAD_BYTES), 'a.pdf')).not.toThrow();
    });
});

describe('loadSource', () => {
    test('rejects missing sources and non-Buffer buffer values', async () => {
        await expect(loadSource(null as never)).rejects.toThrow('Upload source is required');
        await expect(
            loadSource({ buffer: 'not-bytes', fileName: 'contract.pdf' } as never),
        ).rejects.toThrow('buffer must be a Node Buffer');
    });

    test('rejects malformed options with ValidationError', async () => {
        await expect(
            loadSource({ buffer: Buffer.from('x'), fileName: 'a.pdf' }, null as never),
        ).rejects.toThrow(ValidationError);
    });

    test('requires fileName when given a Buffer', async () => {
        // @ts-expect-error — exercising the runtime guard for JS consumers
        await expect(loadSource({ buffer: Buffer.from('x') })).rejects.toThrow(ValidationError);
    });

    test('requires a non-empty filePath', async () => {
        await expect(loadSource({ filePath: '' })).rejects.toThrow(ValidationError);
        await expect(
            loadSource({ filePath: '/not-read.pdf', fileName: '' }),
        ).rejects.toThrow('fileName cannot be empty');
    });

    test('reads a disk upload and uses the basename or explicit file name', async () => {
        const directory = await fs.mkdtemp(path.join(tmpdir(), 'assinafy-upload-file-'));
        const filePath = path.join(directory, 'contract.pdf');
        const bytes = Buffer.from('%PDF-1.7 disk fixture');
        try {
            await fs.writeFile(filePath, bytes);
            await expect(loadSource({ filePath })).resolves.toEqual({
                buffer: bytes,
                fileName: 'contract.pdf',
            });
            await expect(loadSource({ filePath, fileName: 'renamed.pdf' })).resolves.toEqual({
                buffer: bytes,
                fileName: 'renamed.pdf',
            });
        } finally {
            await fs.rm(directory, { recursive: true, force: true });
        }
    });

    test('normalizes inaccessible and non-file paths into ValidationError', async () => {
        await expect(loadSource({ filePath: '/definitely/missing/assinafy.pdf' })).rejects.toThrow(
            'Unable to access upload file',
        );

        const directory = await fs.mkdtemp(path.join(tmpdir(), 'assinafy-upload-dir-'));
        try {
            await expect(loadSource({ filePath: directory })).rejects.toThrow(
                'Upload path must reference a regular file',
            );
        } finally {
            await fs.rm(directory, { recursive: true, force: true });
        }
    });

    test('normalizes a read failure after a successful stat', async () => {
        const directory = await fs.mkdtemp(path.join(tmpdir(), 'assinafy-upload-read-'));
        const filePath = path.join(directory, 'contract.pdf');
        await fs.writeFile(filePath, '%PDF-1.7');
        const readFile = spyOn(fs, 'readFile').mockRejectedValueOnce(new Error('read denied'));

        try {
            await expect(loadSource({ filePath })).rejects.toThrow('Unable to read upload file');
        } finally {
            readFile.mockRestore();
            await fs.rm(directory, { recursive: true, force: true });
        }
    });

    test('rejects an oversized disk file from stat before attempting to read it', async () => {
        const directory = await fs.mkdtemp(path.join(tmpdir(), 'assinafy-upload-size-'));
        const filePath = path.join(directory, 'large.pdf');
        try {
            await fs.writeFile(filePath, '%PDF-1.7');
            await fs.truncate(filePath, MAX_UPLOAD_BYTES + 1);
            await expect(loadSource({ filePath }, { maxBytes: MAX_UPLOAD_BYTES })).rejects.toThrow(
                'File size exceeds maximum allowed (25MB)',
            );
        } finally {
            await fs.rm(directory, { recursive: true, force: true });
        }
    });

    test('applies a size limit only when the caller supplies one', async () => {
        const source = { buffer: Buffer.from('ab'), fileName: 'logo.png' };
        await expect(loadSource(source)).resolves.toEqual(source);
        await expect(loadSource(source, { maxBytes: 1 })).rejects.toThrow(
            'File size exceeds maximum allowed',
        );
    });
});

function pdfBuffer(size: number): Buffer {
    const buffer = Buffer.alloc(size);
    buffer.write('%PDF-');
    return buffer;
}
