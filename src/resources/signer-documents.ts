import type { AxiosInstance } from 'axios';
import type {
    IAccountTheme,
    IAcceptTermsResult,
    ICertifiedCopyResendResult,
    IDocumentListItem,
    IDocumentListResponse,
    IConfirmSignerDataPayload,
    ILegacyUploadSignatureOptions,
    ISignerDocumentListParams,
    ISigningDocument,
    ISigningReadOptions,
    ISignFieldEntry,
    ISigner,
    ISignerSelf,
    ISignerIdentityVerification,
    ISignerIdentityVerificationSession,
    IStartIdentityVerificationPayload,
    IUploadSignatureOptions,
    Logger,
    SignatureImageType,
} from '../types';
import { ValidationError } from '../errors';
import {
    assertRecord,
    cleanListParams,
    cleanParams,
    expandParam,
    isE164PhoneNumber,
    isEmail,
} from '../utils';
import { BaseResource } from './base';
import { withoutCredentials } from '../support/transport';

/**
 * Signer-side endpoints for custom signing UIs. Calls authenticate with
 * `signer-access-code` (from the link e-mailed or WhatsApp'd to the signer) on a
 * credential-free transport, never the workspace API key; the certified-copy
 * link routes use the link's token instead. Only the explicit `*AsWorkspace`
 * methods use the workspace credentials, and they never send a code.
 */
export class SignerDocumentsResource extends BaseResource {
    constructor(
        http: AxiosInstance,
        defaultAccountId?: string,
        logger?: Logger,
        publicHttp?: AxiosInstance,
    ) {
        super(withoutCredentials(publicHttp ?? http), defaultAccountId, logger);
        this.workspaceHttp = http;
    }

    /**
     * Credentialed transport used only by the explicit `*AsWorkspace` methods.
     * Every access-code method stays on the credential-free `http`, so a
     * signer code and the API key or bearer token never share a request.
     */
    private readonly workspaceHttp: AxiosInstance;

    /**
     * Fetch the document currently awaiting a given signer
     * (`GET /signers/{signer_id}/document?signer-access-code=…`).
     *
     * The signer-side counterpart of {@link DocumentResource.details}, authorised
     * by the signer's access code rather than the workspace API key. Unlike
     * {@link SignerDocumentsResource.getAssignment} it does not record a view and
     * answers before a certificate or identity-check signer confirms their data,
     * so a link learns its envelope here.
     *
     * @param signerId - The signer whose current document is fetched.
     * @param signerAccessCode - The signer's access code, from their signing link.
     * @param options - `expand: ['envelope']` adds the code's envelope (`{ id, name }`, or `null`).
     * @returns The {@link ISigningDocument}. Once the code is closed (30 minutes
     * after the signer is done) only `id`, `name`, `status`, `current_signer`,
     * `certified_copy` and `envelope` remain, with `is_signer_access_closed: true`:
     * ```jsonc
     * {
     *   "resource": "document",
     *   "id": "103acccd24234c07858ffddf6d84",
     *   "account_id": "acc_example",
     *   "template_id": null,
     *   "name": "Service agreement.pdf",
     *   "status": "pending_signature",
     *   "artifacts": {
     *     "original": "https://api.assinafy.com.br/v1/documents/103acccd.../download/original",
     *     "thumbnail": "https://api.assinafy.com.br/v1/documents/103acccd.../thumbnail"
     *   },
     *   "is_closed": false,
     *   "signing_url": "https://app.assinafy.com.br/sign/103acccd...",
     *   "decline_reason": null,
     *   "declined_by": null,
     *   "tags": [],
     *   "assignment": null,          // an IAssignment once signing has started
     *   "pages": [
     *     { "id": "103acccd5c73...", "number": 1, "height": 1651, "width": 1275,
     *       "download_url": "https://api.assinafy.com.br/v1/documents/103acccd.../pages/103acccd5c73.../download" }
     *   ],
     *   "current_signer": {
     *     "id": "19e6b92e7895332ed9708535d8c",
     *     "full_name": "Example Signer",
     *     "email": "signer@example.com",
     *     "verification_method": "Email",
     *     "notification_methods": ["Email"],
     *     "completed": false
     *   },
     *   "is_signer_access_closed": false,
     *   "certified_copy": { "available": false, "notification_method": "Email", "resends_left": null },
     *   "envelope": { "id": "1052a1f0c3d4e5f6a7b8c9d0e1f2", "name": "Admission kit" },  // with expand
     *   "created_at": "2026-07-19T14:56:54Z",
     *   "updated_at": "2026-07-19T14:56:56Z"
     * }
     * ```
     * @throws {ValidationError} If `signerId` or `signerAccessCode` is missing.
     * @throws {ApiError} `400` while the signer's step has not started, `401` for an
     * invalid code, `404` for an unknown signer.
     *
     * @example
     * ```ts
     * const doc = await client.signerDocuments.getCurrent(signerId, accessCode, { expand: ['envelope'] });
     * if (doc.is_signer_access_closed) console.log(doc.certified_copy.available);
     * ```
     */
    async getCurrent(
        signerId: string,
        signerAccessCode: string,
        options: Pick<ISigningReadOptions, 'expand'> = {},
    ): Promise<ISigningDocument> {
        const sid = this.requireId(signerId, 'Signer ID');
        const code = this.requireId(signerAccessCode, 'signer-access-code');
        return this.call('Failed to fetch current signer document', () =>
            this.http.get(`/signers/${this.pathSegment(sid, 'Signer ID')}/document`, {
                params: { 'signer-access-code': code, ...signingReadParams(options) },
            }),
        );
    }

    /**
     * List every document awaiting a given signer
     * (`GET /signers/{signer_id}/documents?signer-access-code=…`).
     *
     * The signer-side counterpart of {@link DocumentResource.list}, scoped to one
     * signer and authorised by their access code. Pagination is read from the
     * `X-Pagination-*` response headers and attached in `meta`; the API honours
     * `page` and `per-page` (the SDK normalises `per_page` → `per-page`).
     *
     * @param signerId - The signer whose documents are listed.
     * @param signerAccessCode - The signer's access code, from their signing link.
     * @param params - `envelope_id` (only that envelope's documents) and pagination:
     * `page`, `per-page` (also accepts `per_page`).
     * @returns Matching documents with pagination in `meta`. Each carries its
     * `assignment` (without `signing_urls` when read with a code) and `pages`:
     * ```jsonc
     * {
     *   "data": [
     *     {
     *       "id": "103acccd24234c07858ffddf6d84",
     *       "account_id": "acc_example",
     *       "template_id": null,
     *       "name": "Service agreement.pdf",
     *       "status": "pending_signature",
     *       "artifacts": { "original": "https://...", "thumbnail": "https://..." },
     *       "is_closed": false,
     *       "signing_url": "https://app.assinafy.com.br/sign/103acccd...",
     *       "decline_reason": null,
     *       "declined_by": null,
     *       "tags": [],
     *       "created_at": "2026-07-19T14:56:54Z",
     *       "updated_at": "2026-07-19T14:56:56Z"
     *     }
     *   ],
     *   "meta": { "current_page": 1, "per_page": 20, "total": 1, "last_page": 1 }
     * }
     * ```
     * @throws {ValidationError} If `signerId` or `signerAccessCode` is missing.
     * @throws {ApiError} `400` for a non-text `envelope_id` or a pending step,
     * `403` for another signer's code, `410` once the code is closed.
     *
     * @example
     * ```ts
     * const { data, meta } = await client.signerDocuments.list(signerId, accessCode, {
     *   envelope_id: envelopeId,
     *   'per-page': 20,
     * });
     * ```
     */
    async list(
        signerId: string,
        signerAccessCode: string,
        params: ISignerDocumentListParams = {},
    ): Promise<IDocumentListResponse> {
        const sid = this.requireId(signerId, 'Signer ID');
        const code = this.requireId(signerAccessCode, 'signer-access-code');
        return this.callList<IDocumentListItem>('Failed to list signer documents', () =>
            this.http.get(`/signers/${this.pathSegment(sid, 'Signer ID')}/documents`, {
                params: { ...cleanListParams(params), 'signer-access-code': code },
            }),
        );
    }

