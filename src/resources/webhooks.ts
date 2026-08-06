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
import { cleanListParams } from '../utils';
import { BaseResource } from './base';

/**
 * Default webhook events applied by {@link WebhookResource.register} when the
 * caller omits `events` (or passes an empty array).
 */
export const DEFAULT_WEBHOOK_EVENTS: readonly WebhookEventType[] = Object.freeze([
    'document_ready',
    'document_prepared',
    'signer_signed_document',
    'signer_rejected_document',
    'document_processing_failed',
]);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class WebhookResource extends BaseResource {
    /**
     * Register (or replace) the workspace's single webhook subscription
     * (`PUT /accounts/{accountId}/webhooks/subscriptions`). There is exactly one
     * subscription per workspace, keyed by URL.
     *
     * When `events` is omitted or empty, {@link DEFAULT_WEBHOOK_EVENTS} is used
     * (`document_ready`, `document_prepared`, `signer_signed_document`,
     * `signer_rejected_document`, `document_processing_failed`).
     *
     * @param payload - Subscription details. `url` and `email` are required;
     * `events` defaults to {@link DEFAULT_WEBHOOK_EVENTS} and `is_active`
     * defaults to `true`.
     * @param accountId - Override the client's default account ID.
     * @returns The saved subscription. Response shape:
     * ```jsonc
     * {
     *   "url": "https://example.com/hook",
     *   "email": "ops@example.com",
     *   "events": [
     *     "document_ready",
     *     "document_prepared",
     *     "signer_signed_document",
     *     "signer_rejected_document",
     *     "document_processing_failed"
     *   ],
     *   "is_active": true,
     *   "updated_at": "2026-07-18T02:36:02Z" // no `id` / `created_at` are returned
     * }
     * ```
     * @throws {ValidationError} If `url` or `email` is missing.
     * @throws {ApiError} If the API rejects the subscription.
     *
     * @example
     * ```ts
     * // Subscribe to a specific set of events:
     * await client.webhooks.register({
     *   url: 'https://example.com/hook',
     *   email: 'ops@example.com',
     *   events: ['signer_signed_document', 'document_ready'],
     * });
     *
     * // Omit `events` to fall back to DEFAULT_WEBHOOK_EVENTS:
     * await client.webhooks.register({ url: 'https://example.com/hook', email: 'ops@example.com' });
     * ```
     */
    async register(
        payload: IWebhookRegisterPayload,
        accountId?: string,
    ): Promise<IWebhookSubscription> {
        if (!payload || typeof payload !== 'object') {
            throw new ValidationError('Webhook subscription payload is required');
        }
        validateWebhookUrl(payload.url);
        if (!payload.email || !EMAIL_RE.test(payload.email)) {
            throw new ValidationError('Webhook email must be a valid email address', {
                email: payload.email,
            });
        }
        if (
            payload.events !== undefined &&
            (!Array.isArray(payload.events) ||
                payload.events.some((event) => typeof event !== 'string' || !event.trim()))
        ) {
            throw new ValidationError('Webhook events must be an array of non-empty strings');
        }
        if (payload.is_active !== undefined && typeof payload.is_active !== 'boolean') {
            throw new ValidationError('Webhook is_active must be a boolean');
        }

        const id = this.accountId(accountId);
        const body = {
            url: payload.url,
            email: payload.email,
            events: [...(
                payload.events && payload.events.length > 0
                    ? payload.events
                    : DEFAULT_WEBHOOK_EVENTS
            )],
            is_active: payload.is_active ?? true,
        };

        this.logger.info('Registering webhook', { url: payload.url });

        return this.call('Failed to register webhook', () =>
            this.http.put(
                `/accounts/${this.pathSegment(id, 'Account ID')}/webhooks/subscriptions`,
                body,
            ),
        );
    }

    /**
     * Fetch the current webhook subscription
     * (`GET /accounts/{accountId}/webhooks/subscriptions`).
     *
     * @param accountId - Override the client's default account ID.
     * @returns The subscription, or `null` when the workspace has none (the API
     * responds `404`, which is normalized to `null`). Response shape when
     * present:
     * ```jsonc
     * {
     *   "url": "https://hooks.zapier.com/hooks/standard/27880178/bbe9b90c.../",
     *   "email": "ops@example.com",
     *   "events": [
     *     "document_ready",
     *     "document_prepared"
     *     // …5 more (7 total)
     *   ],
     *   "is_active": false,
     *   "updated_at": "2026-07-18T02:36:02Z"
     * }
     * ```
     * @throws {ApiError} If the API fails for a reason other than `404`.
     *
     * @example
     * ```ts
     * const sub = await client.webhooks.get();
     * if (sub === null) {
     *   // no subscription configured yet
     * } else if (!sub.is_active) {
     *   // exists but deliveries are paused
     * }
     * ```
     */
    async get(accountId?: string): Promise<IWebhookSubscription | null> {
        const id = this.accountId(accountId);
        return this.callOptional<IWebhookSubscription>('Failed to fetch webhook subscription', () =>
            this.http.get(
                `/accounts/${this.pathSegment(id, 'Account ID')}/webhooks/subscriptions`,
            ),
        );
    }

    /**
     * Inactivate the current webhook subscription
     * (`PUT /accounts/{accountId}/webhooks/inactivate`).
     *
     * This is the only supported way to stop deliveries — the API has no
     * subscription-delete route. The subscription is retained (with its `url`
     * and `events`) and simply stops firing; re-enable it by calling
     * {@link WebhookResource.register} again with `is_active: true`.
     *
     * @param accountId - Override the client's default account ID.
     * @returns The subscription with `is_active` flipped to `false`. Response
     * shape:
     * ```jsonc
     * {
     *   "url": "https://example.com/hook",
     *   "email": "ops@example.com",
     *   "events": [
     *     "document_ready",
     *     "document_prepared",
     *     "signer_signed_document",
     *     "signer_rejected_document",
     *     "document_processing_failed"
     *   ],
     *   "is_active": false,
     *   "updated_at": "2026-07-18T02:36:02Z"
     * }
     * ```
     * @throws {ApiError} If the API rejects the request.
     *
     * @example
     * ```ts
     * const sub = await client.webhooks.inactivate();
     * console.log(sub.is_active); // false
     * ```
     */
    async inactivate(accountId?: string): Promise<IWebhookSubscription> {
        const id = this.accountId(accountId);
        this.logger.info('Inactivating webhook subscription');
        return this.call('Failed to inactivate webhook subscription', () =>
            this.http.put(`/accounts/${this.pathSegment(id, 'Account ID')}/webhooks/inactivate`),
        );
    }

    /**
     * List currently supported webhook event types
     * (`GET /webhooks/event-types`). This is a global, account-independent
     * catalog.
     *
     * @returns The full list of event types with human-readable descriptions.
     * Live, the API returns exactly 15 entries (in this order):
     * `document_uploaded`, `document_metadata_ready`, `document_prepared`,
     * `assignment_created`, `signature_requested`, `document_ready`,
     * `signer_created`, `signer_email_verified`, `signer_whatsapp_verified`,
     * `signer_data_confirmed`, `signer_signed_document`, `signer_viewed_document`,
     * `signer_rejected_document`, `user_rejected_document`,
     * `document_processing_failed`. Response shape:
     * ```jsonc
     * [
     *   {
     *     "id": "document_uploaded",
     *     "description": "Triggered when the User has uploaded a Document"
     *   },
     *   {
     *     "id": "document_metadata_ready",
     *     "description": "Triggered when the document is ready to be prepared. The document has been normalized to PDF and its pages are available."
     *   }
     *   // …13 more (15 total)
     * ]
     * ```
     * @throws {ApiError} If the API rejects the request.
     *
     * @example
     * ```ts
     * const types = await client.webhooks.listEventTypes();
     * const ids = types.map((t) => t.id);
     * ```
     */
    async listEventTypes(): Promise<IWebhookEventTypeInfo[]> {
        return this.call('Failed to list webhook event types', () =>
            this.http.get('/webhooks/event-types'),
        );
    }

    /**
     * List webhook delivery history for the workspace
     * (`GET /accounts/{accountId}/webhooks`). Pagination info (if any) is
     * attached in `meta`.
     *
     * @param params - Optional filters and pagination:
     *   - `event` — restrict to a single {@link WebhookEventType}
     *     (e.g. `'signer_signed_document'`).
     *   - `delivered` — `true`/`false` to filter by delivery success.
     *   - `from` / `to` — Unix epoch seconds bounding `created_at`.
     *   - `page` — 1-based page number.
     *   - `per-page` — page size (`per_page` is normalized to `per-page`).
     * @param accountId - Override the client's default account ID.
     * @returns Delivery records, with pagination in `meta`. Each item:
     * ```jsonc
     * {
     *   "id": "103a09cfce51319dd3b3f72ffcdf",
     *   "event": "signature_requested",
     *   "activity_id": 8629,
     *   "endpoint": "https://example.com/hook",
     *   "payload": {
     *     // the full event body that was POSTed to `endpoint`:
     *     // { id, event, object: <document + assignment>, origin, message,
     *     //   payload: { signer_email, signer_full_name, notification_method, ... },
     *     //   subject: <User>, account_id, created_at }
     *   },
     *   "delivered": true,
     *   "http_status": 200,
     *   "response_body": "{ ... }", // body returned by the receiving endpoint
     *   "error": null,
     *   "created_at": "2026-07-15T20:04:36Z",
     *   "updated_at": "2026-07-15T20:04:36Z"
     * }
     * ```
     * @throws {ApiError} If the API rejects the request.
     *
     * @example
     * ```ts
     * // Only failed deliveries, newest page first:
     * const { data, meta } = await client.webhooks.listDispatches({
     *   delivered: false,
     *   'per-page': 20,
     * });
     * for (const dispatch of data) {
     *   if (!dispatch.delivered) await client.webhooks.retryDispatch(dispatch.id);
     * }
     * ```
     */
    async listDispatches(
        params: IWebhookDispatchListParams = {},
        accountId?: string,
    ): Promise<PaginatedResult<IWebhookDispatch>> {
        const id = this.accountId(accountId);
        return this.callList<IWebhookDispatch>('Failed to list webhook dispatches', () =>
            this.http.get(`/accounts/${this.pathSegment(id, 'Account ID')}/webhooks`, {
                params: cleanListParams(params as unknown as Record<string, unknown>),
            }),
        );
    }

    /**
     * Retry delivery of a specific webhook dispatch
     * (`POST /accounts/{accountId}/webhooks/{historyId}/retry`). Re-sends the
     * original payload to the subscription's endpoint.
     *
     * @param dispatchId - The dispatch (delivery history) ID to re-send, as
     * returned by {@link WebhookResource.listDispatches}.
     * @param accountId - Override the client's default account ID.
     * @returns A newly created delivery-history record for the retry attempt;
     * its ID is distinct from the original dispatch. Response
     * shape:
     * ```jsonc
     * {
     *   "id": "103a09cfce51319dd3b3f72ffcdf",
     *   "event": "signature_requested",
     *   "activity_id": 8629,
     *   "endpoint": "https://example.com/hook",
     *   "payload": { }, // the original event body that was re-POSTed
     *   "delivered": true,
     *   "http_status": 200,
     *   "response_body": "{ ... }",
     *   "error": null,
     *   "created_at": "2026-07-15T20:04:36Z",
     *   "updated_at": "2026-07-15T20:05:10Z"
     * }
     * ```
     * @throws {ValidationError} If `dispatchId` is empty.
     * @throws {ApiError} If the dispatch is not found (`404`) or the retry fails.
     *
     * @example
     * ```ts
     * const dispatch = await client.webhooks.retryDispatch('103a09cfce51319dd3b3f72ffcdf');
     * console.log(dispatch.delivered);
     * ```
     */
    async retryDispatch(dispatchId: string, accountId?: string): Promise<IWebhookDispatch> {
        const id = this.accountId(accountId);
        const did = this.requireId(dispatchId, 'Dispatch ID');
        return this.call('Failed to retry webhook dispatch', () =>
            this.http.post(
                `/accounts/${this.pathSegment(id, 'Account ID')}/webhooks/${this.pathSegment(did, 'Dispatch ID')}/retry`,
            ),
        );
    }
}

function validateWebhookUrl(value: string): void {
    let url: URL;
    try {
        url = new URL(value);
    } catch {
        throw new ValidationError('Webhook URL must be an absolute HTTP(S) URL', { url: value });
    }
    if ((url.protocol !== 'https:' && url.protocol !== 'http:') || !url.hostname) {
        throw new ValidationError('Webhook URL must be an absolute HTTP(S) URL', { url: value });
    }
}
