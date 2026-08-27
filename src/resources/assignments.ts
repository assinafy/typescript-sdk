import type {
    IAssignment,
    IAssignmentEntry,
    IAssignmentListParams,
    IAssignmentListResponse,
    ICostEstimate,
    ICreateAssignmentPayload,
    ICreateAssignmentResponse,
    IEstimateAssignmentCostPayload,
    IDisplaySettings,
    IResendCostEstimate,
    IResendEmailResponse,
    IWhatsAppNotification,
    SignerReference,
} from '../types';
import { ValidationError } from '../errors';
import { assertDateTime, assertRecord, cleanListParams, cleanParams } from '../utils';
import { BaseResource } from './base';

const ASSIGNMENT_METHODS = new Set(['virtual', 'collect']);
const VERIFICATION_METHODS = new Set(['Email', 'Whatsapp', 'DigitalCertificate']);
const NOTIFICATION_METHODS = new Set(['Email', 'Whatsapp']);

export function validateAssignmentSignerOptions(
    signer: {
        verification_method?: unknown;
        notification_methods?: unknown;
        step?: unknown;
    },
    label = 'signer',
): void {
    if (
        signer.verification_method !== undefined
        && (typeof signer.verification_method !== 'string'
            || !VERIFICATION_METHODS.has(signer.verification_method))
    ) {
        throw new ValidationError(`${label} has an invalid verification_method`);
    }
    if (
        signer.notification_methods !== undefined
        && (!Array.isArray(signer.notification_methods)
            || signer.notification_methods.some(
                (method) => typeof method !== 'string' || !NOTIFICATION_METHODS.has(method),
            ))
    ) {
        throw new ValidationError(`${label} has invalid notification_methods`);
    }
    if (
        signer.step !== undefined
        && (typeof signer.step !== 'number'
            || !Number.isSafeInteger(signer.step)
            || signer.step < 1)
    ) {
        throw new ValidationError(`${label} step must be a positive safe integer`);
    }
}

export function validateSigningOrder(
    signers: ReadonlyArray<{ verification_method?: string; step?: number }>,
    label = 'signers',
): void {
    const stepped = signers.filter((signer) => signer.step !== undefined);
    if (stepped.length > 0 && stepped.length !== signers.length) {
        throw new ValidationError(`${label} must all define step when any signer defines it`);
    }
    if (stepped.length > 0) {
        const steps = new Set(stepped.map((signer) => signer.step as number));
        const maximum = Math.max(...steps);
        if (steps.size !== maximum) {
            throw new ValidationError(`${label} steps must be contiguous starting at 1`);
        }
    }
    for (const signer of signers) {
        if (signer.verification_method !== 'DigitalCertificate') continue;
        const peers = signer.step === undefined
            ? signers.length
            : signers.filter((candidate) => candidate.step === signer.step).length;
        if (peers !== 1) {
            throw new ValidationError(`DigitalCertificate ${label} must be alone in their step`);
        }
    }
}

