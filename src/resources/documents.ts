import type { AxiosInstance } from 'axios';
import type {
    DocumentArtifactName,
    DocumentStatus,
    ICostEstimate,
    ICreateDocumentFromTemplateOptions,
    IDocumentActivity,
    IDocumentDetailsResponse,
    IDocumentListItem,
    IDocumentListParams,
    IDocumentSearchParams,
    IDocumentListResponse,
    IDocumentStatusInfo,
    IDocumentUploadResponse,
    IDocumentVerification,
    IPublicDocumentInfo,
    IRenameDocumentResponse,
    ISigningProgress,
    ITag,
    ITemplateCostSigner,
    ITemplateSigner,
    Logger,
    SendTokenChannel,
} from '../types';
import { ApiError, ValidationError } from '../errors';
import { cleanListParams } from '../utils';
import { BaseResource } from './base';
import type { DocumentUploadSource } from './upload';

export type { DocumentUploadSource } from './upload';

const READY_STATUSES: ReadonlySet<DocumentStatus | string> = new Set([
    'metadata_ready',
    'pending_signature',
    'certificated',
]);

const FAILED_STATUSES: ReadonlySet<DocumentStatus | string> = new Set([
    'failed',
    'rejected_by_signer',
    'rejected_by_user',
    'expired',
]);

/** Options accepted by {@link DocumentResource.upload}. */
export interface IDocumentUploadOptions {
    /**
     * Display name for the document. Defaults to the uploaded file's own name.
     *
     * `.pdf` is appended when absent, so `'Service agreement'` is stored as
     * `'Service agreement.pdf'`. Accents are transliterated by the API
     * (`'Contrato de Serviço'` → `'Contrato de Servico.pdf'`).
     */
    name?: string;
    /** Optional metadata sent alongside the file (JSON-encoded). */
    metadata?: Record<string, unknown>;
    /** Override the default account ID configured on the client. */
    accountId?: string;
}

export class DocumentResource extends BaseResource {
    constructor(
        http: AxiosInstance,
        defaultAccountId?: string,
        logger?: Logger,
        private readonly publicHttp: AxiosInstance = http,
    ) {
        super(http, defaultAccountId, logger);
    }

    /**
     * Upload a PDF to the workspace (`POST /accounts/{accountId}/documents`).
     *
     * The document is created in `uploaded` status and progresses through the
     * lifecycle `uploading` → `uploaded` → `metadata_processing` →
     * `metadata_ready`, becoming usable once it reaches `metadata_ready`; use
     * {@link DocumentResource.waitUntilReady} to await that transition. Note
     * that {@link DocumentResource.rename} and {@link DocumentResource.delete}
     * return `400` while the document is still processing.
     *
     * @param source - The PDF to upload, as a file path or an in-memory buffer.
     * @param options - Display name, metadata, and account override.
     * @returns The created document, freshly uploaded (`status: 'uploaded'`,
     * empty `pages` until `metadata_ready`). Response shape:
     * ```jsonc
     * {
     *   "resource": "document",
     *   "id": "103ad216846e6b90710cb9acef59",
     *   "account_id": "acc_example",
     *   "template_id": null,
     *   "name": "Service agreement.pdf",
     *   "status": "uploaded",               // NOT metadata_processing yet
     *   "artifacts": { "original": "https://…/documents/103ad216…/download/original" },
     *   "is_closed": false,
     *   "signing_url": "https://app-sandbox.assinafy.com.br/sign/103ad216…",
     *   "decline_reason": null,
     *   "declined_by": null,
     *   "tags": [],
     *   "pages": [],                          // populated once metadata_ready
     *   "created_at": "2026-07-19T17:24:43Z",
     *   "updated_at": "2026-07-19T17:24:44Z"
     * }
     * ```
     * @throws {ValidationError} If the file is empty, not a `.pdf`, exceeds
     * 25 MB, or the API returns no document ID.
     * @throws {ApiError} If the API rejects the upload.
     *
     * @example
     * ```ts
     * await client.documents.upload({ filePath: './contract.pdf' });
     * await client.documents.upload(
     *   { buffer, fileName: 'contract.pdf' },
     *   { name: 'Service agreement', metadata: { orderId: 'A-1' } },
     * );
     * // → name is stored as 'Service agreement.pdf'
     * ```
     */
    async upload(
        source: DocumentUploadSource,
        options: IDocumentUploadOptions = {},
    ): Promise<IDocumentUploadResponse> {
        const accountId = this.accountId(options.accountId);
        const formOptions: { name?: string; metadata?: Record<string, unknown> } = {};
        if (options.name !== undefined) formOptions.name = options.name;
        if (options.metadata !== undefined) formOptions.metadata = options.metadata;

        const document = await this.uploadPdf<IDocumentUploadResponse>(
            `/accounts/${this.pathSegment(accountId, 'Account ID')}/documents`,
            source,
            formOptions,
            {
                errorLabel: 'Document upload failed',
                missingId: 'Upload succeeded but no document ID was returned',
            },
        );

        this.logger.info('Document uploaded', { documentId: document.id });
        return document;
    }

