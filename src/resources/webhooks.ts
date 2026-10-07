import type {
    IWebhookDispatch,
    IWebhookEndpoint,
    IWebhookEndpointCreatePayload,
    IWebhookEndpointSecret,
    IWebhookEndpointUpdatePayload,
    IWebhookDispatchListParams,
    IWebhookEventTypeInfo,
    IWebhookRegisterPayload,
    IWebhookSubscription,
    PaginatedResult,
    WebhookEventType,
} from '../types';
import { ValidationError } from '../errors';
import { cleanListParams, isEmail } from '../utils';
import { BaseResource } from './base';

/**
 * Default webhook events applied by {@link WebhookResource.register} and
 * {@link WebhookResource.createEndpoint} when the caller omits `events` (or
 * passes an empty array).
 */
export const DEFAULT_WEBHOOK_EVENTS: readonly WebhookEventType[] = Object.freeze([
    'document_ready',
    'document_prepared',
    'signer_signed_document',
    'signer_rejected_document',
    'document_processing_failed',
]);

export class WebhookResource extends BaseResource {
    /**
     * Update the account's oldest webhook endpoint, creating it if the account
     * has none (`PUT /accounts/{accountId}/webhooks/subscriptions`). Accounts
     * with several endpoints should use {@link WebhookResource.updateEndpoint}.
     *
     * When `events` is omitted or empty, {@link DEFAULT_WEBHOOK_EVENTS} is used
     * (`document_ready`, `document_prepared`, `signer_signed_document`,
     * `signer_rejected_document`, `document_processing_failed`).
     * OAuth tokens need the `webhooks:write` scope.
     *
     * Request body (`application/json`):
     * ```jsonc
     * {
     *   "events": [
     *     "document_ready",
     *     "document_prepared"
     *   ],
     *   "is_active": true,
     *   "url": "https://myapp.example.com/webhooks/assinafy",
     *   "email": "operations@example.com"
     * }
     * ```
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
     * @throws {ValidationError} If `url` / `email` is invalid, `events` /
     * `is_active` has the wrong type, or no account ID is available.
     * @throws {ApiError} If the API rejects the subscription, including `403`
     * when an OAuth token lacks `webhooks:write`.
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
        validateWebhookFields(payload, true);
        const id = this.accountId(accountId);
        const body = {
            url: payload.url,
            email: payload.email,
            events: withDefaultEvents(payload.events),
            is_active: payload.is_active ?? true,
        };

        this.logger.info('Registering webhook');

        return this.call('Failed to register webhook', () =>
            this.http.put(
                `/accounts/${this.pathSegment(id, 'Account ID')}/webhooks/subscriptions`,
                body,
            ),
        );
    }

    /**
     * Fetch the account's oldest webhook endpoint in the legacy subscription
     * shape (`GET /accounts/{accountId}/webhooks/subscriptions`). Accounts with
     * several endpoints should use {@link WebhookResource.listEndpoints}.
     *
     * @param accountId - Override the client's default account ID.
     * @returns The subscription, or `null` when the workspace has none (the API
     * responds `404`, which is normalized to `null`). Response shape when
     * present:
     * ```jsonc
     * {
     *   "url": "https://webhooks.example.com/assinafy",
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
     * @throws {ValidationError} If no account ID is available.
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
     * Deactivate the account's oldest webhook endpoint
     * (`PUT /accounts/{accountId}/webhooks/inactivate`). Other endpoints are
     * unaffected; use {@link WebhookResource.updateEndpoint} with
     * `is_active: false` to target a specific one.
     *
     * The endpoint is retained (with its `url` and `events`) and simply stops
     * firing; re-enable it by calling {@link WebhookResource.register} again
     * with `is_active: true`.
     * OAuth tokens need the `webhooks:write` scope.
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
     * @throws {ValidationError} If no account ID is available.
     * @throws {ApiError} If the API rejects the request, including `403` when
     * an OAuth token lacks `webhooks:write`.
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
     * @returns The server-controlled event catalog with human-readable
     * descriptions. Event types can be added over time, so callers should not
     * depend on a fixed count or order. Response shape:
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
     * Assinafy treats any `2xx` response as success. It makes at most two
     * attempts per event with a three-second wait. After ten consecutive failed
     * events, the circuit breaker pauses normal delivery and sends roughly 5%
     * as recovery checks until one succeeds. The stored `response_body` is
     * truncated to 2,000 characters.
     *
     * @param params - Optional filters and pagination:
     *   - `endpoint_id` — only deliveries to this webhook endpoint.
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
     *   "resource": "activity_dispatching_history",
     *   "id": "103a09cfce51319dd3b3f72ffcdf",
     *   "event": "signature_requested",
     *   "activity_id": 8629,
     *   "endpoint_id": "65f1c2a9b3e4d5f60718293a4b5c6d7e", // null once the endpoint is deleted
     *   "endpoint": "https://example.com/hook",
     *   "payload": {
     *     // the full event body that was POSTed to `endpoint`:
     *     // { id, event, object: <document + assignment>, origin, message,
     *     //   payload: { signer_email, signer_full_name, notification_method, ... },
     *     //   subject: <User>, account_id, created_at }
     *   },
     *   "delivered": true,
     *   "http_status": 200,
     *   "response_body": "{ ... }", // receiving endpoint body, max 2,000 chars
     *   "error": null,
     *   "created_at": "2026-07-15T20:04:36Z",
     *   "updated_at": "2026-07-15T20:04:36Z"
     * }
     * ```
     * @throws {ValidationError} If no account ID is available.
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
     * original payload to the endpoint that received it.
     *
     * @param dispatchId - The dispatch (delivery history) ID to re-send, as
     * returned by {@link WebhookResource.listDispatches}.
     * @param accountId - Override the client's default account ID.
     * @returns A newly created delivery-history record for the retry attempt;
     * its ID is distinct from the original dispatch. Response
     * shape:
     * ```jsonc
     * {
     *   "resource": "activity_dispatching_history",
     *   "id": "103a09cfce51319dd3b3f72ffcdf",
     *   "event": "signature_requested",
     *   "activity_id": 8629,
     *   "endpoint_id": "65f1c2a9b3e4d5f60718293a4b5c6d7e", // null once the endpoint is deleted
     *   "endpoint": "https://example.com/hook",
     *   "payload": { }, // the original event body that was re-POSTed
     *   "delivered": true,
     *   "http_status": 200,
     *   "response_body": "{ ... }", // max 2,000 characters
     *   "error": null,
     *   "created_at": "2026-07-15T20:04:36Z",
     *   "updated_at": "2026-07-15T20:05:10Z"
     * }
     * ```
     * @throws {ValidationError} If `dispatchId` is empty or no account ID is
     * available.
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

    /**
     * List the account's webhook endpoints, oldest first
     * (`GET /accounts/{accountId}/webhooks/endpoints`). OAuth tokens need the
     * `account:read` scope.
     *
     * @param accountId - Override the client's default account ID.
     * @returns Every endpoint (1 on free plans, up to 3 on paid plans):
     * ```jsonc
     * [
     *   {
     *     "id": "65f1c2a9b3e4d5f60718293a4b5c6d7e",
     *     "name": "ERP",
     *     "url": "https://example.com/webhooks/assinafy",
     *     "email": "ops@example.com",
     *     "events": ["document_ready", "signer_signed_document"],
     *     "is_active": true,
     *     "signing_enabled": true, // deliveries carry a `webhook-signature` header
     *     "created_at": "2026-10-01T12:00:00Z",
     *     "updated_at": "2026-10-01T12:00:00Z"
     *   }
     * ]
     * ```
     * @throws {ValidationError} If no account ID is available.
     * @throws {ApiError} If the API rejects the request.
     *
     * @example
     * ```ts
     * const endpoints = await client.webhooks.listEndpoints();
     * const signed = endpoints.filter((endpoint) => endpoint.signing_enabled);
     * ```
     */
    async listEndpoints(accountId?: string): Promise<IWebhookEndpoint[]> {
        const path = this.endpointsPath(accountId);
        return this.call('Failed to list webhook endpoints', () => this.http.get(path));
    }

