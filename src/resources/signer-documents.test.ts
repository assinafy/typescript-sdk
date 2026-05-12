import { describe, test, expect } from 'bun:test';
import type { AxiosInstance } from 'axios';
import { SignerDocumentsResource } from './signer-documents';
import { ValidationError } from '../errors';

function mockHttp(): { http: AxiosInstance; calls: Array<{ method: string; url: string; body?: unknown; config?: unknown }> } {
    const calls: Array<{ method: string; url: string; body?: unknown; config?: unknown }> = [];
    const ok = (data: unknown) => ({ status: 200, data: { status: 200, data } });
    const binaryOk = (buf: Buffer) => ({ status: 200, data: buf.buffer });
    const http = {
        get: async (url: string, config?: unknown) => {
            calls.push({ method: 'GET', url, config });
            if (url.includes('/download')) {
                return binaryOk(Buffer.from('pdf'));
            }
            return ok({ id: 'doc-1' });
        },
        post: async (url: string, body: unknown, config?: unknown) => {
            calls.push({ method: 'POST', url, body, config });
            return ok({});
        },
        put: async (url: string, body: unknown, config?: unknown) => {
            calls.push({ method: 'PUT', url, body, config });
            return ok([]);
        },
    } as unknown as AxiosInstance;
    return { http, calls };
}

describe('SignerDocumentsResource', () => {
    test('getCurrent requires both IDs', async () => {
        const { http } = mockHttp();
        const r = new SignerDocumentsResource(http);
        await expect(r.getCurrent('', 'c')).rejects.toThrow(ValidationError);
        await expect(r.getCurrent('s', '')).rejects.toThrow(ValidationError);
    });

    test('list passes the signer-access-code', async () => {
        const { http, calls } = mockHttp();
        const r = new SignerDocumentsResource(http);
        await r.list('s1', 'code', { search: 'foo' });
        expect(calls[0]?.url).toBe('/signers/s1/documents');
        expect(calls[0]?.config).toEqual({ params: { 'signer-access-code': 'code', search: 'foo' } });
    });

    test('signMultiple rejects empty arrays', async () => {
        const { http } = mockHttp();
        const r = new SignerDocumentsResource(http);
        await expect(r.signMultiple([], 'code')).rejects.toThrow(ValidationError);
    });

    test('declineMultiple needs a reason', async () => {
        const { http } = mockHttp();
        const r = new SignerDocumentsResource(http);
        await expect(r.declineMultiple(['d1'], '', 'code')).rejects.toThrow(ValidationError);
    });

    test('uploadSignature posts to /signature with image data', async () => {
        const { http, calls } = mockHttp();
        const r = new SignerDocumentsResource(http);
        await r.uploadSignature('code', Buffer.from([1, 2, 3]));
        expect(calls[0]?.url).toBe('/signature');
        expect(calls[0]?.config).toEqual({
            params: { 'signer-access-code': 'code', type: 'signature' },
            headers: { 'Content-Type': 'image/png' },
        });
    });

    test('sign requires entries', async () => {
        const { http } = mockHttp();
        const r = new SignerDocumentsResource(http);
        await expect(r.sign('d', 'a', 'code', [])).rejects.toThrow(ValidationError);
    });

    test('decline requires reason', async () => {
        const { http } = mockHttp();
        const r = new SignerDocumentsResource(http);
        await expect(r.decline('d', 'a', 'code', '')).rejects.toThrow(ValidationError);
    });
});
