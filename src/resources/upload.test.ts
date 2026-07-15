import { describe, test, expect } from 'bun:test';
import { buildUploadForm, validateUpload, loadSource, MAX_UPLOAD_BYTES } from './upload';
import { ValidationError } from '../errors';

async function filePart(form: FormData): Promise<{ file: File; bytes: Buffer }> {
    const file = form.get('file') as File;
    return { file, bytes: Buffer.from(await file.arrayBuffer()) };
}

describe('buildUploadForm', () => {
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

    test('does not copy the underlying buffer (view stays a window onto it)', async () => {
        const pdf = Buffer.from('%PDF-1.4 zero copy');
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

    test('marks the file part as application/pdf', async () => {
        const { file } = await filePart(buildUploadForm(Buffer.from('%PDF'), 'a.pdf'));
        expect(file.type).toBe('application/pdf');
    });
});

describe('validateUpload', () => {
    test('rejects an empty buffer', () => {
        expect(() => validateUpload(Buffer.alloc(0), 'a.pdf')).toThrow(ValidationError);
    });

    test('rejects a non-PDF extension, case-insensitively accepting .PDF', () => {
        expect(() => validateUpload(Buffer.from('x'), 'a.docx')).toThrow(ValidationError);
        expect(() => validateUpload(Buffer.from('x'), 'a.PDF')).not.toThrow();
    });

    test('rejects a file over the API’s 25 MB hard limit but accepts one exactly at it', () => {
        expect(MAX_UPLOAD_BYTES).toBe(25 * 1024 * 1024);
        expect(() => validateUpload(Buffer.alloc(MAX_UPLOAD_BYTES + 1), 'a.pdf')).toThrow(ValidationError);
        expect(() => validateUpload(Buffer.alloc(MAX_UPLOAD_BYTES), 'a.pdf')).not.toThrow();
    });
});

describe('loadSource', () => {
    test('requires fileName when given a Buffer', async () => {
        // @ts-expect-error — exercising the runtime guard for JS consumers
        await expect(loadSource({ buffer: Buffer.from('x') })).rejects.toThrow(ValidationError);
    });

    test('requires a non-empty filePath', async () => {
        await expect(loadSource({ filePath: '' })).rejects.toThrow(ValidationError);
    });
});