    /**
     * Search the documents awaiting a given signer
     * (`GET /signers/{signer_id}/documents/search?signer-access-code=…`).
     *
     * The signer-side counterpart of {@link DocumentResource.search}, scoped to
     * one signer and authorised by their access code rather than the API key.
     * Like {@link SignerDocumentsResource.list}, it requires the
     * `signer-access-code` query parameter.
     *
     * @param signerId - The signer whose documents are searched.
     * @param signerAccessCode - The signer's access code, from their signing link.
     * @param search - Free-text term matched against the document name.
     * @param params - `envelope_id`: only that envelope's documents.
     * @returns Matching documents for that signer, with pagination in `meta`:
     * ```jsonc
     * {
     *   "data": [
     *     {
     *       "id": "103acccd24234c07858ffddf6d84",
     *       "account_id": "acc_example",
     *       "template_id": null,
     *       "name": "Service agreement.pdf",
     *       "status": "pending_signature",
     *       "artifacts": { "original": "https://...", "thumbnail": "https://..." },
     *       "is_closed": false,
     *       "signing_url": "https://app.assinafy.com.br/sign/103acccd...",
     *       "decline_reason": null,
     *       "declined_by": null,
     *       "tags": [],
     *       "created_at": "2026-07-19T14:56:54Z",
     *       "updated_at": "2026-07-19T14:56:56Z"
     *     }
     *   ],
     *   "meta": { "current_page": 1, "per_page": 20, "total": 1, "last_page": 1 }
     * }
     * ```
     * @throws {ValidationError} If `signerId` or `signerAccessCode` is missing.
     * @throws {ApiError} `400`, `403` or `410`, as for {@link SignerDocumentsResource.list}.
     *
     * @example
     * ```ts
     * const { data } = await client.signerDocuments.search(
     *   signerId,
     *   accessCode,
     *   'agreement',
     * );
     * ```
     */
    async search(
        signerId: string,
        signerAccessCode: string,
        search?: string,
        params: Pick<ISignerDocumentListParams, 'envelope_id'> = {},
    ): Promise<IDocumentListResponse> {
        const sid = this.requireId(signerId, 'Signer ID');
        const code = this.requireId(signerAccessCode, 'signer-access-code');
        return this.callList<IDocumentListItem>('Failed to search signer documents', () =>
            this.http.get(`/signers/${this.pathSegment(sid, 'Signer ID')}/documents/search`, {
                params: { 'signer-access-code': code, ...searchParams(search, params) },
            }),
        );
    }

    /**
     * List a signer's documents with the workspace credentials
     * (`GET /signers/{signer_id}/documents`).
     *
     * The same operation as {@link SignerDocumentsResource.list}, authorised by
     * the client's API key or OAuth bearer token instead of a signer access
     * code. No `signer-access-code` is sent.
     *
     * @param signerId - The signer whose documents are listed.
     * @param params - `envelope_id` and pagination: `page`, `per-page` (also accepts `per_page`).
     * @returns Documents in the {@link IDocumentListItem} shape, with
     * pagination in `meta` (same shape as {@link SignerDocumentsResource.list}):
     * ```jsonc
     * {
     *   "data": [{ "id": "103acccd24234c07858ffddf6d84", "name": "Service agreement.pdf", "status": "pending_signature" }],
     *   "meta": { "current_page": 1, "per_page": 20, "total": 1, "last_page": 1 }
     * }
     * ```
     * @throws {ValidationError} If `signerId` is missing.
     * @throws {ApiError} `401` if the workspace credentials are rejected, `403` when a
     * role or OAuth scope refuses it, `404` for a signer outside the workspace.
     *
     * @example
     * ```ts
     * const { data } = await client.signerDocuments.listAsWorkspace(signerId, { page: 1 });
     * ```
     */
    async listAsWorkspace(
        signerId: string,
        params: ISignerDocumentListParams = {},
    ): Promise<IDocumentListResponse> {
        const sid = this.pathSegment(signerId, 'Signer ID');
        const query = cleanListParams(params);
        // Never let a signer code ride the credentialed transport.
        delete query['signer-access-code'];
        return this.callList<IDocumentListItem>('Failed to list signer documents', () =>
            this.workspaceHttp.get(`/signers/${sid}/documents`, { params: query }),
        );
    }

    /**
     * Search a signer's documents with the workspace credentials
     * (`GET /signers/{signer_id}/documents/search`).
     *
     * The same operation as {@link SignerDocumentsResource.search}, authorised
     * by the client's API key or OAuth bearer token instead of a signer access
     * code. No `signer-access-code` is sent.
     *
     * @param signerId - The signer whose documents are searched.
     * @param search - Free-text term matched against the document name.
     * @param params - `envelope_id`: only that envelope's documents.
     * @returns Matching documents with pagination in `meta`, as
     * {@link SignerDocumentsResource.listAsWorkspace} returns.
     * @throws {ValidationError} If `signerId` is missing or `search` is not a string.
     * @throws {ApiError} `401`, `403` or `404`, as for {@link SignerDocumentsResource.listAsWorkspace}.
     *
     * @example
     * ```ts
     * const { data } = await client.signerDocuments.searchAsWorkspace(signerId, 'agreement');
     * ```
     */
    async searchAsWorkspace(
        signerId: string,
        search?: string,
        params: Pick<ISignerDocumentListParams, 'envelope_id'> = {},
    ): Promise<IDocumentListResponse> {
        const sid = this.pathSegment(signerId, 'Signer ID');
        return this.callList<IDocumentListItem>('Failed to search signer documents', () =>
            this.workspaceHttp.get(`/signers/${sid}/documents/search`, {
                params: searchParams(search, params),
            }),
        );
    }