    /**
     * List workspace documents
     * (`GET /accounts/{accountId}/documents`).
     *
     * The full listing: unlike {@link DocumentResource.search}, each item also
     * carries the expanded `assignment` (or `null`) and the rendered `pages`,
     * so prefer it when you need signing state or page geometry. Pagination
     * info (if any) is attached in `meta`.
     *
     * @param params - Filters and pagination: `status`, `method`, `tags`
     * (comma-separated tag IDs), `search`, `sort`, `page`, `per-page`.
     * @param accountId - Override the client's default account ID.
     * @returns Matching documents, with pagination in `meta`. Each item:
     * ```jsonc
     * {
     *   "id": "103acccd24234c07858ffddf6d84",
     *   "account_id": "acc_example",
     *   "template_id": null,
     *   "name": "sdk-smoke-rename-7b006e52.pdf",
     *   "status": "metadata_ready",
     *   "artifacts": {
     *     "original": "https://…/documents/103acccd…/download/original",
     *     "thumbnail": "https://…/documents/103acccd…/thumbnail"
     *   },
     *   "is_closed": false,
     *   "signing_url": "https://app-sandbox.assinafy.com.br/sign/103acccd…",
     *   "decline_reason": null,
     *   "declined_by": null,
     *   "tags": [],
     *   "assignment": null,                  // an IAssignment once signatures are requested
     *   "pages": [
     *     {
     *       "id": "103acccd5c73af8009c3644af591",
     *       "number": 1,
     *       "height": 1651,
     *       "width": 1275,
     *       "download_url": "https://…/documents/103acccd…/pages/103acccd…/download"
     *     }
     *   ],
     *   "created_at": "2026-07-19T14:56:54Z",
     *   "updated_at": "2026-07-19T14:56:56Z"
     * }
     * ```
     * @throws {ValidationError} If no account ID is available.
     * @throws {ApiError} If the API rejects the request.
     *
     * @example
     * ```ts
     * const { data, meta } = await client.documents.list({
     *   status: 'pending_signature',
     *   method: 'virtual',
     *   'per-page': 50,
     * });
     * console.log(data[0]?.pages.length, meta?.total);
     * ```
     */
    async list(params: IDocumentListParams = {}, accountId?: string): Promise<IDocumentListResponse> {
        const id = this.accountId(accountId);
        return this.callList<IDocumentListItem>('Failed to list documents', () =>
            this.http.get(`/accounts/${this.pathSegment(id, 'Account ID')}/documents`, {
                params: cleanListParams(params),
            }),
        );
    }

    /**
     * Search workspace documents
     * (`GET /accounts/{accountId}/documents/search`).
     *
     * A lighter-weight alternative to {@link DocumentResource.list}: it returns
     * a compact representation with no expanded `assignment` or `pages`, so
     * prefer it for name lookups and pickers.
     *
     * @param params - `search`, `status`, `page`, `per-page`.
     * @param accountId - Override the client's default account ID.
     * @returns Matching documents, with pagination in `meta`. Each item:
     * ```jsonc
     * {
     *   "id": "c3d4e5f6a7b8c9d0e1f2a3b4c5d6",
     *   "account_id": "d4e5f6a7b8c9d0e1f2a3b4c5d6e7",
     *   "template_id": null,
     *   "name": "Service agreement.pdf",
     *   "status": "pending_signature",
     *   "artifacts": { "original": "https://…" },
     *   "is_closed": false,
     *   "signing_url": "https://…",
     *   "decline_reason": null,
     *   "declined_by": null,
     *   "tags": [],
     *   "created_at": "2026-07-15T16:15:33Z",
     *   "updated_at": "2026-07-15T16:15:40Z"
     * }
     * ```
     * @throws {ValidationError} If no account ID is available.
     * @throws {ApiError} If the API rejects the request.
     *
     * @example
     * ```ts
     * const { data, meta } = await client.documents.search({
     *   search: 'agreement',
     *   status: 'pending_signature',
     *   'per-page': 20,
     * });
     * ```
     */
    async search(
        params: IDocumentSearchParams = {},
        accountId?: string,
    ): Promise<IDocumentListResponse> {
        const id = this.accountId(accountId);
        return this.callList<IDocumentListItem>('Failed to search documents', () =>
            this.http.get(`/accounts/${this.pathSegment(id, 'Account ID')}/documents/search`, {
                params: cleanListParams(params),
            }),
        );
    }

    /**
     * Rename a document (`PATCH /documents/{documentId}`).
     *
     * Only valid while the document is still renameable: the API returns `400`
     * ("Document cannot be renamed after the signature process has started")
     * both once signing has begun **and** while the document is still in
     * `metadata_processing` immediately after upload. Await
     * {@link DocumentResource.waitUntilReady} before renaming a fresh upload.
     *
     * To set a name at upload time instead, pass `name` to
     * {@link DocumentResource.upload} — that avoids the extra round-trip and
     * the processing race entirely.
     *
     * @param documentId - The document to rename.
     * @param name - The new display name (max 255 chars), e.g.
     * `'Service agreement.pdf'`.
     * @returns The updated document — **without** `pages` or `assignment`,
     * which this endpoint does not return (unlike
     * {@link DocumentResource.details}). Call `details()` if you need them.
     * @throws {ValidationError} If `documentId` or `name` is missing.
     * @throws {ApiError} `400` if the document is processing or already in
     * signing; `404` if it does not exist.
     *
     * @example
     * ```ts
     * const doc = await client.documents.upload({ filePath: './c.pdf' });
     * await client.documents.waitUntilReady(doc.id);   // else 400
     * await client.documents.rename(doc.id, 'Service agreement.pdf');
     * ```
     */
    async rename(documentId: string, name: string): Promise<IRenameDocumentResponse> {
        const id = this.requireId(documentId, 'Document ID');
        const newName = this.requireId(name, 'Name');
        this.logger.info('Renaming document', { documentId: id });
        return this.call('Failed to rename document', () =>
            this.http.patch(`/documents/${this.pathSegment(id, 'Document ID')}`, {
                name: newName,
            }),
        );
    }

