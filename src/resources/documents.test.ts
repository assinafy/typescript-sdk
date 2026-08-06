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
        // Deliberately exercise JavaScript callers that pass an explicit
        // `undefined`, even though exact optional property types tell TS callers
        // to omit the property instead.
        const dirtyParams = { search: undefined, page: 2 } as unknown as Parameters<
            DocumentResource['search']
        >[0];
        await new DocumentResource(ax, 'acc').search(dirtyParams);
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
        // 'failed' is a REAL terminal status in FAILED_STATUSES, so this exercises
        // the terminal branch (immediate throw) — not the timeout fallback that a
        // non-existent status like 'metadata_failed' would have hit.
        const ax = {
            get: async () => envelope({ id: 'doc-1', status: 'failed' }),
        } as unknown as AxiosInstance;
        await expect(
            new DocumentResource(ax, 'acc').waitUntilReady('doc-1', { maxWaitMs: 500, pollIntervalMs: 10 }),
        ).rejects.toThrow(/Document processing failed with status: failed/);
    });
});

describe('DocumentResource.getSigningProgress', () => {
    const detailsFor = (data: unknown) =>
        ({
            get: async () => ({ status: 200, data: { status: 200, data }, headers: {} }),
        }) as unknown as AxiosInstance;

    test('1 of 3 signed → 33.33%', async () => {
        const ax = detailsFor({
            id: 'doc-1',
            status: 'pending_signature',
            assignment: { summary: { signer_count: 3, completed_count: 1 } },
        });
        const progress = await new DocumentResource(ax, 'acc').getSigningProgress('doc-1');
        expect(progress).toEqual({ signed: 1, total: 3, pending: 2, percentage: 33.33 });
    });

    test('no assignment → all zeros (total 0)', async () => {
        const ax = detailsFor({ id: 'doc-1', status: 'metadata_ready', assignment: null });
        const progress = await new DocumentResource(ax, 'acc').getSigningProgress('doc-1');
        expect(progress).toEqual({ signed: 0, total: 0, pending: 0, percentage: 0 });
    });

    test('falls back to signers.length when the summary is absent', async () => {
        const ax = detailsFor({
            id: 'doc-1',
            status: 'pending_signature',
            assignment: { signers: [{ id: 's1' }, { id: 's2' }] },
        });
        const progress = await new DocumentResource(ax, 'acc').getSigningProgress('doc-1');
        expect(progress).toEqual({ signed: 0, total: 2, pending: 2, percentage: 0 });
    });
});

describe('DocumentResource.isFullySigned', () => {
    const detailsFor = (data: unknown) =>
        ({
            get: async () => ({ status: 200, data: { status: 200, data }, headers: {} }),
        }) as unknown as AxiosInstance;

    test('status certificated short-circuits to true', async () => {
        const ax = detailsFor({ id: 'doc-1', status: 'certificated', assignment: null });
        expect(await new DocumentResource(ax, 'acc').isFullySigned('doc-1')).toBe(true);
    });

    test('true when every signer completed (signer_count === completed_count > 0)', async () => {
        const ax = detailsFor({
            id: 'doc-1',
            status: 'pending_signature',
            assignment: { summary: { signer_count: 2, completed_count: 2 } },
        });
        expect(await new DocumentResource(ax, 'acc').isFullySigned('doc-1')).toBe(true);
    });

    test('false when the counts disagree', async () => {
        const ax = detailsFor({
            id: 'doc-1',
            status: 'pending_signature',
            assignment: { summary: { signer_count: 2, completed_count: 1 } },
        });
        expect(await new DocumentResource(ax, 'acc').isFullySigned('doc-1')).toBe(false);
    });

    test('false when there is no summary', async () => {
        const ax = detailsFor({ id: 'doc-1', status: 'pending_signature', assignment: null });
        expect(await new DocumentResource(ax, 'acc').isFullySigned('doc-1')).toBe(false);
    });
});

