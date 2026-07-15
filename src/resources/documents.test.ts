import { describe, test, expect, beforeEach } from 'bun:test';
import { DocumentResource } from './documents';
import { ApiError, ValidationError } from '../errors';
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

    test('list items expose the live fields (artifacts, signing_url, assignment, …)', async () => {
        const item = {
            id: 'd1',
            name: 'doc.pdf',
            status: 'metadata_ready',
            account_id: 'acc',
            template_id: null,
            artifacts: { original: 'https://api/d1/download/original', thumbnail: 'https://api/d1/thumbnail' },
            signing_url: 'https://app/sign/d1',
            pages: [{ id: 'p1', number: 1, height: 417, width: 417, download_url: 'https://api/d1/pages/p1/download' }],
            assignment: null,
            decline_reason: null,
            declined_by: null,
            tags: [],
            created_at: '2026-06-05T19:52:27Z',
            updated_at: '2026-06-05T19:52:30Z',
            is_closed: false,
        };
        const ax = {
            ...mockAxios,
            get: async () => ({ status: 200, data: { status: 200, data: [item] }, headers: {} }),
        } as unknown as AxiosInstance;
        const { data } = await new DocumentResource(ax, 'acc').list();
        expect(data[0]?.artifacts?.original).toContain('/download/original');
        expect(data[0]?.signing_url).toBe('https://app/sign/d1');
        expect(data[0]?.assignment).toBeNull();
        expect(data[0]?.pages?.[0]?.download_url).toContain('/pages/');
    });

    test('upload tolerates an absent assignment and empty pages', async () => {
        const uploaded = {
            resource: 'document',
            id: 'd1',
            account_id: 'acc',
            template_id: null,
            name: 'doc.pdf',
            status: 'uploaded',
            artifacts: { original: 'https://api/d1/download/original' },
            signing_url: 'https://app/sign/d1',
            tags: [],
            pages: [],
            created_at: '2026-06-05T20:50:33Z',
            updated_at: '2026-06-05T20:50:34Z',
            is_closed: false,
            decline_reason: null,
            declined_by: null,
        };
        const ax = {
            ...mockAxios,
            post: async () => ({ status: 200, data: { status: 200, data: uploaded } }),
        } as unknown as AxiosInstance;
        const doc = await new DocumentResource(ax, 'acc').upload({
            buffer: Buffer.from('%PDF-1.4 minimal'),
            fileName: 'doc.pdf',
        });
        expect(doc.id).toBe('d1');
        expect(doc.assignment).toBeUndefined();
        expect(doc.pages).toEqual([]);
    });
});

describe('DocumentResource.search', () => {
    const okList = { status: 200, data: { status: 200, data: [] }, headers: {} };

    test('GETs the search endpoint and forwards params', async () => {
        let url = '';
        let params: unknown;
        const ax = {
            get: async (u: string, cfg: { params: unknown }) => {
                url = u;
                params = cfg.params;
                return okList;
            },
        } as unknown as AxiosInstance;
        await new DocumentResource(ax, 'acc').search({ search: 'nda', status: 'pending_signature', 'per-page': 20 });
        expect(url).toBe('/accounts/acc/documents/search');
        expect(params).toEqual({ search: 'nda', status: 'pending_signature', 'per-page': 20 });
    });

    test('drops undefined params rather than sending them', async () => {
        let params: unknown;
        const ax = {
            get: async (_u: string, cfg: { params: unknown }) => {
                params = cfg.params;
                return okList;
            },
        } as unknown as AxiosInstance;
        await new DocumentResource(ax, 'acc').search({ search: undefined, page: 2 });
        expect(params).toEqual({ page: 2 });
    });

    test('honours an explicit accountId override', async () => {
        let url = '';
        const ax = {
            get: async (u: string) => {
                url = u;
                return okList;
            },
        } as unknown as AxiosInstance;
        await new DocumentResource(ax, 'acc').search({}, 'other-acc');
        expect(url).toBe('/accounts/other-acc/documents/search');
    });

    test('throws ValidationError when no account ID is available', async () => {
        const ax = { get: async () => okList } as unknown as AxiosInstance;
        await expect(new DocumentResource(ax).search()).rejects.toThrow(ValidationError);
    });
});

