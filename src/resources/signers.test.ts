import { describe, test, expect, beforeEach } from 'bun:test';
import { SignerResource } from './signers';
import { ValidationError } from '../errors';
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

    test('throws when deleting without signer ID', async () => {
        await expect(signerResource.delete('')).rejects.toThrow(ValidationError);
    });

    test('throws when no account ID is available', async () => {
        const resource = new SignerResource(mockAxios);
        await expect(
            resource.create({ full_name: 'Test', email: 'test@test.com' }),
        ).rejects.toThrow(ValidationError);
    });

    test('rejects invalid email', async () => {
        await expect(
            signerResource.create({ full_name: 'Test', email: 'not-an-email' }),
        ).rejects.toThrow(ValidationError);
    });

    test('rejects when neither email nor whatsapp number is provided', async () => {
        await expect(signerResource.create({ full_name: 'Test' })).rejects.toThrow(ValidationError);
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
        await resource.create({ full_name: 'Test', email: 'test@test.com' }, 'custom-account');
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
        await resource.create({ full_name: 'Test', email: 'test@test.com' });
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
        const trackingAxios = {
            ...mockAxios,
            get: async () => ({
                status: 200,
                data: {
                    status: 200,
                    data: [{ id: '1', full_name: 'John', email: 'JOHN@EXAMPLE.COM' }],
                },
                headers: {},
            }),
        } as unknown as AxiosInstance;
        const resource = new SignerResource(trackingAxios, 'acc');
        const result = await resource.findByEmail('john@example.com');
        expect(result?.id).toBe('1');
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
        const result = await resource.create({ full_name: 'John', email: 'john@example.com' });

        expect(result.id).toBe('existing');
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
