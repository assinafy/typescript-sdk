import type {
    IAssignment,
    IAssignmentListParams,
    IAssignmentListResponse,
    ICostEstimate,
    ICreateAssignmentPayload,
    ICreateAssignmentResponse,
    IEstimateAssignmentCostPayload,
    IResendCostEstimate,
    IResendEmailResponse,
    IWhatsAppNotification,
    SignerReference,
} from '../types';
import { ValidationError } from '../errors';
import { cleanListParams, cleanParams } from '../utils';
import { BaseResource } from './base';

/**
 * Normalize a public assignment input into the exact create-request body.
 * String IDs and legacy `signer_id` aliases become signer objects, omitted
 * values are removed, and collect assignments must include placement entries.
 *
 * @param payload - Assignment method, signer references, and optional message,
 * expiration, copy receivers, or collect-field placements.
 * @returns A JSON-ready body shaped as
 * `{ method, signers: [{ id, verification_method?, notification_methods?, step? }], message?, expires_at?, copy_receivers?, entries? }`.
 * @throws {ValidationError} If no signer is present, a signer reference is
 * malformed, or a collect assignment has no field-placement entries.
 *
 * @example
 * ```ts
 * const body = buildAssignmentPayload({
 *   method: 'virtual',
 *   signers: ['signer-1', { signer_id: 'signer-2', step: 2 }],
 *   message: 'Please sign',
 * });
 * // body.signers → [{ id: 'signer-1' }, { id: 'signer-2', step: 2 }]
 * ```
 */
export function buildAssignmentPayload(
    payload: ICreateAssignmentPayload,
): Record<string, unknown> {
    const method = payload.method ?? 'virtual';
    const signers = extractSignerRefs(payload);
    if (signers.length === 0) {
        throw new ValidationError('At least one signer is required', {
            signers: payload.signers ?? payload.signer_ids ?? payload.signerIds,
        });
    }
    if (method === 'collect' && (!Array.isArray(payload.entries) || payload.entries.length === 0)) {
        throw new ValidationError('At least one field-placement entry is required for collect assignments', {
            entries: payload.entries,
        });
    }

    return cleanParams({
        method,
        signers: signers.map((ref) => normaliseSignerRef(ref)),
        message: payload.message,
        expires_at: payload.expires_at,
        copy_receivers: payload.copy_receivers,
        entries: payload.entries,
    });
}

/**
 * Build the narrower official cost-estimate body without create-only fields.
 *
 * @param payload - Assignment method plus channel descriptors for `virtual`,
 * or field-placement entries for `collect`.
 * @returns A JSON-ready `{ method, signers?, entries? }` request body. Signer
 * IDs and create-only step fields are never forwarded to pricing.
 * @throws {ValidationError} If a virtual estimate has no signer descriptor or
 * a collect estimate has no placement entry.
 *
 * @example
 * ```ts
 * const body = buildAssignmentEstimatePayload({
 *   method: 'virtual',
 *   signers: [{ verification_method: 'Email', notification_methods: ['Email'] }],
 * });
 * ```
 */
export function buildAssignmentEstimatePayload(
    payload: IEstimateAssignmentCostPayload,
): Record<string, unknown> {
    const method = payload.method ?? 'virtual';
    const signers = Array.isArray(payload.signers) ? payload.signers : [];
    if (method === 'virtual' && signers.length === 0) {
        throw new ValidationError('At least one signer is required for a virtual cost estimate');
    }
    if (method === 'collect' && (!Array.isArray(payload.entries) || payload.entries.length === 0)) {
        throw new ValidationError('At least one field-placement entry is required for a collect cost estimate');
    }

    return cleanParams({
        method,
        signers: signers.length > 0
            ? signers.map((signer) => normaliseEstimateSigner(signer))
            : undefined,
        entries: payload.entries,
    });
}

function extractSignerRefs(payload: ICreateAssignmentPayload): SignerReference[] {
    if (Array.isArray(payload.signers) && payload.signers.length > 0) {
        return payload.signers;
    }

    const legacy = payload.signer_ids ?? payload.signerIds;
    return Array.isArray(legacy) ? legacy : [];
}

