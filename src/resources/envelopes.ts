import type {
    DocumentArtifactName,
    IAddEnvelopeDocumentPayload,
    ICostEstimate,
    ICreateEnvelopePayload,
    IEnvelope,
    IEnvelopeActivity,
    IEnvelopeCancelResult,
    IEnvelopeDocumentInput,
    IEnvelopeListParams,
    IEnvelopeListResponse,
    IEnvelopeResendResponse,
    IListParams,
    IUpdateEnvelopePayload,
    PaginatedResult,
} from '../types';
import { ValidationError } from '../errors';
import {
    assertCreditCeiling,
    assertDocumentArtifactName,
    assertExpirationDate,
    assertNonEmptyString,
    assertRecord,
    cleanListParams,
    idempotencyConfig,
} from '../utils';
import { BaseResource } from './base';
import { normaliseAssignmentEntries, validateAssignmentSignerOptions } from './assignments';

/**
 * Envelopes send several documents to the same signers at once. Each document
 * keeps its own assignment, status, certificate, downloads and webhooks; each
 * signer receives one invitation for all of their documents, and the envelope
 * is charged as one document.
 *
 * Creating an envelope, adding a document and estimating the cost need the
 * Envelopes plan feature (`403 PlanRestricted`); every other route works for
 * every workspace. OAuth tokens need `documents:write` to change envelopes and
 * `documents:read` to read them.
 */
export class EnvelopeResource extends BaseResource {
    /**
     * List the workspace's envelopes, most recent first
     * (`GET /accounts/{accountId}/envelopes`).
     *
     * @param params - Optional filters and pagination.
     * @param params.search - Part of the envelope name.
     * @param params.status - `open` (a document is still open) or `closed`
     * (every document signed, declined, cancelled, expired or failed).
     * @param params.page - One-based page number.
     * @param params.per-page - Page size: 20 by default, at most 50.
     * @param accountId - Override the client's default account ID.
     * @returns Envelopes and pagination metadata:
     * ```jsonc
     * {
     *   "data": [{
     *     "id": "1052a1f0c3d4e5f6a7b8c9d0e1f2",
     *     "name": "Admission kit",
     *     "message": "Please sign the documents below.",
     *     "documents": [{
     *       "id": "1052a1e9b8c7d6e5f4a3b2c1d0e9",
     *       "position": 1,
     *       "name": "contract.pdf",
     *       "status": "pending_signature",
     *       "artifacts": {
     *         "original": "https://api.assinafy.com.br/v1/documents/1052a1e9b8c7d6e5f4a3b2c1d0e9/download/original",
     *         "thumbnail": "https://api.assinafy.com.br/v1/documents/1052a1e9b8c7d6e5f4a3b2c1d0e9/thumbnail"
     *       },
     *       "signers": [{
     *         "id": "1052a1d4c3b2a1f0e9d8c7b6a5f4",
     *         "full_name": "Ana Souza",
     *         "email": "ana@example.com",
     *         "whatsapp_phone_number": null,
     *         "completed": false,
     *         "signed_at": null
     *       }]
     *     }],
     *     "counts": { "pending_signature": 1 },   // documents per status; no envelope-level status
     *     "signing_urls": [{
     *       "signer_id": "1052a1d4c3b2a1f0e9d8c7b6a5f4",
     *       "url": "https://app.assinafy.com.br/sign/1052a1e9b8c7d6e5f4a3b2c1d0e9?email=ana%40example.com",
     *       "embedded": false
     *     }],
     *     "created_at": "2026-11-11T14:00:00Z"
     *   }],
     *   "meta": { "current_page": 1, "per_page": 20, "total": 1, "last_page": 1 }
     * }
     * ```
     * @throws {ValidationError} If no account ID is available.
     * @throws {ApiError} `400` for a filter of the wrong type, `403` for a token
     * without `documents:read`, `401` for invalid credentials.
     *
     * @example
     * ```ts
     * const { data: open } = await client.envelopes.list({ status: 'open' });
     * ```
     */
    async list(
        params: IEnvelopeListParams = {},
        accountId?: string,
    ): Promise<IEnvelopeListResponse> {
        assertRecord(params, 'envelope list params');
        if (params.status !== undefined && params.status !== 'open' && params.status !== 'closed') {
            throw new ValidationError('status must be open or closed');
        }
        return this.callList('Failed to list envelopes', () =>
            this.http.get(this.envelopesPath(accountId), { params: cleanListParams(params) }),
        );
    }

