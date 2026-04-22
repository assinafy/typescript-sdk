import { describe, test, expect } from 'bun:test';
import type { AxiosInstance } from 'axios';
import { ValidationError } from '../errors';
import { WebhookResource } from './webhooks';

describe('WebhookResource', () => {
    test('register defaults include document_prepared', async () => {
        let capturedBody: unknown;
        const axiosMock = {
            put: async (_url: string, body: unknown) => {
                capturedBody = body;
                return { status: 200, data: { status: 200, data: { is_active: true } } };
            },
        } as unknown as AxiosInstance;

        const resource = new WebhookResource(axiosMock, 'acc');
        await resource.register({
            url: 'https://example.com/webhook',
            email: 'ops@example.com',
        });

        expect(capturedBody).toEqual({
            url: 'https://example.com/webhook',
            email: 'ops@example.com',
            events: [
                'document_ready',
                'document_prepared',
                'signer_signed_document',
                'signer_rejected_document',
                'document_processing_failed',
            ],
            is_active: true,
        });
    });

    test('listEventTypes calls the global event-types endpoint', async () => {
        let capturedUrl = '';
        const axiosMock = {
            get: async (url: string) => {
                capturedUrl = url;
                return { status: 200, data: { status: 200, data: [] } };
            },
        } as unknown as AxiosInstance;

        const resource = new WebhookResource(axiosMock);
        await resource.listEventTypes();
        expect(capturedUrl).toBe('/webhooks/event-types');
    });

    test('listDispatches passes filters and pagination headers through', async () => {
        let capturedUrl = '';
        let capturedParams: unknown;
        const axiosMock = {
            get: async (url: string, config?: { params?: unknown }) => {
                capturedUrl = url;
                capturedParams = config?.params;
                return {
                    status: 200,
                    data: { status: 200, data: [] },
                    headers: {
                        'x-pagination-current-page': '1',
                        'x-pagination-per-page': '20',
                        'x-pagination-total-count': '2',
                        'x-pagination-page-count': '1',
                    },
                };
            },
        } as unknown as AxiosInstance;

        const resource = new WebhookResource(axiosMock, 'acc');
        const result = await resource.listDispatches({ delivered: false, 'per-page': 20 });

        expect(capturedUrl).toBe('/accounts/acc/webhooks');
        expect(capturedParams).toEqual({ delivered: false, 'per-page': 20 });
        expect(result.meta).toEqual({
            current_page: 1,
            per_page: 20,
            total: 2,
            last_page: 1,
        });
    });

    test('retryDispatch requires a dispatch id', async () => {
        const axiosMock = {
            post: async () => ({ status: 200, data: { status: 200, data: {} } }),
        } as unknown as AxiosInstance;

        const resource = new WebhookResource(axiosMock, 'acc');
        await expect(resource.retryDispatch('')).rejects.toThrow(ValidationError);
    });

    test('inactivate hits the documented endpoint', async () => {
        let capturedUrl = '';
        const axiosMock = {
            put: async (url: string) => {
                capturedUrl = url;
                return { status: 200, data: { status: 200, data: { is_active: false } } };
            },
        } as unknown as AxiosInstance;

        const resource = new WebhookResource(axiosMock, 'acc');
        await resource.inactivate();
        expect(capturedUrl).toBe('/accounts/acc/webhooks/inactivate');
    });
});