    /**
     * Register a URL to receive the account's webhook events
     * (`POST /accounts/{accountId}/webhooks/endpoints`).
     *
     * An account can have 1 endpoint, or up to 3 on paid plans. Each endpoint
     * of a workspace needs a different `url`. With `signing_enabled: true` the
     * API generates a signing secret; read it with
     * {@link WebhookResource.getEndpointSecret}. When `events` is omitted or
     * empty, {@link DEFAULT_WEBHOOK_EVENTS} is sent. OAuth tokens need the
     * `webhooks:write` scope.
     *
     * Request body (`application/json`):
     * ```jsonc
     * {
     *   "url": "https://example.com/webhooks/assinafy",
     *   "email": "ops@example.com",
     *   "events": ["document_ready", "signer_signed_document"],
     *   "name": "ERP",              // optional label
     *   "is_active": true,          // defaults to true
     *   "signing_enabled": true     // defaults to false
     * }
     * ```
     *
     * @param payload - Endpoint details. `url` (absolute HTTP(S)) and `email`
     * are required; `events`, `name`, `is_active` and `signing_enabled` are
     * optional.
     * @param accountId - Override the client's default account ID.
     * @returns The created endpoint:
     * ```jsonc
     * {
     *   "id": "65f1c2a9b3e4d5f60718293a4b5c6d7e",
     *   "name": "ERP",
     *   "url": "https://example.com/webhooks/assinafy",
     *   "email": "ops@example.com",
     *   "events": ["document_ready", "signer_signed_document"],
     *   "is_active": true,
     *   "signing_enabled": true, // deliveries carry a `webhook-signature` header
     *   "created_at": "2026-10-01T12:00:00Z",
     *   "updated_at": "2026-10-01T12:00:00Z"
     * }
     * ```
     * @throws {ValidationError} If a field is malformed or no account ID is
     * available.
     * @throws {ApiError} `400` if another endpoint already uses `url`; `403`
     * when the plan's endpoint limit is reached or an OAuth token lacks
     * `webhooks:write`.
     *
     * @example
     * ```ts
     * const endpoint = await client.webhooks.createEndpoint({
     *   name: 'ERP',
     *   url: 'https://example.com/webhooks/assinafy',
     *   email: 'ops@example.com',
     *   events: ['document_ready', 'signer_signed_document'],
     *   signing_enabled: true,
     * });
     * const { secret } = await client.webhooks.getEndpointSecret(endpoint.id);
     * ```
     */
    async createEndpoint(
        payload: IWebhookEndpointCreatePayload,
        accountId?: string,
    ): Promise<IWebhookEndpoint> {
        validateWebhookFields(payload, true);
        const path = this.endpointsPath(accountId);
        this.logger.info('Creating webhook endpoint');
        return this.call('Failed to create webhook endpoint', () =>
            this.http.post(path, { ...payload, events: withDefaultEvents(payload.events) }),
        );
    }

