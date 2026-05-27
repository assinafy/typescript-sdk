import { describe, test, expect, beforeEach } from 'bun:test';
import { DocumentResource } from './documents';
import { ValidationError } from '../errors';
import type { AxiosInstance } from 'axios';

describe('DocumentResource', () => {
    let mockAxios: AxiosInstance;
    let docs: DocumentResource;

    beforeEach(() => {
        mockAxios = {
            get: async () => ({ status: 200, data: { status: 200, data: [] }, headers: {} }),
            post: async () => ({ status: 200, data: { status: 200, data: [] } }),
            put: async () => ({ status: 200, data: { status: 200, data: [] } }),
            delete: async () => ({ status: 200, data: { status: 200, data: { detached: true } } }),
        } as unknown as AxiosInstance;
        docs = new DocumentResource(mockAxios, 'acc');
    });

    test('list forwards status/method/tags filters', async () => {
        let params: unknown;
        const ax = {
            ...mockAxios,
            get: async (_u: string, cfg: { params: unknown }) => {
                params = cfg.params;
                return { status: 200, data: { status: 200, data: [] }, headers: {} };
            },
        } as unknown as AxiosInstance;
        await new DocumentResource(ax, 'acc').list({ status: 'pending_signature', method: 'virtual', tags: 'a,b' });
        expect(params).toEqual({ status: 'pending_signature', method: 'virtual', tags: 'a,b' });
    });

    test('listTags hits the account-scoped document tags endpoint', async () => {
        let url = '';
        const ax = {
            ...mockAxios,
            get: async (u: string) => {
                url = u;
                return { status: 200, data: { status: 200, data: [] }, headers: {} };
            },
        } as unknown as AxiosInstance;
        await new DocumentResource(ax, 'acc').listTags('doc1');
        expect(url).toBe('/accounts/acc/documents/doc1/tags');
    });

    test('replaceTags PUTs the tags array (empty allowed)', async () => {
        let url = '';
        let body: unknown;
        const ax = {
            ...mockAxios,
            put: async (u: string, b: unknown) => {
                url = u;
                body = b;
                return { status: 200, data: { status: 200, data: [] } };
            },
        } as unknown as AxiosInstance;
        await new DocumentResource(ax, 'acc').replaceTags('doc1', []);
        expect(url).toBe('/accounts/acc/documents/doc1/tags');
        expect(body).toEqual({ tags: [] });
    });

    test('addTags rejects an empty array', async () => {
        await expect(docs.addTags('doc1', [])).rejects.toThrow(ValidationError);
    });

    test('detachTag DELETEs the document/tag pair', async () => {
        let url = '';
        const ax = {
            ...mockAxios,
            delete: async (u: string) => {
                url = u;
                return { status: 200, data: { status: 200, data: { detached: true } } };
            },
        } as unknown as AxiosInstance;
        await new DocumentResource(ax, 'acc').detachTag('doc1', 'tag1');
        expect(url).toBe('/accounts/acc/documents/doc1/tags/tag1');
    });

    test('download validates the document id', async () => {
        await expect(docs.download('')).rejects.toThrow(ValidationError);
    });
});