/**
 * Normalize a public assignment input into the exact create-request body.
 * String IDs and legacy `signer_id` aliases become signer objects, omitted
 * values are removed, and collect assignments must include placement entries.
 *
 * @param payload - Assignment method, signer references, and optional message,
 * expiration, copy-receiver signer IDs, or collect-field placements.
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
    assertRecord(payload, 'assignment payload');
    const method = payload.method ?? 'virtual';
    if (!ASSIGNMENT_METHODS.has(method)) {
        throw new ValidationError('method must be virtual or collect');
    }
    const signers = extractSignerRefs(payload);
    if (signers.length === 0) {
        throw new ValidationError('At least one signer is required', {
            signers: payload.signers ?? payload.signer_ids ?? payload.signerIds,
        });
    }
    const entries = payload.entries === undefined
        ? undefined
        : normaliseAssignmentEntries(payload.entries);
    if (method === 'collect' && (!entries || entries.length === 0)) {
        throw new ValidationError('At least one field-placement entry is required for collect assignments', {
            entries: payload.entries,
        });
    }
    if (payload.message !== undefined && typeof payload.message !== 'string') {
        throw new ValidationError('message must be a string');
    }
    if (payload.expires_at !== undefined) assertDateTime(payload.expires_at, 'expires_at');
    if (
        payload.copy_receivers !== undefined
        && (!Array.isArray(payload.copy_receivers)
            || payload.copy_receivers.some(
                (id) => typeof id !== 'string' || !id.trim(),
            ))
    ) {
        throw new ValidationError('copy_receivers must be an array of non-empty signer IDs');
    }

    const normalisedSigners = signers.map((ref) => normaliseSignerRef(ref));
    validateSigningOrder(normalisedSigners, 'assignment signers');
    return cleanParams({
        method,
        signers: normalisedSigners,
        message: payload.message,
        expires_at: payload.expires_at,
        copy_receivers: payload.copy_receivers,
        entries,
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
    assertRecord(payload, 'assignment estimate payload');
    const method = payload.method ?? 'virtual';
    if (!ASSIGNMENT_METHODS.has(method)) {
        throw new ValidationError('method must be virtual or collect');
    }
    const signers = Array.isArray(payload.signers) ? payload.signers : [];
    if (method === 'virtual' && signers.length === 0) {
        throw new ValidationError('At least one signer is required for a virtual cost estimate');
    }
    const entries = payload.entries === undefined
        ? undefined
        : normaliseAssignmentEntries(payload.entries);
    if (method === 'collect' && (!entries || entries.length === 0)) {
        throw new ValidationError('At least one field-placement entry is required for a collect cost estimate');
    }

    return cleanParams({
        method,
        signers: signers.length > 0
            ? signers.map((signer) => normaliseEstimateSigner(signer))
            : undefined,
        entries,
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
        if (!ref.trim()) throw new ValidationError('Signer ID cannot be empty');
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
        validateAssignmentSignerOptions(input);
        const id = input.id ?? input.signer_id;
        const normalised = cleanParams({
            id,
            verification_method: input.verification_method,
            notification_methods: input.notification_methods,
            step: input.step,
        });

        if (typeof id === 'string' && id.trim().length > 0) {
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
    validateAssignmentSignerOptions(descriptor);
    return cleanParams({
        verification_method: descriptor.verification_method,
        notification_methods: descriptor.notification_methods,
    });
}

function normaliseAssignmentEntries(entries: unknown): IAssignmentEntry[] {
    if (!Array.isArray(entries)) {
        throw new ValidationError('entries must be an array of field-placement entries');
    }
    return entries.map((entry, entryIndex) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
            throw new ValidationError(`entry ${entryIndex + 1} must be an object`);
        }
        const candidate = entry as Record<string, unknown>;
        const pageId = candidate['page_id'];
        if (typeof pageId !== 'string' || !pageId.trim()) {
            throw new ValidationError(`entry ${entryIndex + 1} requires page_id`);
        }
        const rawFields = candidate['fields'];
        if (!Array.isArray(rawFields)) {
            throw new ValidationError(`entry ${entryIndex + 1} fields must be an array`);
        }
        const fields = rawFields.map((field, fieldIndex) => {
            if (!field || typeof field !== 'object' || Array.isArray(field)) {
                throw new ValidationError(
                    `entry ${entryIndex + 1} field ${fieldIndex + 1} must be an object`,
                );
            }
            const descriptor = field as Record<string, unknown>;
            const signerId = descriptor['signer_id'];
            const fieldId = descriptor['field_id'];
            if (typeof signerId !== 'string' || !signerId.trim()) {
                throw new ValidationError(
                    `entry ${entryIndex + 1} field ${fieldIndex + 1} requires signer_id`,
                );
            }
            if (typeof fieldId !== 'string' || !fieldId.trim()) {
                throw new ValidationError(
                    `entry ${entryIndex + 1} field ${fieldIndex + 1} requires field_id`,
                );
            }
            const projected: IAssignmentEntry['fields'][number] = {
                signer_id: signerId,
                field_id: fieldId,
            };
            if (descriptor['display_settings'] !== undefined) {
                projected.display_settings = normaliseDisplaySettings(
                    descriptor['display_settings'],
                    `entry ${entryIndex + 1} field ${fieldIndex + 1}`,
                );
            }
            return projected;
        });
        return { page_id: pageId, fields };
    });
}

function normaliseDisplaySettings(value: unknown, label: string): IDisplaySettings {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new ValidationError(`${label} display_settings must be an object`);
    }
    const settings = value as Record<string, unknown>;
    const left = requireGeometryNumber(settings['left'], `${label} display_settings.left`, false);
    const top = requireGeometryNumber(settings['top'], `${label} display_settings.top`, false);
    const width = requireGeometryNumber(settings['width'], `${label} display_settings.width`, true);
    const height = requireGeometryNumber(settings['height'], `${label} display_settings.height`, true);
    const fontSize = requireGeometryNumber(
        settings['fontSize'],
        `${label} display_settings.fontSize`,
        true,
    );
    const projected: IDisplaySettings = { left, top, width, height, fontSize };
    for (const key of ['fontFamily', 'backgroundColor'] as const) {
        const item = settings[key];
        if (item !== undefined) {
            if (typeof item !== 'string') {
                throw new ValidationError(`${label} display_settings.${key} must be a string`);
            }
            projected[key] = item;
        }
    }
    return projected;
}

function requireGeometryNumber(value: unknown, label: string, positive: boolean): number {
    if (
        typeof value !== 'number'
        || !Number.isFinite(value)
        || (positive ? value <= 0 : value < 0)
    ) {
        throw new ValidationError(`${label} must be a finite ${positive ? 'positive' : 'non-negative'} number`);
    }
    return value;
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
     *   "resource": "assignment",
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
     *       "display_settings": [],
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
     * {@link buildAssignmentPayload}. A `virtual` assignment may be created at
     * `uploaded`, `metadata_processing`, or `metadata_ready` and is promoted
     * automatically; `collect` requires rendered pages at `metadata_ready`.
     * `DigitalCertificate` costs two credits, requires the feature plus a
     * signer `government_id`, and that signer must be alone in its step.
     *
     * @param documentId - The document to request signatures on.
     * @param payload - Signers plus optional `method` (defaults to `virtual`),
     * `message`, `expires_at`, `copy_receivers` (existing signer IDs, not
     * addresses), and `collect`-mode `entries` with page-image geometry.
     * @returns The created {@link IAssignment}: `signers` (rich, with `step` /
     * `notified` / `verification_method`), `items` (one row per signer × field),
     * a `summary` count block, and per-signer `signing_urls`. Response shape:
     * ```jsonc
     * {
     *   "resource": "assignment",
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
     *       "display_settings": [],
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
     * @throws {ApiError} `400` for an invalid assignment or unmet verification
     * precondition; otherwise if the API rejects the request.
     *
     * @example
     * ```ts
     * const assignment = await client.assignments.create('doc-1', {
     *   signers: ['19e6b92e7895332ed9708535d8c'],
     *   message: 'Please sign this contract',
     * });
     * // → wire body: { method: 'virtual', signers: [{ id: '19e6…' }], message: 'Please sign this contract' }
     * console.log(assignment.signing_urls?.length); // one protected link per signer
     * ```
     */
    async create(
        documentId: string,
        payload: ICreateAssignmentPayload,
    ): Promise<ICreateAssignmentResponse> {
        const docId = this.requireId(documentId, 'Document ID');
        const body = buildAssignmentPayload(payload);
        const signers = extractSignerRefs(payload);
        this.logger.info('Creating assignment', {
            documentId: docId,
            signerCount: signers.length,
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
     * `DigitalCertificate` is priced at two credits per signer and remains
     * subject to the feature, identity, and one-signer-per-step requirements.
     * Current documented unit prices are 1 credit for an extra document, 0 for
     * email notification, and 0.45 for WhatsApp notification; a digital
     * certificate charge is added on top of its notification cost.
     *
     * @param documentId - The document the assignment would be created on.
     * @param payload - `method` plus channel-only signer descriptors and/or
     * `collect`-mode `entries`. Create-only fields and signer IDs are not part
     * of this request schema. `blocking_reason` may be `PendingPayment`,
     * `InsufficientDocuments`, or `InsufficientCredits`.
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
     * Sends `{ expires_at }` verbatim. Use an ISO-8601 date/time string; `null`
     * is retained as a compatibility value and, unlike ordinary nullable
     * inputs, is intentionally not stripped from the body.
     *
     * @param documentId - The document the assignment belongs to.
     * @param assignmentId - The assignment to update.
     * @param expiresAt - New expiry as an ISO-8601 date/time string. `null` is
     * a compatibility value intended to clear it.
     * @returns The updated {@link IAssignment} — the same full shape
     * {@link AssignmentResource.create} returns (`signers`, `items`, `summary`,
     * `signing_urls`), with `expires_at` reflecting the new value:
     * ```jsonc
     * {
     *   "id": "103033c9d2cec233bf65eea04999",
     *   "sender_email": "sender@example.com",
     *   "method": "virtual",
     *   "expires_at": "2027-12-31T23:59:59Z",
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
     * await client.assignments.resetExpiration('doc-1', 'asg-1', '2027-12-31T23:59:59Z');
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
        if (expiresAt !== null) assertDateTime(expiresAt, 'expiresAt');
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
     * @returns An {@link IResendCostEstimate}: either the full
     * {@link ICostEstimate} or the compact `total` /
     * `has_sufficient_credits` compatibility shape:
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
     * console.log(notifications.length);
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