function normaliseSignerRef(
    ref: SignerReference,
): { id?: string; verification_method?: string; notification_methods?: string[]; step?: number } {
    if (typeof ref === 'string') {
        if (!ref) throw new ValidationError('Signer ID cannot be empty');
        return { id: ref };
    }
    if (ref && typeof ref === 'object') {
        const input = ref as {
            id?: string;
            signer_id?: string;
            verification_method?: string;
            notification_methods?: string[];
            step?: number;
        };
        const id = input.id ?? input.signer_id;
        const normalised = cleanParams({
            id,
            verification_method: input.verification_method,
            notification_methods: input.notification_methods,
            step: input.step,
        });

        if (typeof id === 'string' && id.length > 0) {
            return normalised as { id: string; verification_method?: string; notification_methods?: string[] };
        }

    }
    throw new ValidationError('Invalid signer reference', { ref: ref as unknown });
}

function normaliseEstimateSigner(signer: unknown): Record<string, unknown> {
    // Older SDK releases accepted signer IDs here. IDs do not participate in
    // the published cost schema; retain the signer count for JavaScript callers
    // while projecting every legacy string to the official `{}` descriptor.
    if (typeof signer === 'string') return {};
    if (!signer || typeof signer !== 'object' || Array.isArray(signer)) {
        throw new ValidationError('Invalid assignment cost signer');
    }
    const descriptor = signer as {
        verification_method?: unknown;
        notification_methods?: unknown;
    };
    return cleanParams({
        verification_method: descriptor.verification_method,
        notification_methods: descriptor.notification_methods,
    });
}

export class AssignmentResource extends BaseResource {
    /**
     * List assignments across the workspace (`GET /assignments`).
     *
     * The account is passed as an `accountId` **query parameter** — the API
     * responds `400` ("Um contexto de conta é necessário e não foi fornecido")
     * without it. Note the camelCase spelling: `account_id` and an
     * `X-Account-Id` header are both rejected.
     *
     * @param params - `page`, `per-page`.
     * @param accountId - Override the client's default account ID.
     * @returns Assignments, with pagination in `meta`. Each item is a full
     * {@link IAssignment} (same shape as {@link AssignmentResource.create}
     * returns):
     * ```jsonc
     * {
     *   "id": "103033c9d2cec233bf65eea04999",
     *   "sender_email": "sender@example.com",
     *   "method": "virtual",
     *   "expires_at": null,
     *   "message": "Please sign this contract",
     *   "copy_receivers": [],
     *   "signers": [
     *     {
     *       "id": "19e6b92e7895332ed9708535d8c",
     *       "full_name": "Ana Souza",
     *       "email": "signer@example.com",
     *       "whatsapp_phone_number": null,
     *       "has_accepted_terms": false,
     *       "completed": false,
     *       "notification_history": [],
     *       "verification_method": "Email",
     *       "notification_methods": ["Email"],
     *       "step": 1,
     *       "notified": true
     *     }
     *   ],
     *   "items": [
     *     {
     *       "id": "103033c9d33326458deb74fc3052",
     *       "page": null,
     *       "signer": {
     *         "id": "19e6b92e7895332ed9708535d8c",
     *         "full_name": "Ana Souza",
     *         "email": "signer@example.com",
     *         "whatsapp_phone_number": null,
     *         "has_accepted_terms": false
     *       },
     *       "field": {
     *         "id": "signer-example",
     *         "name": "Virtual",
     *         "type": "virtual",
     *         "is_active": true
     *       },
     *       "value": null,
     *       "completed": false
     *     }
     *   ],
     *   "summary": {
     *     "signer_count": 1,
     *     "completed_count": 0,
     *     "signers": [
     *       {
     *         "id": "19e6b92e7895332ed9708535d8c",
     *         "full_name": "Ana Souza",
     *         "email": "signer@example.com",
     *         "whatsapp_phone_number": null,
     *         "has_accepted_terms": false,
     *         "completed": false
     *       }
     *     ]
     *   },
     *   "signing_urls": [
     *     {
     *       "signer_id": "19e6b92e7895332ed9708535d8c",
     *       "url": "https://app-sandbox.assinafy.com.br/sign/103033c950d865a248a11c5cf96c?email=signer%40example.com"
     *     }
     *   ]
     * }
     * ```
     * @throws {ValidationError} If no account ID is available.
     * @throws {ApiError} If the API rejects the request.
     *
     * @example
     * ```ts
     * const { data, meta } = await client.assignments.list({ 'per-page': 20 });
     * ```
     */
    async list(
        params: IAssignmentListParams = {},
        accountId?: string,
    ): Promise<IAssignmentListResponse> {
        const id = this.accountId(accountId);
        return this.callList<IAssignment>('Failed to list assignments', () =>
            this.http.get('/assignments', {
                params: { ...cleanListParams(params), accountId: id },
            }),
        );
    }