    /**
     * Get document details (`GET /documents/{documentId}`).
     *
     * The full single-document view, including the embedded `assignment` (or
     * `null`), rendered `pages`, and `artifacts`.
     *
     * @param documentId - The document to fetch.
     * @returns The document. Response shape (once `metadata_ready`):
     * ```jsonc
     * {
     *   "resource": "document",
     *   "id": "103ad216846e6b90710cb9acef59",
     *   "account_id": "acc_example",
     *   "template_id": null,
     *   "name": "audit-test.pdf",
     *   "status": "metadata_ready",
     *   "artifacts": {
     *     "original": "https://…/documents/103ad216…/download/original",
     *     "thumbnail": "https://…/documents/103ad216…/thumbnail"
     *   },
     *   "is_closed": false,
     *   "signing_url": "https://app-sandbox.assinafy.com.br/sign/103ad216…",
     *   "decline_reason": null,
     *   "declined_by": null,
     *   "tags": [],
     *   "assignment": null,
     *   "pages": [
     *     {
     *       "id": "103ad216be62159d3087452d7cf8",
     *       "number": 1,
     *       "height": 1651,
     *       "width": 1275,
     *       "download_url": "https://…/documents/103ad216…/pages/103ad216…/download"
     *     }
     *   ],
     *   "created_at": "2026-07-19T17:24:43Z",
     *   "updated_at": "2026-07-19T17:24:46Z"
     * }
     * ```
     * @throws {ValidationError} If `documentId` is missing.
     * @throws {ApiError} `404` if the document does not exist.
     *
     * @example
     * ```ts
     * const doc = await client.documents.details('103ad216846e6b90710cb9acef59');
     * console.log(doc.status, doc.pages.length);
     * ```
     */
    async details(documentId: string): Promise<IDocumentDetailsResponse> {
        const id = this.requireId(documentId, 'Document ID');
        return this.call('Failed to fetch document details', () =>
            this.http.get(`/documents/${this.pathSegment(id, 'Document ID')}`),
        );
    }

    /**
     * Alias for {@link DocumentResource.details}
     * (`GET /documents/{documentId}`).
     *
     * @param documentId - The document to fetch.
     * @returns The document details (see {@link DocumentResource.details} for
     * the response shape).
     * @throws {ValidationError} If `documentId` is missing.
     * @throws {ApiError} `404` if the document does not exist.
     *
     * @example
     * ```ts
     * const doc = await client.documents.get('103ad216846e6b90710cb9acef59');
     * ```
     */
    async get(documentId: string): Promise<IDocumentDetailsResponse> {
        return this.details(documentId);
    }

    /**
     * Poll {@link DocumentResource.details} until the document reaches a ready
     * status (`metadata_ready`, `pending_signature`, or `certificated`),
     * throwing on a terminal failure status or timeout.
     *
     * Transient errors are tolerated — a `5xx` or `429` is retried on the next
     * poll — but a non-retryable `4xx` (bad key, wrong account, deleted
     * document) is surfaced immediately rather than masked as a timeout.
     *
     * @param documentId - The document to wait on.
     * @param options - `maxWaitMs` (default `30_000`) and `pollIntervalMs`
     * (default `2_000`).
     * @returns The document details once it reaches a ready status (see
     * {@link DocumentResource.details} for the shape).
     * @throws {ValidationError} If `documentId` is missing, the document enters
     * a terminal failure status (`failed`, `rejected_by_signer`,
     * `rejected_by_user`, `expired` — message
     * `Document processing failed with status: <status>`), or the wait times
     * out (`Timeout waiting for document to be ready`).
     * @throws {ApiError} On a non-retryable `4xx` other than `429`.
     *
     * @example
     * ```ts
     * const doc = await client.documents.upload({ filePath: './c.pdf' });
     * const ready = await client.documents.waitUntilReady(doc.id, {
     *   maxWaitMs: 60_000,
     *   pollIntervalMs: 3_000,
     * });
     * console.log(ready.status); // 'metadata_ready'
     * ```
     */
    async waitUntilReady(
        documentId: string,
        options: { maxWaitMs?: number; pollIntervalMs?: number } = {},
    ): Promise<IDocumentDetailsResponse> {
        const id = this.requireId(documentId, 'Document ID');
        const maxWaitMs = options.maxWaitMs ?? 30_000;
        const pollIntervalMs = options.pollIntervalMs ?? 2_000;
        validateWaitOption(maxWaitMs, 'maxWaitMs');
        validateWaitOption(pollIntervalMs, 'pollIntervalMs');
        const start = Date.now();
        let attempts = 0;

        this.logger.info('Waiting for document to be ready', { documentId: id, maxWaitMs });

        while (Date.now() - start < maxWaitMs) {
            attempts++;
            try {
                const details = await this.details(id);
                const status = details.status ?? 'unknown';
                this.logger.debug('Document status check', { attempts, status });

                if (READY_STATUSES.has(status)) return details;
                if (FAILED_STATUSES.has(status)) {
                    throw new ValidationError(`Document processing failed with status: ${status}`, {
                        status,
                    });
                }
            } catch (err) {
                if (err instanceof ValidationError) throw err;
                // Only transient failures are worth another poll. A 4xx (bad key,
                // wrong account, deleted document) will never resolve by waiting,
                // so surface it now instead of masking it as a timeout — 429 is
                // the exception: it is transient and may carry a Retry-After
                // hint that the retry interceptor honors.
                if (err instanceof ApiError && err.statusCode < 500 && err.statusCode !== 429) {
                    throw err;
                }
                this.logger.warn('Error checking document status', {
                    error: err instanceof Error ? err.message : String(err),
                });
            }
            await sleep(pollIntervalMs);
        }

        throw new ValidationError('Timeout waiting for document to be ready', {
            documentId: id,
            attempts,
        });
    }

