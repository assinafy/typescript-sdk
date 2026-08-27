import type { AxiosInstance } from 'axios';
import type {
    DocumentArtifactName,
    IDocumentDetailsResponse,
    IDocumentListItem,
    IDocumentListResponse,
    IConfirmSignerDataPayload,
    IListParams,
    ILegacyConfirmSignerDataPayload,
    ILegacyUploadSignatureOptions,
    ISignFieldEntry,
    ISigner,
    ISignerSelf,
    IUploadSignatureOptions,
    Logger,
    SignatureImageType,
} from '../types';
import { ValidationError } from '../errors';
import {
    assertDocumentArtifactName,
    assertRecord,
    cleanListParams,
    cleanParams,
    isE164PhoneNumber,
    isEmail,
} from '../utils';
import { BaseResource } from './base';
import { withoutCredentials } from '../support/transport';

/**
 * Signer-side endpoints for custom signing UIs. Most calls authenticate with
 * `signer-access-code` (the one-time link emailed/whatsapped to the signer),
 * never the workspace API key. The artifact-download route is the documented
 * public exception and can be called without an access code.
 */
export class SignerDocumentsResource extends BaseResource {
    constructor(
        http: AxiosInstance,
        defaultAccountId?: string,
        logger?: Logger,
        publicHttp?: AxiosInstance,
    ) {
        super(withoutCredentials(publicHttp ?? http), defaultAccountId, logger);
    }