    /**
     * Read one envelope (`GET /accounts/{accountId}/envelopes/{envelopeId}`).
     *
     * @param envelopeId - Envelope ID.
     * @param accountId - Override the client's default account ID.
     * @returns The envelope: its documents in order (`position`), each with its
     * status and signers, the per-status `counts` and one `signing_urls` entry
     * per signer. Same shape as each item of {@link EnvelopeResource.list}.
     * @throws {ValidationError} If an ID is missing or invalid.
     * @throws {ApiError} `403` for a token without `documents:read`, `404` for an
     * unknown envelope.
     *
     * @example
     * ```ts
     * const envelope = await client.envelopes.get(envelopeId);
     * const pending = envelope.documents.filter((doc) => doc.status === 'pending_signature');
     * ```
     */
    async get(envelopeId: string, accountId?: string): Promise<IEnvelope> {
        return this.call('Failed to fetch envelope', () =>
            this.http.get(this.envelopePath(envelopeId, accountId)),
        );
    }

    /**
     * Send several documents to the same signers at once
     * (`POST /accounts/{accountId}/envelopes`).
     *
     * Every document must be uploaded, `metadata_ready` and unassigned; every
     * signer must be on at least one document. Signers all sign at once (no
     * `step`); a `DigitalCertificate` signer signs only `virtual` documents and
     * is alone on each. One invitation goes to each signer, and `200` means the
     * envelope exists even when a send fails (see each signer's
     * `notification_history`). The envelope is charged as one document, each
     * signer's notification and identity check once, and each certificate
     * signature on every document it is made on. A refused request creates and
     * charges nothing. Pass an `idempotencyKey` to retry safely after a lost
     * response; the SDK then also replays a `429`.
     *
     * @param payload - Envelope definition.
     * @param payload.name - 1–255 characters without `<`; invitations use it in
     * place of document names.
     * @param payload.message - Optional message for every signer.
     * @param payload.max_total_credits - Refuse with `409 CreditCeilingExceeded`
     * above this many credits.
     * @param payload.signers - 1–20 `{ id, verification_method?, notification_methods?, embedded? }`.
     * @param payload.documents - 1–20 `{ id, signer_ids, method?, entries?, expires_at?, copy_receiver_ids? }`,
     * in envelope order. `collect` documents need `entries` whose signers are
     * exactly `signer_ids`.
     * @param options - `idempotencyKey`: new for each envelope you mean to create.
     * @param accountId - Override the client's default account ID.
     * @returns The created envelope (see {@link EnvelopeResource.list}). An
     * embedded or WhatsApp-only signer has `url: null` in `signing_urls`.
     * @throws {ValidationError} If the payload is malformed, a signer's channels
     * do not pair, or a `collect` document has no `entries`.
     * @throws {ApiError} `400` with `fieldErrors` naming each field at fault, `403`
     * (`PlanRestricted` or `InsufficientScope`), `409` (`CreditCeilingExceeded`,
     * or `IdempotencyKeyInUse` while the first request with that key runs).
     *
     * @example
     * ```ts
     * const envelope = await client.envelopes.create({
     *   name: 'Admission kit',
     *   signers: [{ id: signerId }],
     *   documents: [
     *     { id: contractId, signer_ids: [signerId] },
     *     { id: policyId, signer_ids: [signerId], expires_at: '2026-12-31' },
     *   ],
     * }, { idempotencyKey: crypto.randomUUID() });
     * ```
     */
    async create(
        payload: ICreateEnvelopePayload,
        options: { idempotencyKey?: string } = {},
        accountId?: string,
    ): Promise<IEnvelope> {
        const body = buildEnvelopePayload(payload);
        assertRecord(options, 'envelope options');
        const config = idempotencyConfig(options.idempotencyKey);
        this.logger.info('Creating envelope', {
            signerCount: (body['signers'] as unknown[]).length,
            documentCount: (body['documents'] as unknown[]).length,
        });
        return this.call('Failed to create envelope', () =>
            this.http.post(this.envelopesPath(accountId), body, config),
        );
    }

