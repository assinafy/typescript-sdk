import { describe, expect, test } from 'bun:test';
import type { AxiosInstance } from 'axios';
import { ApiError, ValidationError } from '../errors';
import { DEFAULT_WEBHOOK_EVENTS, WebhookResource } from './webhooks';

type HttpCall = {
    method: 'GET' | 'POST' | 'PUT';
    url: string;
    body?: unknown;
    config?: unknown;
};

const DEFAULT_EVENTS = [
    'document_ready',
    'document_prepared',
    'signer_signed_document',
    'signer_rejected_document',
    'document_processing_failed',
];

const SUBSCRIPTION = {
    url: 'https://example.com/webhook',
    email: 'ops@example.com',
    events: ['document_ready', 'signer_signed_document'],
    is_active: true,
    updated_at: '2026-07-18T02:36:02Z',
};

const EVENT_TYPES = [
    {
        id: 'document_ready',
        description: 'Triggered when a document is ready',
    },
    {
        id: 'future_event_added_by_server',
        description: 'A future event unknown to this SDK release',
    },
];

const DISPATCH = {
    id: 'dispatch-1',
    event: 'document_ready',
    activity_id: 42,
    endpoint: 'https://example.com/webhook',
    payload: { document_id: 'document-1' },
    delivered: true,
    http_status: 200,
    response_body: 'ok',
    error: null,
    created_at: '2026-07-18T02:36:02Z',
    updated_at: '2026-07-18T02:36:03Z',
};

function response(data: unknown) {
    return { status: 200, data: { status: 200, data } };
}

function mockHttp(): { http: AxiosInstance; calls: HttpCall[] } {
    const calls: HttpCall[] = [];
    const http = {
        get: async (url: string, config?: unknown) => {
            calls.push({ method: 'GET', url, config });
            if (url === '/webhooks/event-types') return response(EVENT_TYPES);
            if (url.endsWith('/webhooks/subscriptions')) return response(SUBSCRIPTION);
            return {
                ...response([DISPATCH]),
                headers: {
                    'x-pagination-current-page': '2',
                    'x-pagination-per-page': '20',
                    'x-pagination-total-count': '21',
                    'x-pagination-page-count': '2',
                },
            };
        },
        put: async (url: string, body?: unknown, config?: unknown) => {
            calls.push({ method: 'PUT', url, body, config });
            if (url.endsWith('/webhooks/inactivate')) {
                return response({ ...SUBSCRIPTION, is_active: false });
            }
            return response({
                ...(body as Record<string, unknown>),
                updated_at: SUBSCRIPTION.updated_at,
            });
        },
        post: async (url: string, body?: unknown, config?: unknown) => {
            calls.push({ method: 'POST', url, body, config });
            return response(DISPATCH);
        },
    } as unknown as AxiosInstance;
    return { http, calls };
}