    /**
     * Download the original PDF a signer is asked to sign
     * (`GET /signers/{signer_id}/documents/{document_id}/download/original`).
     *
     * Only `original` is available with an access code; the certified copy is
     * sent to the signer instead (see {@link SignerDocumentsResource.resendCertifiedCopy}).
     * The API redirects a request it cannot serve to its expired-link page, so
     * the SDK does not follow redirects here: that case throws instead of
     * returning the page's HTML.
     *
     * @param signerId - The signer requesting the download.
     * @param documentId - The document to download.
     * @param artifactName - `original`, the only artifact a signer can download.
     * @param signerAccessCode - The signer's access code, from their signing link.
     * @returns The PDF bytes as a Node `Buffer`.
     * @throws {ValidationError} If an ID or the code is missing, or the artifact is not `original`.
     * @throws {ApiError} `302` when the code is missing or closed, `400` while the
     * signer's step has not started, `403` for another artifact, `404` for a
     * document the code does not reach, `410` once the code is closed.
     *
     * @example
     * ```ts
     * const pdf = await client.signerDocuments.download(
     *   signerId,
     *   documentId,
     *   'original',
     *   accessCode,
     * );
     * await fs.promises.writeFile('to-sign.pdf', pdf);
     * ```
     */
    async download(
        signerId: string,
        documentId: string,
        artifactName: 'original',
        signerAccessCode: string,
    ): Promise<Buffer> {
        const sid = this.requireId(signerId, 'Signer ID');
        const did = this.requireId(documentId, 'Document ID');
        if (artifactName !== 'original') {
            throw new ValidationError('A signer can download only the original artifact');
        }
        const code = this.requireId(signerAccessCode, 'signer-access-code');
        return this.callBinary('Failed to download signer document', () =>
            this.http.get<ArrayBuffer>(
                `/signers/${this.pathSegment(sid, 'Signer ID')}/documents/${this.pathSegment(did, 'Document ID')}/download/original`,
                { ...BINARY_NO_REDIRECT, params: { 'signer-access-code': code } },
            ),
        );
    }

    /**
     * Sign several documents in one call
     * (`PUT /signers/documents/sign-multiple?signer-access-code=…`).
     *
     * Batch shortcut for a signer who has multiple pending documents under the
     * same access code — it signs each with their stored signature/initials
     * rather than field-by-field (contrast {@link SignerDocumentsResource.sign}).
     * Every document must use the `virtual` assignment method.
     * The `document_ids` array goes in the request body; the access code
     * authenticates via the `signer-access-code` query param.
     *
     * Request body (`application/json`):
     * ```jsonc
     * {
     *   "document_ids": [
     *     "document_example"
     *   ]
     * }
     * ```
     *
     * @param documentIds - Non-empty array of document IDs to sign.
     * @param signerAccessCode - The signer's access code, from their signing link.
     * @returns Resolves when the API acknowledges the operation. The documented
     *   empty-array response data is intentionally discarded.
     * @throws {ValidationError} If `documentIds` is empty/not an array, or
     *   `signerAccessCode` is missing.
     * @throws {ApiError} If the access code is invalid/expired or a document is
     *   not in a signable state.
     *
     * @example
     * ```ts
     * // body → { document_ids: ['103acccd...', '103aa251...'] }
     * await client.signerDocuments.signMultiple(
     *   ['103acccd24234c07858ffddf6d84', '103aa251ccb4ee136e3fd5cc140b'],
     *   accessCode,
     * );
     * ```
     */
    async signMultiple(documentIds: string[], signerAccessCode: string): Promise<void> {
        assertDocumentIds(documentIds);
        const code = this.requireId(signerAccessCode, 'signer-access-code');
        return this.callVoid('Failed to sign multiple documents', () =>
            this.http.put(
                '/signers/documents/sign-multiple',
                { document_ids: documentIds },
                { params: { 'signer-access-code': code } },
            ),
        );
    }

    /**
     * Decline several documents in one call
     * (`PUT /signers/documents/decline-multiple?signer-access-code=…`).
     *
     * The batch counterpart of {@link SignerDocumentsResource.signMultiple}: the
     * same `decline_reason` is recorded against every document in `documentIds`.
     * Both `document_ids` and `decline_reason` go in the request body; the access
     * code authenticates via the `signer-access-code` query param.
     *
     * Request body (`application/json`):
     * ```jsonc
     * {
     *   "document_ids": [
     *     "document_example"
     *   ],
     *   "decline_reason": "The document needs a correction."
     * }
     * ```
     *
     * @param documentIds - Non-empty array of document IDs to decline.
     * @param declineReason - Free-text reason shown to the sender (required).
     * @param signerAccessCode - The signer's access code, from their signing link.
     * @returns Resolves when the API acknowledges the operation. The documented
     *   empty-array response data is intentionally discarded.
     * @throws {ValidationError} If `documentIds` is empty/not an array,
     *   `declineReason` is empty, or `signerAccessCode` is missing.
     * @throws {ApiError} If the access code is invalid or expired.
     *
     * @example
     * ```ts
     * // body → { document_ids: ['103acccd...'], decline_reason: 'Wrong counterparty' }
     * await client.signerDocuments.declineMultiple(
     *   ['103acccd24234c07858ffddf6d84'],
     *   'Wrong counterparty',
     *   accessCode,
     * );
     * ```
     */
    async declineMultiple(
        documentIds: string[],
        declineReason: string,
        signerAccessCode: string,
    ): Promise<void> {
        assertDocumentIds(documentIds);
        assertDeclineReason(declineReason);
        const code = this.requireId(signerAccessCode, 'signer-access-code');
        return this.callVoid('Failed to decline multiple documents', () =>
            this.http.put(
                '/signers/documents/decline-multiple',
                { document_ids: documentIds, decline_reason: declineReason },
                { params: { 'signer-access-code': code } },
            ),
        );
    }

    /**
     * Fetch the authenticated signer's own profile
     * (`GET /signers/self?signer-access-code=…`).
     *
     * Resolves the signer identity behind an access code, plus whether they have
     * already stored a signature/initial image — useful for deciding whether to
     * prompt for {@link SignerDocumentsResource.uploadSignature} before signing.
     *
     * @param signerAccessCode - The signer's access code, from their signing link.
     * @returns The signer profile. `has_signature`, `has_initial`, and
     * `is_signature_reusable` are optional compatibility flags:
     * ```jsonc
     * {
     *   "resource": "signer",
     *   "id": "19e6b92e7895332ed9708535d8c",
     *   "full_name": "Example Signer",
     *   "email": "signer@example.com",
     *   "whatsapp_phone_number": null,
     *   "has_accepted_terms": false,
     *   "has_signature": false,
     *   "has_initial": false,
     *   "is_signature_reusable": false,
     *   "verification_method": "IdDocumentFaceMatchBasic"
     * }
     * ```
     * @throws {ValidationError} If `signerAccessCode` is missing.
     * @throws {ApiError} If the access code is invalid or expired.
     *
     * @example
     * ```ts
     * const me = await client.signerDocuments.self(accessCode);
     * if (!me.has_signature) {
     *   // prompt the signer to draw/upload a signature first
     * }
     * ```
     */
    async self(signerAccessCode: string): Promise<ISignerSelf> {
        const code = this.requireId(signerAccessCode, 'signer-access-code');
        return this.call<ISignerSelf>('Failed to fetch signer profile', () =>
            this.http.get('/signers/self', { params: { 'signer-access-code': code } }),
        );
    }

