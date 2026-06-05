import type {
    IListParams,
    ITemplateDetailsResponse,
    ITemplateListResponse,
    ITemplateListItem,
    IUpdateTemplatePayload,
} from '../types';
import { ValidationError } from '../errors';
import { cleanParams } from '../utils';
import { BaseResource } from './base';
import { buildUploadForm, loadSource, validateUpload } from './upload';
import type { DocumentUploadSource } from './upload';

export class TemplateResource extends BaseResource {
    /**
     * Create a template by uploading a PDF (`POST /accounts/{id}/templates`).
     *
     * The template is created in `Uploaded` status and transitions to `Ready`
     * once the platform finishes processing its pages. Configure roles/fields
     * afterwards in the Assinafy editor.
     *
     * @example
     * ```ts
     * const tmpl = await client.templates.create(
     *   { filePath: './nda.pdf' },
     *   { name: 'NDA template' },
     * );
     * // → { resource: 'template', id, name, status: 'Uploaded',
     * //     roles: [{ id, name: 'TemplateEditor', assignment_type: 'Editor' }],
     * //     pages: [], tags: [], created_at, updated_at }
     * ```
     */
    async create(
        source: DocumentUploadSource,
        options: { name?: string; accountId?: string } = {},
    ): Promise<ITemplateDetailsResponse> {
        const { buffer, fileName } = await loadSource(source);
        validateUpload(buffer, fileName);

        const id = this.accountId(options.accountId);
        const formOptions: { name?: string } = {};
        if (options.name !== undefined) formOptions.name = options.name;
        const form = buildUploadForm(buffer, fileName, formOptions);

        this.logger.info('Creating template', { fileName, size: buffer.byteLength });

        const template = await this.call<ITemplateDetailsResponse>('Failed to create template', () =>
            this.http.post(`/accounts/${id}/templates`, form, {
                headers: { 'Content-Type': 'multipart/form-data' },
            }),
        );

        if (!template?.id) {
            throw new ValidationError('Template upload succeeded but no template ID was returned', {
                response: template as unknown as Record<string, unknown>,
            });
        }
        this.logger.info('Template created', { templateId: template.id });
        return template;
    }

    /** List templates for the workspace. */
    async list(params: IListParams = {}, accountId?: string): Promise<ITemplateListResponse> {
        const id = this.accountId(accountId);
        return this.callList<ITemplateListItem>('Failed to list templates', () =>
            this.http.get(`/accounts/${id}/templates`, { params: cleanParams(params) }),
        );
    }

    /**
     * Get a template by ID (`GET /accounts/{id}/templates/{template_id}`).
     *
     * Unlike the list endpoint, the single-template response includes `pages`
     * (with per-page `download_url`) and `default_document_tags`.
     */
    async get(templateId: string, accountId?: string): Promise<ITemplateDetailsResponse> {
        const id = this.accountId(accountId);
        const tmplId = this.requireId(templateId, 'Template ID');
        return this.call('Failed to fetch template', () =>
            this.http.get(`/accounts/${id}/templates/${tmplId}`),
        );
    }

    /**
     * Update a template's `name` and/or default `message`
     * (`PUT /accounts/{id}/templates/{template_id}`). Returns the updated template.
     *
     * @example
     * ```ts
     * await client.templates.update(templateId, { name: 'NDA v2', message: 'Please sign' });
     * ```
     */
    async update(
        templateId: string,
        payload: IUpdateTemplatePayload,
        accountId?: string,
    ): Promise<ITemplateDetailsResponse> {
        const id = this.accountId(accountId);
        const tmplId = this.requireId(templateId, 'Template ID');
        return this.call('Failed to update template', () =>
            this.http.put(
                `/accounts/${id}/templates/${tmplId}`,
                cleanParams(payload as Record<string, unknown>),
            ),
        );
    }

    /** Delete a template (`DELETE /accounts/{id}/templates/{template_id}`). */
    async delete(templateId: string, accountId?: string): Promise<void> {
        const id = this.accountId(accountId);
        const tmplId = this.requireId(templateId, 'Template ID');
        return this.callVoid('Failed to delete template', () =>
            this.http.delete(`/accounts/${id}/templates/${tmplId}`),
        );
    }

    /**
     * Download a template page as a JPEG
     * (`GET /accounts/{id}/templates/{template_id}/pages/{page_id}/download`).
     *
     * Used by template editors to render page thumbnails on the client. The
     * matching `download_url` is also returned on each `template.pages[]` entry.
     */
    async downloadPage(templateId: string, pageId: string, accountId?: string): Promise<Buffer> {
        const id = this.accountId(accountId);
        const tmplId = this.requireId(templateId, 'Template ID');
        const pid = this.requireId(pageId, 'Page ID');
        return this.callBinary('Failed to download template page', () =>
            this.http.get<ArrayBuffer>(
                `/accounts/${id}/templates/${tmplId}/pages/${pid}/download`,
                { responseType: 'arraybuffer' },
            ),
        );
    }
}