    /**
     * Create a signing assignment for a document
     * (`POST /documents/{documentId}/assignments`).
     *
     * Signers may be passed as bare id strings or as objects
     * (`{ id, verification_method, notification_methods, step }`); the SDK
     * normalises them to the docs-sanctioned `signers: [{ ... }]` shape via
     * {@link buildAssignmentPayload}. The document must have reached
     * `metadata_ready` before an assignment can be created.
     *
     * @param documentId - The document to request signatures on.
     * @param payload - Signers plus optional `method` (defaults to `virtual`),
     * `message`, `expires_at`, `copy_receivers`, and `collect`-mode `entries`.
     * @returns The created {@link IAssignment}: `signers` (rich, with `step` /
     * `notified` / `verification_method`), `items` (one row per signer × field),
     * a `summary` count block, and per-signer `signing_urls`. Response shape:
     * ```jsonc
     * {
     *   "id": "103033c9d2cec233bf65eea04999",
     *   "sender_email": "sender@example.com",
     *   "method": "virtual",
     *   "expires_at": null,
     *   "message": "Please sign this contract",
     *   "copy_receivers": [],
     *   "signers": [
     *     {
     *       "id": "19e6b92e7895332ed9708535d8c",
     *       "full_name": "Ana Souza",
     *       "email": "signer@example.com",
     *       "whatsapp_phone_number": null,
     *       "has_accepted_terms": false,
     *       "completed": false,
     *       "notification_history": [],
     *       "verification_method": "Email",
     *       "notification_methods": ["Email"],
     *       "step": 1,
     *       "notified": true
     *     }
     *   ],
     *   "items": [
     *     {
     *       "id": "103033c9d33326458deb74fc3052",
     *       "page": null,
     *       "signer": {
     *         "id": "19e6b92e7895332ed9708535d8c",
     *         "full_name": "Ana Souza",
     *         "email": "signer@example.com"
     *       },
     *       "field": {
     *         "id": "signer-example",
     *         "name": "Virtual",
     *         "type": "virtual",
     *         "is_active": true
     *       },
     *       "value": null,
     *       "completed": false
     *     }
     *   ],
     *   "summary": {
     *     "signer_count": 1,
     *     "completed_count": 0,
     *     "signers": [
     *       {
     *         "id": "19e6b92e7895332ed9708535d8c",
     *         "full_name": "Ana Souza",
     *         "email": "signer@example.com",
     *         "whatsapp_phone_number": null,
     *         "has_accepted_terms": false,
     *         "completed": false
     *       }
     *     ]
     *   },
     *   "signing_urls": [
     *     {
     *       "signer_id": "19e6b92e7895332ed9708535d8c",
     *       "url": "https://app-sandbox.assinafy.com.br/sign/103033c950d865a248a11c5cf96c?email=signer%40example.com"
     *     }
     *   ]
     * }
     * ```
     * @throws {ValidationError} If `documentId` is missing, no signer is
     * supplied, or a signer reference is invalid.
     * @throws {ApiError} If the API rejects the request — e.g. `400`
     * ("Um signatário com este e-mail já existe.") when a signer email already
     * exists on the account.
     *
     * @example
     * ```ts
     * const assignment = await client.assignments.create('doc-1', {
     *   signers: ['19e6b92e7895332ed9708535d8c'],
     *   message: 'Please sign this contract',
     * });
     * // → wire body: { method: 'virtual', signers: [{ id: '19e6…' }], message: 'Please sign this contract' }
     * assignment.signing_urls?.forEach((s) => console.log(s.signer_id, s.url));
     * ```
     */
    async create(
        documentId: string,
        payload: ICreateAssignmentPayload,
    ): Promise<ICreateAssignmentResponse> {
        const docId = this.requireId(documentId, 'Document ID');
        const signers = extractSignerRefs(payload);
        const body = buildAssignmentPayload(payload);
        this.logger.info('Creating assignment', {
            documentId: docId,
            signers: signers.length,
        });
        return this.call('Failed to create assignment', () =>
            this.http.post(
                `/documents/${this.pathSegment(docId, 'Document ID')}/assignments`,
                body,
            ),
        );
    }