    /**
     * Read the signer's identity verification state
     * (`GET /signers/identity-verification?signer-access-code=…`).
     *
     * No request body or workspace credentials. Reads a pending provider
     * decision when available. A new session can start before the first capture
     * or after `Expired`; `Declined` and `Abandoned` require a new document and
     * assignment. `InReview` lets the signer continue; account approval gates
     * certification, with `pending_identity_review` after everyone signs.
     *
     * @param signerAccessCode - Access code from the signer's signing link.
     * @returns Provider state, with nullable fields before a session exists:
     * ```jsonc
     * {
     *   "can_start": false, "status": "Pending",
     *   "url": "https://verify.example.com/c/session#t=opaque",
     *   "expires_at": "2026-10-16T12:30:00Z", "completed_at": null
     * }
     * ```
     * `url` exists only while Pending. It is a bearer link: open it intact,
     * including its fragment, and keep it out of logs and browser storage.
     * @throws {ValidationError} If the access code is blank.
     * @throws {ApiError} `401` for an invalid/expired code; `500` for a server failure.
     * @example
     * ```ts
     * const state = await client.signerDocuments.getIdentityVerification(accessCode);
     * console.log(state.status, state.can_start);
     * ```
     */
    async getIdentityVerification(signerAccessCode: string): Promise<ISignerIdentityVerification> {
        const code = this.requireId(signerAccessCode, 'signer-access-code');
        return this.call('Failed to fetch signer identity verification', () =>
            this.http.get('/signers/identity-verification', { params: { 'signer-access-code': code } }),
        );
    }

    /**
     * Record biometric consent and open an identity verification session
     * (`POST /signers/identity-verification?signer-access-code=…`).
     *
     * Send only after the signer explicitly consents. Starts a session when
     * none exists or replaces an Expired session. Other states return `400`;
     * resending a notification never replaces a live session. The account is
     * billed at assignment creation, with no new charge for a restart.
     *
     * Request body (`application/json`):
     * ```jsonc
     * { "consent": true }
     * ```
     * @param signerAccessCode - Access code from the signer's signing link.
     * @param payload - Explicit consent from the signer.
     * @param payload.consent - Must be `true`; never default or infer consent.
     * @returns The newly opened provider session:
     * ```jsonc
     * {
     *   "id": "verification_example",
     *   "url": "https://verify.example.com/c/session#t=opaque",
     *   "expires_at": "2026-10-16T12:30:00Z"
     * }
     * ```
     * `expires_at` can be null. Open the URL as-is; it is a bearer credential
     * and its fragment must survive navigation. Do not log or persist it in
     * browser storage. No workspace credential is attached to this call.
     * @throws {ValidationError} If the code is blank or consent is not `true`.
     * @throws {ApiError} `400` when a non-expired session already exists;
     * `401` for an invalid/expired code; `500` for a provider/server failure.
     * @example
     * ```ts
     * // Inside the handler for the signer's explicit consent action:
     * const session = await client.signerDocuments.startIdentityVerification(accessCode, { consent: true });
     * response.redirect(session.url);
     * ```
     */
    async startIdentityVerification(
        signerAccessCode: string,
        payload: IStartIdentityVerificationPayload,
    ): Promise<ISignerIdentityVerificationSession> {
        const code = this.requireId(signerAccessCode, 'signer-access-code');
        assertRecord(payload, 'identity verification payload');
        if (payload.consent !== true) {
            throw new ValidationError('Explicit biometric-processing consent is required');
        }
        return this.call('Failed to start signer identity verification', () =>
            this.http.post('/signers/identity-verification', { consent: true }, {
                params: { 'signer-access-code': code },
            }),
        );
    }

    /**
     * Accept the platform terms of use as the signer
     * (`PUT /signers/accept-terms?signer-access-code=…`).
     *
     * A signer must accept terms before they can sign. The access code
     * authenticates via the `signer-access-code` **query param** — this endpoint
     * takes **no request body** (sending the code in the body leaves the request
     * unauthenticated → `401`). Pass the resulting acceptance to
     * {@link SignerDocumentsResource.getAssignment} via its `hasAcceptedTerms`
     * flag.
     *
     * @param signerAccessCode - The signer's access code, from their signing link.
     * @returns The signer's acceptance state, or `null` from deployments that
     * acknowledge without data:
     * ```jsonc
     * { "full_name": "Example Signer", "email": "signer@example.com", "has_accepted_terms": true }
     * ```
     * @throws {ValidationError} If `signerAccessCode` is missing.
     * @throws {ApiError} `400` while the signer's verification is not done (e.g.
     * the e-mail code) or their step has not started, `401` for an invalid code,
     * `410` once the code is closed.
     *
     * @example
     * ```ts
     * await client.signerDocuments.acceptTerms(accessCode);
     * const assignment = await client.signerDocuments.getAssignment(accessCode, true);
     * ```
     */
    async acceptTerms(signerAccessCode: string): Promise<IAcceptTermsResult | null> {
        const code = this.requireId(signerAccessCode, 'signer-access-code');
        // The access code authenticates via the `signer-access-code` QUERY param
        // (the API's `signerAccessCode` security scheme is `in: query`). Sending
        // it in the body leaves the request unauthenticated → 401.
        const data = await this.call<IAcceptTermsResult | undefined>('Failed to accept terms', () =>
            this.http.put('/signers/accept-terms', undefined, {
                params: { 'signer-access-code': code },
            }),
        );
        // Older deployments acknowledge without `data`.
        return data ?? null;
    }

    /**
     * Verify the signer's email or WhatsApp one-time password
     * (`POST /verify?signer-access-code=…`).
     *
     * Confirms the 6-digit OTP sent through the selected channel. The access code
     * authenticates via the `signer-access-code` **query param**; the request
     * **body carries only `verification-code`** (putting the access code in the
     * body leaves the request unauthenticated → `401`).
     *
     * Request body (`application/json`):
     * ```jsonc
     * {
     *   "verification-code": "123456"
     * }
     * ```
     *
     * @param payload - `signerAccessCode` (the signing-link code) and
     *   `verificationCode` (the OTP the signer received).
     * @param payload.signerAccessCode - Signing-link code sent only in the query.
     * @param payload.verificationCode - Email or WhatsApp OTP sent as `verification-code`.
     * @returns Resolves when the API acknowledges the operation. The response
     *   envelope has no `data` field and is intentionally discarded.
     * @throws {ValidationError} If `signerAccessCode` or `verificationCode` is
     *   missing.
     * @throws {ApiError} `400`/`401` if the OTP is wrong or the access code is
     *   invalid or expired.
     *
     * @example
     * ```ts
     * // query → ?signer-access-code=<code>   body → { 'verification-code': '123456' }
     * await client.signerDocuments.verifyEmail({
     *   signerAccessCode: accessCode,
     *   verificationCode: '123456',
     * });
     * ```
     */
    async verifyEmail(payload: {
        signerAccessCode: string;
        verificationCode: string;
    }): Promise<void> {
        assertRecord(payload, 'email verification payload');
        const code = this.requireId(payload.signerAccessCode, 'signer-access-code');
        const otp = this.requireId(payload.verificationCode, 'verification-code');
        // `signer-access-code` authenticates via the QUERY param; the body carries
        // only `verification-code` (per the spec's request schema). Putting the
        // access code in the body leaves the request unauthenticated → 401.
        return this.callVoid('Failed to verify signer email', () =>
            this.http.post(
                '/verify',
                { 'verification-code': otp },
                { params: { 'signer-access-code': code } },
            ),
        );
    }

