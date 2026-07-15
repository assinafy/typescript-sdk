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
    IPublicDocumentInfo,
    IRenameDocumentResponse,
    ISigningProgress,
    ITag,
    ITemplateSigner,
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
    /**
     * Upload a PDF to the workspace (`POST /accounts/{accountId}/documents`).
     *
     * The document is created in `metadata_processing` status and becomes
     * usable once it reaches `metadata_ready`; use
     * {@link DocumentResource.waitUntilReady} to await that transition. Note
     * that {@link DocumentResource.rename} and {@link DocumentResource.delete}
     * return `400` while the document is still processing.
     *
     * @param source - The PDF to upload, as a file path or an in-memory buffer.
     * @param options - Display name, metadata, and account override.
     * @returns The created document. Response shape:
     * ```jsonc
     * {
     *   "resource": "document",
     *   "id": "c3d4e5f6a7b8c9d0e1f2a3b4c5d6",
     *   "name": "Service agreement.pdf",
     *   "status": "metadata_processing",
     *   "created_at": "2026-07-15T16:15:33Z",
     *   "updated_at": "2026-07-15T16:15:33Z"
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
            `/accounts/${accountId}/documents`,
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
     * List workspace documents. Pagination info (if any) is attached in `meta`.
     * Supports `status`, `method`, `tags`, `search`, `sort`, `page`, `per-page`.
     */
    async list(params: IDocumentListParams = {}, accountId?: string): Promise<IDocumentListResponse> {
        const id = this.accountId(accountId);
        return this.callList<IDocumentListItem>('Failed to list documents', () =>
            this.http.get(`/accounts/${id}/documents`, { params: cleanListParams(params) }),
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
            this.http.get(`/accounts/${id}/documents/search`, { params: cleanListParams(params) }),
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
            this.http.patch(`/documents/${id}`, { name: newName }),
        );
    }

    /** Get document details. */
    async details(documentId: string): Promise<IDocumentDetailsResponse> {
        const id = this.requireId(documentId, 'Document ID');
        return this.call('Failed to fetch document details', () => this.http.get(`/documents/${id}`));
    }

    /** Alias for {@link details}. */
    async get(documentId: string): Promise<IDocumentDetailsResponse> {
        return this.details(documentId);
    }

    /** Poll document status until ready (or a terminal status / timeout). */
    async waitUntilReady(
        documentId: string,
        options: { maxWaitMs?: number; pollIntervalMs?: number } = {},
    ): Promise<IDocumentDetailsResponse> {
        const id = this.requireId(documentId, 'Document ID');
        const maxWaitMs = options.maxWaitMs ?? 30_000;
        const pollIntervalMs = options.pollIntervalMs ?? 2_000;
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
                // the exception, since the retry interceptor handles it and the
                // limit is per-minute.
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

    /** Download a document artifact. Defaults to the certificated (signed) PDF. */
    async download(
        documentId: string,
        artifactName: DocumentArtifactName = 'certificated',
    ): Promise<Buffer> {
        const id = this.requireId(documentId, 'Document ID');
        return this.callBinary('Failed to download document', () =>
            this.http.get<ArrayBuffer>(`/documents/${id}/download/${artifactName}`, {
                responseType: 'arraybuffer',
            }),
        );
    }

    /** Download the document thumbnail. */
    async thumbnail(documentId: string): Promise<Buffer> {
        const id = this.requireId(documentId, 'Document ID');
        return this.callBinary('Failed to download document thumbnail', () =>
            this.http.get<ArrayBuffer>(`/documents/${id}/thumbnail`, { responseType: 'arraybuffer' }),
        );
    }

    /** Download a single page as a JPEG. */
    async downloadPage(documentId: string, pageId: string): Promise<Buffer> {
        const docId = this.requireId(documentId, 'Document ID');
        const pid = this.requireId(pageId, 'Page ID');
        return this.callBinary('Failed to download page', () =>
            this.http.get<ArrayBuffer>(`/documents/${docId}/pages/${pid}/download`, {
                responseType: 'arraybuffer',
            }),
        );
    }

    /** Fetch the document activity log. */
    async activities(documentId: string): Promise<IDocumentActivity[]> {
        const id = this.requireId(documentId, 'Document ID');
        const result = await this.call<IDocumentActivity[] | null>(
            'Failed to fetch document activities',
            () => this.http.get(`/documents/${id}/activities`),
        );
        return result ?? [];
    }

    /** Delete a document. */
    async delete(documentId: string): Promise<void> {
        const id = this.requireId(documentId, 'Document ID');
        return this.callVoid('Failed to delete document', () => this.http.delete(`/documents/${id}`));
    }

    /** List the tags attached to a document. */
    async listTags(documentId: string, accountId?: string): Promise<ITag[]> {
        const accId = this.accountId(accountId);
        const docId = this.requireId(documentId, 'Document ID');
        return this.call('Failed to list document tags', () =>
            this.http.get(`/accounts/${accId}/documents/${docId}/tags`),
        );
    }

    /**
     * Replace the document's tag set with `tags` (an array of tag names).
     * Unknown names are auto-created; an empty array detaches all tags.
     */
    async replaceTags(documentId: string, tags: string[], accountId?: string): Promise<ITag[]> {
        const accId = this.accountId(accountId);
        const docId = this.requireId(documentId, 'Document ID');
        if (!Array.isArray(tags)) throw new ValidationError('tags must be an array of tag names');
        return this.call('Failed to replace document tags', () =>
            this.http.put(`/accounts/${accId}/documents/${docId}/tags`, { tags }),
        );
    }

    /** Attach additional tags (by name) without removing existing ones. Idempotent. */
    async addTags(documentId: string, tags: string[], accountId?: string): Promise<ITag[]> {
        const accId = this.accountId(accountId);
        const docId = this.requireId(documentId, 'Document ID');
        if (!Array.isArray(tags) || tags.length === 0) {
            throw new ValidationError('tags must be a non-empty array of tag names');
        }
        return this.call('Failed to add document tags', () =>
            this.http.post(`/accounts/${accId}/documents/${docId}/tags`, { tags }),
        );
    }

    /** Detach a single tag from a document (the tag itself is not deleted). */
    async detachTag(documentId: string, tagId: string, accountId?: string): Promise<void> {
        const accId = this.accountId(accountId);
        const docId = this.requireId(documentId, 'Document ID');
        const tid = this.requireId(tagId, 'Tag ID');
        return this.callVoid('Failed to detach document tag', () =>
            this.http.delete(`/accounts/${accId}/documents/${docId}/tags/${tid}`),
        );
    }

    /**
     * Create a document from a template.
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
        const body: Record<string, unknown> = { signers, ...options };
        this.logger.info('Creating document from template', { templateId: tmplId, accountId: accId });
        return this.call('Failed to create document from template', () =>
            this.http.post(`/accounts/${accId}/templates/${tmplId}/documents`, body),
        );
    }

    /**
     * Estimate the credit cost of creating a document from a template.
     *
     * @returns an {@link ICostEstimate}: `total_credits`, balances, and a
     * per-line `breakdown` of what the operation would consume.
     */
    async estimateCostFromTemplate(
        templateId: string,
        signers: ITemplateSigner[],
        accountId?: string,
    ): Promise<ICostEstimate> {
        const tmplId = this.requireId(templateId, 'Template ID');
        const accId = this.accountId(accountId);
        return this.call('Failed to estimate cost from template', () =>
            this.http.post(`/accounts/${accId}/templates/${tmplId}/documents/estimate-cost`, { signers }),
        );
    }

    /** Verify a document by its signature hash. */
    async verify(hash: string): Promise<Record<string, unknown>> {
        const h = this.requireId(hash, 'Signature hash');
        return this.call('Failed to verify document', () => this.http.get(`/documents/${h}/verify`));
    }

    /**
     * `GET /documents/statuses` — list every possible document status with
     * its description and whether documents in that status can be deleted.
     */
    async statuses(): Promise<IDocumentStatusInfo[]> {
        return this.call('Failed to list document statuses', () =>
            this.http.get('/documents/statuses'),
        );
    }

    /**
     * `GET /public/documents/{document_id}` — public, unauthenticated lookup of
     * basic document info (used by the signing portal before the signer
     * authenticates via the access code).
     */
    async getPublic(documentId: string): Promise<IPublicDocumentInfo> {
        const id = this.requireId(documentId, 'Document ID');
        return this.call('Failed to fetch public document info', () =>
            this.http.get(`/public/documents/${id}`),
        );
    }

    /**
     * `PUT /public/documents/{document_id}/send-token` — send the 6-digit
     * verification token to the signer's email / WhatsApp.
     */
    async sendToken(
        documentId: string,
        recipient: string,
        channel: SendTokenChannel = 'email',
    ): Promise<unknown> {
        const id = this.requireId(documentId, 'Document ID');
        if (!recipient) throw new ValidationError('recipient is required');
        return this.call('Failed to send signing token', () =>
            this.http.put(`/public/documents/${id}/send-token`, { recipient, channel }),
        );
    }

    /** Quick check: has every signer completed their assignment? */
    async isFullySigned(documentId: string): Promise<boolean> {
        const details = await this.details(documentId);
        if (details.status === 'certificated') return true;
        const summary = details.assignment?.summary;
        if (summary && typeof summary.signer_count === 'number') {
            return summary.signer_count > 0 && summary.signer_count === summary.completed_count;
        }
        return false;
    }

    /** Summarise signing progress for UI display. */
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

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