    /**
     * Estimate what creating an envelope would cost
     * (`POST /accounts/{accountId}/envelopes/estimate-cost`).
     *
     * Takes the creation body and checks it the same way, creating and charging
     * nothing; `max_total_credits` is ignored. The envelope counts as one
     * document, each signer's notification and identity check once, and each
     * certificate signature per document.
     *
     * @param payload - The body {@link EnvelopeResource.create} would send.
     * @param accountId - Override the client's default account ID.
     * @returns A cost estimate:
     * ```jsonc
     * {
     *   "documents": 1,
     *   "credits": 1.45,
     *   "needs_extra_document": false,
     *   "extra_document_cost": 1,
     *   "total_credits": 1.45,
     *   "breakdown": [
     *     { "code": "NotificationWhatsapp", "name": "WhatsApp notification", "cost": 0.45, "quantity": 1, "unit_cost": 0.45 },
     *     { "code": "SignatureDigitalCertificate", "name": "Digital certificate signature", "cost": 1, "quantity": 2, "unit_cost": 0.5 }
     *   ],
     *   "document_balance": 97,        // null when documents are not limited
     *   "credit_balance": 10,          // null when credits are not limited
     *   "has_sufficient_resources": true,
     *   "blocking_reason": null,
     *   "message": null
     * }
     * ```
     * @throws {ValidationError} If the payload is malformed or a signer's channels do not pair.
     * @throws {ApiError} `400` for fields at fault, `403` (`PlanRestricted` or
     * `InsufficientScope`).
     *
     * @example
     * ```ts
     * const estimate = await client.envelopes.estimateCost(envelopeBody);
     * if (!estimate.has_sufficient_resources) console.warn(estimate.blocking_reason);
     * ```
     */
    async estimateCost(payload: ICreateEnvelopePayload, accountId?: string): Promise<ICostEstimate> {
        const body = buildEnvelopePayload(payload);
        return this.call('Failed to estimate envelope cost', () =>
            this.http.post(`${this.envelopesPath(accountId)}/estimate-cost`, body),
        );
    }

    /**
     * Rename an envelope, change its message or reorder its documents
     * (`PATCH /accounts/{accountId}/envelopes/{envelopeId}`).
     *
     * Send only what changes. Nothing is sent to anyone; later reminders,
     * cancellations and additions use the new values. Works on closed envelopes.
     *
     * @param envelopeId - Envelope ID.
     * @param payload - At least one change.
     * @param payload.name - 1–255 characters without `<`.
     * @param payload.message - New message, or `null` for none.
     * @param payload.document_ids - Every document of the envelope, each once, in the new order.
     * @param accountId - Override the client's default account ID.
     * @returns The updated envelope (see {@link EnvelopeResource.list}).
     * @throws {ValidationError} If nothing would change or a value is malformed.
     * @throws {ApiError} `400` for fields at fault, `403` for a token without
     * `documents:write`, `404` for an unknown envelope.
     *
     * @example
     * ```ts
     * await client.envelopes.update(envelopeId, { name: 'Admission kit 2026', message: null });
     * ```
     */
    async update(
        envelopeId: string,
        payload: IUpdateEnvelopePayload,
        accountId?: string,
    ): Promise<IEnvelope> {
        const body = buildUpdatePayload(payload);
        return this.call('Failed to update envelope', () =>
            this.http.patch(this.envelopePath(envelopeId, accountId), body),
        );
    }

    /**
     * Delete a closed envelope (`DELETE /accounts/{accountId}/envelopes/{envelopeId}`).
     *
     * Allowed once every document is certificated, declined, cancelled, expired
     * or failed; cancel it first otherwise. Its documents remain as ordinary
     * documents, and its `Idempotency-Key` no longer answers it.
     *
     * @param envelopeId - Envelope ID.
     * @param accountId - Override the client's default account ID.
     * @throws {ValidationError} If an ID is missing or invalid.
     * @throws {ApiError} `403` for a token without `documents:write`, `404` for an
     * unknown envelope, `409` (`EnvelopeOpen`) while a document is still open.
     *
     * @example
     * ```ts
     * await client.envelopes.cancel(envelopeId);
     * await client.envelopes.delete(envelopeId);
     * ```
     */
    async delete(envelopeId: string, accountId?: string): Promise<void> {
        return this.callVoid('Failed to delete envelope', () =>
            this.http.delete(this.envelopePath(envelopeId, accountId)),
        );
    }