    /**
     * Download a document artifact as raw bytes
     * (`GET /documents/{documentId}/download/{artifactName}`).
     *
     * @param documentId - The document to download from.
     * @param artifactName - Which artifact to fetch: `original`,
     * `certificated` (the default — the signed PDF), `certificate-page`, or
     * `bundle`.
     * @returns A {@link Buffer} of the artifact's bytes (PDF).
     * @throws {ValidationError} If `documentId` is missing.
     * @throws {ApiError} `404` if the document or artifact does not exist (e.g.
     * requesting `certificated` before signing completes).
     *
     * @example
     * ```ts
     * const pdf = await client.documents.download('doc-1'); // signed PDF
     * const original = await client.documents.download('doc-1', 'original');
     * await fs.promises.writeFile('signed.pdf', pdf);
     * ```
     */
    async download(
        documentId: string,
        artifactName: DocumentArtifactName = 'certificated',
    ): Promise<Buffer> {
        const id = this.requireId(documentId, 'Document ID');
        return this.callBinary('Failed to download document', () =>
            this.http.get<ArrayBuffer>(
                `/documents/${this.pathSegment(id, 'Document ID')}/download/${this.pathSegment(artifactName, 'Artifact name')}`,
                { responseType: 'arraybuffer' },
            ),
        );
    }

    /**
     * Download the document thumbnail image
     * (`GET /documents/{documentId}/thumbnail`).
     *
     * @param documentId - The document whose thumbnail to fetch.
     * @returns A {@link Buffer} of the thumbnail image bytes.
     * @throws {ValidationError} If `documentId` is missing.
     * @throws {ApiError} `404` if the document or its thumbnail does not exist.
     *
     * @example
     * ```ts
     * const thumb = await client.documents.thumbnail('doc-1');
     * await fs.promises.writeFile('thumb.jpg', thumb);
     * ```
     */
    async thumbnail(documentId: string): Promise<Buffer> {
        const id = this.requireId(documentId, 'Document ID');
        return this.callBinary('Failed to download document thumbnail', () =>
            this.http.get<ArrayBuffer>(
                `/documents/${this.pathSegment(id, 'Document ID')}/thumbnail`,
                { responseType: 'arraybuffer' },
            ),
        );
    }

    /**
     * Download a single rendered page as a JPEG
     * (`GET /documents/{documentId}/pages/{pageId}/download`).
     *
     * The `pageId` comes from a page's `id` in {@link DocumentResource.details}
     * or {@link DocumentResource.list} (`pages[].id`).
     *
     * @param documentId - The document the page belongs to.
     * @param pageId - The page to download.
     * @returns A {@link Buffer} of the page's JPEG bytes.
     * @throws {ValidationError} If `documentId` or `pageId` is missing.
     * @throws {ApiError} `404` if the document or page does not exist.
     *
     * @example
     * ```ts
     * const doc = await client.documents.details('doc-1');
     * const page = await client.documents.downloadPage('doc-1', doc.pages[0].id);
     * await fs.promises.writeFile('page-1.jpg', page);
     * ```
     */
    async downloadPage(documentId: string, pageId: string): Promise<Buffer> {
        const docId = this.requireId(documentId, 'Document ID');
        const pid = this.requireId(pageId, 'Page ID');
        return this.callBinary('Failed to download page', () =>
            this.http.get<ArrayBuffer>(
                `/documents/${this.pathSegment(docId, 'Document ID')}/pages/${this.pathSegment(pid, 'Page ID')}/download`,
                { responseType: 'arraybuffer' },
            ),
        );
    }

    /**
     * Fetch the document activity log
     * (`GET /documents/{documentId}/activities`).
     *
     * Returns a chronological audit trail of lifecycle events. Normalises an
     * absent body to `[]`.
     *
     * @param documentId - The document whose activity log to fetch.
     * @returns The activity entries (newest first), or `[]`:
     * ```jsonc
     * [
     *   {
     *     "id": 15272,
     *     "event": "document_metadata_ready",
     *     "message": "Documento processado.",
     *     "payload": [],
     *     "origin": null,                    // system event
     *     "created_at": "2026-07-19T14:56:56Z"
     *   },
     *   {
     *     "id": 15271,
     *     "event": "document_uploaded",
     *     "message": "Documento criado.",
     *     "payload": [],
     *     "origin": { "ip": "99.75.13.162", "user-agent": "assinafy-webforms-java-client-sdk" },
     *     "created_at": "2026-07-19T14:56:55Z"
     *   }
     * ]
     * ```
     * @throws {ValidationError} If `documentId` is missing.
     * @throws {ApiError} If the API rejects the request.
     *
     * @example
     * ```ts
     * const events = await client.documents.activities('doc-1');
     * console.log(events.map((e) => e.event));
     * ```
     */
    async activities(documentId: string): Promise<IDocumentActivity[]> {
        const id = this.requireId(documentId, 'Document ID');
        const result = await this.call<IDocumentActivity[] | null>(
            'Failed to fetch document activities',
            () => this.http.get(`/documents/${this.pathSegment(id, 'Document ID')}/activities`),
        );
        return result ?? [];
    }