    /**
     * Retrieve one webhook endpoint
     * (`GET /accounts/{accountId}/webhooks/endpoints/{endpointId}`). OAuth
     * tokens need the `account:read` scope.
     *
     * @param endpointId - The endpoint ID.
     * @param accountId - Override the client's default account ID.
     * @returns The endpoint:
     * ```jsonc
     * {
     *   "id": "65f1c2a9b3e4d5f60718293a4b5c6d7e",
     *   "name": "ERP",
     *   "url": "https://example.com/webhooks/assinafy",
     *   "email": "ops@example.com",
     *   "events": ["document_ready", "signer_signed_document"],
     *   "is_active": true,
     *   "signing_enabled": true, // deliveries carry a `webhook-signature` header
     *   "created_at": "2026-10-01T12:00:00Z",
     *   "updated_at": "2026-10-01T12:00:00Z"
     * }
     * ```
     * @throws {ValidationError} If `endpointId` is empty or no account ID is
     * available.
     * @throws {ApiError} `404` if the endpoint does not exist.
     *
     * @example
     * ```ts
     * const endpoint = await client.webhooks.getEndpoint('65f1c2a9b3e4d5f60718293a4b5c6d7e');
     * ```
     */
    async getEndpoint(endpointId: string, accountId?: string): Promise<IWebhookEndpoint> {
        const path = this.endpointPath(endpointId, accountId);
        return this.call('Failed to fetch webhook endpoint', () => this.http.get(path));
    }