    /**
     * Fetch the document currently awaiting a given signer
     * (`GET /signers/{signer_id}/document?signer-access-code=…`).
     *
     * The signer-side counterpart of {@link DocumentResource.details}, authorised
     * by the signer's access code rather than the workspace API key.
     *
     * @param signerId - The signer whose current document is fetched.
     * @param signerAccessCode - The signer's access code, from their signing link.
     * @returns The document in the full {@link IDocumentDetailsResponse} shape:
     * ```jsonc
     * {
     *   "resource": "document",
     *   "id": "103acccd24234c07858ffddf6d84",
     *   "account_id": "acc_example",
     *   "template_id": null,
     *   "name": "Service agreement.pdf",
     *   "status": "pending_signature",
     *   "artifacts": {
     *     "original": "https://sandbox.assinafy.com.br/v1/documents/103acccd.../download/original",
     *     "thumbnail": "https://sandbox.assinafy.com.br/v1/documents/103acccd.../thumbnail"
     *   },
     *   "is_closed": false,
     *   "signing_url": "https://app-sandbox.assinafy.com.br/sign/103acccd...",
     *   "decline_reason": null,
     *   "declined_by": null,
     *   "tags": [],
     *   "assignment": null,          // an IAssignment once signing has started
     *   "pages": [
     *     { "id": "103acccd5c73...", "number": 1, "height": 1651, "width": 1275,
     *       "download_url": "https://sandbox.assinafy.com.br/v1/documents/103acccd.../pages/103acccd5c73.../download" }
     *   ],
     *   "created_at": "2026-07-19T14:56:54Z",
     *   "updated_at": "2026-07-19T14:56:56Z"
     * }
     * ```
     * @throws {ValidationError} If `signerId` or `signerAccessCode` is missing,
     * or a supplied `search` value is not a string.
     * @throws {ApiError} If the access code is invalid or expired.
     *
     * @example
     * ```ts
     * const doc = await client.signerDocuments.getCurrent(signerId, accessCode);
     * console.log(doc.status, doc.pages.length);
     * ```
     */
    async getCurrent(signerId: string, signerAccessCode: string): Promise<IDocumentDetailsResponse> {
        const sid = this.requireId(signerId, 'Signer ID');
        const code = this.requireId(signerAccessCode, 'signer-access-code');
        return this.call('Failed to fetch current signer document', () =>
            this.http.get(`/signers/${this.pathSegment(sid, 'Signer ID')}/document`, {
                params: { 'signer-access-code': code },
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
     * @param params - Pagination: `page`, `per-page` (also accepts `per_page`).
     * @returns Matching documents in the compact {@link IDocumentListItem} shape,
     * with pagination in `meta`:
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
     *       "signing_url": "https://app-sandbox.assinafy.com.br/sign/103acccd...",
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
     * @throws {ApiError} If the access code is invalid or expired.
     *
     * @example
     * ```ts
     * const { data, meta } = await client.signerDocuments.list(signerId, accessCode, {
     *   'per-page': 20,
     * });
     * ```
     */
    async list(
        signerId: string,
        signerAccessCode: string,
        params: IListParams = {},
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
     * @returns Matching documents for that signer, in the compact
     * {@link IDocumentListItem} shape, with pagination in `meta`.
     * @throws {ValidationError} If `signerId` or `signerAccessCode` is missing.
     * @throws {ApiError} If the access code is invalid or expired.
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
    ): Promise<IDocumentListResponse> {
        const sid = this.requireId(signerId, 'Signer ID');
        const code = this.requireId(signerAccessCode, 'signer-access-code');
        if (search !== undefined && typeof search !== 'string') {
            throw new ValidationError('search must be a string');
        }
        return this.callList<IDocumentListItem>('Failed to search signer documents', () =>
            this.http.get(`/signers/${this.pathSegment(sid, 'Signer ID')}/documents/search`, {
                params: cleanParams({ 'signer-access-code': code, search }),
            }),
        );
    }

    /**
     * Download one of a signer's document artifacts as raw bytes
     * (`GET /signers/{signer_id}/documents/{document_id}/download/{artifact}`).
     *
     * The signer-side counterpart of {@link DocumentResource.download}: same
     * artifact names, exposed by the API as a public signer-link endpoint. The
     * optional access-code argument is retained for compatibility with deployed
     * environments that still accept or require the legacy query parameter. The
     * `certificated` and `bundle` exist only once the document is fully signed.
     * `pades` exists only when the document had a Digital Certificate signer.
     * A bundle contains original, certificated, and certificate-page artifacts,
     * plus PAdES when present.
     *
     * @param signerId - The signer requesting the download.
     * @param documentId - The document to download.
     * @param artifactName - Which artifact to fetch (`original`, `certificated`,
     *   `certificate-page`, `pades`, or `bundle`).
     * @param signerAccessCode - Optional legacy signer access code. Omit it for
     *   the official public request shape.
     * @returns The raw artifact bytes as a Node `Buffer` (PDF except for the
     *   ZIP `bundle`).
     * @throws {ValidationError} If `signerId` or `documentId` is missing,
     *   `artifactName` is not one of the five documented names, or an explicitly
     *   supplied legacy `signerAccessCode` is blank.
     * @throws {ApiError} `404` if the artifact does not exist yet.
     *
     * @example
     * ```ts
     * const pdf = await client.signerDocuments.download(
     *   signerId,
     *   documentId,
     *   'original',
     * );
     * await fs.writeFile('to-sign.pdf', pdf);
     * ```
     */
    async download(
        signerId: string,
        documentId: string,
        artifactName: DocumentArtifactName,
        signerAccessCode?: string,
    ): Promise<Buffer> {
        const sid = this.requireId(signerId, 'Signer ID');
        const did = this.requireId(documentId, 'Document ID');
        assertDocumentArtifactName(artifactName);
        const code =
            signerAccessCode === undefined
                ? undefined
                : this.requireId(signerAccessCode, 'signer-access-code');
        return this.callBinary('Failed to download signer document', () =>
            this.http.get<ArrayBuffer>(
                `/signers/${this.pathSegment(sid, 'Signer ID')}/documents/${this.pathSegment(did, 'Document ID')}/download/${this.pathSegment(artifactName, 'Artifact name')}`,
                code === undefined
                    ? { responseType: 'arraybuffer' }
                    : {
                          responseType: 'arraybuffer',
                          params: { 'signer-access-code': code },
                      },
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
        if (
            !Array.isArray(documentIds)
            || documentIds.length === 0
            || documentIds.some((id) => typeof id !== 'string' || !id.trim())
        ) {
            throw new ValidationError('documentIds must be a non-empty array of non-empty IDs');
        }
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
        if (
            !Array.isArray(documentIds)
            || documentIds.length === 0
            || documentIds.some((id) => typeof id !== 'string' || !id.trim())
        ) {
            throw new ValidationError('documentIds must be a non-empty array of non-empty IDs');
        }
        if (typeof declineReason !== 'string' || !declineReason.trim()) {
            throw new ValidationError('declineReason is required');
        }
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
     *   "is_signature_reusable": false
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
     * @returns Resolves when the API acknowledges the operation. The response
     *   envelope has no `data` field and is intentionally discarded.
     * @throws {ValidationError} If `signerAccessCode` is missing.
     * @throws {ApiError} If the access code is invalid or expired.
     *
     * @example
     * ```ts
     * await client.signerDocuments.acceptTerms(accessCode);
     * const assignment = await client.signerDocuments.getAssignment(accessCode, true);
     * ```
     */
    async acceptTerms(signerAccessCode: string): Promise<void> {
        const code = this.requireId(signerAccessCode, 'signer-access-code');
        // The access code authenticates via the `signer-access-code` QUERY param
        // (the API's `signerAccessCode` security scheme is `in: query`). Sending
        // it in the body leaves the request unauthenticated → 401.
        return this.callVoid('Failed to accept terms', () =>
            this.http.put('/signers/accept-terms', undefined, {
                params: { 'signer-access-code': code },
            }),
        );
    }

    /**
     * Verify the signer's email one-time password
     * (`POST /verify?signer-access-code=…`).
     *
     * Confirms the 6-digit OTP the platform emailed the signer. The access code
     * authenticates via the `signer-access-code` **query param**; the request
     * **body carries only `verification-code`** (putting the access code in the
     * body leaves the request unauthenticated → `401`).
     *
     * @param payload - `signerAccessCode` (the signing-link code) and
     *   `verificationCode` (the OTP the signer received).
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
     * Confirm (and optionally correct) the signer's identity data before signing
     * (`PUT /documents/{documentId}/signers/confirm-data?signer-access-code=…`).
     *
     * Lets the signer confirm the name/e-mail/government ID that will appear on
     * the signed document. Only the provided fields are sent — `undefined`/`null`
     * entries are stripped by {@link cleanParams} before the request — so you can
     * pass just the fields the signer changed. The access code authenticates via
     * the `signer-access-code` query param. For `DigitalCertificate`, pass
     * `has_accepted_terms: true` here or call
     * {@link SignerDocumentsResource.acceptTerms} before fetching the assignment.
     *
     * @param documentId - The document the signer is confirming data for.
     * @param signerAccessCode - The signer's access code, from their signing link.
     * @param payload - Any of the official `full_name`, `email`, or
     *   `government_id`, or `has_accepted_terms` fields. Fields left out are not
     *   sent.
     * @returns The confirmed signer in the full {@link ISigner} response shape.
     * @throws {ValidationError} If `documentId` or `signerAccessCode` is missing,
     * or a supplied identity value is malformed.
     * @throws {ApiError} If the access code is invalid/expired or a value fails
     *   validation.
     *
     * @example
     * ```ts
     * // body → { full_name: 'Example Signer', government_id: '123.456.789-00', has_accepted_terms: true }
     * await client.signerDocuments.confirmData(documentId, accessCode, {
     *   full_name: 'Example Signer',
     *   government_id: '123.456.789-00',
     *   has_accepted_terms: true,
     * });
     * ```
     */
    async confirmData(
        documentId: string,
        signerAccessCode: string,
        payload: IConfirmSignerDataPayload,
    ): Promise<ISigner>;
    /**
     * @deprecated Compatibility overload preserving the previous wire shape.
     * `whatsapp_phone_number` is a compatibility pass-through field.
     */
    async confirmData(
        documentId: string,
        signerAccessCode: string,
        payload: ILegacyConfirmSignerDataPayload,
    ): Promise<ISigner>;
    async confirmData(
        documentId: string,
        signerAccessCode: string,
        payload: ILegacyConfirmSignerDataPayload,
    ): Promise<ISigner> {
        assertRecord(payload, 'signer confirmation payload');
        validateConfirmDataPayload(payload);
        const did = this.requireId(documentId, 'Document ID');
        const code = this.requireId(signerAccessCode, 'signer-access-code');
        return this.call<ISigner>('Failed to confirm signer data', () =>
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
     * @deprecated Compatibility overload for non-PNG media types. The current
     * OpenAPI contract specifies only `image/png`; other values are not certified.
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
     * await fs.writeFile('signature.png', png);
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
     * @param hasAcceptedTerms - Maps to the `has_accepted_terms` query param
     *   (server default `false`); pass `true` once the signer has accepted terms.
     *   `false`/`undefined` is omitted only when `undefined` (an explicit `false`
     *   is still sent).
     * @returns The document to sign, including its `assignment` (the
     *   {@link IAssignment} shape: `signers`, `items`, `summary`, `signing_urls`)
     *   from which the `itemId` / `fieldId` / `pageId` values for
     *   {@link SignerDocumentsResource.sign} are read.
     * @throws {ValidationError} If `signerAccessCode` is missing.
     * @throws {ApiError} `400` when DigitalCertificate identity/terms are not
     *   confirmed; `401`/`403` if the access code is invalid or expired; `409`
     *   while the document is still being prepared.
     *
     * @example
     * ```ts
     * // query → ?signer-access-code=<code>&has_accepted_terms=true
     * const assignment = await client.signerDocuments.getAssignment(accessCode, true);
     * ```
     */
    async getAssignment(
        signerAccessCode: string,
        hasAcceptedTerms?: boolean,
    ): Promise<IDocumentDetailsResponse> {
        const code = this.requireId(signerAccessCode, 'signer-access-code');
        if (hasAcceptedTerms !== undefined && typeof hasAcceptedTerms !== 'boolean') {
            throw new ValidationError('hasAcceptedTerms must be a boolean');
        }
        return this.call<IDocumentDetailsResponse>('Failed to fetch signer assignment', () =>
            this.http.get('/sign', {
                params: cleanParams({
                    'signer-access-code': code,
                    has_accepted_terms: hasAcceptedTerms,
                }),
            }),
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
        if (typeof declineReason !== 'string' || !declineReason.trim()) {
            throw new ValidationError('declineReason is required');
        }
        return this.callVoid('Failed to decline assignment', () =>
            this.http.put(
                `/documents/${this.pathSegment(did, 'Document ID')}/assignments/${this.pathSegment(aid, 'Assignment ID')}/reject`,
                { decline_reason: declineReason },
                { params: { 'signer-access-code': code } },
            ),
        );
    }
}

function validateConfirmDataPayload(payload: ILegacyConfirmSignerDataPayload): void {
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