    /**
     * Cancel every document that can still be cancelled
     * (`PUT /accounts/{accountId}/envelopes/{envelopeId}/cancel`).
     *
     * Each owner, signer and copy receiver is told once for the whole envelope.
     * Documents already closed, fully signed or being certificated are left as
     * they are. Safe to repeat: a second call cancels nothing.
     *
     * @param envelopeId - Envelope ID.
     * @param accountId - Override the client's default account ID.
     * @returns What happened to each document:
     * ```jsonc
     * [
     *   { "id": "1052a1e9b8c7d6e5f4a3b2c1d0e9", "status": "cancelled", "cancelled": true },
     *   { "id": "1052a1eaf9e8d7c6b5a4f3e2d1c0", "status": "certificated", "cancelled": false }
     * ]
     * ```
     * @throws {ValidationError} If an ID is missing or invalid.
     * @throws {ApiError} `403` for a token without `documents:write`, `404` for an
     * unknown envelope.
     *
     * @example
     * ```ts
     * const results = await client.envelopes.cancel(envelopeId);
     * ```
     */
    async cancel(envelopeId: string, accountId?: string): Promise<IEnvelopeCancelResult[]> {
        return this.call('Failed to cancel envelope', () =>
            this.http.put(`${this.envelopePath(envelopeId, accountId)}/cancel`),
        );
    }

    /**
     * Read the envelope's activity trail, newest first
     * (`GET /accounts/{accountId}/envelopes/{envelopeId}/activities`).
     *
     * Includes every document the envelope has had, including ones taken out;
     * each entry is a document activity that also names its document.
     *
     * @param envelopeId - Envelope ID.
     * @param params - `sort` (`-id`, the default, or `id` for oldest first),
     * `page`, and `per-page` (20 by default, at most 50).
     * @param accountId - Override the client's default account ID.
     * @returns Activity entries and pagination metadata:
     * ```jsonc
     * {
     *   "data": [{
     *     "id": 7731204,
     *     "event": "signer_signed_document",
     *     "message": "Ana Souza signed the document",
     *     "payload": { "signer": { "id": "1052a1d4c3b2a1f0e9d8c7b6a5f4" } },  // same keys as that event's webhook
     *     "origin": { "ip": "203.0.113.10", "user-agent": "Mozilla/5.0" },
     *     "document_id": "1052a1e9b8c7d6e5f4a3b2c1d0e9",
     *     "document_name": "contract.pdf",
     *     "created_at": "2026-11-11T14:05:00Z"
     *   }],
     *   "meta": { "current_page": 1, "per_page": 20, "total": 1, "last_page": 1 }
     * }
     * ```
     * @throws {ValidationError} If an ID is missing or invalid.
     * @throws {ApiError} `403` for a token without `documents:read`, `404` for an
     * unknown envelope.
     *
     * @example
     * ```ts
     * const { data } = await client.envelopes.listActivities(envelopeId, { sort: 'id' });
     * ```
     */
    async listActivities(
        envelopeId: string,
        params: IListParams = {},
        accountId?: string,
    ): Promise<PaginatedResult<IEnvelopeActivity>> {
        return this.callList('Failed to fetch envelope activities', () =>
            this.http.get(`${this.envelopePath(envelopeId, accountId)}/activities`, {
                params: cleanListParams(params),
            }),
        );
    }

    /**
     * Download one artifact of every document as a zip
     * (`GET /accounts/{accountId}/envelopes/{envelopeId}/download/{artifactName}`).
     *
     * Files are named after their position (`1 - contract.pdf`); `bundle` gives
     * each document a folder. `certificated`, `certificate-page`, `pades` and
     * `bundle` include only the documents certified so far.
     *
     * @param envelopeId - Envelope ID.
     * @param artifactName - `original`, `certificated`, `certificate-page`, `pades` or `bundle`.
     * @param accountId - Override the client's default account ID.
     * @returns The zip archive bytes.
     * @throws {ValidationError} If an ID or the artifact name is invalid.
     * @throws {ApiError} `403` for a token without `documents:read`, `404` when no
     * document has the artifact.
     *
     * @example
     * ```ts
     * import { writeFile } from 'node:fs/promises';
     * await writeFile('envelope.zip', await client.envelopes.download(envelopeId, 'certificated'));
     * ```
     */
    async download(
        envelopeId: string,
        artifactName: DocumentArtifactName,
        accountId?: string,
    ): Promise<Buffer> {
        assertDocumentArtifactName(artifactName);
        return this.callBinary('Failed to download envelope artifacts', () =>
            this.http.get<ArrayBuffer>(
                `${this.envelopePath(envelopeId, accountId)}/download/${this.pathSegment(artifactName, 'Artifact name')}`,
                { responseType: 'arraybuffer' },
            ),
        );
    }

