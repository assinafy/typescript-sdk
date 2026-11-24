import type {
    IScheduleAssignmentPayload,
    IScheduleEnvelopePayload,
    IScheduledSend,
    IScheduledSendListParams,
    PaginatedResult,
} from '../types';
import { ValidationError } from '../errors';
import { assertExpirationDate, assertNonEmptyString, assertRecord, cleanListParams } from '../utils';
import { BaseResource } from './base';
import { buildAssignmentPayload } from './assignments';
import { buildEnvelopePayload } from './envelopes';

/**
 * Deferred assignment/envelope requests, available on staging. All routes,
 * including listing, need `documents:write` for OAuth applications. Requests
 * are checked when scheduled, and checked and charged again when sent. The
 * server checks due sends every five minutes. No mutation is automatically
 * retried and no Idempotency-Key is supported.
 */
export class ScheduledSendResource extends BaseResource {
    /**
     * Schedule an assignment (`POST /documents/{documentId}/scheduled-sends`).
     *
     * Sends and charges nothing now. Each document takes one pending or
     * processing scheduled send. A failed due send records its reason and
     * emails the scheduling member (active owners if that member has left).
     * @param documentId - Unassigned document in the workspace.
     * @param payload - The same signing request as `assignments.create()` plus its send time.
     * @param payload.send_at - ISO date-time (no offset means UTC) or Unix seconds, one hour to 90 days ahead.
     * @param payload.method - `virtual` (default) or `collect`.
     * @param payload.signers - Contacts and their verification, notification, capacity and ordering options.
     * @param payload.signer_ids - Compatibility alias for signer IDs.
     * @param payload.signerIds - Compatibility alias for signer IDs.
     * @param payload.entries - Required field placements for `collect`.
     * @param payload.message - Invitation text.
     * @param payload.copy_receivers - Contacts receiving copies.
     * @param payload.expires_at - Absolute deadline at least two hours after send_at, or null for none.
     * @param payload.max_total_credits - Credit ceiling enforced when sending.
     * @returns The saved request's state:
     * ```jsonc
     * { "resource": "scheduled_send", "id": "send-1", "type": "assignment",
     *   "document_ids": ["doc-1"], "status": "pending", "send_at": "2026-12-01T12:00:00Z",
     *   "assignment_id": null, "envelope_id": null, "failure_reason": null,
     *   "created_at": "2026-11-24T12:00:00Z", "processed_at": null }
     * ```
     * @throws {ValidationError} If the ID, time or signing request is malformed.
     * @throws {ApiError} `400` for timing, assignment or pending-send conflicts;
     * `401`, `403` for plan/scope restrictions, `404` for document/contact/deployment availability.
     * @example
     * ```ts
     * const scheduled = await client.scheduledSends.createAssignment(document.id, {
     *   signers: [{ id: signer.id, verification_method: 'Email', notification_methods: ['Email'] }],
     *   send_at: new Date(Date.now() + 86_400_000).toISOString(),
     *   max_total_credits: 0,
     * });
     * ```
     */
    async createAssignment(documentId: string, payload: IScheduleAssignmentPayload): Promise<IScheduledSend> {
        assertRecord(payload, 'scheduled assignment');
        validateTimestamp(payload.send_at, 'send_at');
        const { expires_at, ...assignment } = payload;
        const body = buildAssignmentPayload(assignment);
        body['send_at'] = payload.send_at;
        if (expires_at !== undefined) {
            if (expires_at !== null) validateTimestamp(expires_at, 'expires_at');
            body['expires_at'] = expires_at;
        }
        return this.call('Failed to schedule assignment', () =>
            this.http.post(`/documents/${this.pathSegment(documentId, 'Document ID')}/scheduled-sends`, body),
        );
    }

    /**
     * Schedule an envelope (`POST /accounts/{accountId}/scheduled-sends`).
     *
     * Creates no envelope and charges nothing now. Uses the same plan and
     * signing rules as envelope estimation; checks balances when sending.
     * @param payload - Envelope request and send time.
     * @param payload.send_at - ISO date-time or Unix seconds, one hour to 90 days ahead.
     * @param payload.name - Envelope name, 1–255 characters without `<`.
     * @param payload.message - Invitation text or null.
     * @param payload.signers - 1–20 contacts with shared channel options; no signing steps.
     * @param payload.documents - 1–20 unassigned documents, signer IDs and optional placements/copy receivers.
     * Each document's expires_at must be at least two hours after send_at.
     * @param payload.max_total_credits - Credit ceiling enforced when sending.
     * @param accountId - Override the client's default workspace.
     * @returns The saved request's state:
     * ```jsonc
     * { "resource": "scheduled_send", "id": "send-2", "type": "envelope",
     *   "document_ids": ["doc-1", "doc-2"], "status": "pending", "send_at": "2026-12-01T12:00:00Z",
     *   "assignment_id": null, "envelope_id": null, "failure_reason": null,
     *   "created_at": "2026-11-24T12:00:00Z", "processed_at": null }
     * ```
     * @throws {ValidationError} If the time or envelope request is malformed.
     * @throws {ApiError} `400` for timing or envelope/pending-send conflicts;
     * `401`, `403` (`PlanRestricted`, `InsufficientScope`), `404`.
     * @example
     * ```ts
     * const scheduled = await client.scheduledSends.createEnvelope({
     *   name: 'Agreement', signers: [{ id: signer.id }],
     *   documents: [{ id: document.id, signer_ids: [signer.id] }],
     *   send_at: new Date(Date.now() + 86_400_000).toISOString(),
     * });
     * ```
     */
    async createEnvelope(payload: IScheduleEnvelopePayload, accountId?: string): Promise<IScheduledSend> {
        assertRecord(payload, 'scheduled envelope');
        validateTimestamp(payload.send_at, 'send_at');
        const body = buildEnvelopePayload(payload);
        body['send_at'] = payload.send_at;
        return this.call('Failed to schedule envelope', () => this.http.post(this.path(accountId), body));
    }