    /**
     * Delete a document (`DELETE /documents/{documentId}`).
     *
     * Only documents in a deletable status can be removed — the API returns
     * `400` while the document is still `uploading` / `metadata_processing`
     * (await {@link DocumentResource.waitUntilReady} first) or once it has been
     * certificated.
     *
     * @param documentId - The document to delete.
     * @returns Nothing on success.
     * @throws {ValidationError} If `documentId` is missing.
     * @throws {ApiError} `400` if the document is not in a deletable status;
     * `404` if it does not exist.
     *
     * @example
     * ```ts
     * await client.documents.delete('doc-1');
     * ```
     */
    async delete(documentId: string): Promise<void> {
        const id = this.requireId(documentId, 'Document ID');
        return this.callVoid('Failed to delete document', () =>
            this.http.delete(`/documents/${this.pathSegment(id, 'Document ID')}`),
        );
    }

    /**
     * List the tags attached to a document
     * (`GET /accounts/{accountId}/documents/{documentId}/tags`).
     *
     * @param documentId - The document whose tags to list.
     * @param accountId - Override the client's default account ID.
     * @returns The attached tags:
     * ```jsonc
     * [
     *   {
     *     "resource": "tag",
     *     "id": "103aa252123d3bf1843a317ee0e6",
     *     "name": "urgent",
     *     "color": "ff8800",
     *     "created_at": "2026-07-18T19:09:03Z",
     *     "updated_at": "2026-07-18T19:09:03Z"
     *   }
     * ]
     * ```
     * @throws {ValidationError} If `documentId` is missing or no account ID is
     * available.
     * @throws {ApiError} If the API rejects the request.
     *
     * @example
     * ```ts
     * const tags = await client.documents.listTags('doc-1');
     * ```
     */
    async listTags(documentId: string, accountId?: string): Promise<ITag[]> {
        const accId = this.accountId(accountId);
        const docId = this.requireId(documentId, 'Document ID');
        return this.call('Failed to list document tags', () =>
            this.http.get(
                `/accounts/${this.pathSegment(accId, 'Account ID')}/documents/${this.pathSegment(docId, 'Document ID')}/tags`,
            ),
        );
    }

    /**
     * Replace the document's tag set
     * (`PUT /accounts/{accountId}/documents/{documentId}/tags`).
     *
     * The official contract defines `tags` as an array of tag **IDs**. An empty
     * array detaches all tags. Some environments have also accepted names and
     * auto-created missing tags, but that is an undocumented extension and
     * should not be relied on. This overwrites the existing set — use
     * {@link DocumentResource.addTags} to append.
     *
     * @param documentId - The document to retag.
     * @param tags - The complete desired set of tag IDs (`[]` clears all).
     * @param accountId - Override the client's default account ID.
     * @returns The document's tags after the replace:
     * ```jsonc
     * [
     *   { "resource": "tag", "id": "103aa252…", "name": "signed", "color": null,
     *     "created_at": "2026-07-18T19:09:03Z", "updated_at": "2026-07-18T19:09:03Z" }
     * ]
     * ```
     * @throws {ValidationError} If `tags` is not an array, `documentId` is
     * missing, or no account ID is available.
     * @throws {ApiError} If the API rejects the request.
     *
     * @example
     * ```ts
     * await client.documents.replaceTags('doc-1', ['tag-signed', 'tag-archived']);
     * await client.documents.replaceTags('doc-1', []); // detach all
     * ```
     */
    async replaceTags(documentId: string, tags: string[], accountId?: string): Promise<ITag[]> {
        const accId = this.accountId(accountId);
        const docId = this.requireId(documentId, 'Document ID');
        if (!Array.isArray(tags)) throw new ValidationError('tags must be an array of tag IDs');
        return this.call('Failed to replace document tags', () =>
            this.http.put(
                `/accounts/${this.pathSegment(accId, 'Account ID')}/documents/${this.pathSegment(docId, 'Document ID')}/tags`,
                { tags },
            ),
        );
    }

    /**
     * Attach additional tags without removing existing ones
     * (`POST /accounts/{accountId}/documents/{documentId}/tags`).
     *
     * `tags` is a non-empty array of tag **IDs**. Attaching an ID already
     * present is a no-op. To replace the whole set instead, use
     * {@link DocumentResource.replaceTags}.
     *
     * @param documentId - The document to tag.
     * @param tags - Tag IDs to attach (must be non-empty).
     * @param accountId - Override the client's default account ID.
     * @returns The document's tags after the attach:
     * ```jsonc
     * [
     *   { "resource": "tag", "id": "103aa252…", "name": "urgent", "color": null,
     *     "created_at": "2026-07-18T19:09:03Z", "updated_at": "2026-07-18T19:09:03Z" }
     * ]
     * ```
     * @throws {ValidationError} If `tags` is empty or not an array,
     * `documentId` is missing, or no account ID is available.
     * @throws {ApiError} If the API rejects the request.
     *
     * @example
     * ```ts
     * await client.documents.addTags('doc-1', ['tag-urgent']);
     * ```
     */
    async addTags(documentId: string, tags: string[], accountId?: string): Promise<ITag[]> {
        const accId = this.accountId(accountId);
        const docId = this.requireId(documentId, 'Document ID');
        if (!Array.isArray(tags) || tags.length === 0) {
            throw new ValidationError('tags must be a non-empty array of tag IDs');
        }
        return this.call('Failed to add document tags', () =>
            this.http.post(
                `/accounts/${this.pathSegment(accId, 'Account ID')}/documents/${this.pathSegment(docId, 'Document ID')}/tags`,
                { tags },
            ),
        );
    }