    /**
     * Confirm the signer's contact data before signing
     * (`PUT /documents/{documentId}/signers/confirm-data?signer-access-code=…`).
     *
     * Send the contact the signer's channel needs: `email` for e-mail
     * verification or notification, `whatsapp_phone_number` for WhatsApp. Each
     * is saved when the signer has none; otherwise it must be theirs, so it
     * cannot change the record. `has_accepted_terms: true` also records the
     * terms, which opens `getAssignment()` for a `DigitalCertificate` signer.
     * With an envelope code it acts on the document the route names. Only the
     * fields provided are sent.
     *
     * Request body (`application/json`):
     * ```jsonc
     * {
     *   "email": "signer@example.com",
     *   "has_accepted_terms": true
     * }
     * ```
     *
     * @param documentId - The document the signer is confirming data for.
     * @param signerAccessCode - The signer's access code, from their signing link.
     * @param payload - `email`, `whatsapp_phone_number` and `has_accepted_terms`.
     * `full_name`/`government_id` are forwarded only for older deployments.
     * @returns `null` on production, which answers `data: []`; older deployments
     * return the signer:
     * ```jsonc
     * { "resource": "signer", "id": "19e6b92e7895332ed9708535d8c", "full_name": "Example Signer",
     *   "email": "signer@example.com", "whatsapp_phone_number": null, "has_accepted_terms": true }
     * ```
     * @throws {ValidationError} If `documentId` or `signerAccessCode` is missing,
     * or a supplied value is malformed.
     * @throws {ApiError} `400` when a contact the signer's methods need is missing,
     * invalid or not theirs, or their step has not started; `404` for a document
     * the code does not reach; `410` once the code is closed.
     *
     * @example
     * ```ts
     * await client.signerDocuments.confirmData(documentId, accessCode, {
     *   email: 'signer@example.com',
     *   has_accepted_terms: true,
     * });
     * ```
     */
    async confirmData(
        documentId: string,
        signerAccessCode: string,
        payload: IConfirmSignerDataPayload,
    ): Promise<ISigner | null> {
        assertRecord(payload, 'signer confirmation payload');
        validateConfirmDataPayload(payload);
        const did = this.requireId(documentId, 'Document ID');
        const code = this.requireId(signerAccessCode, 'signer-access-code');
        const data = await this.call<unknown>('Failed to confirm signer data', () =>
            this.http.put(
                `/documents/${this.pathSegment(did, 'Document ID')}/signers/confirm-data`,
                cleanParams({
                    full_name: payload.full_name,
                    email: payload.email,
                    government_id: payload.government_id,
                    whatsapp_phone_number: payload.whatsapp_phone_number,
                    has_accepted_terms: payload.has_accepted_terms,
                }),
                { params: { 'signer-access-code': code } },
            ),
        );
        return data !== null && typeof data === 'object' && !Array.isArray(data) ? (data as ISigner) : null;
    }

    /**
     * Upload the signer's signature or initial image
     * (`POST /signature?signer-access-code=…&type=…`).
     *
     * The image bytes are sent as the raw request body (default
     * `Content-Type: image/png`); `type` (`signature` or `initial`) and the
     * optional `reuse` flag are query params, alongside the authenticating
     * `signer-access-code`. Set `reuse: true` to persist the image so it is
     * applied automatically to the signer's future documents.
     *
     * @param signerAccessCode - The signer's access code, from their signing link.
     * @param image - The image bytes as a non-empty `Buffer`.
     * @param options - `imageType` (`'signature'` default, or `'initial'`) and
     *   `reuse` (persist for reuse). The official request content type is PNG.
     * @param options.imageType - Signature image category; defaults to `signature`.
     * @param options.reuse - Persist the image for future signing requests.
     * @returns Resolves when the API acknowledges the upload. The response
     *   envelope has no `data` field and is intentionally discarded.
     * @throws {ValidationError} If `signerAccessCode` is missing or `image` is not
     *   a non-empty buffer.
     * @throws {ApiError} If the access code is invalid or expired.
     *
     * @example
     * ```ts
     * const png = await fs.readFile('./signature.png');
     * // query → ?signer-access-code=<code>&type=signature&reuse=true
     * await client.signerDocuments.uploadSignature(accessCode, png, {
     *   imageType: 'signature',
     *   reuse: true,
     * });
     * ```
     */
    async uploadSignature(
        signerAccessCode: string,
        image: Buffer,
        options?: IUploadSignatureOptions,
    ): Promise<void>;
    /**
     * Upload a signature image using a compatibility content type
     * (`POST /signature?signer-access-code=…&type=…`).
     * @deprecated Compatibility overload for non-PNG media types. The current
     * OpenAPI contract specifies only `image/png`; other values are not certified.
     * @param signerAccessCode - Access code sent in the query string.
     * @param image - Non-empty raw image bytes, without a JSON envelope.
     * @param options - Image type, reuse preference and compatibility content type.
     * @param options.imageType - Signature image category; defaults to `signature`.
     * @param options.reuse - Persist the image for future signing requests.
     * @param options.contentType - Compatibility media type; the official type is `image/png`.
     * @returns Nothing; the acknowledgement body is discarded.
     * @throws {ValidationError} If the code, image or options are invalid.
     * @throws {ApiError} If the API rejects the upload.
     * @example
     * ```ts
     * await client.signerDocuments.uploadSignature(accessCode, image, {
     *   imageType: 'signature', reuse: false, contentType: 'image/jpeg',
     * });
     * ```
     */
    async uploadSignature(
        signerAccessCode: string,
        image: Buffer,
        options: ILegacyUploadSignatureOptions,
    ): Promise<void>;
    async uploadSignature(
        signerAccessCode: string,
        image: Buffer,
        options: ILegacyUploadSignatureOptions = {},
    ): Promise<void> {
        const code = this.requireId(signerAccessCode, 'signer-access-code');
        if (!Buffer.isBuffer(image) || image.byteLength === 0) {
            throw new ValidationError('image buffer is required');
        }
        assertRecord(options, 'signature upload options');
        if (
            options.imageType !== undefined
            && (typeof options.imageType !== 'string' || !options.imageType.trim())
        ) {
            throw new ValidationError('imageType must be a non-empty string');
        }
        if (options.reuse !== undefined && typeof options.reuse !== 'boolean') {
            throw new ValidationError('reuse must be a boolean');
        }
        if (
            options.contentType !== undefined
            && (typeof options.contentType !== 'string' || !options.contentType.trim())
        ) {
            throw new ValidationError('contentType must be a non-empty string');
        }
        return this.callVoid('Failed to upload signer signature', () =>
            this.http.post('/signature', image, {
                params: cleanParams({
                    'signer-access-code': code,
                    type: options.imageType ?? 'signature',
                    reuse: options.reuse,
                }),
                headers: { 'Content-Type': options.contentType ?? 'image/png' },
            }),
        );
    }