    /**
     * Add a document to an open envelope for some of its signers
     * (`POST /accounts/{accountId}/envelopes/{envelopeId}/documents`).
     *
     * The document is checked as on creation and goes last. Only its
     * certificate signatures are charged; the chosen signers receive the
     * envelope invitation again, now listing it. No new signer can join, and an
     * envelope holds at most 20 documents.
     *
     * @param envelopeId - Envelope ID.
     * @param payload - `{ id, signer_ids, method?, entries?, expires_at?, copy_receiver_ids?, max_total_credits? }`.
     * @param accountId - Override the client's default account ID.
     * @returns The updated envelope (see {@link EnvelopeResource.list}).
     * @throws {ValidationError} If the document definition is malformed.
     * @throws {ApiError} `400` for fields at fault, `403` (`PlanRestricted` or
     * `InsufficientScope`), `409` (`EnvelopeClosed`, `CreditCeilingExceeded`).
     *
     * @example
     * ```ts
     * await client.envelopes.addDocument(envelopeId, { id: annexId, signer_ids: [signerId] });
     * ```
     */
    async addDocument(
        envelopeId: string,
        payload: IAddEnvelopeDocumentPayload,
        accountId?: string,
    ): Promise<IEnvelope> {
        const body = buildEnvelopeDocument(payload, 'document');
        assertCreditCeiling(payload.max_total_credits);
        if (payload.max_total_credits !== undefined) body['max_total_credits'] = payload.max_total_credits;
        return this.call('Failed to add document to envelope', () =>
            this.http.post(`${this.envelopePath(envelopeId, accountId)}/documents`, body),
        );
    }

    /**
     * Take an open document out of the envelope
     * (`DELETE /accounts/{accountId}/envelopes/{envelopeId}/documents/{documentId}`).
     *
     * The document is cancelled and its people are told; the other documents
     * carry on, and links sent from it keep opening them.
     *
     * @param envelopeId - Envelope ID.
     * @param documentId - Document to take out.
     * @param accountId - Override the client's default account ID.
     * @returns The updated envelope (see {@link EnvelopeResource.list}).
     * @throws {ValidationError} If an ID is missing or invalid.
     * @throws {ApiError} `403` for a token without `documents:write`, `404` when the
     * document is not in the envelope, `409` (`DocumentClosed`) when it can no
     * longer be cancelled.
     *
     * @example
     * ```ts
     * await client.envelopes.removeDocument(envelopeId, documentId);
     * ```
     */
    async removeDocument(
        envelopeId: string,
        documentId: string,
        accountId?: string,
    ): Promise<IEnvelope> {
        return this.call('Failed to remove document from envelope', () =>
            this.http.delete(
                `${this.envelopePath(envelopeId, accountId)}/documents/${this.pathSegment(documentId, 'Document ID')}`,
            ),
        );
    }

    /**
     * Remind a signer of the whole envelope
     * (`PUT /accounts/{accountId}/envelopes/{envelopeId}/signers/{signerId}/resend`).
     *
     * One message from their first link, listing the documents still to sign;
     * paid channels are charged once. A document's own reminder
     * (`assignments.resendNotification`) still goes per document.
     *
     * @param envelopeId - Envelope ID.
     * @param signerId - Signer of the envelope.
     * @param accountId - Override the client's default account ID.
     * @returns Delivery acknowledgement:
     * ```jsonc
     * { "is_sent": true, "envelope_id": "1052a1f0c3d4e5f6a7b8c9d0e1f2", "signer_id": "1052a1d4c3b2a1f0e9d8c7b6a5f4" }
     * ```
     * @throws {ValidationError} If an ID is missing or invalid.
     * @throws {ApiError} `400` when the signer has nothing left to sign or credits
     * are short, `404` when the signer is not on the envelope, `409`
     * (`EnvelopeClosed`).
     *
     * @example
     * ```ts
     * await client.envelopes.resendNotification(envelopeId, signerId);
     * ```
     */
    async resendNotification(
        envelopeId: string,
        signerId: string,
        accountId?: string,
    ): Promise<IEnvelopeResendResponse> {
        return this.call('Failed to remind envelope signer', () =>
            this.http.put(
                `${this.envelopePath(envelopeId, accountId)}/signers/${this.pathSegment(signerId, 'Signer ID')}/resend`,
            ),
        );
    }

    private envelopesPath(accountId?: string): string {
        return `/accounts/${this.pathSegment(this.accountId(accountId), 'Account ID')}/envelopes`;
    }

