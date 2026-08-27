import { describe, test, expect } from 'bun:test';
import axios from 'axios';
import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import packageJson from '../package.json';
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

    test('static create() cannot have its required credentials overridden at runtime', () => {
        const client = AssinafyClient.create(
            'required-key',
            'required-account',
            { apiKey: 'overridden-key', accountId: 'overridden-account' } as never,
        );
        const headers = client.getAxiosInstance().defaults.headers as Record<string, unknown>;

        expect(headers['X-Api-Key']).toBe('required-key');
        expect(
            (client.signers as unknown as { defaultAccountId?: string }).defaultAccountId,
        ).toBe('required-account');
    });

    test('static create() rejects missing runtime credentials', () => {
        for (const [apiKey, accountId] of [
            ['', 'account'],
            ['key', ' '],
            [null, 'account'],
            ['key', 42],
        ]) {
            expect(() => AssinafyClient.create(apiKey as never, accountId as never)).toThrow(
                ValidationError,
            );
        }
    });

    test('static create() rejects malformed options', () => {
        for (const options of [null, []]) {
            expect(() => AssinafyClient.create('key', 'account', options as never)).toThrow(
                ValidationError,
            );
        }
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

    test('identifies every client transport with the package version', () => {
        const client = new AssinafyClient({ apiKey: 'secret-key' });
        const authenticated = client.getAxiosInstance().defaults.headers as Record<
            string,
            unknown
        >;
        const publicHttp = (
            client.auth as unknown as { publicHttp: { defaults: { headers: Record<string, unknown> } } }
        ).publicHttp;
        const expected = `Assinafy-Typescript-SDK/v${packageJson.version}`;

        expect(packageJson.version).toBe('2.2.0');
        expect(authenticated['User-Agent']).toBe(expected);
        expect(publicHttp.defaults.headers['User-Agent']).toBe(expected);
    });

    test('dispatches the versioned user-agent on protected and public requests', async () => {
        const client = new AssinafyClient({ apiKey: 'secret-key' });
        const authenticated = client.getAxiosInstance();
        const publicHttp = (
            client.auth as unknown as { publicHttp: AxiosInstance }
        ).publicHttp;
        const seen: string[] = [];
        const adapter = async (config: InternalAxiosRequestConfig) => {
            seen.push(String(config.headers.get('User-Agent')));
            return {
                data: { status: 200, data: config.url === '/documents/statuses' ? [] : {} },
                status: 200,
                statusText: 'OK',
                headers: {},
                config,
            };
        };
        authenticated.defaults.adapter = adapter;
        publicHttp.defaults.adapter = adapter;

        await client.documents.statuses();
        await client.documents.getPublic('doc-1');

        expect(seen).toEqual([
            `Assinafy-Typescript-SDK/v${packageJson.version}`,
            `Assinafy-Typescript-SDK/v${packageJson.version}`,
        ]);
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

    test('canonicalizes dot segments in a custom baseUrl', () => {
        const client = new AssinafyClient({ baseUrl: 'https://example.com/api/../v1/' });
        expect(client.getAxiosInstance().defaults.baseURL).toBe('https://example.com/v1');
    });

    // Every request on the credentialed transport carries `X-Api-Key` or a
    // Bearer token, so plaintext HTTP to a remote host would leak a long-lived
    // credential. Loopback stays allowed so local mock servers still work.
    test('allows plaintext http only for loopback hosts', () => {
        for (const baseUrl of [
            'http://localhost:3000/v1',
            'http://127.0.0.1:3000/v1',
            'http://127.0.0.53/v1',
            // The URL parser canonicalizes shorthand/hex/decimal IPv4 forms, so
            // these reach the guard already normalized to 127.0.0.1.
            'http://127.1/v1',
            'http://2130706433/v1',
            'http://[::1]:3000/v1',
        ]) {
            expect(() => new AssinafyClient({ apiKey: 'k', baseUrl })).not.toThrow();
        }

        for (const baseUrl of [
            'http://api.assinafy.com.br/v1',
            'http://192.168.1.10/v1',
            // Anchored so a loopback-looking prefix on an attacker domain fails.
            'http://localhost.evil.example/v1',
            'http://127.0.0.1.evil.example/v1',
        ]) {
            expect(() => new AssinafyClient({ apiKey: 'k', baseUrl })).toThrow(ValidationError);
        }
    });

    test('allows same-origin absolute requests and rejects cross-origin dispatch', async () => {
        const client = new AssinafyClient({ apiKey: 'secret-key' });
        const http = client.getAxiosInstance();
        let calls = 0;
        http.defaults.adapter = async (config) => {
            calls++;
            return { data: {}, status: 200, statusText: 'OK', headers: {}, config };
        };

        await expect(
            http.get('https://api.assinafy.com.br/v1/documents/statuses'),
        ).resolves.toMatchObject({ status: 200 });
        await expect(http.get('https://attacker.invalid/collect')).rejects.toBeInstanceOf(
            ValidationError,
        );
        await expect(
            http.get('/collect', { baseURL: 'https://attacker.invalid/v1' }),
        ).rejects.toBeInstanceOf(ValidationError);
        expect(calls).toBe(1);
    });

    test('marks credentials as sensitive across redirects', () => {
        const client = new AssinafyClient({ apiKey: 'secret-key' });
        expect(client.getAxiosInstance().defaults.sensitiveHeaders).toEqual([
            'Authorization',
            'X-Api-Key',
        ]);
    });

    test('blocks cross-origin redirects that would replay credential-bearing bodies', () => {
        const client = new AssinafyClient({ apiKey: 'secret-key' });
        const authenticated = client.getAxiosInstance().defaults.beforeRedirect;
        const publicHttp = (
            client.auth as unknown as { publicHttp: AxiosInstance }
        ).publicHttp.defaults.beforeRedirect;
        const redirect = { href: 'https://attacker.invalid/capture', method: 'POST' };
        const response = { headers: {}, statusCode: 307 };

        expect(() =>
            authenticated?.(redirect, response, {
                headers: {},
                url: 'https://api.assinafy.com.br/v1/authentication/change-password',
                method: 'PUT',
            }),
        ).toThrow('Unsafe cross-origin redirect blocked');
        expect(() =>
            publicHttp?.(redirect, response, {
                headers: {},
                url: 'https://api.assinafy.com.br/v1/login',
                method: 'POST',
            }),
        ).toThrow('Unsafe cross-origin redirect blocked');
    });

    test('validates timeout, retry count, and base URL configuration', () => {
        expect(() => new AssinafyClient(null as never)).toThrow(ValidationError);
        expect(() => AssinafyClient.fromConfig(null as never)).toThrow(ValidationError);
        expect(() => new AssinafyClient({ timeout: Number.NaN })).toThrow(ValidationError);
        expect(() => new AssinafyClient({ maxRetries: Number.POSITIVE_INFINITY })).toThrow(
            ValidationError,
        );
        expect(() => new AssinafyClient({ maxRetries: 1.5 })).toThrow(ValidationError);
        expect(() => new AssinafyClient({ baseUrl: 'not-a-url' })).toThrow(ValidationError);
        expect(() => new AssinafyClient({ baseUrl: 'file:///tmp/api' })).toThrow(ValidationError);
        expect(() => new AssinafyClient({ baseUrl: null as never })).toThrow(ValidationError);
        expect(() => new AssinafyClient({ baseUrl: 42 as never })).toThrow(ValidationError);
        expect(() => new AssinafyClient({ baseUrl: 'https://user:pass@example.com/v1' })).toThrow(
            ValidationError,
        );
        expect(() => new AssinafyClient({ baseUrl: 'https://example.com/v1?tenant=one' })).toThrow(
            ValidationError,
        );
        expect(() => new AssinafyClient({ baseUrl: 'https://example.com/v1#docs' })).toThrow(
            ValidationError,
        );
        for (const options of [
            { apiKey: '' },
            { token: 42 as never },
            { accountId: ' ' },
            { webhookSecret: null as never },
        ]) {
            expect(() => new AssinafyClient(options)).toThrow(ValidationError);
        }
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

    test('aborts while waiting to retry a rate-limited request', async () => {
        const client = new AssinafyClient({ apiKey: 'k', maxRetries: 2 });
        const ax = client.getAxiosInstance();
        let calls = 0;
        ax.defaults.adapter = async (config) => {
            calls++;
            throw new axios.AxiosError('Too Many Requests', 'ERR_BAD_RESPONSE', config, {}, {
                status: 429,
                statusText: 'Too Many Requests',
                headers: { 'retry-after': '30' },
                data: {},
                config,
            });
        };
        const controller = new AbortController();
        const startedAt = Date.now();
        const request = ax.get('/rate-limited', { signal: controller.signal });
        setTimeout(() => controller.abort(), 10);

        await expect(request).rejects.toMatchObject({ name: 'AbortError' });
        expect(Date.now() - startedAt).toBeLessThan(1_000);
        expect(calls).toBe(1);
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

    test('retries every supported read/delete method after a 429', async () => {
        for (const method of ['head', 'options', 'delete']) {
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

    test('does not replay PUT requests after a 429 without an idempotency key', async () => {
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

        await expect(ax.put('/accounts/acc', { name: 'Updated' })).rejects.toMatchObject({
            response: { status: 429 },
        });
        expect(calls).toBe(1);
    });

    test('retries caller-opted custom requests carrying an Idempotency-Key', async () => {
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

        const postResponse = await ax.post(
            '/custom-operation',
            { value: 1 },
            { headers: { 'Idempotency-Key': 'operation-123' } },
        );
        expect(postResponse.data).toEqual({ status: 200, data: { id: 'created-once' } });
        expect(calls).toBe(2);

        calls = 0;
        const putResponse = await ax.put(
            '/authentication/change-password',
            { value: 1 },
            { headers: { 'Idempotency-Key': 'operation-123' } },
        );
        expect(putResponse.data).toEqual({ status: 200, data: { id: 'created-once' } });
        expect(calls).toBe(2);
    });

    test('never retries GET /sign because reading it records a signer view', async () => {
        const client = new AssinafyClient({ maxRetries: 2 });
        const ax = (client as unknown as { publicAxiosInstance: AxiosInstance })
            .publicAxiosInstance;
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

        await expect(
            ax.get('/sign?signer-access-code=code', {
                headers: { 'Idempotency-Key': 'unsupported-for-this-route' },
            }),
        ).rejects.toMatchObject({ response: { status: 429 } });
        expect(calls).toBe(1);
    });

    test('retains rate-limit retries on signer-code requests', async () => {
        const client = new AssinafyClient({ maxRetries: 1 });
        const ax = (client as unknown as { publicAxiosInstance: AxiosInstance })
            .publicAxiosInstance;
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
                data: { status: 200, data: { id: 'signer-1' } },
                status: 200,
                statusText: 'OK',
                headers: {},
                config,
            };
        };

        await expect(client.signerDocuments.self('access-code')).resolves.toMatchObject({
            id: 'signer-1',
        });
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

        test('rejects malformed workflow objects before requesting', async () => {
            const client = new AssinafyClient({ apiKey: 'k', accountId: 'acc' });
            let requests = 0;
            client.getAxiosInstance().defaults.adapter = async () => {
                requests++;
                throw new Error('unexpected request');
            };

            const malformed = [
                null,
                { source: pdf, signers: {} },
                { source: pdf, signers: [null] },
                {
                    source: pdf,
                    signers: [{ name: 'Signer', email: 'signer@example.com' }],
                    waitOptions: null,
                },
                {
                    source: pdf,
                    signers: [{ name: 'Signer', email: 'signer@example.com' }],
                    waitOptions: { maxWaitMs: -1 },
                },
                {
                    source: pdf,
                    signers: [{ name: 'Signer', email: 'signer@example.com' }],
                    waitForReady: 'false',
                },
                {
                    source: pdf,
                    signers: [{ name: 'Signer', email: 'signer@example.com' }],
                    copyReceivers: [''],
                },
                {
                    source: pdf,
                    signers: [{ name: 'Signer', email: 'signer@example.com' }],
                    expiresAt: '',
                },
                {
                    source: pdf,
                    signers: [{ name: 'Signer', email: 'signer@example.com' }],
                    expiresAt: 'not-a-date',
                },
            ];
            for (const options of malformed) {
                await expect(
                    client.uploadAndRequestSignatures(options as never),
                ).rejects.toBeInstanceOf(ValidationError);
            }
            expect(requests).toBe(0);
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

        test('rejects duplicate normalized signer contacts before uploading', async () => {
            const client = new AssinafyClient({ apiKey: 'k', accountId: 'acc' });
            let requests = 0;
            client.getAxiosInstance().defaults.adapter = async (config) => {
                requests++;
                throw new Error(`unexpected request to ${config.url}`);
            };

            const duplicateContacts = [
                [
                    { name: 'First', email: 'same@example.com' },
                    { name: 'Second', email: 'SAME@example.com' },
                ],
                [
                    { name: 'First', whatsapp_phone_number: '+15555550101' },
                    { name: 'Second', phone: '+15555550101' },
                ],
            ];
            for (const signers of duplicateContacts) {
                await expect(
                    client.uploadAndRequestSignatures({ source: pdf, signers }),
                ).rejects.toBeInstanceOf(ValidationError);
            }
            expect(requests).toBe(0);
        });

        test('validates signer metadata before uploading anything', async () => {
            const client = new AssinafyClient({ apiKey: 'k', accountId: 'acc' });
            let requests = 0;
            client.getAxiosInstance().defaults.adapter = async (config) => {
                requests++;
                throw new Error(`unexpected request to ${config.url}`);
            };
            const circular: Record<string, unknown> = {};
            circular['self'] = circular;

            for (const metadata of [circular, { amount: 1n }, []]) {
                await expect(
                    client.uploadAndRequestSignatures({
                        source: pdf,
                        signers: [
                            {
                                name: 'Signer',
                                email: 'signer@example.com',
                                metadata: metadata as never,
                            },
                        ],
                    }),
                ).rejects.toBeInstanceOf(ValidationError);
            }
            expect(requests).toBe(0);
        });

        test('creates a virtual assignment before waiting for document processing', async () => {
            const client = new AssinafyClient({
                apiKey: 'k',
                accountId: 'acc',
                logger: throwingLogger,
            });
            const ax = client.getAxiosInstance();

            const calls = { upload: 0, signerList: 0, signerCreate: 0, assignment: 0, details: 0 };
            const callOrder: string[] = [];
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
                    callOrder.push('assignment');
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
                // GET /documents/{id} — post-assignment waitUntilReady poll
                if (method === 'get' && url.startsWith('/documents/')) {
                    calls.details++;
                    callOrder.push('details');
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

            // Flow: one upload, two signer creations, one immediate assignment,
            // then one GET /documents/{id} to return the processed document.
            expect(calls.upload).toBe(1);
            expect(calls.signerCreate).toBe(2);
            expect(calls.assignment).toBe(1);
            expect(calls.details).toBe(1);
            expect(callOrder).toEqual(['assignment', 'details']);

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

        test('waitForReady:false creates immediately and skips document polling', async () => {
            const client = new AssinafyClient({ apiKey: 'k', accountId: 'acc' });
            const ax = client.getAxiosInstance();

            const calls = { upload: 0, signerList: 0, signerCreate: 0, assignment: 0, details: 0 };
            let signerSeq = 0;
            let assignmentBody: unknown;

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
                    assignmentBody = config.data;
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
                signers: [{ name: 'Ana Souza', whatsapp_phone_number: '+5548999990000' }],
                waitForReady: false,
            });

            expect(calls.upload).toBe(1);
            expect(calls.signerCreate).toBe(1);
            expect(calls.assignment).toBe(1);
            expect(calls.details).toBe(0);
            expect(result.signer_ids).toEqual(['signer-1']);
            expect(result.document.status).toBe('uploaded'); // raw upload snapshot
            const body = typeof assignmentBody === 'string'
                ? JSON.parse(assignmentBody) as unknown
                : assignmentBody;
            expect(body).toEqual({
                method: 'virtual',
                signers: [{
                    id: 'signer-1',
                    verification_method: 'Whatsapp',
                    notification_methods: ['Whatsapp'],
                }],
            });
        });

        test('wait failures expose already-created resource IDs', async () => {
            const client = new AssinafyClient({ apiKey: 'k', accountId: 'acc' });
            let assignmentCalls = 0;
            client.getAxiosInstance().defaults.adapter = async (config) => {
                const method = (config.method ?? 'get').toLowerCase();
                const url = config.url ?? '';
                const respond = (data: unknown) => ({
                    data: { status: 200, data },
                    status: 200,
                    statusText: 'OK',
                    headers: {},
                    config,
                });
                if (method === 'post' && url.endsWith('/documents')) {
                    return respond({ id: 'doc-123', status: 'uploaded', pages: [] });
                }
                if (method === 'get' && url.includes('/signers')) return respond([]);
                if (method === 'post' && url.endsWith('/signers')) {
                    return respond({ id: 'signer-1', full_name: 'Ana', email: 'ana@example.com' });
                }
                if (method === 'post' && url.endsWith('/assignments')) {
                    assignmentCalls++;
                    return respond({ id: 'asg-1', method: 'virtual', signers: [] });
                }
                throw new Error(`unexpected request ${method.toUpperCase()} ${url}`);
            };

            let caught: unknown;
            try {
                await client.uploadAndRequestSignatures({
                    source: pdf,
                    signers: [{ name: 'Ana', email: 'ana@example.com' }],
                    waitOptions: { maxWaitMs: 0 },
                });
            } catch (error) {
                caught = error;
            }
            expect(assignmentCalls).toBe(1);
            expect(caught).toBeInstanceOf(ValidationError);
            expect((caught as ValidationError).errors).toMatchObject({
                documentId: 'doc-123',
                assignmentId: 'asg-1',
                signerIds: ['signer-1'],
            });
            expect((caught as ValidationError).context).toMatchObject({
                documentId: 'doc-123',
                assignmentId: 'asg-1',
                signerIds: ['signer-1'],
            });
        });

        test('signer creation failures expose the document and accumulated signer IDs', async () => {
            const client = new AssinafyClient({ apiKey: 'k', accountId: 'acc' });
            let signerCreates = 0;
            client.getAxiosInstance().defaults.adapter = async (config) => {
                const method = (config.method ?? 'get').toLowerCase();
                const url = config.url ?? '';
                const respond = (data: unknown) => ({
                    data: { status: 200, data },
                    status: 200,
                    statusText: 'OK',
                    headers: {},
                    config,
                });
                if (method === 'post' && url.endsWith('/documents')) {
                    return respond({ id: 'doc-123', status: 'uploaded', pages: [] });
                }
                if (method === 'get' && url.includes('/signers')) return respond([]);
                if (method === 'post' && url.endsWith('/signers')) {
                    signerCreates++;
                    if (signerCreates === 2) throw new ApiError('signer failed', 422);
                    return respond({ id: 'signer-1', full_name: 'One' });
                }
                throw new Error(`unexpected request ${method.toUpperCase()} ${url}`);
            };

            await expect(
                client.uploadAndRequestSignatures({
                    source: pdf,
                    signers: [
                        { name: 'One', email: 'one@example.com' },
                        { name: 'Two', email: 'two@example.com' },
                    ],
                }),
            ).rejects.toMatchObject({
                context: { documentId: 'doc-123', signerIds: ['signer-1'] },
            });
        });

        test('assignment failures expose the document and all signer IDs', async () => {
            const client = new AssinafyClient({ apiKey: 'k', accountId: 'acc' });
            client.getAxiosInstance().defaults.adapter = async (config) => {
                const method = (config.method ?? 'get').toLowerCase();
                const url = config.url ?? '';
                const respond = (data: unknown) => ({
                    data: { status: 200, data },
                    status: 200,
                    statusText: 'OK',
                    headers: {},
                    config,
                });
                if (method === 'post' && url.endsWith('/documents')) {
                    return respond({ id: 'doc-123', status: 'uploaded', pages: [] });
                }
                if (method === 'get' && url.includes('/signers')) return respond([]);
                if (method === 'post' && url.endsWith('/signers')) {
                    return respond({ id: 'signer-1', full_name: 'One' });
                }
                if (method === 'post' && url.endsWith('/assignments')) {
                    throw new ApiError('assignment failed', 422);
                }
                throw new Error(`unexpected request ${method.toUpperCase()} ${url}`);
            };

            await expect(
                client.uploadAndRequestSignatures({
                    source: pdf,
                    signers: [{ name: 'One', email: 'one@example.com' }],
                }),
            ).rejects.toMatchObject({
                context: { documentId: 'doc-123', signerIds: ['signer-1'] },
            });
        });
    });
});