describe('WebhookResource', () => {
    test('register validates, applies documented defaults, and returns the PUT response', async () => {
        const { http, calls } = mockHttp();
        const resource = new WebhookResource(http, 'account-1');

        await expect(
            resource.register({ url: '', email: 'ops@example.com' }),
        ).rejects.toThrow(ValidationError);
        await expect(
            resource.register({ url: 'https://example.com/webhook', email: '' }),
        ).rejects.toThrow(ValidationError);
        await expect(
            resource.register({ url: '/relative', email: 'ops@example.com' }),
        ).rejects.toThrow(ValidationError);
        await expect(
            resource.register({ url: 'javascript:alert(1)', email: 'ops@example.com' }),
        ).rejects.toThrow(ValidationError);
        await expect(
            resource.register({ url: 'https://example.com/webhook', email: 'not-an-email' }),
        ).rejects.toThrow(ValidationError);

        const result = await resource.register({
            url: 'https://example.com/webhook',
            email: 'ops@example.com',
        });
        const body = {
            url: 'https://example.com/webhook',
            email: 'ops@example.com',
            events: DEFAULT_EVENTS,
            is_active: true,
        };

        expect(calls).toEqual([
            {
                method: 'PUT',
                url: '/accounts/account-1/webhooks/subscriptions',
                body,
                config: undefined,
            },
        ]);
        expect(result).toEqual({ ...body, updated_at: SUBSCRIPTION.updated_at });
        expect(Object.isFrozen(DEFAULT_WEBHOOK_EVENTS)).toBe(true);
        expect((calls[0]?.body as { events: string[] }).events).not.toBe(DEFAULT_WEBHOOK_EVENTS);
    });

    test('register rejects malformed payload, events, and activation state before dispatch', async () => {
        const { http, calls } = mockHttp();
        const resource = new WebhookResource(http, 'account-1');

        await expect(resource.register(null as never)).rejects.toThrow(ValidationError);
        await expect(resource.register('invalid' as never)).rejects.toThrow(ValidationError);
        await expect(
            resource.register({
                url: 'https://example.com/webhook',
                email: 'ops@example.com',
                events: 'document_ready' as never,
            }),
        ).rejects.toThrow(ValidationError);
        await expect(
            resource.register({
                url: 'https://example.com/webhook',
                email: 'ops@example.com',
                events: ['document_ready', '   '],
            }),
        ).rejects.toThrow(ValidationError);
        await expect(
            resource.register({
                url: 'https://example.com/webhook',
                email: 'ops@example.com',
                events: [123] as never,
            }),
        ).rejects.toThrow(ValidationError);
        await expect(
            resource.register({
                url: 'https://example.com/webhook',
                email: 'ops@example.com',
                is_active: 'yes' as never,
            }),
        ).rejects.toThrow(ValidationError);

        expect(calls).toHaveLength(0);
    });

    test('register treats an empty event list as omitted', async () => {
        const { http, calls } = mockHttp();
        const resource = new WebhookResource(http, 'account-1');

        await resource.register({
            url: 'https://example.com/webhook',
            email: 'ops@example.com',
            events: [],
        });

        expect(calls[0]?.body).toEqual({
            url: 'https://example.com/webhook',
            email: 'ops@example.com',
            events: DEFAULT_EVENTS,
            is_active: true,
        });
    });

    test('register clones a caller-provided events array before sending it', async () => {
        const { http, calls } = mockHttp();
        const events: Array<'document_ready'> = ['document_ready'];

        await new WebhookResource(http, 'account-1').register({
            url: 'https://example.com/webhook',
            email: 'ops@example.com',
            events,
        });

        expect((calls[0]?.body as { events: string[] }).events).toEqual(events);
        expect((calls[0]?.body as { events: string[] }).events).not.toBe(events);
    });

    test('register preserves explicit events and inactive state for an account override', async () => {
        const { http, calls } = mockHttp();
        const resource = new WebhookResource(http, 'default-account');
        const payload = {
            url: 'https://example.com/custom-webhook',
            email: 'alerts@example.com',
            events: ['signature_requested'],
            is_active: false,
        };

        const result = await resource.register(payload, 'override-account');

        expect(calls).toEqual([
            {
                method: 'PUT',
                url: '/accounts/override-account/webhooks/subscriptions',
                body: payload,
                config: undefined,
            },
        ]);
        expect(result).toEqual({ ...payload, updated_at: SUBSCRIPTION.updated_at });
    });

    test('get fetches and returns the current subscription', async () => {
        const { http, calls } = mockHttp();
        const resource = new WebhookResource(http, 'account-1');

        const result = await resource.get();

        expect(calls).toEqual([
            {
                method: 'GET',
                url: '/accounts/account-1/webhooks/subscriptions',
                config: undefined,
            },
        ]);
        expect(result).toEqual(SUBSCRIPTION);
    });

    test('get returns null only when the API responds 404', async () => {
        let capturedUrl = '';
        const http = {
            get: async (url: string) => {
                capturedUrl = url;
                throw ApiError.fromResponse(404, { message: 'No subscription found' });
            },
        } as unknown as AxiosInstance;
        const resource = new WebhookResource(http, 'account-1');

        const result = await resource.get();

        expect(capturedUrl).toBe('/accounts/account-1/webhooks/subscriptions');
        expect(result).toBeNull();
    });

    test('get propagates non-404 API errors', async () => {
        const error = ApiError.fromResponse(500, { message: 'Server error' });
        const http = {
            get: async () => {
                throw error;
            },
        } as unknown as AxiosInstance;
        const resource = new WebhookResource(http, 'account-1');

        await expect(resource.get()).rejects.toBe(error);
    });

    test('inactivate PUTs and returns the inactive subscription', async () => {
        const { http, calls } = mockHttp();
        const resource = new WebhookResource(http, 'account-1');

        const result = await resource.inactivate();

        expect(calls).toEqual([
            {
                method: 'PUT',
                url: '/accounts/account-1/webhooks/inactivate',
                body: undefined,
                config: undefined,
            },
        ]);
        expect(result).toEqual({ ...SUBSCRIPTION, is_active: false });
    });

    test('listEventTypes passes through the dynamic global catalog in server order', async () => {
        const { http, calls } = mockHttp();
        const resource = new WebhookResource(http);

        const result = await resource.listEventTypes();

        expect(calls).toEqual([
            { method: 'GET', url: '/webhooks/event-types', config: undefined },
        ]);
        expect(result).toEqual(EVENT_TYPES);
        expect(result[1]?.id).toBe('future_event_added_by_server');
    });

    test('listDispatches cleans query params and returns data with pagination', async () => {
        const { http, calls } = mockHttp();
        const resource = new WebhookResource(http, 'default-account');

        // Deliberately include an explicit `undefined` to pin runtime cleanup for
        // plain-JavaScript callers; typed callers normally omit this property.
        const dirtyParams = {
            event: 'document_ready',
            delivered: false,
            page: 2,
            per_page: 20,
            from: undefined,
        } as unknown as Parameters<WebhookResource['listDispatches']>[0];
        const result = await resource.listDispatches(dirtyParams, 'override-account');
        const defaultResult = await resource.listDispatches();

        expect(calls).toEqual([
            {
                method: 'GET',
                url: '/accounts/override-account/webhooks',
                config: {
                    params: {
                        event: 'document_ready',
                        delivered: false,
                        page: 2,
                        'per-page': 20,
                    },
                },
            },
            {
                method: 'GET',
                url: '/accounts/default-account/webhooks',
                config: { params: {} },
            },
        ]);
        expect(result).toEqual({
            data: [DISPATCH],
            meta: {
                current_page: 2,
                per_page: 20,
                total: 21,
                last_page: 2,
            },
        });
        expect(defaultResult).toEqual(result);
    });

    test('retryDispatch validates, POSTs the retry route, and returns the dispatch', async () => {
        const { http, calls } = mockHttp();
        const resource = new WebhookResource(http, 'default-account');

        await expect(resource.retryDispatch('')).rejects.toThrow(ValidationError);
        const result = await resource.retryDispatch('dispatch/1', 'override/account');

        expect(calls).toEqual([
            {
                method: 'POST',
                url: '/accounts/override%2Faccount/webhooks/dispatch%2F1/retry',
                body: undefined,
                config: undefined,
            },
        ]);
        expect(result).toEqual(DISPATCH);
    });
});
