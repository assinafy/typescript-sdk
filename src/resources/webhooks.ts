import type {
    IWebhookDispatch,
    IWebhookDispatchListParams,
    IWebhookEventTypeInfo,
    IWebhookRegisterPayload,
    IWebhookSubscription,
    PaginatedResult,
    WebhookEventType,
} from '../types';
import { ValidationError } from '../errors';
import { cleanParams } from '../utils';
import { BaseResource } from './base';

/**
 * Default webhook events applied by {@link WebhookResource.register} when the
 * caller omits `events` (or passes an empty array).
 */
export const DEFAULT_WEBHOOK_EVENTS: WebhookEventType[] = [
    'document_ready',
    'document_prepared',
    'signer_signed_document',
    'signer_rejected_document',
    'document_processing_failed',
];

export class WebhookResource extends BaseResource {
    /**
     * Register (or replace) the workspace's single webhook subscription
     * (`PUT /accounts/{id}/webhooks/subscriptions`). There is exactly one
     * subscription per workspace, keyed by URL.
     *
     * When `events` is omitted or empty, {@link DEFAULT_WEBHOOK_EVENTS} is used
     * (`document_ready`, `document_prepared`, `signer_signed_document`,
     * `signer_rejected_document`, `document_processing_failed`).
     *
     * @example
     * ```ts
     * await client.webhooks.register({ url: 'https://example.com/hook', email: 'ops@example.com' });
     * // → { url, email, events: [...], is_active: true, updated_at: '2026-…' }
     * ```
     */
    async register(
        payload: IWebhookRegisterPayload,
        accountId?: string,
    ): Promise<IWebhookSubscription> {
        if (!payload.url) throw new ValidationError('Webhook URL is required');
        if (!payload.email) throw new ValidationError('Webhook email is required');

        const id = this.accountId(accountId);
        const body = {
            url: payload.url,
            email: payload.email,
            events:
                payload.events && payload.events.length > 0
                    ? payload.events
                    : DEFAULT_WEBHOOK_EVENTS,
            is_active: payload.is_active ?? true,
        };

        this.logger.info('Registering webhook', { url: payload.url });

        return this.call('Failed to register webhook', () =>
            this.http.put(`/accounts/${id}/webhooks/subscriptions`, body),
        );
    }

    /** Fetch the current webhook subscription. Returns `null` if none exists. */
    async get(accountId?: string): Promise<IWebhookSubscription | null> {
        const id = this.accountId(accountId);
        return this.callOptional<IWebhookSubscription>('Failed to fetch webhook subscription', () =>
            this.http.get(`/accounts/${id}/webhooks/subscriptions`),
        );
    }

    /** Delete the current webhook subscription. */
    async delete(accountId?: string): Promise<void> {
        const id = this.accountId(accountId);
        this.logger.info('Deleting webhook subscription');
        return this.callVoid('Failed to delete webhook subscription', () =>
            this.http.delete(`/accounts/${id}/webhooks/subscriptions`),
        );
    }

    /** Inactivate the current webhook subscription without deleting it. */
    async inactivate(accountId?: string): Promise<IWebhookSubscription> {
        const id = this.accountId(accountId);
        this.logger.info('Inactivating webhook subscription');
        return this.call('Failed to inactivate webhook subscription', () =>
            this.http.put(`/accounts/${id}/webhooks/inactivate`),
        );
    }

    /** List currently supported webhook event types. */
    async listEventTypes(): Promise<IWebhookEventTypeInfo[]> {
        return this.call('Failed to list webhook event types', () =>
            this.http.get('/webhooks/event-types'),
        );
    }

    /** List webhook delivery history for the workspace. */
    async listDispatches(
        params: IWebhookDispatchListParams = {},
        accountId?: string,
    ): Promise<PaginatedResult<IWebhookDispatch>> {
        const id = this.accountId(accountId);
        return this.callList<IWebhookDispatch>('Failed to list webhook dispatches', () =>
            this.http.get(`/accounts/${id}/webhooks`, {
                params: cleanParams(params as unknown as Record<string, unknown>),
            }),
        );
    }

    /** Retry delivery of a specific webhook dispatch. */
    async retryDispatch(dispatchId: string, accountId?: string): Promise<IWebhookDispatch> {
        const id = this.accountId(accountId);
        const did = this.requireId(dispatchId, 'Dispatch ID');
        return this.call('Failed to retry webhook dispatch', () =>
            this.http.post(`/accounts/${id}/webhooks/${did}/retry`),
        );
    }
}