    /**
     * Detach a single tag from a document
     * (`DELETE /accounts/{accountId}/documents/{documentId}/tags/{tagId}`).
     *
     * Removes the association only — the workspace tag itself is not deleted.
     * Like {@link DocumentResource.addTags} /
     * {@link DocumentResource.replaceTags}, this takes the tag's **ID**.
     *
     * @param documentId - The document to detach from.
     * @param tagId - The ID of the tag to detach.
     * @param accountId - Override the client's default account ID.
     * @returns Nothing on success.
     * @throws {ValidationError} If `documentId` or `tagId` is missing, or no
     * account ID is available.
     * @throws {ApiError} If the API rejects the request.
     *
     * @example
     * ```ts
     * await client.documents.detachTag('doc-1', 'tag-1');
     * ```
     */
    async detachTag(documentId: string, tagId: string, accountId?: string): Promise<void> {
        const accId = this.accountId(accountId);
        const docId = this.requireId(documentId, 'Document ID');
        const tid = this.requireId(tagId, 'Tag ID');
        return this.callVoid('Failed to detach document tag', () =>
            this.http.delete(
                `/accounts/${this.pathSegment(accId, 'Account ID')}/documents/${this.pathSegment(docId, 'Document ID')}/tags/${this.pathSegment(tid, 'Tag ID')}`,
            ),
        );
    }

    /**
     * Create a document from a template
     * (`POST /accounts/{accountId}/templates/{templateId}/documents`).
     *
     * Instantiates the template, binding each role to a signer, and returns the
     * new document. The request body is `{ signers, ...options }` — `signers`
     * maps template `role_id` → signer `id`, and `options` may add `name`,
     * `message`, `expires_at`, `editor_fields`, and `tags`.
     *
     * @param templateId - The template to instantiate.
     * @param signers - Role-to-signer bindings (each with `role_id` and `id`,
     * plus optional `verification_method`, `notification_methods`, `step`).
     * @param options - Optional `name`, `message`, `expires_at`,
     * `editor_fields`, `tags`.
     * @param accountId - Override the client's default account ID.
     * @returns The created document (an {@link IDocumentDetailsResponse} with
     * `template_id` set and its `assignment` populated):
     * ```jsonc
     * {
     *   "resource": "document",
     *   "id": "19f675b761b392a48b8642503bb",
     *   "account_id": "acc_example",
     *   "template_id": "103a0991a5cde83518e5672aa9aa",
     *   "name": "Audit From Template",
     *   "status": "pending_signature",
     *   "artifacts": { "original": "https://…/download/original", "thumbnail": "https://…/thumbnail" },
     *   "is_closed": false,
     *   "signing_url": "https://app-sandbox.assinafy.com.br/sign/19f675b7…",
     *   "tags": [{ "id": "103a0992…", "name": "audit-tmp-fromtmpl", "color": null }],
     *   "assignment": { "id": "103a09a1…", "method": "virtual", "summary": { "signer_count": 1, "completed_count": 0 } },
     *   "pages": [{ "id": "103a0992…", "number": 1, "height": 1651, "width": 1275, "download_url": "https://…/download" }],
     *   "created_at": "2026-07-15T19:57:55Z",
     *   "updated_at": "2026-07-15T19:59:33Z"
     * }
     * ```
     * @throws {ValidationError} If `templateId` is missing or no account ID is
     * available.
     * @throws {ApiError} `400` if the signers/roles are invalid or the template
     * is not ready.
     *
     * @example
     * ```ts
     * await client.documents.createFromTemplate('tmpl_id', [
     *   { role_id: 'role_id', id: 'signer_id', verification_method: 'Email', notification_methods: ['Email'] },
     * ], { name: 'My Contract' });
     * ```
     */
    async createFromTemplate(
        templateId: string,
        signers: ITemplateSigner[],
        options: ICreateDocumentFromTemplateOptions = {},
        accountId?: string,
    ): Promise<IDocumentDetailsResponse> {
        const tmplId = this.requireId(templateId, 'Template ID');
        const accId = this.accountId(accountId);
        const body: Record<string, unknown> = {
            ...options,
            signers: normaliseTemplateSigners(signers),
        };
        this.logger.info('Creating document from template', { templateId: tmplId, accountId: accId });
        return this.call('Failed to create document from template', () =>
            this.http.post(
                `/accounts/${this.pathSegment(accId, 'Account ID')}/templates/${this.pathSegment(tmplId, 'Template ID')}/documents`,
                body,
            ),
        );
    }

    /**
     * Estimate the credit cost of creating a document from a template
     * (`POST /accounts/{accountId}/templates/{templateId}/documents/estimate-cost`).
     *
     * A dry run: sends only `{ signers }` and consumes nothing. Use it to check
     * balances before calling {@link DocumentResource.createFromTemplate}.
     *
     * @param templateId - The template that would be instantiated.
     * @param signers - One channel descriptor per template role. Cost requests
     * use only `role_id`, `verification_method`, and `notification_methods`;
     * they do not send a signer ID or signing-order step.
     * @param accountId - Override the client's default account ID.
     * @returns An {@link ICostEstimate}: `total_credits`, balances, and a
     * per-line `breakdown` of what the operation would consume:
     * ```jsonc
     * {
     *   "documents": 1,
     *   "credits": 1,
     *   "needs_extra_document": false,
     *   "extra_document_cost": 0,
     *   "total_credits": 1,
     *   "breakdown": [
     *     { "code": "signature", "name": "Assinatura", "cost": 1, "quantity": 1, "unit_cost": 1 }
     *   ],
     *   "document_balance": 10,
     *   "credit_balance": 250,
     *   "has_sufficient_resources": true,
     *   "blocking_reason": null,
     *   "message": null
     * }
     * ```
     * @throws {ValidationError} If `templateId` is missing or no account ID is
     * available.
     * @throws {ApiError} If the API rejects the request.
     *
     * @example
     * ```ts
     * const estimate = await client.documents.estimateCostFromTemplate('tmpl_id', [
     *   { role_id: 'role_id', verification_method: 'Email' },
     * ]);
     * if (!estimate.has_sufficient_resources) throw new Error(estimate.blocking_reason ?? 'insufficient');
     * ```
     */
    async estimateCostFromTemplate(
        templateId: string,
        signers: ITemplateCostSigner[],
        accountId?: string,
    ): Promise<ICostEstimate> {
        const tmplId = this.requireId(templateId, 'Template ID');
        const accId = this.accountId(accountId);
        const costSigners = normaliseTemplateCostSigners(signers);
        return this.call('Failed to estimate cost from template', () =>
            this.http.post(
                `/accounts/${this.pathSegment(accId, 'Account ID')}/templates/${this.pathSegment(tmplId, 'Template ID')}/documents/estimate-cost`,
                { signers: costSigners },
            ),
        );
    }