    /**
     * List scheduled sends (`GET /accounts/{accountId}/scheduled-sends`).
     *
     * Newest first, in every state. Requires `documents:write`, because failure
     * reasons can expose balance and workspace membership information.
     * @param params - Optional document filter and pagination.
     * @param params.document_id - Return only sends containing this document.
     * @param params.page - One-based page number.
     * @param params.per-page - Page size, default 20 and maximum 50.
     * @param params.per_page - Compatibility alias for per-page.
     * @param accountId - Override the client's default workspace.
     * @returns Requests and header-derived pagination:
     * ```jsonc
     * { "data": [{ "id": "send-1", "type": "assignment", "document_ids": ["doc-1"],
     *   "status": "sent", "send_at": "2026-12-01T12:00:00Z", "assignment_id": "assignment-1",
     *   "envelope_id": null, "failure_reason": null, "created_at": "2026-11-24T12:00:00Z",
     *   "processed_at": "2026-12-01T12:00:03Z" }],
     *   "meta": { "current_page": 1, "per_page": 20, "total": 1, "last_page": 1 } }
     * ```
     * @throws {ValidationError} If the workspace/filter is invalid.
     * @throws {ApiError} `400` for an invalid filter, `401`, `403`, `404`.
     * @example
     * ```ts
     * const sends = await client.scheduledSends.list({ document_id: document.id });
     * ```
     */
    async list(params: IScheduledSendListParams = {}, accountId?: string): Promise<PaginatedResult<IScheduledSend>> {
        assertRecord(params, 'scheduled send list parameters');
        if (params.document_id !== undefined) assertNonEmptyString(params.document_id, 'document_id');
        return this.callList('Failed to list scheduled sends', () =>
            this.http.get(this.path(accountId), { params: cleanListParams({ ...params }) }),
        );
    }

    /**
     * Cancel a pending send (`PUT /accounts/{accountId}/scheduled-sends/{scheduledSendId}/cancel`).
     *
     * Sends and charges nothing. A second cancellation is a conflict.
     * @param scheduledSendId - Pending scheduled send ID.
     * @param accountId - Override the client's default workspace.
     * @returns The cancelled state:
     * ```jsonc
     * { "id": "send-1", "type": "assignment", "document_ids": ["doc-1"],
     *   "status": "cancelled", "send_at": "2026-12-01T12:00:00Z", "assignment_id": null,
     *   "envelope_id": null, "failure_reason": null, "created_at": "2026-11-24T12:00:00Z",
     *   "processed_at": "2026-11-24T12:05:00Z" }
     * ```
     * @throws {ValidationError} If an ID is invalid.
     * @throws {ApiError} `401`, `403`, `404`, `409` if no longer pending.
     * @example
     * ```ts
     * await client.scheduledSends.cancel(scheduled.id);
     * ```
     */
    async cancel(scheduledSendId: string, accountId?: string): Promise<IScheduledSend> {
        return this.call('Failed to cancel scheduled send', () =>
            this.http.put(`${this.path(accountId)}/${this.pathSegment(scheduledSendId, 'Scheduled send ID')}/cancel`),
        );
    }

    /**
     * Send a pending request now (`PUT /accounts/{accountId}/scheduled-sends/{scheduledSendId}/send`).
     *
     * Checks and charges as the scheduling member. A refusal leaves it pending
     * for its original time; cancel it explicitly to stop that future attempt.
     * @param scheduledSendId - Pending scheduled send ID.
     * @param accountId - Override the client's default workspace.
     * @returns The sent state and created assignment or envelope ID:
     * ```jsonc
     * { "id": "send-1", "type": "assignment", "document_ids": ["doc-1"],
     *   "status": "sent", "send_at": "2026-12-01T12:00:00Z", "assignment_id": "assignment-1",
     *   "envelope_id": null, "failure_reason": null, "created_at": "2026-11-24T12:00:00Z",
     *   "processed_at": "2026-11-24T13:00:00Z" }
     * ```
     * @throws {ValidationError} If an ID is invalid.
     * @throws {ApiError} `400` for invalid requests/balances or departed members;
     * `401`, `403`, `404`, `409` if no longer pending or `CreditCeilingExceeded`.
     * @example
     * ```ts
     * const sent = await client.scheduledSends.sendNow(scheduled.id);
     * ```
     */
    async sendNow(scheduledSendId: string, accountId?: string): Promise<IScheduledSend> {
        return this.call('Failed to send scheduled request', () =>
            this.http.put(`${this.path(accountId)}/${this.pathSegment(scheduledSendId, 'Scheduled send ID')}/send`),
        );
    }

    private path(accountId?: string): string {
        return `/accounts/${this.pathSegment(this.accountId(accountId), 'Account ID')}/scheduled-sends`;
    }
}

function validateTimestamp(value: unknown, label: string): void {
    if (typeof value === 'number') {
        if (!Number.isSafeInteger(value) || value < 0) {
            throw new ValidationError(`${label} must be a non-negative Unix time in seconds`);
        }
    } else {
        assertExpirationDate(value, label);
    }
}
