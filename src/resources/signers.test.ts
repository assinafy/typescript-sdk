import { describe, test, expect, beforeEach } from 'bun:test';
import { SignerResource } from './signers';
import { ApiError, ValidationError } from '../errors';
import type { AxiosInstance } from 'axios';

describe('SignerResource', () => {
    let mockAxios: AxiosInstance;
    let signerResource: SignerResource;

    beforeEach(() => {
        mockAxios = {
            post: async () => ({ status: 200, data: { status: 200, data: { id: '123' } } }),
            get: async () => ({ status: 200, data: { status: 200, data: [] }, headers: {} }),
            put: async () => ({ status: 200, data: { status: 200, data: { id: '123' } } }),
            delete: async () => ({ status: 200 }),
        } as unknown as AxiosInstance;

        signerResource = new SignerResource(mockAxios, 'test-account');
    });

    test('throws when updating without signer ID', async () => {
        await expect(signerResource.update('', { full_name: 'Test' })).rejects.toThrow(ValidationError);
    });

    test('validates partial updates before making a request', async () => {
        let called = false;
        const http = {
            put: async () => {
                called = true;
                return { status: 200, data: { status: 200, data: { id: 'signer-1' } } };
            },
        } as unknown as AxiosInstance;
        const resource = new SignerResource(http, 'acc');

        await expect(resource.update('signer-1', {})).rejects.toThrow(ValidationError);
        await expect(resource.update('signer-1', { full_name: '   ' })).rejects.toThrow(
            ValidationError,
        );
        await expect(resource.update('signer-1', { email: 'invalid' })).rejects.toThrow(
            ValidationError,
        );
        await expect(
            resource.update('signer-1', { whatsapp_phone_number: ' ' }),
        ).rejects.toThrow(ValidationError);
        await expect(resource.update('signer-1', { government_id: '---' })).rejects.toThrow(
            ValidationError,
        );
        expect(called).toBe(false);
    });

    test('throws when deleting without signer ID', async () => {
        await expect(signerResource.delete('')).rejects.toThrow(ValidationError);
    });

    test('throws when no account ID is available', async () => {
        const resource = new SignerResource(mockAxios);
        await expect(
            resource.create({ full_name: 'Test', email: 'test@example.com' }),
        ).rejects.toThrow(ValidationError);
    });

    test('rejects invalid email', async () => {
        await expect(
            signerResource.create({ full_name: 'Test', email: 'not-an-email' }),
        ).rejects.toThrow(ValidationError);
        await expect(
            signerResource.create({ full_name: 'Test', whatsapp_phone_number: 'not-e164' }),
        ).rejects.toThrow(ValidationError);
    });

    test('rejects non-serializable metadata before requesting', async () => {
        const circular: Record<string, unknown> = {};
        circular['self'] = circular;

        await expect(
            signerResource.create({
                full_name: 'Test',
                email: 'test@example.com',
                metadata: circular,
            }),
        ).rejects.toThrow(ValidationError);
    });

    test('rejects a missing signer name before requesting', async () => {
        await expect(
            signerResource.create({ full_name: '   ', email: 'test@example.com' }),
        ).rejects.toThrow(ValidationError);
    });

    test('creates the official name-only signer payload', async () => {
        await expect(signerResource.create({ full_name: 'Test' })).resolves.toMatchObject({
            id: expect.any(String),
        });
    });

    test('direct resource construction isolates logger failures and signer PII', async () => {
        const entries: unknown[] = [];
        const logger = {
            debug: () => undefined,
            info: (_message: string, context?: Record<string, unknown>) => {
                entries.push(context);
                throw new Error('logger failed');
            },
            warn: () => undefined,
            error: () => undefined,
        };
        const resource = new SignerResource(mockAxios, 'acc', logger);

        await expect(
            resource.create({ full_name: 'Private Signer', email: 'private@example.com' }),
        ).resolves.toMatchObject({ id: '123' });
        expect(JSON.stringify(entries)).not.toContain('private@example.com');
        expect(JSON.stringify(entries)).not.toContain('Private Signer');
    });

    test('creates a whatsapp-only signer without an email lookup', async () => {
        let getCalled = false;
        let body: unknown;
        const trackingAxios = {
            ...mockAxios,
            get: async () => {
                getCalled = true;
                return { status: 200, data: { status: 200, data: [] }, headers: {} };
            },
            post: async (_url: string, b: unknown) => {
                body = b;
                return { status: 200, data: { status: 200, data: { id: 'wa1' } } };
            },
        } as unknown as AxiosInstance;
        const resource = new SignerResource(trackingAxios, 'acc');
        const result = await resource.create({
            full_name: 'WhatsApp Only',
            whatsapp_phone_number: '+5548999990000',
        });
        expect(result.id).toBe('wa1');
        // No email → no findByEmail dedup lookup.
        expect(getCalled).toBe(false);
        expect(body).toEqual({ full_name: 'WhatsApp Only', whatsapp_phone_number: '+5548999990000' });
    });

    test('strips non-digits from cpf before sending', async () => {
        let body: unknown;
        const trackingAxios = {
            ...mockAxios,
            get: async () => ({ status: 200, data: { status: 200, data: [] }, headers: {} }),
            post: async (_url: string, b: unknown) => {
                body = b;
                return { status: 200, data: { status: 200, data: { id: '123' } } };
            },
        } as unknown as AxiosInstance;
        const resource = new SignerResource(trackingAxios, 'acc');
        await resource.create({ full_name: 'John', email: 'john@example.com', cpf: '390.533.447-05' });
        expect((body as Record<string, unknown>)['cpf']).toBe('39053344705');
    });

    test('uses custom accountId when provided', async () => {
        let capturedUrl = '';
        const trackingAxios = {
            ...mockAxios,
            get: async () => ({ status: 200, data: { status: 200, data: [] }, headers: {} }),
            post: async (url: string) => {
                capturedUrl = url;
                return { status: 200, data: { status: 200, data: { id: '123' } } };
            },
        } as unknown as AxiosInstance;

        const resource = new SignerResource(trackingAxios, 'default-account');
        await resource.create({ full_name: 'Test', email: 'test@example.com' }, 'custom-account');
        expect(capturedUrl).toBe('/accounts/custom-account/signers');
    });

    test('uses default accountId when custom not provided', async () => {
        let capturedUrl = '';
        const trackingAxios = {
            ...mockAxios,
            get: async () => ({ status: 200, data: { status: 200, data: [] }, headers: {} }),
            post: async (url: string) => {
                capturedUrl = url;
                return { status: 200, data: { status: 200, data: { id: '123' } } };
            },
        } as unknown as AxiosInstance;

        const resource = new SignerResource(trackingAxios, 'default-account');
        await resource.create({ full_name: 'Test', email: 'test@example.com' });
        expect(capturedUrl).toBe('/accounts/default-account/signers');
    });

    test('list passes search via params', async () => {
        let capturedParams: unknown;
        const trackingAxios = {
            ...mockAxios,
            get: async (_url: string, config: { params: unknown }) => {
                capturedParams = config.params;
                return { status: 200, data: { status: 200, data: [] }, headers: {} };
            },
        } as unknown as AxiosInstance;
        const resource = new SignerResource(trackingAxios, 'acc');
        await resource.list({ search: 'john@example.com' });
        expect(capturedParams).toEqual({ search: 'john@example.com' });
    });

    test('list returns meta parsed from X-Pagination-* headers', async () => {
        const trackingAxios = {
            ...mockAxios,
            get: async () => ({
                status: 200,
                data: { status: 200, data: [] },
                headers: {
                    'x-pagination-current-page': '2',
                    'x-pagination-per-page': '20',
                    'x-pagination-total-count': '45',
                    'x-pagination-page-count': '3',
                },
            }),
        } as unknown as AxiosInstance;
        const resource = new SignerResource(trackingAxios, 'acc');
        const result = await resource.list({ page: 2 });
        expect(result.meta).toEqual({
            current_page: 2,
            per_page: 20,
            total: 45,
            last_page: 3,
        });
    });

    test('findByEmail returns null when no match', async () => {
        const resource = new SignerResource(mockAxios, 'acc');
        const result = await resource.findByEmail('nobody@example.com');
        expect(result).toBeNull();
    });

    test('findByEmail returns a matching signer', async () => {
        let params: unknown;
        const trackingAxios = {
            ...mockAxios,
            get: async (_url: string, config: { params: unknown }) => {
                params = config.params;
                return {
                status: 200,
                data: {
                    status: 200,
                    data: [{ id: '1', full_name: 'John', email: 'JOHN@EXAMPLE.COM' }],
                },
                headers: {},
                };
            },
        } as unknown as AxiosInstance;
        const resource = new SignerResource(trackingAxios, 'acc');
        const result = await resource.findByEmail('john@example.com');
        expect(result?.id).toBe('1');
        expect(params).toEqual({ search: 'john@example.com', 'per-page': 100 });
    });

    test('findByEmail returns null when the list request 404s', async () => {
        // The 404 → null recovery branch: a 404 ApiError from list() is treated
        // as "no such signer", not surfaced as an error.
        const trackingAxios = {
            ...mockAxios,
            get: async () => {
                throw new ApiError('Not found', 404, null);
            },
        } as unknown as AxiosInstance;
        const resource = new SignerResource(trackingAxios, 'acc');
        const result = await resource.findByEmail('nobody@example.com');
        expect(result).toBeNull();
    });

    test('get fetches a signer by id and returns it', async () => {
        let capturedUrl = '';
        const signer = {
            resource: 'signer',
            id: 'sig-1',
            full_name: 'Ana Souza',
            email: 'ana@example.com',
            whatsapp_phone_number: null,
            has_accepted_terms: false,
        };
        const trackingAxios = {
            ...mockAxios,
            get: async (url: string) => {
                capturedUrl = url;
                return { status: 200, data: { status: 200, data: signer } };
            },
        } as unknown as AxiosInstance;
        const resource = new SignerResource(trackingAxios, 'acc');
        const result = await resource.get('sig-1');
        expect(capturedUrl).toBe('/accounts/acc/signers/sig-1');
        expect(result).toEqual(signer);
    });

    test('get throws when signer ID is missing', async () => {
        const resource = new SignerResource(mockAxios, 'acc');
        await expect(resource.get('')).rejects.toThrow(ValidationError);
    });

    test('create reuses an existing signer by email before posting', async () => {
        let postCalled = false;
        const trackingAxios = {
            ...mockAxios,
            get: async () => ({
                status: 200,
                data: {
                    status: 200,
                    data: [{ id: 'existing', full_name: 'John', email: 'john@example.com' }],
                },
                headers: {},
            }),
            post: async () => {
                postCalled = true;
                return { status: 200, data: { status: 200, data: { id: 'new' } } };
            },
        } as unknown as AxiosInstance;

        const resource = new SignerResource(trackingAxios, 'acc');
        const result = await resource.create({
            full_name: 'Requested New Name',
            email: 'john@example.com',
            phone: '+5548999990000',
            metadata: { source: 'new-request' },
        });

        expect(result.id).toBe('existing');
        expect(result.full_name).toBe('John');
        expect(postCalled).toBe(false);
    });

    test('create maps phone to whatsapp_phone_number', async () => {
        let capturedBody: unknown;
        const trackingAxios = {
            ...mockAxios,
            get: async () => ({ status: 200, data: { status: 200, data: [] }, headers: {} }),
            post: async (_url: string, body: unknown) => {
                capturedBody = body;
                return { status: 200, data: { status: 200, data: { id: '123' } } };
            },
        } as unknown as AxiosInstance;

        const resource = new SignerResource(trackingAxios, 'acc');
        await resource.create({
            full_name: 'John',
            email: 'john@example.com',
            phone: '+5548999990000',
        });

        expect(capturedBody).toEqual({
            full_name: 'John',
            email: 'john@example.com',
            whatsapp_phone_number: '+5548999990000',
        });
    });
});