    /**
     * Verify a signed document by its signature hash
     * (`GET /documents/{documentSignatureHash}/verify`).
     *
     * Public authenticity check: given the hash embedded in a certificated
     * document, returns the API's typed verification record for it. Unknown
     * hashes still return HTTP 200 with `is_valid: false`.
     *
     * @param hash - The document's signature hash (the
     * `documentSignatureHash` path segment).
     * @returns `{ hash, id, status, page_count, signer_count, completed_count,
     * completed_at, verified_at, is_valid, message }`.
     * @throws {ValidationError} If `hash` is missing.
     * @throws {ApiError} If the API rejects the request.
     *
     * @example
     * ```ts
     * const result = await client.documents.verify('a7b8c9d0e1f2…');
     * ```
     */
    async verify(hash: string): Promise<IDocumentVerification> {
        const h = this.requireId(hash, 'Signature hash');
        return this.call('Failed to verify document', () =>
            this.publicHttp.get(`/documents/${this.pathSegment(h, 'Signature hash')}/verify`),
        );
    }

    /**
     * List every possible document status (`GET /documents/statuses`).
     *
     * A static catalog (11 entries) of each status `code` and whether documents
     * in that status can be deleted (`deletable`). This catalog requires the
     * same API-key or Bearer authentication as other workspace operations.
     *
     * @returns The status catalog:
     * ```jsonc
     * [
     *   { "code": "uploading", "deletable": false },
     *   { "code": "uploaded", "deletable": false },
     *   { "code": "metadata_processing", "deletable": false },
     *   { "code": "metadata_ready", "deletable": true },
     *   { "code": "pending_signature", "deletable": true },
     *   { "code": "certificated", "deletable": false }
     *   // …11 total: also expired, certificating, rejected_by_signer,
     *   //            rejected_by_user, failed
     * ]
     * ```
     * @throws {ApiError} If the API rejects the request.
     *
     * @example
     * ```ts
     * const statuses = await client.documents.statuses();
     * const deletable = statuses.filter((s) => s.deletable).map((s) => s.code);
     * ```
     */
    async statuses(): Promise<IDocumentStatusInfo[]> {
        return this.call('Failed to list document statuses', () =>
            this.http.get('/documents/statuses'),
        );
    }

    /**
     * Public, unauthenticated lookup of basic document info
     * (`GET /public/documents/{documentId}`).
     *
     * Used by the signing portal before the signer authenticates via the access
     * code, so it returns only non-sensitive fields.
     *
     * @param documentId - The document to look up.
     * @returns Basic public info for the document:
     * ```jsonc
     * {
     *   "resource": "document",
     *   "id": "103ad216846e6b90710cb9acef59",
     *   "name": "Service agreement.pdf",
     *   "page_count": 1,
     *   "created_by": "Multica Test"
     * }
     * ```
     * @throws {ValidationError} If `documentId` is missing.
     * @throws {ApiError} `404` if the document does not exist.
     *
     * @example
     * ```ts
     * const info = await client.documents.getPublic('103ad216846e6b90710cb9acef59');
     * ```
     */
    async getPublic(documentId: string): Promise<IPublicDocumentInfo> {
        const id = this.requireId(documentId, 'Document ID');
        return this.call('Failed to fetch public document info', () =>
            this.publicHttp.get(`/public/documents/${this.pathSegment(id, 'Document ID')}`),
        );
    }

    /**
     * Send the signer's access token to their email / WhatsApp
     * (`PUT /public/documents/{documentId}/send-token`).
     *
     * Part of the public signing flow: dispatches the 6-digit verification
     * token the signer enters to view the document. The documented request body
     * is `{ email }`. For compatibility with Assinafy environments that still
     * require the older contract, passing an explicit `channel` sends
     * `{ recipient, channel }`; the two-argument documented call also retries
     * that legacy shape only when the server explicitly reports that
     * `channel`/`recipient` is required.
     *
     * @param documentId - The document to send the token for.
     * @param recipient - The signer's email address (or WhatsApp number when an
     * explicit channel is supplied).
     * @param channel - Optional legacy delivery channel.
     * @returns Nothing after the API's empty acknowledgement.
     * @throws {ValidationError} If `documentId` or `recipient` is missing.
     * @throws {ApiError} If the API rejects the request.
     *
     * @example
     * ```ts
     * await client.documents.sendToken('doc-1', 'signer@example.com');
     * await client.documents.sendToken('doc-1', '+5511999998888', 'whatsapp');
     * ```
     */
    async sendToken(documentId: string, email: string): Promise<void>;
    async sendToken(
        documentId: string,
        recipient: string,
        channel: SendTokenChannel,
    ): Promise<void>;
    async sendToken(
        documentId: string,
        recipient: string,
        channel?: SendTokenChannel,
    ): Promise<void> {
        const id = this.requireId(documentId, 'Document ID');
        if (!recipient) throw new ValidationError('recipient is required');
        const path = `/public/documents/${this.pathSegment(id, 'Document ID')}/send-token`;
        if (channel !== undefined) {
            return this.callVoid('Failed to send signing token', () =>
                this.publicHttp.put(path, { recipient, channel }),
            );
        }

        try {
            return await this.callVoid('Failed to send signing token', () =>
                this.publicHttp.put(path, { email: recipient }),
            );
        } catch (error) {
            if (!isLegacySendTokenValidation(error)) throw error;
            return this.callVoid('Failed to send signing token', () =>
                this.publicHttp.put(path, { recipient, channel: 'email' }),
            );
        }
    }

