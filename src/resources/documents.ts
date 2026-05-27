import { promises as fs } from 'node:fs';
import path from 'node:path';
import type {
    DocumentArtifactName,
    DocumentStatus,
    ICreateDocumentFromTemplateOptions,
    IDocumentActivity,
    IDocumentDetailsResponse,
    IDocumentListItem,
    IDocumentListParams,
    IDocumentListResponse,
    IDocumentStatusInfo,
    IDocumentUploadResponse,
    IPublicDocumentInfo,
    ISigningProgress,
    ITag,
    ITemplateSigner,
    SendTokenChannel,
} from '../types';
import { ValidationError } from '../errors';
import { cleanParams } from '../utils';
import { BaseResource } from './base';

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

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

/** Input for uploading a document: either an on-disk file or an in-memory buffer. */
export type DocumentUploadSource =
    | { filePath: string; fileName?: string }
    | { buffer: Buffer; fileName: string };

export interface IDocumentUploadOptions {
    /** Optional metadata sent alongside the file (JSON-encoded). */
    metadata?: Record<string, unknown>;
    /** Override the default account ID configured on the client. */
    accountId?: string;
}

export class DocumentResource extends BaseResource {
    /**
     * Upload a PDF to the workspace.
     *
     * @example
     * ```ts
     * await client.documents.upload({ filePath: './contract.pdf' });
     * await client.documents.upload({ buffer, fileName: 'contract.pdf' }, { metadata });
     * ```
     */
    async upload(
        source: DocumentUploadSource,
        options: IDocumentUploadOptions = {},
    ): Promise<IDocumentUploadResponse> {
        const { buffer, fileName } = await loadSource(source);
        validateUpload(buffer, fileName);

        const accountId = this.accountId(options.accountId);
        const form = buildUploadForm(buffer, fileName, options.metadata);

        this.logger.info('Uploading document', { fileName, size: buffer.byteLength });

        const document = await this.call<IDocumentUploadResponse>('Document upload failed', () =>
            this.http.post(`/accounts/${accountId}/documents`, form, {
                headers: { 'Content-Type': 'multipart/form-data' },
            }),
        );

        if (!document?.id) {
            throw new ValidationError('Upload succeeded but no document ID was returned', {
                response: document as unknown as Record<string, unknown>,
            });
        }
        this.logger.info('Document uploaded', { documentId: document.id });
        return document;
    }

    /**
     * List workspace documents. Pagination info (if any) is attached in `meta`.
     * Supports `status`, `method`, `tags`, `search`, `sort`, `page`, `per_page`.
     */
    async list(params: IDocumentListParams = {}, accountId?: string): Promise<IDocumentListResponse> {
        const id = this.accountId(accountId);
        return this.callList<IDocumentListItem>('Failed to list documents', () =>
            this.http.get(`/accounts/${id}/documents`, { params: cleanParams(params) }),
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

    /** Estimate the credit cost of creating a document from a template. */
    async estimateCostFromTemplate(
        templateId: string,
        signers: ITemplateSigner[],
        accountId?: string,
    ): Promise<Record<string, unknown>> {
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

async function loadSource(source: DocumentUploadSource): Promise<{ buffer: Buffer; fileName: string }> {
    if ('buffer' in source) {
        if (!source.fileName) {
            throw new ValidationError('fileName is required when uploading a Buffer');
        }
        return { buffer: source.buffer, fileName: source.fileName };
    }
    if (!source.filePath) {
        throw new ValidationError('filePath is required');
    }
    const buffer = await fs.readFile(source.filePath);
    return { buffer, fileName: source.fileName ?? path.basename(source.filePath) };
}

function validateUpload(buffer: Buffer, fileName: string): void {
    if (!buffer || buffer.byteLength === 0) {
        throw new ValidationError('File buffer is empty', { fileName });
    }
    if (!fileName.toLowerCase().endsWith('.pdf')) {
        throw new ValidationError('Only PDF files are supported', { fileName });
    }
    if (buffer.byteLength > MAX_UPLOAD_BYTES) {
        throw new ValidationError('File size exceeds maximum allowed (25MB)', {
            fileSize: buffer.byteLength,
            maxSize: MAX_UPLOAD_BYTES,
        });
    }
}

function buildUploadForm(
    buffer: Buffer,
    fileName: string,
    metadata: Record<string, unknown> | undefined,
): FormData {
    const form = new FormData();
    // Blob copy-free view over the Buffer's underlying ArrayBuffer slice.
    const view = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    form.append('file', new Blob([view], { type: 'application/pdf' }), fileName);
    form.append('name', fileName);
    if (metadata) {
        form.append('metadata', JSON.stringify(metadata));
    }
    return form;
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
