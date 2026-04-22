import type {
    IWebhookDispatch,
    IWebhookDispatchListParams,
    IWebhookEventTypeInfo,
    IWebhookRegisterPayload,
    IWebhookSubscription,
    WebhookEventType,
} from '../types';
import { ValidationError } from '../errors';
import { cleanParams, toSdkError } from '../utils';
import { BaseResource } from './base';

const DEFAULT_EVENTS: WebhookEventType[] = [
    'document_ready',
    'document_prepared',
    'signer_signed_document',
    'signer_rejected_document',
    'document_processing_failed',
];

export class WebhookResource extends BaseResource {
    /** Register (or replace) the webhook subscription for the workspace. */
    register(payload: IWebhookRegisterPayload, accountId?: string): Promise<IWebhookSubscription> {
        if (!payload.url) throw new ValidationError('Webhook URL is required');
        if (!payload.email) throw new ValidationError('Webhook email is required');

        const id = this.accountId(accountId);
        const body = {
            url: payload.url,
            email: payload.email,
            events: payload.events && payload.events.length > 0 ? payload.events : DEFAULT_EVENTS,
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
        try {
            const response = await this.http.get(`/accounts/${id}/webhooks/subscriptions`);
            return (response.data?.data ?? response.data ?? null) as IWebhookSubscription | null;
        } catch (err) {
            this.logger.warn('Error fetching webhook subscription', {
                error: err instanceof Error ? err.message : String(err),
            });
            // Only swallow 404 — any other error should propagate as a real problem.
            const sdkErr = toSdkError(err, 'Failed to fetch webhook subscription');
            if ('statusCode' in sdkErr && (sdkErr as { statusCode?: number }).statusCode === 404) {
                return null;
            }
            throw sdkErr;
        }
    }

    /** Delete the current webhook subscription. */
    delete(accountId?: string): Promise<void> {
        const id = this.accountId(accountId);
        this.logger.info('Deleting webhook subscription');
        return this.callVoid('Failed to delete webhook subscription', () =>
            this.http.delete(`/accounts/${id}/webhooks/subscriptions`),
        );
    }

    /** Inactivate the current webhook subscription without deleting it. */
    inactivate(accountId?: string): Promise<IWebhookSubscription> {
        const id = this.accountId(accountId);
        this.logger.info('Inactivating webhook subscription');
        return this.call('Failed to inactivate webhook subscription', () =>
            this.http.put(`/accounts/${id}/webhooks/inactivate`),
        );
    }

    /** List currently supported webhook event types. */
    listEventTypes(): Promise<IWebhookEventTypeInfo[]> {
        return this.call('Failed to list webhook event types', () =>
            this.http.get('/webhooks/event-types'),
        );
    }

    /** List webhook delivery history for the workspace. */
    listDispatches(
        params: IWebhookDispatchListParams = {},
        accountId?: string,
    ): Promise<{ data: IWebhookDispatch[]; meta?: import('../types').PaginationMeta }> {
        const id = this.accountId(accountId);
        return this.callList<IWebhookDispatch>('Failed to list webhook dispatches', () =>
            this.http.get(`/accounts/${id}/webhooks`, {
                params: cleanParams(params as unknown as Record<string, unknown>),
            }),
        );
    }

    /** Retry delivery of a specific webhook dispatch. */
    retryDispatch(dispatchId: string, accountId?: string): Promise<IWebhookDispatch> {
        const id = this.accountId(accountId);
        const did = this.requireId(dispatchId, 'Dispatch ID');
        return this.call('Failed to retry webhook dispatch', () =>
            this.http.post(`/accounts/${id}/webhooks/${did}/retry`),
        );
    }
}