describe('DocumentResource.rename', () => {
    test('PATCHes /documents/{id} with the new name', async () => {
        let url = '';
        let body: unknown;
        const ax = {
            patch: async (u: string, b: unknown) => {
                url = u;
                body = b;
                return { status: 200, data: { status: 200, data: { id: 'doc-1', name: 'New.pdf' } } };
            },
        } as unknown as AxiosInstance;
        const result = await new DocumentResource(ax, 'acc').rename('doc-1', 'New.pdf');
        expect(url).toBe('/documents/doc-1');
        expect(body).toEqual({ name: 'New.pdf' });
        expect(result.name).toBe('New.pdf');
    });

    test('validates documentId and name before any request', async () => {
        let called = false;
        const ax = {
            patch: async () => {
                called = true;
                return { status: 200, data: { status: 200, data: {} } };
            },
        } as unknown as AxiosInstance;
        const docs = new DocumentResource(ax, 'acc');
        await expect(docs.rename('', 'New.pdf')).rejects.toThrow(ValidationError);
        await expect(docs.rename('doc-1', '')).rejects.toThrow(ValidationError);
        expect(called).toBe(false);
    });
});

describe('DocumentResource.waitUntilReady error handling', () => {
    const envelope = (data: unknown) => ({ status: 200, data: { status: 200, data }, headers: {} });

    test('surfaces a 4xx immediately instead of masking it as a timeout', async () => {
        // Regression: a bad API key used to be swallowed by the poll loop, so the
        // caller waited the full maxWaitMs and then got "Timeout waiting for
        // document to be ready" — hiding the real cause.
        let calls = 0;
        const ax = {
            get: async () => {
                calls++;
                throw new ApiError('Credenciais inválidas.', 401, null);
            },
        } as unknown as AxiosInstance;

        const started = Date.now();
        await expect(
            new DocumentResource(ax, 'acc').waitUntilReady('doc-1', { maxWaitMs: 5_000, pollIntervalMs: 50 }),
        ).rejects.toThrow(ApiError);
        // Bailed on the first attempt rather than polling to exhaustion.
        expect(calls).toBe(1);
        expect(Date.now() - started).toBeLessThan(1_000);
    });

    test('keeps polling through a transient 5xx and still succeeds', async () => {
        let calls = 0;
        const ax = {
            get: async () => {
                calls++;
                if (calls === 1) throw new ApiError('Server blew up', 500, null);
                return envelope({ id: 'doc-1', status: 'metadata_ready' });
            },
        } as unknown as AxiosInstance;
        const result = await new DocumentResource(ax, 'acc').waitUntilReady('doc-1', {
            maxWaitMs: 5_000,
            pollIntervalMs: 10,
        });
        expect(result.status).toBe('metadata_ready');
        expect(calls).toBe(2);
    });

    test('keeps polling through a 429 rather than bailing', async () => {
        let calls = 0;
        const ax = {
            get: async () => {
                calls++;
                if (calls === 1) throw new ApiError('Too many requests', 429, null);
                return envelope({ id: 'doc-1', status: 'metadata_ready' });
            },
        } as unknown as AxiosInstance;
        await new DocumentResource(ax, 'acc').waitUntilReady('doc-1', { maxWaitMs: 5_000, pollIntervalMs: 10 });
        expect(calls).toBe(2);
    });

    test('still throws ValidationError on a terminal failure status', async () => {
        const ax = {
            get: async () => envelope({ id: 'doc-1', status: 'metadata_failed' }),
        } as unknown as AxiosInstance;
        await expect(
            new DocumentResource(ax, 'acc').waitUntilReady('doc-1', { maxWaitMs: 500, pollIntervalMs: 10 }),
        ).rejects.toThrow(ValidationError);
    });
});