    /**
     * Estimate the cost (in credits/documents) of creating the assignment
     * (`POST /documents/{documentId}/assignments/estimate-cost`).
     *
     * Unlike {@link AssignmentResource.create}, estimate signer entries contain
     * only `verification_method` / `notification_methods` (or `{}` for the
     * default Email channel). {@link buildAssignmentEstimatePayload} projects
     * exactly the fields permitted by the estimate schema.
     *
     * @param documentId - The document the assignment would be created on.
     * @param payload - `method` plus channel-only signer descriptors and/or
     * `collect`-mode `entries`. Create-only fields and signer IDs are not part
     * of this request schema.
     * @returns an {@link ICostEstimate} with `total_credits`, balances, a
     * line-item `breakdown`, and a `has_sufficient_resources` gate. Response
     * shape:
     * ```jsonc
     * {
     *   "documents": 1,
     *   "credits": 0,
     *   "needs_extra_document": false,
     *   "extra_document_cost": 0,
     *   "total_credits": 0,
     *   "breakdown": [],
     *   "document_balance": 67,
     *   "credit_balance": 0,
     *   "has_sufficient_resources": true,
     *   "blocking_reason": null,
     *   "message": null
     * }
     * ```
     * @throws {ValidationError} If `documentId` is missing, a `virtual` request
     * has no signer entry, or a `collect` request has no field-placement entry.
     * @throws {ApiError} If the API rejects the request.
     *
     * @example
     * ```ts
     * const cost = await client.assignments.estimateCost('doc-1', {
     *   signers: [{ verification_method: 'Whatsapp' }],
     * });
     * // → wire body: { method: 'virtual', signers: [{ verification_method: 'Whatsapp' }] }
     * if (!cost.has_sufficient_resources) console.warn(cost.blocking_reason);
     * ```
     */
    async estimateCost(
        documentId: string,
        payload: IEstimateAssignmentCostPayload,
    ): Promise<ICostEstimate> {
        const docId = this.requireId(documentId, 'Document ID');
        return this.call('Failed to estimate assignment cost', () =>
            this.http.post(
                `/documents/${this.pathSegment(docId, 'Document ID')}/assignments/estimate-cost`,
                buildAssignmentEstimatePayload(payload),
            ),
        );
    }