    /**
     * Download the signer's stored signature or initial image
     * (`GET /signature/{type}?signer-access-code=…`).
     *
     * The read-side counterpart of {@link SignerDocumentsResource.uploadSignature}
     * — returns the image the signer previously uploaded (e.g. to preview it in a
     * custom signing UI). Returns bytes, not JSON.
     *
     * @param signerAccessCode - The signer's access code, from their signing link.
     * @param imageType - Server-defined image category; known values are
     *   `'signature'` (default) and `'initial'`.
     * @returns The image bytes as a Node `Buffer` (PNG by default).
     * @throws {ValidationError} If `signerAccessCode` is missing.
     * @throws {ApiError} `404` if the signer has no such image stored; `401`/`403`
     *   if the access code is invalid or expired.
     *
     * @example
     * ```ts
     * const png = await client.signerDocuments.downloadSignature(accessCode, 'signature');
     * await fs.promises.writeFile('signature.png', png);
     * ```
     */
    async downloadSignature(
        signerAccessCode: string,
        imageType: SignatureImageType = 'signature',
    ): Promise<Buffer> {
        const code = this.requireId(signerAccessCode, 'signer-access-code');
        if (typeof imageType !== 'string' || !imageType.trim()) {
            throw new ValidationError('imageType must be a non-empty string');
        }
        return this.callBinary('Failed to download signer signature', () =>
            this.http.get<ArrayBuffer>(`/signature/${this.pathSegment(imageType, 'Image type')}`, {
                responseType: 'arraybuffer',
                params: { 'signer-access-code': code },
            }),
        );
    }

    /**
     * Fetch the assignment (document + fields) as the signer sees it
     * (`GET /sign?signer-access-code=…`).
     *
     * The entry point for a custom signing UI: resolves the access code to the
     * document, its pages, and the {@link ISignFieldEntry}-addressable items the
     * signer must fill. The server answers `409` while the document is still
     * being prepared; retry that response with backoff. For ordinary signers,
     * `hasAcceptedTerms: true` records terms acceptance on this request.
     * Digital-certificate signers must confirm their data and accept terms
     * before this request; otherwise it returns `400`. The query flag is too
     * late to open that gate, so use `confirmData(..., { has_accepted_terms:
     * true })` or `acceptTerms()` first.
     * The API records this read as the signer having viewed the assignment, so
     * the SDK never automatically replays this particular `GET` after a `429`.
     *
     * @param signerAccessCode - The signer's access code, from their signing link.
     * @param options - `true`/`false` (the `has_accepted_terms` query, kept for
     *   existing calls) or an options object:
     *   `hasAcceptedTerms` (an explicit `false` is still sent), `expand:
     *   ['envelope']` (adds the code's envelope), and `documentId` (with an
     *   envelope code, open another document of that envelope the signer is on).
     * @returns The {@link ISigningDocument}. Its `assignment` carries only this
     *   signer's items — no other signers, `signing_urls`, copy receivers or
     *   `summary` — from which the `itemId` / `fieldId` / `pageId` values for
     *   {@link SignerDocumentsResource.sign} are read. A closed code returns
     *   only `id`, `name`, `status`, `current_signer`, `certified_copy` and
     *   `envelope`, with `is_signer_access_closed: true`:
     * ```jsonc
     * {
     *   "resource": "document",
     *   "id": "103acccd24234c07858ffddf6d84",
     *   "account_id": "acc_example",
     *   "template_id": null,
     *   "name": "Service agreement.pdf",
     *   "status": "pending_signature",
     *   "artifacts": {
     *     "original": "https://api.assinafy.com.br/v1/documents/103acccd.../download/original",
     *     "thumbnail": "https://api.assinafy.com.br/v1/documents/103acccd.../thumbnail"
     *   },
     *   "is_closed": false,
     *   "signing_url": "https://app.assinafy.com.br/sign/103acccd...",
     *   "decline_reason": null,
     *   "declined_by": null,
     *   "tags": [],
     *   "assignment": {
     *     "id": "1032c55c58bb00a8dc35db916751",
     *     "method": "virtual",
     *     "sender_email": "sender@example.com",
     *     "expires_at": null,
     *     "signers": [
     *       { "id": "19e6b92e7895332ed9708535d8c", "step": 1, "email": "signer@example.com",
     *         "full_name": "Example Signer", "notified": true }
     *     ],
     *     "items": [
     *       { "id": "item-1", "page": { "id": "page-1", "number": 1, "height": 1651, "width": 1275,
     *         "download_url": "https://..." }, "signer": { "id": "19e6b92e..." },
     *         "field": { "id": "field-1", "type": "signature" }, "value": null, "completed": false }
     *     ]
     *   },
     *   "current_signer": { "id": "19e6b92e7895332ed9708535d8c", "verification_method": "Email",
     *     "notification_methods": ["Email"], "completed": false },
     *   "is_signer_access_closed": false,
     *   "certified_copy": { "available": false, "notification_method": "Email", "resends_left": null },
     *   "pages": [
     *     { "id": "103acccd5c73...", "number": 1, "height": 1651, "width": 1275,
     *       "download_url": "https://api.assinafy.com.br/v1/documents/103acccd.../pages/103acccd5c73.../download" }
     *   ],
     *   "created_at": "2026-07-19T14:56:54Z",
     *   "updated_at": "2026-07-19T14:56:56Z"
     * }
     * ```
     * @throws {ValidationError} If `signerAccessCode` is missing or an option is malformed.
     * @throws {ApiError} `400` when a DigitalCertificate signer has not confirmed
     *   data and terms, the signer's step has not started, or `documentId` is
     *   not an ID; `401` for an invalid code; `404` when `documentId` is outside
     *   the code's envelope; `409` (`DocumentNotReady`) while the document is
     *   still being prepared.
     *
     * @example
     * ```ts
     * // query → ?signer-access-code=<code>&has_accepted_terms=true&expand=envelope
     * const doc = await client.signerDocuments.getAssignment(accessCode, {
     *   hasAcceptedTerms: true,
     *   expand: ['envelope'],
     * });
     * ```
     */
    async getAssignment(
        signerAccessCode: string,
        options?: boolean | ISigningReadOptions,
    ): Promise<ISigningDocument> {
        const code = this.requireId(signerAccessCode, 'signer-access-code');
        const read: ISigningReadOptions = typeof options === 'object' && options !== null
            ? options
            : options === undefined ? {} : { hasAcceptedTerms: options };
        assertRecord(read, 'signing read options');
        if (read.hasAcceptedTerms !== undefined && typeof read.hasAcceptedTerms !== 'boolean') {
            throw new ValidationError('hasAcceptedTerms must be a boolean');
        }
        if (read.documentId !== undefined) this.requireId(read.documentId, 'documentId');
        return this.call('Failed to fetch signer assignment', () =>
            this.http.get('/sign', {
                params: cleanParams({
                    'signer-access-code': code,
                    has_accepted_terms: read.hasAcceptedTerms,
                    document_id: read.documentId,
                    ...signingReadParams(read),
                }),
            }),
        );
    }