    /**
     * Change a webhook endpoint
     * (`PUT /accounts/{accountId}/webhooks/endpoints/{endpointId}`). Only the
     * fields sent are updated; `url` cannot be one another endpoint of the
     * workspace already uses.
     *
     * `signing_enabled: true` generates a secret if the endpoint has none and
     * keeps the current one otherwise; `false` discards the secret. OAuth
     * tokens need the `webhooks:write` scope.
     *
     * Request body (`application/json`, every field optional):
     * ```jsonc
     * {
     *   "url": "https://example.com/webhooks/assinafy",
     *   "email": "ops@example.com",
     *   "events": ["document_ready"],
     *   "name": "ERP",
     *   "is_active": false,
     *   "signing_enabled": true
     * }
     * ```
     *
     * @param endpointId - The endpoint ID.
     * @param payload - Fields to change; at least one is required.
     * @param accountId - Override the client's default account ID.
     * @returns The updated endpoint:
     * ```jsonc
     * {
     *   "id": "65f1c2a9b3e4d5f60718293a4b5c6d7e",
     *   "name": "ERP",
     *   "url": "https://example.com/webhooks/assinafy",
     *   "email": "ops@example.com",
     *   "events": ["document_ready", "signer_signed_document"],
     *   "is_active": true,
     *   "signing_enabled": true, // deliveries carry a `webhook-signature` header
     *   "created_at": "2026-10-01T12:00:00Z",
     *   "updated_at": "2026-10-01T12:00:00Z"
     * }
     * ```
     * @throws {ValidationError} If `endpointId` is empty, the payload is empty
     * or malformed, or no account ID is available.
     * @throws {ApiError} `400` if another endpoint already uses `url`; `404` if
     * the endpoint does not exist.
     *
     * @example
     * ```ts
     * // Pause one endpoint without touching the others:
     * await client.webhooks.updateEndpoint(endpoint.id, { is_active: false });
     * ```
     */
    async updateEndpoint(
        endpointId: string,
        payload: IWebhookEndpointUpdatePayload,
        accountId?: string,
    ): Promise<IWebhookEndpoint> {
        validateWebhookFields(payload, false);
        const path = this.endpointPath(endpointId, accountId);
        this.logger.info('Updating webhook endpoint');
        return this.call('Failed to update webhook endpoint', () => this.http.put(path, payload));
    }

    /**
     * Stop delivering events to an endpoint and free its plan slot
     * (`DELETE /accounts/{accountId}/webhooks/endpoints/{endpointId}`). Its
     * delivery history is kept with `endpoint_id: null`. OAuth tokens need the
     * `webhooks:write` scope.
     *
     * @param endpointId - The endpoint ID.
     * @param accountId - Override the client's default account ID.
     * @returns Resolves once deleted (the API answers `{ "data": [] }`).
     * @throws {ValidationError} If `endpointId` is empty or no account ID is
     * available.
     * @throws {ApiError} `404` if the endpoint does not exist.
     *
     * @example
     * ```ts
     * await client.webhooks.deleteEndpoint('65f1c2a9b3e4d5f60718293a4b5c6d7e');
     * ```
     */
    async deleteEndpoint(endpointId: string, accountId?: string): Promise<void> {
        const path = this.endpointPath(endpointId, accountId);
        this.logger.info('Deleting webhook endpoint');
        await this.callVoid('Failed to delete webhook endpoint', () => this.http.delete(path));
    }