describe('DocumentResource.createFromTemplate', () => {
    test('POSTs the template documents endpoint with { signers, ...options }', async () => {
        let url = '';
        let body: unknown;
        const ax = {
            post: async (u: string, b: unknown) => {
                url = u;
                body = b;
                return { status: 200, data: { status: 200, data: { id: 'doc-1' } } };
            },
        } as unknown as AxiosInstance;
        const signers = [
            { role_id: 'role1', id: 'signer1', verification_method: 'Email', notification_methods: ['Email'] },
        ];
        await new DocumentResource(ax, 'acc').createFromTemplate(
            'tmpl1',
            signers,
            {
                name: 'My Contract',
                message: 'Please sign',
                signers: [{ role_id: 'attacker', id: 'attacker' }],
            } as never,
        );
        expect(url).toBe('/accounts/acc/templates/tmpl1/documents');
        expect(body).toEqual({ signers, name: 'My Contract', message: 'Please sign' });
    });

    test('validates the template id before any request', async () => {
        let called = false;
        const ax = {
            post: async () => {
                called = true;
                return { status: 200, data: { status: 200, data: { id: 'doc-1' } } };
            },
        } as unknown as AxiosInstance;
        await expect(new DocumentResource(ax, 'acc').createFromTemplate('', [])).rejects.toThrow(
            ValidationError,
        );
        expect(called).toBe(false);
    });
});

describe('DocumentResource.estimateCostFromTemplate', () => {
    test('POSTs the estimate-cost endpoint with a body of exactly { signers }', async () => {
        let url = '';
        let body: unknown;
        const ax = {
            post: async (u: string, b: unknown) => {
                url = u;
                body = b;
                return { status: 200, data: { status: 200, data: { total_credits: 1 } } };
            },
        } as unknown as AxiosInstance;
        const signers = [{ role_id: 'role1', verification_method: 'Email' }];
        await new DocumentResource(ax, 'acc').estimateCostFromTemplate('tmpl1', signers);
        expect(url).toBe('/accounts/acc/templates/tmpl1/documents/estimate-cost');
        expect(body).toEqual({ signers });
    });

    test('strips create-only id/step fields from cost descriptors at runtime', async () => {
        let body: unknown;
        const ax = {
            post: async (_url: string, value: unknown) => {
                body = value;
                return { status: 200, data: { status: 200, data: { total_credits: 0 } } };
            },
        } as unknown as AxiosInstance;
        await new DocumentResource(ax, 'acc').estimateCostFromTemplate(
            'tmpl1',
            [{ role_id: 'role1', id: 'ignored', step: 2 } as never],
        );
        expect(body).toEqual({ signers: [{ role_id: 'role1' }] });
    });

    test('requires at least one valid template role for cost estimation', async () => {
        const resource = new DocumentResource({} as AxiosInstance, 'acc');
        await expect(resource.estimateCostFromTemplate('tmpl1', [])).rejects.toThrow(
            ValidationError,
        );
        await expect(
            resource.estimateCostFromTemplate('tmpl1', [{ role_id: '' }]),
        ).rejects.toThrow(ValidationError);
    });
});