    /**
     * Read the sending workspace's brand for the signing page (`GET /sign/theme`).
     *
     * Available before verification and after the document is deleted.
     * `primary_color` is the button background and `secondary_color` its text
     * (6-digit hex without `#`). The `logo` URL carries no access code: fetch it
     * with {@link SignerDocumentsResource.downloadLogo}.
     *
     * @param signerAccessCode - The signer's access code, from their signing link.
     * @returns The brand:
     * ```jsonc
     * {
     *   "account_name": "Example Ltda",
     *   "primary_color": "1F6FEB",
     *   "secondary_color": "FFFFFF",
     *   "logo": "https://api.assinafy.com.br/v1/sign/logo"   // null when the account has none
     * }
     * ```
     * @throws {ValidationError} If `signerAccessCode` is missing.
     * @throws {ApiError} `400` while the signer's step has not started, `401` for an invalid code.
     *
     * @example
     * ```ts
     * const theme = await client.signerDocuments.getTheme(accessCode);
     * ```
     */
    async getTheme(signerAccessCode: string): Promise<IAccountTheme> {
        const code = this.requireId(signerAccessCode, 'signer-access-code');
        return this.call('Failed to fetch signing theme', () =>
            this.http.get('/sign/theme', { params: { 'signer-access-code': code } }),
        );
    }

    /**
     * Download the sending workspace's logo for the signing page (`GET /sign/logo`).
     *
     * @param signerAccessCode - The signer's access code, from their signing link.
     * @returns The image bytes (`image/*`).
     * @throws {ValidationError} If `signerAccessCode` is missing.
     * @throws {ApiError} `400` while the signer's step has not started, `401` for an
     * invalid code, `404` when the workspace has no logo.
     *
     * @example
     * ```ts
     * const logo = await client.signerDocuments.downloadLogo(accessCode);
     * ```
     */
    async downloadLogo(signerAccessCode: string): Promise<Buffer> {
        const code = this.requireId(signerAccessCode, 'signer-access-code');
        return this.callBinary('Failed to download signing logo', () =>
            this.http.get<ArrayBuffer>('/sign/logo', {
                responseType: 'arraybuffer',
                params: { 'signer-access-code': code },
            }),
        );
    }

    /**
     * Send the signer their certified copy again (`POST /sign/certified-copy`).
     *
     * The copy goes, with a download link valid for 30 minutes, on the signature
     * request's channel and only to the contact the signing messages went to.
     * Works after the signer signed, also once the code is closed. E-mail: once
     * every 2 minutes and 10 times a day; WhatsApp: once per request.
     * `certified_copy` on {@link SignerDocumentsResource.getAssignment} says
     * whether it is available.
     *
     * @param signerAccessCode - The signer's access code, from their signing link.
     * @param documentId - With an envelope code, another document of that envelope.
     * @returns What was sent:
     * ```jsonc
     * { "available": true, "notification_method": "Email", "resends_left": null, "sent_to": "j***@example.com" }
     * ```
     * @throws {ValidationError} If the code or `documentId` is blank.
     * @throws {ApiError} `400` while the signer's step has not started, `404` for a
     * document outside the envelope, `409` when the signer has not signed or the
     * document is not certified, `429` within the resend limits, `500` when the
     * message could not be sent (nothing used up; ask again).
     *
     * @example
     * ```ts
     * const { sent_to } = await client.signerDocuments.resendCertifiedCopy(accessCode);
     * ```
     */
    async resendCertifiedCopy(
        signerAccessCode: string,
        documentId?: string,
    ): Promise<ICertifiedCopyResendResult> {
        const code = this.requireId(signerAccessCode, 'signer-access-code');
        const body = documentId === undefined
            ? {}
            : { document_id: this.requireId(documentId, 'documentId') };
        return this.call('Failed to resend certified copy', () =>
            this.http.post('/sign/certified-copy', body, { params: { 'signer-access-code': code } }),
        );
    }

    /**
     * Download the certified copy from a sent link (`GET /signers/downloads/{token}`).
     *
     * The token is the last path segment of the link in the completion and
     * re-send messages; it is a credential. Links last 7 days (completion) or
     * 30 minutes (re-send). An expired or unknown link redirects to the
     * expired-link page; the SDK does not follow it and throws instead.
     *
     * @param token - Link token.
     * @param artifact - `pades` for the PAdES version, when the document has one.
     * @returns The PDF bytes.
     * @throws {ValidationError} If `token` is blank or `artifact` is not `pades`.
     * @throws {ApiError} `302` for an expired or unknown link (ask for a new one
     * with {@link SignerDocumentsResource.resendCertifiedCopyFromLink}), `404`
     * for `pades` on a document without it.
     *
     * @example
     * ```ts
     * const pdf = await client.signerDocuments.downloadCertifiedCopy(token);
     * ```
     */
    async downloadCertifiedCopy(token: string, artifact?: 'pades'): Promise<Buffer> {
        if (artifact !== undefined && artifact !== 'pades') {
            throw new ValidationError('artifact must be pades when given');
        }
        const path = `/signers/downloads/${this.pathSegment(token, 'Download token')}`;
        return this.callBinary('Failed to download certified copy', () =>
            this.http.get<ArrayBuffer>(artifact ? `${path}/pades` : path, BINARY_NO_REDIRECT),
        );
    }

    /**
     * Send the certified copy again from an expired link
     * (`POST /signers/downloads/{token}/resend`).
     *
     * Works with the link's token after it expired, on the same terms as
     * {@link SignerDocumentsResource.resendCertifiedCopy}.
     *
     * @param token - Link token, from the expired link.
     * @returns What was sent, as {@link SignerDocumentsResource.resendCertifiedCopy} returns.
     * @throws {ValidationError} If `token` is blank.
     * @throws {ApiError} `404` for an unknown link, `409` when nothing can be sent
     * from it (copy receiver, Bypass signer, no contact, not certified), `429`
     * within the resend limits.
     *
     * @example
     * ```ts
     * await client.signerDocuments.resendCertifiedCopyFromLink(token);
     * ```
     */
    async resendCertifiedCopyFromLink(token: string): Promise<ICertifiedCopyResendResult> {
        return this.call('Failed to resend certified copy', () =>
            this.http.post(`/signers/downloads/${this.pathSegment(token, 'Download token')}/resend`),
        );
    }