    /**
     * Return the secret that signs deliveries to an endpoint
     * (`GET /accounts/{accountId}/webhooks/endpoints/{endpointId}/secret`).
     * Pass it to {@link AssinafyClient} as `webhookSecret` to verify deliveries
     * with `webhookVerifier.verifySignature()`. Not available to OAuth
     * applications; use an API key.
     *
     * @param endpointId - The endpoint ID.
     * @param accountId - Override the client's default account ID.
     * @returns The Standard Webhooks secret:
     * ```jsonc
     * { "secret": "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw" }
     * ```
     * @throws {ValidationError} If `endpointId` is empty or no account ID is
     * available.
     * @throws {ApiError} `400` when signing is disabled on the endpoint; `404`
     * if it does not exist.
     *
     * @example
     * ```ts
     * const { secret } = await client.webhooks.getEndpointSecret(endpoint.id);
     * // store `secret` with your other credentials, never in source control
     * ```
     */
    async getEndpointSecret(
        endpointId: string,
        accountId?: string,
    ): Promise<IWebhookEndpointSecret> {
        const path = `${this.endpointPath(endpointId, accountId)}/secret`;
        return this.call('Failed to fetch webhook endpoint secret', () => this.http.get(path));
    }

    /**
     * Replace an endpoint's signing secret and return the new one
     * (`POST /accounts/{accountId}/webhooks/endpoints/{endpointId}/secret/rotate`).
     * The old secret stops working immediately: deliveries sent after the
     * rotation are signed only with the new secret, so update the receiver at
     * once. Not available to OAuth applications; use an API key.
     *
     * @param endpointId - The endpoint ID.
     * @param accountId - Override the client's default account ID.
     * @returns The new secret:
     * ```jsonc
     * { "secret": "whsec_bmV3LWtleS1iYXNlNjQtZW5jb2RlZA==" }
     * ```
     * @throws {ValidationError} If `endpointId` is empty or no account ID is
     * available.
     * @throws {ApiError} `400` when signing is disabled on the endpoint; `404`
     * if it does not exist.
     *
     * @example
     * ```ts
     * const { secret } = await client.webhooks.rotateEndpointSecret(endpoint.id);
     * await secretStore.put('assinafy-webhook-secret', secret);
     * ```
     */
    async rotateEndpointSecret(
        endpointId: string,
        accountId?: string,
    ): Promise<IWebhookEndpointSecret> {
        const path = `${this.endpointPath(endpointId, accountId)}/secret/rotate`;
        this.logger.info('Rotating webhook endpoint secret');
        return this.call('Failed to rotate webhook endpoint secret', () => this.http.post(path));
    }

    private endpointsPath(accountId?: string): string {
        const id = this.pathSegment(this.accountId(accountId), 'Account ID');
        return `/accounts/${id}/webhooks/endpoints`;
    }

    private endpointPath(endpointId: string, accountId?: string): string {
        const eid = this.pathSegment(endpointId, 'Endpoint ID');
        return `${this.endpointsPath(accountId)}/${eid}`;
    }
}

function withDefaultEvents(events: readonly string[] | undefined): string[] {
    return [...(events && events.length > 0 ? events : DEFAULT_WEBHOOK_EVENTS)];
}

/**
 * Validate webhook endpoint fields. `required` enforces `url` and `email`
 * (create/register); otherwise only the fields present are checked and at
 * least one must be.
 */
function validateWebhookFields(
    payload: IWebhookEndpointUpdatePayload,
    required: boolean,
): void {
    if (!payload || typeof payload !== 'object') {
        throw new ValidationError('Webhook payload is required');
    }
    if (!required && Object.values(payload).every((value) => value === undefined)) {
        throw new ValidationError('Webhook endpoint update must include at least one field');
    }
    if (required || payload.url !== undefined) validateWebhookUrl(payload.url);
    if ((required || payload.email !== undefined) && !isEmail(payload.email)) {
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
    for (const key of ['is_active', 'signing_enabled'] as const) {
        if (payload[key] !== undefined && typeof payload[key] !== 'boolean') {
            throw new ValidationError(`Webhook ${key} must be a boolean`);
        }
    }
    if (payload.name !== undefined && typeof payload.name !== 'string') {
        throw new ValidationError('Webhook name must be a string');
    }
}

function validateWebhookUrl(value: string | undefined): void {
    let url: URL;
    try {
        url = new URL(value ?? '');
    } catch {
        throw new ValidationError('Webhook URL must be an absolute HTTP(S) URL', { url: value });
    }
    if ((url.protocol !== 'https:' && url.protocol !== 'http:') || !url.hostname) {
        throw new ValidationError('Webhook URL must be an absolute HTTP(S) URL', { url: value });
    }
}