describe('SignerResource.create duplicate-email race recovery', () => {
    const list = (data: unknown[]) => ({ status: 200, data: { status: 200, data }, headers: {} });
    const existing = { id: 'signer-existing', full_name: 'Ana Souza', email: 'ana@example.com' };

    /**
     * findByEmail returns nothing (so create is attempted), then the POST fails —
     * simulating another caller winning the race in between.
     */
    function raceHarness(postError: ApiError) {
        let lookups = 0;
        const http = {
            get: async () => {
                lookups++;
                // First lookup: not found. Second (post-failure): found.
                return lookups === 1 ? list([]) : list([existing]);
            },
            post: async () => {
                throw postError;
            },
        } as unknown as AxiosInstance;
        return { http, lookups: () => lookups };
    }

    test('recovers from the 400 this API returns for a duplicate email', async () => {
        // Regression: the guard previously matched only 409, but the live API
        // answers a duplicate email with 400 — so recovery never fired.
        const h = raceHarness(new ApiError('Um signatário com este e-mail já existe.', 400, null));
        const result = await new SignerResource(h.http, 'acc').create({
            full_name: 'Ana Souza',
            email: 'ana@example.com',
        });
        expect(result.id).toBe('signer-existing');
        expect(h.lookups()).toBe(2);
    });

    test('still recovers from a 409, should the API ever use it', async () => {
        const h = raceHarness(new ApiError('Conflict', 409, null));
        const result = await new SignerResource(h.http, 'acc').create({
            full_name: 'Ana Souza',
            email: 'ana@example.com',
        });
        expect(result.id).toBe('signer-existing');
    });

    test('rethrows an unrelated 400 instead of swallowing it', async () => {
        // A malformed-payload 400 must not be masked: the lookup finds nothing,
        // so the original error surfaces.
        let lookups = 0;
        const http = {
            get: async () => {
                lookups++;
                return list([]);
            },
            post: async () => {
                throw new ApiError('O atributo "full_name" é obrigatório.', 400, null);
            },
        } as unknown as AxiosInstance;
        await expect(
            new SignerResource(http, 'acc').create({ full_name: 'X', email: 'x@example.com' }),
        ).rejects.toThrow(ApiError);
        expect(lookups).toBe(2);
    });

    test('rethrows a 500 without attempting recovery', async () => {
        let lookups = 0;
        const http = {
            get: async () => {
                lookups++;
                return list([]);
            },
            post: async () => {
                throw new ApiError('Server error', 500, null);
            },
        } as unknown as AxiosInstance;
        await expect(
            new SignerResource(http, 'acc').create({ full_name: 'X', email: 'x@example.com' }),
        ).rejects.toThrow(ApiError);
        expect(lookups).toBe(1); // no second lookup — 500 is not a duplicate signal
    });
});