    /**
     * Submit the signer's field values to sign an assignment
     * (`POST /documents/{documentId}/assignments/{assignmentId}?signer-access-code=…`).
     *
     * The precise, field-by-field counterpart of
     * {@link SignerDocumentsResource.signMultiple}: the `entries` array is sent as
     * the request body, each entry addressing one item resolved from
     * {@link SignerDocumentsResource.getAssignment}. The access code
     * authenticates via the `signer-access-code` query param.
     * Virtual signers must call {@link SignerDocumentsResource.confirmData}
     * first. Digital Certificate signers cannot use this endpoint; use the
     * certificate start/complete API flow instead.
     *
     * Request body (`application/json`):
     * ```jsonc
     * [
     *   {
     *     "itemId": "item_example",
     *     "fieldId": "field_example",
     *     "pageId": "page_example",
     *     "value": "Example Signer"
     *   }
     * ]
     * ```
     *
     * @param documentId - The document being signed.
     * @param assignmentId - The assignment within that document.
     * @param signerAccessCode - The signer's access code, from their signing link.
     * @param entries - Non-empty array of {@link ISignFieldEntry}
     *   (`itemId`, `fieldId`, `pageId`, `value`) — the body sent to the API.
     * @returns The API's signing result object. Its keys are operation-specific,
     *   so the SDK preserves them as a {@link Record} without inventing fields.
     * @throws {ValidationError} If any of `documentId`, `assignmentId`, or
     *   `signerAccessCode` is missing, or `entries` is empty.
     * @throws {ApiError} `400`/`409` if a value fails validation or the assignment
     *   is no longer signable; `401`/`403` if the access code is invalid/expired.
     *
     * @example
     * ```ts
     * // body → [{ itemId, fieldId, pageId, value: 'Example Signer' }]
     * await client.signerDocuments.sign(documentId, assignmentId, accessCode, [
     *   { itemId: 'item-1', fieldId: 'field-1', pageId: 'page-1', value: 'Example Signer' },
     * ]);
     * ```
     */
    async sign(
        documentId: string,
        assignmentId: string,
        signerAccessCode: string,
        entries: ISignFieldEntry[],
    ): Promise<Record<string, unknown>> {
        const did = this.requireId(documentId, 'Document ID');
        const aid = this.requireId(assignmentId, 'Assignment ID');
        const code = this.requireId(signerAccessCode, 'signer-access-code');
        if (
            !Array.isArray(entries)
            || entries.length === 0
            || entries.some(
                (entry) =>
                    !entry
                    || typeof entry !== 'object'
                    || Array.isArray(entry)
                    || typeof entry.itemId !== 'string'
                    || !entry.itemId.trim()
                    || typeof entry.fieldId !== 'string'
                    || !entry.fieldId.trim()
                    || typeof entry.pageId !== 'string'
                    || !entry.pageId.trim()
                    || typeof entry.value !== 'string',
            )
        ) {
            throw new ValidationError(
                'entries must contain itemId, fieldId, pageId, and string value',
            );
        }
        const body = entries.map((entry) => ({
            itemId: entry.itemId,
            fieldId: entry.fieldId,
            pageId: entry.pageId,
            value: entry.value,
        }));
        return this.call<Record<string, unknown>>('Failed to sign document', () =>
            this.http.post(
                `/documents/${this.pathSegment(did, 'Document ID')}/assignments/${this.pathSegment(aid, 'Assignment ID')}`,
                body,
                { params: { 'signer-access-code': code } },
            ),
        );
    }

    /**
     * Decline (reject) a single assignment as the signer
     * (`PUT /documents/{documentId}/assignments/{assignmentId}/reject?signer-access-code=…`).
     *
     * The single-document counterpart of
     * {@link SignerDocumentsResource.declineMultiple}. The `decline_reason` is
     * sent in the request body; the access code authenticates via the
     * `signer-access-code` query param. (The workspace-side equivalent is to
     * delete the document via `documents.delete`; there is no workspace "cancel"
     * endpoint.)
     *
     * Request body (`application/json`):
     * ```jsonc
     * {
     *   "decline_reason": "The document needs a correction."
     * }
     * ```
     *
     * @param documentId - The document being declined.
     * @param assignmentId - The assignment within that document.
     * @param signerAccessCode - The signer's access code, from their signing link.
     * @param declineReason - Free-text reason shown to the sender (required).
     * @returns Resolves when the API acknowledges the operation. The documented
     *   empty-array response data is intentionally discarded.
     * @throws {ValidationError} If any of `documentId`, `assignmentId`, or
     *   `signerAccessCode` is missing, or `declineReason` is empty.
     * @throws {ApiError} If the access code is invalid or expired.
     *
     * @example
     * ```ts
     * // body → { decline_reason: 'Terms are unacceptable' }
     * await client.signerDocuments.decline(
     *   documentId,
     *   assignmentId,
     *   accessCode,
     *   'Terms are unacceptable',
     * );
     * ```
     */
    async decline(
        documentId: string,
        assignmentId: string,
        signerAccessCode: string,
        declineReason: string,
    ): Promise<void> {
        const did = this.requireId(documentId, 'Document ID');
        const aid = this.requireId(assignmentId, 'Assignment ID');
        const code = this.requireId(signerAccessCode, 'signer-access-code');
        assertDeclineReason(declineReason);
        return this.callVoid('Failed to decline assignment', () =>
            this.http.put(
                `/documents/${this.pathSegment(did, 'Document ID')}/assignments/${this.pathSegment(aid, 'Assignment ID')}/reject`,
                { decline_reason: declineReason },
                { params: { 'signer-access-code': code } },
            ),
        );
    }
}

function assertDocumentIds(documentIds: string[]): void {
    if (
        !Array.isArray(documentIds)
        || documentIds.length === 0
        || documentIds.some((id) => typeof id !== 'string' || !id.trim())
    ) {
        throw new ValidationError('documentIds must be a non-empty array of non-empty IDs');
    }
}

/**
 * Binary request that surfaces a redirect as an error: these routes redirect
 * a request they cannot serve to an HTML page, which must never be returned
 * as file bytes.
 */
const BINARY_NO_REDIRECT = { responseType: 'arraybuffer', maxRedirects: 0 } as const;

const SIGNING_EXPANSIONS = new Set(['envelope']);

function signingReadParams(options: Pick<ISigningReadOptions, 'expand'>): { expand?: string } {
    assertRecord(options, 'signing read options');
    return expandParam(options.expand, SIGNING_EXPANSIONS);
}

function searchParams(
    search: string | undefined,
    params: Pick<ISignerDocumentListParams, 'envelope_id'>,
): Record<string, unknown> {
    if (search !== undefined && typeof search !== 'string') {
        throw new ValidationError('search must be a string');
    }
    assertRecord(params, 'search params');
    return cleanParams({ search, envelope_id: params.envelope_id });
}

function assertDeclineReason(declineReason: string): void {
    if (typeof declineReason !== 'string' || !declineReason.trim()) {
        throw new ValidationError('declineReason is required');
    }
    if ([...declineReason].length > 2000) {
        throw new ValidationError('declineReason must be at most 2000 characters');
    }
}

function validateConfirmDataPayload(payload: IConfirmSignerDataPayload): void {
    for (const key of ['full_name', 'government_id'] as const) {
        if (payload[key] !== undefined && typeof payload[key] !== 'string') {
            throw new ValidationError(`${key} must be a string`);
        }
    }
    if (payload.email !== undefined && !isEmail(payload.email)) {
        throw new ValidationError('email must be a valid email address');
    }
    if (
        payload.whatsapp_phone_number !== undefined
        && !isE164PhoneNumber(payload.whatsapp_phone_number)
    ) {
        throw new ValidationError('whatsapp_phone_number must use E.164 format');
    }
    if (
        payload.has_accepted_terms !== undefined
        && typeof payload.has_accepted_terms !== 'boolean'
    ) {
        throw new ValidationError('has_accepted_terms must be a boolean');
    }
}