    /**
     * Update the expiration date of an existing assignment
     * (`PUT /documents/{documentId}/assignments/{assignmentId}/reset-expiration`).
     *
     * Sends `{ expires_at }` verbatim. The official contract accepts an ISO-8601
     * date/time string. `null` is retained as a live-unverified compatibility
     * value used by older integrations and, unlike ordinary nullable inputs, is
     * intentionally not stripped from the body.
     *
     * @param documentId - The document the assignment belongs to.
     * @param assignmentId - The assignment to update.
     * @param expiresAt - New expiry as an ISO-8601 date/time string. `null` is
     * an unverified compatibility value intended to clear it.
     * @returns The updated {@link IAssignment} — the same full shape
     * {@link AssignmentResource.create} returns (`signers`, `items`, `summary`,
     * `signing_urls`), with `expires_at` reflecting the new value:
     * ```jsonc
     * {
     *   "id": "103033c9d2cec233bf65eea04999",
     *   "sender_email": "sender@example.com",
     *   "method": "virtual",
     *   "expires_at": "2026-12-31T23:59:59Z",
     *   "message": "Please sign this contract",
     *   "copy_receivers": [],
     *   "signers": [
     *     {
     *       "id": "19e6b92e7895332ed9708535d8c",
     *       "full_name": "Ana Souza",
     *       "email": "signer@example.com",
     *       "completed": false,
     *       "verification_method": "Email",
     *       "notification_methods": ["Email"],
     *       "step": 1,
     *       "notified": true
     *     }
     *   ],
     *   "summary": { "signer_count": 1, "completed_count": 0 },
     *   "signing_urls": [
     *     { "signer_id": "19e6b92e7895332ed9708535d8c", "url": "https://app-sandbox.assinafy.com.br/sign/103033c950d865a248a11c5cf96c" }
     *   ]
     * }
     * ```
     * @throws {ValidationError} If `documentId` or `assignmentId` is missing.
     * @throws {ApiError} `400`/`404` if the assignment cannot be updated.
     *
     * @example
     * ```ts
     * // Extend the deadline …
     * await client.assignments.resetExpiration('doc-1', 'asg-1', '2026-12-31T23:59:59Z');
     * // … or remove it entirely (sends { expires_at: null }).
     * await client.assignments.resetExpiration('doc-1', 'asg-1', null);
     * ```
     */
    async resetExpiration(
        documentId: string,
        assignmentId: string,
        expiresAt: string | null,
    ): Promise<IAssignment> {
        const docId = this.requireId(documentId, 'Document ID');
        const asgId = this.requireId(assignmentId, 'Assignment ID');
        // `null` is meaningful here ("no expiration"), so don't strip it.
        return this.call('Failed to update assignment expiration', () =>
            this.http.put(
                `/documents/${this.pathSegment(docId, 'Document ID')}/assignments/${this.pathSegment(asgId, 'Assignment ID')}/reset-expiration`,
                { expires_at: expiresAt },
            ),
        );
    }

    /**
     * Resend the signing notification to a single signer
     * (`PUT /documents/{documentId}/assignments/{assignmentId}/signers/{signerId}/resend`).
     *
     * Sends no request body — the target is fully identified by the path. Use
     * {@link AssignmentResource.estimateResendCost} first if you need to know
     * whether the resend will consume credits.
     *
     * @param documentId - The document the assignment belongs to.
     * @param assignmentId - The assignment containing the signer.
     * @param signerId - The signer to re-notify.
     * @returns An {@link IResendEmailResponse} confirming dispatch:
     * ```jsonc
     * {
     *   "is_sent": true,
     *   "document_id": "103acccd24234c07858ffddf6d84",
     *   "signer_id": "19e6b92e7895332ed9708535d8c"
     * }
     * ```
     * @throws {ValidationError} If any of the three IDs is missing.
     * @throws {ApiError} If the API rejects the request.
     *
     * @example
     * ```ts
     * await client.assignments.resendNotification('doc-1', 'asg-1', 'signer-1');
     * ```
     */
    async resendNotification(
        documentId: string,
        assignmentId: string,
        signerId: string,
    ): Promise<IResendEmailResponse> {
        const docId = this.requireId(documentId, 'Document ID');
        const asgId = this.requireId(assignmentId, 'Assignment ID');
        const sid = this.requireId(signerId, 'Signer ID');
        return this.call('Failed to resend signer notification', () =>
            this.http.put(
                `/documents/${this.pathSegment(docId, 'Document ID')}/assignments/${this.pathSegment(asgId, 'Assignment ID')}/signers/${this.pathSegment(sid, 'Signer ID')}/resend`,
            ),
        );
    }