describe('SignerResource public request contracts', () => {
    test('update PUTs the normalised payload and returns the updated signer', async () => {
        let request: { url: string; body: unknown } | undefined;
        const updated = {
            id: 'signer-1',
            full_name: 'Updated Name',
            email: 'signer@example.com',
            whatsapp_phone_number: '+5548999990000',
        };
        const http = {
            put: async (url: string, body: unknown) => {
                request = { url, body };
                return { status: 200, data: { status: 200, data: updated } };
            },
        } as unknown as AxiosInstance;

        const result = await new SignerResource(http, 'acc').update('signer-1', {
            full_name: 'Updated Name',
            phone: '+5548999990000',
            cpf: '390.533.447-05',
            government_id: '12.345.678/0001-95',
        });

        expect(request).toEqual({
            url: '/accounts/acc/signers/signer-1',
            body: {
                full_name: 'Updated Name',
                whatsapp_phone_number: '+5548999990000',
                cpf: '39053344705',
                government_id: '12345678000195',
            },
        });
        expect(result).toEqual(updated as never);
    });

    test('delete calls the account-scoped signer endpoint and resolves void', async () => {
        let url = '';
        const http = {
            delete: async (requestUrl: string) => {
                url = requestUrl;
                return { status: 204 };
            },
        } as unknown as AxiosInstance;

        const result: void = await new SignerResource(http, 'acc').delete('signer-1');
        expect(url).toBe('/accounts/acc/signers/signer-1');
        expect(result).toBeUndefined();
    });

    test('encodes account and signer IDs as independent path segments', async () => {
        let url = '';
        const http = {
            get: async (requestUrl: string) => {
                url = requestUrl;
                return {
                    status: 200,
                    data: {
                        status: 200,
                        data: { id: 'signer/1', full_name: 'Test', email: null },
                    },
                };
            },
        } as unknown as AxiosInstance;

        await new SignerResource(http, 'account/root').get('signer/1');
        expect(url).toBe('/accounts/account%2Froot/signers/signer%2F1');
    });

    test('findByEmail propagates list failures other than 404', async () => {
        const error = new ApiError('Server unavailable', 503, null);
        let calls = 0;
        const http = {
            get: async () => {
                calls++;
                throw error;
            },
        } as unknown as AxiosInstance;

        await expect(
            new SignerResource(http, 'acc').findByEmail('signer@example.com'),
        ).rejects.toBe(error);
        expect(calls).toBe(1);
    });

    test('findByEmail rejects malformed addresses before listing', async () => {
        let called = false;
        const http = {
            get: async () => {
                called = true;
                return { status: 200, data: { status: 200, data: [] }, headers: {} };
            },
        } as unknown as AxiosInstance;

        await expect(new SignerResource(http, 'acc').findByEmail('invalid')).rejects.toThrow(
            ValidationError,
        );
        expect(called).toBe(false);
    });

    test('create preserves caller metadata in the wire payload', async () => {
        let body: unknown;
        const http = {
            post: async (_url: string, requestBody: unknown) => {
                body = requestBody;
                return { status: 200, data: { status: 200, data: { id: 'signer-1' } } };
            },
        } as unknown as AxiosInstance;

        await new SignerResource(http, 'acc').create({
            full_name: 'Metadata Signer',
            whatsapp_phone_number: '+5548999990000',
            metadata: { customer_id: 'customer-1' },
        });
        expect(body).toEqual({
            full_name: 'Metadata Signer',
            whatsapp_phone_number: '+5548999990000',
            metadata: { customer_id: 'customer-1' },
        });
    });
});
