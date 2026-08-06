import { describe, test, expect } from 'bun:test';
import axios from 'axios';
import { AssinafyClient } from './client';
import { ApiError, ValidationError } from './errors';

const throwingLogger = {
    debug: () => {
        throw new Error('logger failed');
    },
    info: () => {
        throw new Error('logger failed');
    },
    warn: () => {
        throw new Error('logger failed');
    },
    error: () => {
        throw new Error('logger failed');
    },
};

describe('AssinafyClient', () => {
    test('supports credential-free public and signer-code flows', () => {
        const client = new AssinafyClient({ accountId: 'acc' });
        const headers = client.getAxiosInstance().defaults.headers as Record<string, unknown>;
        expect(headers['X-Api-Key']).toBeUndefined();
        expect(headers['Authorization']).toBeUndefined();
        expect(client.auth).toBeDefined();
        expect(client.signerDocuments).toBeDefined();
    });

    test('accepts apiKey credentials', () => {
        const client = new AssinafyClient({ apiKey: 'k', accountId: 'acc' });
        expect(client.documents).toBeDefined();
        expect(client.signers).toBeDefined();
        expect(client.workspaces).toBeDefined();
        expect(client.assignments).toBeDefined();
        expect(client.webhooks).toBeDefined();
        expect(client.users).toBeDefined();
        expect(client.webhookVerifier).toBeDefined();
    });

    test('accepts Bearer token credentials', () => {
        const client = new AssinafyClient({ token: 't', accountId: 'acc' });
        expect(client.documents).toBeDefined();
    });

    test('static create() builds a configured client', () => {
        const client = AssinafyClient.create('k', 'acc', { webhookSecret: 's' });
        expect(client.documents).toBeDefined();
    });

    test('fromConfig accepts snake_case keys', () => {
        const client = AssinafyClient.fromConfig({
            api_key: 'k',
            account_id: 'acc',
            webhook_secret: 's',
        });
        expect(client.documents).toBeDefined();
    });

    test('sends X-Api-Key header when apiKey is provided', () => {
        const client = new AssinafyClient({ apiKey: 'my-key', accountId: 'acc' });
        const headers = client.getAxiosInstance().defaults.headers as Record<string, unknown>;
        expect(headers['X-Api-Key']).toBe('my-key');
    });

    test('sends Bearer Authorization when only token is provided', () => {
        const client = new AssinafyClient({ token: 'legacy', accountId: 'acc' });
        const headers = client.getAxiosInstance().defaults.headers as Record<string, unknown>;
        expect(headers['Authorization']).toBe('Bearer legacy');
    });

    test('does not copy privileged credentials to the public transport', () => {
        const client = new AssinafyClient({ apiKey: 'secret-key', accountId: 'acc' });
        const publicHttp = (
            client.auth as unknown as { publicHttp: { defaults: { headers: Record<string, unknown> } } }
        ).publicHttp;
        expect(publicHttp.defaults.headers['X-Api-Key']).toBeUndefined();
        expect(publicHttp.defaults.headers['Authorization']).toBeUndefined();
    });

    test('strips trailing slash from baseUrl', () => {
        const client = new AssinafyClient({
            apiKey: 'k',
            accountId: 'acc',
            baseUrl: 'https://sandbox.assinafy.com.br/v1/',
        });
        expect(client.getAxiosInstance().defaults.baseURL).toBe('https://sandbox.assinafy.com.br/v1');
    });

    test('validates timeout, retry count, and base URL configuration', () => {
        expect(() => new AssinafyClient({ timeout: Number.NaN })).toThrow(ValidationError);
        expect(() => new AssinafyClient({ maxRetries: Number.POSITIVE_INFINITY })).toThrow(
            ValidationError,
        );
        expect(() => new AssinafyClient({ maxRetries: 1.5 })).toThrow(ValidationError);
        expect(() => new AssinafyClient({ baseUrl: 'not-a-url' })).toThrow(ValidationError);
        expect(() => new AssinafyClient({ baseUrl: 'file:///tmp/api' })).toThrow(ValidationError);
    });

    test('retries an HTTP 429 then succeeds (honoring Retry-After)', async () => {
        const client = new AssinafyClient({
            apiKey: 'k',
            accountId: 'acc',
            maxRetries: 2,
            logger: throwingLogger,
        });
        const ax = client.getAxiosInstance();
        let calls = 0;
        ax.defaults.adapter = async (config) => {
            calls++;
            if (calls === 1) {
                throw new axios.AxiosError('Too Many Requests', 'ERR_BAD_RESPONSE', config, {}, {
                    status: 429,
                    statusText: 'Too Many Requests',
                    headers: { 'retry-after': '0' },
                    data: {},
                    config,
                });
            }
            return {
                data: { status: 200, data: [{ id: 'd1' }] },
                status: 200,
                statusText: 'OK',
                headers: {},
                config,
            };
        };
        const result = await client.documents.list();
        expect(calls).toBe(2);
        expect(result.data).toEqual([{ id: 'd1' }] as never);
    });

    test('does not retry a non-idempotent 429 without an idempotency key', async () => {
        const client = new AssinafyClient({ apiKey: 'k', accountId: 'acc', maxRetries: 2 });
        const ax = client.getAxiosInstance();
        let calls = 0;
        ax.defaults.adapter = async (config) => {
            calls++;
            throw new axios.AxiosError('Too Many Requests', 'ERR_BAD_RESPONSE', config, {}, {
                status: 429,
                statusText: 'Too Many Requests',
                headers: { 'retry-after': '0' },
                data: {},
                config,
            });
        };

        await expect(ax.post('/custom-operation', { value: 1 })).rejects.toMatchObject({
            response: { status: 429 },
        });
        expect(calls).toBe(1);
    });

    test('retries every supported idempotent method after a 429', async () => {
        for (const method of ['head', 'options', 'put', 'delete']) {
            const client = new AssinafyClient({ apiKey: 'k', accountId: 'acc', maxRetries: 1 });
            const ax = client.getAxiosInstance();
            let calls = 0;
            ax.defaults.adapter = async (config) => {
                calls++;
                if (calls === 1) {
                    throw new axios.AxiosError(
                        'Too Many Requests',
                        'ERR_BAD_RESPONSE',
                        config,
                        {},
                        {
                            status: 429,
                            statusText: 'Too Many Requests',
                            headers: { 'retry-after': '0' },
                            data: {},
                            config,
                        },
                    );
                }
                return {
                    data: { status: 200, data: {} },
                    status: 200,
                    statusText: 'OK',
                    headers: {},
                    config,
                };
            };

            await ax.request({ method, url: `/custom-${method}` });
            expect(calls).toBe(2);
        }
    });

    test('retries a non-idempotent 429 with an explicit Idempotency-Key', async () => {
        const client = new AssinafyClient({ apiKey: 'k', accountId: 'acc', maxRetries: 2 });
        const ax = client.getAxiosInstance();
        let calls = 0;
        ax.defaults.adapter = async (config) => {
            calls++;
            if (calls === 1) {
                throw new axios.AxiosError('Too Many Requests', 'ERR_BAD_RESPONSE', config, {}, {
                    status: 429,
                    statusText: 'Too Many Requests',
                    headers: { 'retry-after': '0' },
                    data: {},
                    config,
                });
            }
            return {
                data: { status: 200, data: { id: 'created-once' } },
                status: 200,
                statusText: 'OK',
                headers: {},
                config,
            };
        };

        const response = await ax.post(
            '/custom-operation',
            { value: 1 },
            { headers: { 'Idempotency-Key': 'operation-123' } },
        );
        expect(response.data).toEqual({ status: 200, data: { id: 'created-once' } });
        expect(calls).toBe(2);
    });

    test('does not forward signer PII to logger callbacks', async () => {
        const entries: Array<{ message: string; context?: Record<string, unknown> }> = [];
        const client = new AssinafyClient({
            apiKey: 'private-api-key',
            accountId: 'private-account-id',
            logger: {
                debug: () => undefined,
                info: (message, context) =>
                    entries.push(context ? { message, context } : { message }),
                warn: () => undefined,
                error: () => undefined,
            },
        });
        client.getAxiosInstance().defaults.adapter = async (config) => {
            const method = (config.method ?? 'get').toLowerCase();
            const data = method === 'get'
                ? []
                : {
                    resource: 'signer',
                    id: 'signer-1',
                    full_name: 'Private Person',
                    email: 'private@example.com',
                };
            return {
                data: { status: 200, data },
                status: 200,
                statusText: 'OK',
                headers: {},
                config,
            };
        };

        await client.signers.create({
            full_name: 'Private Person',
            email: 'private@example.com',
        });

        expect(entries.some(({ message }) => message === 'Creating signer')).toBe(true);
        const serialized = JSON.stringify(entries);
        expect(serialized).not.toContain('private@example.com');
        expect(serialized).not.toContain('Private Person');
        expect(serialized).not.toContain('private-api-key');
        expect(serialized).not.toContain('private-account-id');
    });

    test('gives up after maxRetries 429s and surfaces an ApiError', async () => {
        const client = new AssinafyClient({ apiKey: 'k', accountId: 'acc', maxRetries: 1 });
        const ax = client.getAxiosInstance();
        let calls = 0;
        ax.defaults.adapter = async (config) => {
            calls++;
            throw new axios.AxiosError('Too Many Requests', 'ERR_BAD_RESPONSE', config, {}, {
                status: 429,
                statusText: 'Too Many Requests',
                headers: { 'retry-after': '0' },
                data: { message: 'rate limited' },
                config,
            });
        };
        await expect(client.documents.list()).rejects.toBeInstanceOf(ApiError);
        expect(calls).toBe(2); // initial + 1 retry
    });

    describe('uploadAndRequestSignatures', () => {
        const pdf = { buffer: Buffer.from('%PDF-1.4 minimal test file'), fileName: 'contract.pdf' };

        test('throws ValidationError when signers is empty', async () => {
            const client = new AssinafyClient({ apiKey: 'k', accountId: 'acc' });
            await expect(
                client.uploadAndRequestSignatures({ source: pdf, signers: [] }),
            ).rejects.toBeInstanceOf(ValidationError);
        });

        test('validates every signer before uploading anything', async () => {
            const client = new AssinafyClient({ apiKey: 'k', accountId: 'acc' });
            let requests = 0;
            client.getAxiosInstance().defaults.adapter = async (config) => {
                requests++;
                throw new Error(`unexpected request to ${config.url}`);
            };
            await expect(
                client.uploadAndRequestSignatures({
                    source: pdf,
                    signers: [
                        { name: 'Valid', email: 'valid@example.com' },
                        { name: '', email: 'broken@example.com' },
                    ],
                }),
            ).rejects.toBeInstanceOf(ValidationError);
            expect(requests).toBe(0);
        });

        test('uploads, waits for ready, creates each signer + a virtual assignment, returns the result', async () => {
            const client = new AssinafyClient({
                apiKey: 'k',
                accountId: 'acc',
                logger: throwingLogger,
            });
            const ax = client.getAxiosInstance();

            const calls = { upload: 0, signerList: 0, signerCreate: 0, assignment: 0, details: 0 };
            let assignmentBody: unknown;
            let signerSeq = 0;

            ax.defaults.adapter = async (config) => {
                const method = (config.method ?? 'get').toLowerCase();
                const url = config.url ?? '';
                const respond = (data: unknown) => ({
                    data: { status: 200, message: '', data },
                    status: 200,
                    statusText: 'OK',
                    headers: {},
                    config,
                });

                // POST /accounts/{id}/documents — the upload (snapshot, status "uploaded")
                if (method === 'post' && url.endsWith('/documents')) {
                    calls.upload++;
                    return respond({
                        resource: 'document',
                        id: 'doc-123',
                        account_id: 'acc',
                        template_id: null,
                        name: 'contract.pdf',
                        status: 'uploaded',
                        artifacts: {
                            original:
                                'https://sandbox.assinafy.com.br/v1/documents/doc-123/download/original',
                        },
                        is_closed: false,
                        signing_url: 'https://app-sandbox.assinafy.com.br/sign/doc-123',
                        decline_reason: null,
                        declined_by: null,
                        tags: [],
                        created_at: '2026-07-19T17:24:43Z',
                        updated_at: '2026-07-19T17:24:44Z',
                        pages: [],
                    });
                }
                // GET /accounts/{id}/signers — findByEmail lookup (no existing signer)
                if (method === 'get' && url.includes('/signers')) {
                    calls.signerList++;
                    return respond([]);
                }
                // POST /accounts/{id}/signers — create each signer
                if (method === 'post' && url.endsWith('/signers')) {
                    calls.signerCreate++;
                    signerSeq++;
                    return respond({
                        resource: 'signer',
                        id: `signer-${signerSeq}`,
                        full_name: `Signer ${signerSeq}`,
                        email: `s${signerSeq}@example.com`,
                        whatsapp_phone_number: null,
                        has_accepted_terms: false,
                    });
                }
                // POST /documents/{id}/assignments — create the virtual assignment
                if (method === 'post' && url.endsWith('/assignments')) {
                    calls.assignment++;
                    assignmentBody = config.data;
                    return respond({
                        resource: 'assignment',
                        id: 'asg-1',
                        method: 'virtual',
                        sender_email: 'sender@example.com',
                        message: 'Please sign',
                        expires_at: null,
                        copy_receivers: [],
                        signers: [],
                        items: [],
                        summary: { signer_count: 2, completed_count: 0, signers: [] },
                        signing_urls: [],
                    });
                }
                // GET /documents/{id} — waitUntilReady poll + final re-fetch (metadata_ready)
                if (method === 'get' && url.startsWith('/documents/')) {
                    calls.details++;
                    return respond({
                        resource: 'document',
                        id: 'doc-123',
                        account_id: 'acc',
                        template_id: null,
                        name: 'contract.pdf',
                        status: 'metadata_ready',
                        artifacts: {
                            original:
                                'https://sandbox.assinafy.com.br/v1/documents/doc-123/download/original',
                            thumbnail:
                                'https://sandbox.assinafy.com.br/v1/documents/doc-123/thumbnail',
                        },
                        is_closed: false,
                        signing_url: 'https://app-sandbox.assinafy.com.br/sign/doc-123',
                        decline_reason: null,
                        declined_by: null,
                        tags: [],
                        assignment: null,
                        created_at: '2026-07-19T17:24:43Z',
                        updated_at: '2026-07-19T17:24:46Z',
                        pages: [
                            {
                                id: 'page-1',
                                number: 1,
                                height: 1651,
                                width: 1275,
                                download_url:
                                    'https://sandbox.assinafy.com.br/v1/documents/doc-123/pages/page-1/download',
                            },
                        ],
                    });
                }
                throw new Error(`unexpected request ${method.toUpperCase()} ${url}`);
            };

            const result = await client.uploadAndRequestSignatures({
                source: pdf,
                signers: [
                    { name: 'Ana Souza', email: 'ana@example.com' },
                    { name: 'Bruno Lima', email: 'bruno@example.com' },
                ],
                message: 'Please sign',
            });

            // Flow: one upload, two signer creations, one assignment, two GET /documents/{id}
            // (waitUntilReady poll + the post-assignment re-fetch).
            expect(calls.upload).toBe(1);
            expect(calls.signerCreate).toBe(2);
            expect(calls.assignment).toBe(1);
            expect(calls.details).toBe(2);

            // Assignment was posted as a virtual method carrying both created signer IDs.
            const body = (typeof assignmentBody === 'string'
                ? JSON.parse(assignmentBody)
                : assignmentBody) as { method: string; signers: Array<{ id: string }> };
            expect(body.method).toBe('virtual');
            expect(body.signers).toHaveLength(2);
            expect(body.signers.map((s) => s.id)).toEqual(['signer-1', 'signer-2']);

            // Result shape: { document, assignment, signer_ids }.
            expect(result.signer_ids).toEqual(['signer-1', 'signer-2']);
            expect(result.signer_ids.length).toBe(2);
            expect(result.assignment.id).toBe('asg-1');
            expect(result.assignment.method).toBe('virtual');
            // waitForReady default → document is the re-fetched details snapshot.
            expect(result.document.status).toBe('metadata_ready');
        });

        test('waitForReady:false still waits for assignment safety but skips the final re-fetch', async () => {
            const client = new AssinafyClient({ apiKey: 'k', accountId: 'acc' });
            const ax = client.getAxiosInstance();

            const calls = { upload: 0, signerList: 0, signerCreate: 0, assignment: 0, details: 0 };
            let signerSeq = 0;

            ax.defaults.adapter = async (config) => {
                const method = (config.method ?? 'get').toLowerCase();
                const url = config.url ?? '';
                const respond = (data: unknown) => ({
                    data: { status: 200, message: '', data },
                    status: 200,
                    statusText: 'OK',
                    headers: {},
                    config,
                });

                if (method === 'post' && url.endsWith('/documents')) {
                    calls.upload++;
                    return respond({
                        resource: 'document',
                        id: 'doc-123',
                        account_id: 'acc',
                        name: 'contract.pdf',
                        status: 'uploaded',
                        artifacts: {
                            original:
                                'https://sandbox.assinafy.com.br/v1/documents/doc-123/download/original',
                        },
                        pages: [],
                    });
                }
                if (method === 'get' && url.includes('/signers')) {
                    calls.signerList++;
                    return respond([]);
                }
                if (method === 'post' && url.endsWith('/signers')) {
                    calls.signerCreate++;
                    signerSeq++;
                    return respond({ resource: 'signer', id: `signer-${signerSeq}`, full_name: 'x', email: null });
                }
                if (method === 'post' && url.endsWith('/assignments')) {
                    calls.assignment++;
                    return respond({ resource: 'assignment', id: 'asg-1', method: 'virtual', signers: [] });
                }
                if (method === 'get' && url.startsWith('/documents/')) {
                    calls.details++;
                    return respond({ resource: 'document', id: 'doc-123', status: 'metadata_ready' });
                }
                throw new Error(`unexpected request ${method.toUpperCase()} ${url}`);
            };

            const result = await client.uploadAndRequestSignatures({
                source: pdf,
                signers: [{ name: 'Ana Souza', email: 'ana@example.com' }],
                waitForReady: false,
            });

            expect(calls.upload).toBe(1);
            expect(calls.signerCreate).toBe(1);
            expect(calls.assignment).toBe(1);
            // Assignment creation requires metadata_ready, so the safety poll is
            // retained; only the post-assignment details refresh is skipped.
            expect(calls.details).toBe(1);
            expect(result.signer_ids).toEqual(['signer-1']);
            expect(result.document.status).toBe('uploaded'); // raw upload snapshot
        });
    });
});