    /**
     * Estimate the cost of resending a signer notification
     * (`POST /documents/{documentId}/assignments/{assignmentId}/signers/{signerId}/estimate-resend-cost`).
     *
     * Sends no request body. Pair it with
     * {@link AssignmentResource.resendNotification} to gate a resend on
     * available credit.
     *
     * @param documentId - The document the assignment belongs to.
     * @param assignmentId - The assignment containing the signer.
     * @param signerId - The signer whose notification would be resent.
     * @returns An {@link IResendCostEstimate}. The published contract returns
     * the full {@link ICostEstimate}; older deployments may return the compact
     * `total` / `has_sufficient_credits` shape shown below:
     * ```jsonc
     * {
     *   "total": 0,
     *   "breakdown": [
     *     { "code": "NotificationEmailResend", "name": "Email Notification Resend", "cost": 0 }
     *   ],
     *   "credit_balance": 0,
     *   "has_sufficient_credits": true
     * }
     * ```
     * @throws {ValidationError} If any of the three IDs is missing.
     * @throws {ApiError} If the API rejects the request.
     *
     * @example
     * ```ts
     * const cost = await client.assignments.estimateResendCost('doc-1', 'asg-1', 'signer-1');
     * const affordable = 'total_credits' in cost
     *   ? cost.has_sufficient_resources
     *   : cost.has_sufficient_credits;
     * if (affordable) {
     *   await client.assignments.resendNotification('doc-1', 'asg-1', 'signer-1');
     * }
     * ```
     */
    async estimateResendCost(
        documentId: string,
        assignmentId: string,
        signerId: string,
    ): Promise<IResendCostEstimate> {
        const docId = this.requireId(documentId, 'Document ID');
        const asgId = this.requireId(assignmentId, 'Assignment ID');
        const sid = this.requireId(signerId, 'Signer ID');
        return this.call('Failed to estimate resend cost', () =>
            this.http.post(
                `/documents/${this.pathSegment(docId, 'Document ID')}/assignments/${this.pathSegment(asgId, 'Assignment ID')}/signers/${this.pathSegment(sid, 'Signer ID')}/estimate-resend-cost`,
            ),
        );
    }

    /**
     * List every WhatsApp notification rendered + sent for an assignment
     * (`GET /documents/{documentId}/assignments/{assignmentId}/whatsapp-notifications`).
     *
     * Returns the raw array (this endpoint is not paginated), so there is no
     * `meta` — each entry is the rendered message the signer received.
     *
     * @param documentId - The document the assignment belongs to.
     * @param assignmentId - The assignment whose WhatsApp notifications to list.
     * @returns An array of {@link IWhatsAppNotification} (empty when the
     * assignment used the email channel). Response shape:
     * ```jsonc
     * [
     *   {
     *     "sent_at": 1784145573,
     *     "header": "Assinafy",
     *     "body": "Você tem um documento para assinar.",
     *     "buttons": [
     *       { "text": "Assinar documento", "url": "https://app-sandbox.assinafy.com.br/sign/103033c950d865a248a11c5cf96c" }
     *     ],
     *     "phone_number": "+5511999998888",
     *     "signer_id": "19e6b92e7895332ed9708535d8c"
     *   }
     * ]
     * ```
     * @throws {ValidationError} If `documentId` or `assignmentId` is missing.
     * @throws {ApiError} If the API rejects the request.
     *
     * @example
     * ```ts
     * const notifications = await client.assignments.listWhatsAppNotifications('doc-1', 'asg-1');
     * notifications.forEach((n) => console.log(n.phone_number, n.body));
     * ```
     */
    async listWhatsAppNotifications(
        documentId: string,
        assignmentId: string,
    ): Promise<IWhatsAppNotification[]> {
        const docId = this.requireId(documentId, 'Document ID');
        const asgId = this.requireId(assignmentId, 'Assignment ID');
        return this.call('Failed to list WhatsApp notifications', () =>
            this.http.get(
                `/documents/${this.pathSegment(docId, 'Document ID')}/assignments/${this.pathSegment(asgId, 'Assignment ID')}/whatsapp-notifications`,
            ),
        );
    }
}