describe('DocumentResource public request contracts', () => {
    const envelope = (data: unknown) => ({
        status: 200,
        data: { status: 200, data },
        headers: {},
    });

    test('details and its get alias fetch and unwrap the same document endpoint', async () => {
        const urls: string[] = [];
        const document = {
            id: 'doc-1',
            account_id: 'acc',
            name: 'Agreement.pdf',
            status: 'metadata_ready',
            assignment: null,
            pages: [],
            created_at: '2026-08-06T12:00:00Z',
            updated_at: '2026-08-06T12:00:00Z',
            is_closed: false,
        };
        const http = {
            get: async (url: string) => {
                urls.push(url);
                return envelope(document);
            },
        } as unknown as AxiosInstance;
        const resource = new DocumentResource(http, 'acc');

        expect(await resource.details('doc-1')).toEqual(document as never);
        expect(await resource.get('doc-1')).toEqual(document as never);
        expect(urls).toEqual(['/documents/doc-1', '/documents/doc-1']);
    });

    test('download, thumbnail, and downloadPage request binary response bodies', async () => {
        const calls: Array<{ url: string; config: unknown }> = [];
        const bytes = Uint8Array.from([37, 80, 68, 70]).buffer;
        const http = {
            get: async (url: string, config: unknown) => {
                calls.push({ url, config });
                return { status: 200, data: bytes };
            },
        } as unknown as AxiosInstance;
        const resource = new DocumentResource(http, 'acc');

        expect(await resource.download('doc-1')).toEqual(Buffer.from(bytes));
        expect(await resource.thumbnail('doc-1')).toEqual(Buffer.from(bytes));
        expect(await resource.downloadPage('doc-1', 'page-1')).toEqual(Buffer.from(bytes));
        expect(calls).toEqual([
            {
                url: '/documents/doc-1/download/certificated',
                config: { responseType: 'arraybuffer' },
            },
            {
                url: '/documents/doc-1/thumbnail',
                config: { responseType: 'arraybuffer' },
            },
            {
                url: '/documents/doc-1/pages/page-1/download',
                config: { responseType: 'arraybuffer' },
            },
        ]);
    });

    test('activities unwraps entries and normalises null to an empty array', async () => {
        const urls: string[] = [];
        let requestCount = 0;
        const activity = {
            id: 1,
            event: 'document_uploaded',
            message: 'Uploaded',
            origin: null,
            created_at: '2026-08-06T12:00:00Z',
        };
        const http = {
            get: async (url: string) => {
                urls.push(url);
                requestCount++;
                return envelope(requestCount === 1 ? [activity] : null);
            },
        } as unknown as AxiosInstance;
        const resource = new DocumentResource(http, 'acc');

        expect(await resource.activities('doc-1')).toEqual([activity]);
        expect(await resource.activities('doc-1')).toEqual([]);
        expect(urls).toEqual(['/documents/doc-1/activities', '/documents/doc-1/activities']);
    });

    test('delete calls the document endpoint and resolves void', async () => {
        let url = '';
        const http = {
            delete: async (requestUrl: string) => {
                url = requestUrl;
                return { status: 204 };
            },
        } as unknown as AxiosInstance;

        const result: void = await new DocumentResource(http, 'acc').delete('doc-1');
        expect(url).toBe('/documents/doc-1');
        expect(result).toBeUndefined();
    });

    test('addTags posts a non-empty tag-id array and returns the attached tags', async () => {
        let request: { url: string; body: unknown } | undefined;
        const tags = [{ id: 'tag-1', name: 'Urgent' }];
        const http = {
            post: async (url: string, body: unknown) => {
                request = { url, body };
                return envelope(tags);
            },
        } as unknown as AxiosInstance;

        const result = await new DocumentResource(http, 'acc').addTags('doc-1', ['tag-1']);
        expect(request).toEqual({
            url: '/accounts/acc/documents/doc-1/tags',
            body: { tags: ['tag-1'] },
        });
        expect(result).toEqual(tags as never);
    });

    test('verify/getPublic use public transport while statuses uses its authenticated route', async () => {
        const urls: string[] = [];
        const http = {
            get: async (url: string) => {
                urls.push(url);
                if (url.endsWith('/verify')) {
                    return envelope({ hash: 'hash-1', is_valid: true, verified_at: 'now', message: '' });
                }
                if (url === '/documents/statuses') {
                    return envelope([{ code: 'metadata_ready', deletable: true }]);
                }
                return envelope({
                    resource: 'document',
                    id: 'doc-1',
                    name: 'Agreement.pdf',
                    page_count: 1,
                    created_by: 'SDK Test',
                });
            },
        } as unknown as AxiosInstance;
        const resource = new DocumentResource(http, 'acc');

        expect((await resource.verify('hash-1')).is_valid).toBe(true);
        expect(await resource.statuses()).toEqual([{ code: 'metadata_ready', deletable: true }]);
        expect((await resource.getPublic('doc-1')).page_count).toBe(1);
        expect(urls).toEqual([
            '/documents/hash-1/verify',
            '/documents/statuses',
            '/public/documents/doc-1',
        ]);
    });

    test('sendToken supports the documented email and explicit legacy channel bodies', async () => {
        const calls: Array<{ url: string; body: unknown }> = [];
        const http = {
            put: async (url: string, body: unknown) => {
                calls.push({ url, body });
                return { status: 200, data: { status: 200, message: '' } };
            },
        } as unknown as AxiosInstance;
        const resource = new DocumentResource(http, 'acc');

        const emailResult: void = await resource.sendToken('doc-1', 'signer@example.com');
        const whatsappResult: void = await resource.sendToken(
            'doc-1',
            '+5511999998888',
            'whatsapp',
        );
        expect(calls).toEqual([
            {
                url: '/public/documents/doc-1/send-token',
                body: { email: 'signer@example.com' },
            },
            {
                url: '/public/documents/doc-1/send-token',
                body: { recipient: '+5511999998888', channel: 'whatsapp' },
            },
        ]);
        expect(emailResult).toBeUndefined();
        expect(whatsappResult).toBeUndefined();
    });

    test('sendToken retries the legacy body only for channel/recipient validation errors', async () => {
        const bodies: unknown[] = [];
        const http = {
            put: async (_url: string, body: unknown) => {
                bodies.push(body);
                if (bodies.length === 1) {
                    throw new ApiError('The recipient field is required.', 422, {
                        errors: { channel: ['required'] },
                    });
                }
                return { status: 200, data: { status: 200, message: '' } };
            },
        } as unknown as AxiosInstance;

        await expect(
            new DocumentResource(http, 'acc').sendToken('doc-1', 'signer@example.com'),
        ).resolves.toBeUndefined();
        expect(bodies).toEqual([
            { email: 'signer@example.com' },
            { recipient: 'signer@example.com', channel: 'email' },
        ]);
    });

    test('sendToken does not mask an unrelated API validation error', async () => {
        const error = new ApiError('Invalid email address.', 422, { field: 'email' });
        let calls = 0;
        const http = {
            put: async () => {
                calls++;
                throw error;
            },
        } as unknown as AxiosInstance;

        await expect(
            new DocumentResource(http, 'acc').sendToken('doc-1', 'invalid'),
        ).rejects.toBe(error);
        expect(calls).toBe(1);
    });

    test('waitUntilReady reports an immediate timeout when its wait budget is zero', async () => {
        let called = false;
        const http = {
            get: async () => {
                called = true;
                return envelope({ status: 'metadata_processing' });
            },
        } as unknown as AxiosInstance;

        await expect(
            new DocumentResource(http, 'acc').waitUntilReady('doc-1', { maxWaitMs: 0 }),
        ).rejects.toThrow('Timeout waiting for document to be ready');
        expect(called).toBe(false);
    });

    test('waitUntilReady rejects non-finite or negative timing options before polling', async () => {
        let called = false;
        const http = {
            get: async () => {
                called = true;
                return envelope({ status: 'metadata_ready' });
            },
        } as unknown as AxiosInstance;
        const resource = new DocumentResource(http, 'acc');

        await expect(resource.waitUntilReady('doc-1', { maxWaitMs: -1 })).rejects.toThrow(
            /maxWaitMs must be a finite, non-negative number/,
        );
        await expect(
            resource.waitUntilReady('doc-1', { pollIntervalMs: Number.POSITIVE_INFINITY }),
        ).rejects.toThrow(/pollIntervalMs must be a finite, non-negative number/);
        await expect(resource.waitUntilReady('doc-1', { maxWaitMs: Number.NaN })).rejects.toThrow(
            /maxWaitMs must be a finite, non-negative number/,
        );
        expect(called).toBe(false);
    });

    test('encodes public document IDs as a single path segment', async () => {
        let url = '';
        const http = {
            get: async (requestUrl: string) => {
                url = requestUrl;
                return envelope({ id: 'doc/1', name: 'Contract.pdf' });
            },
        } as unknown as AxiosInstance;

        await new DocumentResource(http, 'acc').getPublic('doc/1?#');
        expect(url).toBe('/public/documents/doc%2F1%3F%23');
    });
});