    private envelopePath(envelopeId: string, accountId?: string): string {
        return `${this.envelopesPath(accountId)}/${this.pathSegment(envelopeId, 'Envelope ID')}`;
    }
}

/**
 * Build the create/estimate body. Beyond these shapes and the shared channel
 * rules, the API refuses a broken envelope rule itself, creating and charging
 * nothing, and names each field in `ApiError.fieldErrors`.
 */
function buildEnvelopePayload(payload: ICreateEnvelopePayload): Record<string, unknown> {
    assertRecord(payload, 'envelope payload');
    assertNonEmptyString(payload.name, 'name');
    assertMessage(payload.message);
    assertCreditCeiling(payload.max_total_credits);
    const signers = records(payload.signers, 'signers').map((signer, index) => {
        const label = `signers[${index}]`;
        assertNonEmptyString(signer['id'], `${label}.id`);
        validateAssignmentSignerOptions(signer, label);
        const projected: Record<string, unknown> = { id: signer['id'] };
        // `step` is forwarded so the API refuses it (envelope signers sign at once)
        // rather than the SDK dropping it and inviting everyone together.
        for (const key of ['verification_method', 'notification_methods', 'embedded', 'step'] as const) {
            if (signer[key] !== undefined) projected[key] = signer[key];
        }
        return projected;
    });
    const documents = records(payload.documents, 'documents')
        .map((document, index) => buildEnvelopeDocument(document, `documents[${index}]`));

    const body: Record<string, unknown> = { name: payload.name, signers, documents };
    if (payload.message !== undefined) body['message'] = payload.message;
    if (payload.max_total_credits !== undefined) body['max_total_credits'] = payload.max_total_credits;
    return body;
}

/** Project one envelope document (creation or `addDocument`). */
function buildEnvelopeDocument(document: unknown, label: string): Record<string, unknown> {
    assertRecord(document, label);
    const input = document as Partial<IEnvelopeDocumentInput>;
    assertNonEmptyString(input.id, `${label}.id`);
    const method = input.method ?? 'virtual';
    if (method !== 'virtual' && method !== 'collect') {
        throw new ValidationError(`${label}.method must be virtual or collect`);
    }
    const entries = input.entries === undefined ? undefined : normaliseAssignmentEntries(input.entries);
    if (method === 'collect' && !entries?.length) {
        throw new ValidationError(`${label}.entries is required for collect documents`);
    }
    if (input.expires_at !== undefined && input.expires_at !== null) {
        assertExpirationDate(input.expires_at, `${label}.expires_at`);
    }

    const projected: Record<string, unknown> = {
        id: input.id,
        method,
        signer_ids: idList(input.signer_ids, `${label}.signer_ids`),
    };
    if (entries !== undefined) projected['entries'] = entries;
    if (input.expires_at !== undefined) projected['expires_at'] = input.expires_at;
    if (input.copy_receiver_ids !== undefined) {
        projected['copy_receiver_ids'] = idList(input.copy_receiver_ids, `${label}.copy_receiver_ids`);
    }
    return projected;
}

function buildUpdatePayload(payload: IUpdateEnvelopePayload): Record<string, unknown> {
    assertRecord(payload, 'envelope update');
    const body: Record<string, unknown> = {};
    if (payload.name !== undefined) {
        assertNonEmptyString(payload.name, 'name');
        body['name'] = payload.name;
    }
    if (payload.message !== undefined) {
        assertMessage(payload.message);
        body['message'] = payload.message;
    }
    if (payload.document_ids !== undefined) {
        body['document_ids'] = idList(payload.document_ids, 'document_ids');
    }
    if (Object.keys(body).length === 0) {
        throw new ValidationError('envelope update must change name, message or document_ids');
    }
    return body;
}

function assertMessage(message: unknown): void {
    if (message !== undefined && message !== null && typeof message !== 'string') {
        throw new ValidationError('message must be a string or null');
    }
}

function records(value: unknown, label: string): Array<Record<string, unknown>> {
    if (!Array.isArray(value)) throw new ValidationError(`${label} must be an array`);
    value.forEach((item, index) => assertRecord(item, `${label}[${index}]`));
    return value as Array<Record<string, unknown>>;
}

function idList(value: unknown, label: string): string[] {
    if (!Array.isArray(value) || value.some((id) => typeof id !== 'string' || !id.trim())) {
        throw new ValidationError(`${label} must be an array of IDs`);
    }
    return [...(value as string[])];
}