    /**
     * Quick boolean check: has every signer completed their assignment?
     *
     * A computed convenience over {@link DocumentResource.details} (one `GET
     * /documents/{documentId}`). Returns `true` when the document status is
     * `certificated`, or when the assignment summary reports at least one signer
     * and `signer_count === completed_count`. Returns `false` when there is no
     * assignment summary (nothing to sign yet) or counts disagree.
     *
     * @param documentId - The document to check.
     * @returns `true` if fully signed, otherwise `false`.
     * @throws {ValidationError} If `documentId` is missing.
     * @throws {ApiError} `404` if the document does not exist.
     *
     * @example
     * ```ts
     * if (await client.documents.isFullySigned('doc-1')) {
     *   const pdf = await client.documents.download('doc-1');
     * }
     * ```
     */
    async isFullySigned(documentId: string): Promise<boolean> {
        const details = await this.details(documentId);
        if (details.status === 'certificated') return true;
        const summary = details.assignment?.summary;
        if (summary && typeof summary.signer_count === 'number') {
            return summary.signer_count > 0 && summary.signer_count === summary.completed_count;
        }
        return false;
    }

    /**
     * Summarise signing progress for UI display.
     *
     * A computed convenience over {@link DocumentResource.details} (one `GET
     * /documents/{documentId}`). `total` and `signed` come from the assignment
     * summary's `signer_count` / `completed_count`; when the summary is absent
     * `total` falls back to `assignment.signers.length` (and `signed` to `0`).
     * `percentage` is `signed / total` rounded to two decimals (`0` when
     * `total` is `0`).
     *
     * @param documentId - The document to summarise.
     * @returns An {@link ISigningProgress}, e.g. one of three signed:
     * ```jsonc
     * { "signed": 1, "total": 3, "pending": 2, "percentage": 33.33 }
     * ```
     * @throws {ValidationError} If `documentId` is missing.
     * @throws {ApiError} `404` if the document does not exist.
     *
     * @example
     * ```ts
     * const { signed, total, percentage } = await client.documents.getSigningProgress('doc-1');
     * console.log(`${signed}/${total} (${percentage}%)`);
     * ```
     */
    async getSigningProgress(documentId: string): Promise<ISigningProgress> {
        const details = await this.details(documentId);
        const summary = details.assignment?.summary;
        const total = summary?.signer_count ?? details.assignment?.signers?.length ?? 0;
        const signed = summary?.completed_count ?? 0;
        const pending = Math.max(total - signed, 0);
        const percentage = total > 0 ? Math.round((signed / total) * 10_000) / 100 : 0;
        return { signed, total, pending, percentage };
    }
}

function normaliseTemplateSigners(signers: ITemplateSigner[]): ITemplateSigner[] {
    if (!Array.isArray(signers) || signers.length === 0) {
        throw new ValidationError('At least one template signer is required');
    }
    return signers.map((signer, index) => {
        if (!signer || typeof signer !== 'object') {
            throw new ValidationError(`Template signer ${index + 1} is invalid`);
        }
        if (typeof signer.role_id !== 'string' || !signer.role_id.trim()) {
            throw new ValidationError(`Template signer ${index + 1} requires role_id`);
        }
        if (typeof signer.id !== 'string' || !signer.id.trim()) {
            throw new ValidationError(`Template signer ${index + 1} requires id`);
        }
        return signer;
    });
}

function normaliseTemplateCostSigners(signers: ITemplateCostSigner[]): ITemplateCostSigner[] {
    if (!Array.isArray(signers) || signers.length === 0) {
        throw new ValidationError('At least one template role is required for cost estimation');
    }
    return signers.map((signer, index) => {
        if (!signer || typeof signer !== 'object') {
            throw new ValidationError(`Template cost signer ${index + 1} is invalid`);
        }
        if (typeof signer.role_id !== 'string' || !signer.role_id.trim()) {
            throw new ValidationError(`Template cost signer ${index + 1} requires role_id`);
        }
        const descriptor: ITemplateCostSigner = { role_id: signer.role_id };
        if (signer.verification_method !== undefined) {
            descriptor.verification_method = signer.verification_method;
        }
        if (signer.notification_methods !== undefined) {
            descriptor.notification_methods = signer.notification_methods;
        }
        return descriptor;
    });
}

function validateWaitOption(value: number, name: 'maxWaitMs' | 'pollIntervalMs'): void {
    if (!Number.isFinite(value) || value < 0) {
        throw new ValidationError(`${name} must be a finite, non-negative number`, {
            [name]: value,
        });
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function isLegacySendTokenValidation(error: unknown): boolean {
    if (!(error instanceof ApiError) || (error.statusCode !== 400 && error.statusCode !== 422)) {
        return false;
    }
    const detail = `${error.message} ${JSON.stringify(error.responseData)}`.toLowerCase();
    return detail.includes('channel') || detail.includes('recipient');
}
