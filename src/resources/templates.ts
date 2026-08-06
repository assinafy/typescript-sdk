import type {
    IListParams,
    ITemplateDetailsResponse,
    ITemplateListResponse,
    ITemplateListItem,
    IUpdateTemplatePayload,
} from '../types';
import { cleanListParams, cleanParams } from '../utils';
import { BaseResource } from './base';
import type { DocumentUploadSource } from './upload';

/**
 * Live-API compatibility endpoints for managing reusable templates.
 *
 * These CRUD routes are operational in the Assinafy sandbox but are not
 * described by the current published OpenAPI document. They are retained for
 * compatibility and should be integration-tested against the target Assinafy
 * environment before a production rollout.
 */
export class TemplateResource extends BaseResource {
    /**
     * Create a template by uploading a PDF (`POST /accounts/{id}/templates`).
     *
     * The template is created in `Uploaded` status and transitions to `Ready`
     * once the platform finishes processing its pages (`pages` stays empty until
     * then). Configure roles/fields afterwards in the Assinafy editor. As with
     * document uploads, the API derives the display name from the file part's
     * filename, so `options.name` is applied as the (`.pdf`-suffixed) filename
     * rather than a separate form field.
     *
     * @param source - The PDF to upload, as a file path or an in-memory buffer.
     * @param options - `name` (display name) and an optional `accountId` override.
     * @returns The created template (envelope unwrapped). Response shape:
     * ```jsonc
     * {
     *   "resource": "template",
     *   "id": "103ad2171db7979468c3e97eb067",
     *   "name": "NDA template.pdf",
     *   "document_name": "NDA template.pdf",
     *   "message": null,
     *   "status": "Uploaded",
     *   "pages": [],
     *   "roles": [
     *     {
     *       "id": "19f7b68b811f8d1e1aeaf11178e",
     *       "name": "TemplateEditor",
     *       "assignment_type": "Editor",
     *       "created_at": "2026-07-19T17:24:48Z",
     *       "updated_at": "2026-07-19T17:24:48Z"
     *     }
     *   ],
     *   "tags": [],
     *   "created_at": "2026-07-19T17:24:47Z",
     *   "updated_at": "2026-07-19T17:24:48Z"
     * }
     * ```
     * @throws {ValidationError} If the file is empty, not a `.pdf`, exceeds
     * 25 MB, no account ID is available, or the API returns no template ID.
     * @throws {ApiError} If the API rejects the upload.
     *
     * @example
     * ```ts
     * const tmpl = await client.templates.create(
     *   { filePath: './nda.pdf' },
     *   { name: 'NDA template' },
     * );
     * // → status: 'Uploaded'; name stored as 'NDA template.pdf'
     * ```
     */
    async create(
        source: DocumentUploadSource,
        options: { name?: string; accountId?: string } = {},
    ): Promise<ITemplateDetailsResponse> {
        const id = this.accountId(options.accountId);
        const formOptions: { name?: string } = {};
        if (options.name !== undefined) formOptions.name = options.name;

        const template = await this.uploadPdf<ITemplateDetailsResponse>(
            `/accounts/${this.pathSegment(id, 'Account ID')}/templates`,
            source,
            formOptions,
            {
                errorLabel: 'Failed to create template',
                missingId: 'Template upload succeeded but no template ID was returned',
            },
        );

        this.logger.info('Template created', { templateId: template.id });
        return template;
    }

    /**
     * List templates for the workspace (`GET /accounts/{id}/templates`).
     *
     * Pagination lives in the response **headers** and is surfaced on `meta`.
     * Each item is an {@link ITemplateListItem} carrying `pages[]` (each with a
     * `download_url`), so there is no need to `get()` a template again just to
     * read its rendered pages.
     *
     * @param params - `search`, `page`, and `per-page` (the SDK normalizes
     * `per_page` → `per-page`, the only spelling the API honors).
     * @param accountId - Override the client's default account ID.
     * @returns Matching templates, with pagination in `meta`. Each item:
     * ```jsonc
     * {
     *   "id": "103ad2171db7979468c3e97eb067",
     *   "name": "NDA template.pdf",
     *   "document_name": "nda.pdf",
     *   "message": null,
     *   "status": "Ready",
     *   "pages": [
     *     {
     *       "id": "103ad217673e1f978cb86179e8f8",
     *       "number": 1,
     *       "height": 1651,
     *       "width": 1275,
     *       "download_url": "https://api.assinafy.com.br/v1/accounts/…/templates/…/pages/…/download",
     *       "fields": []
     *     }
     *   ],
     *   "roles": [
     *     { "id": "19f7b68b811f8d1e1aeaf11178e", "name": "TemplateEditor", "assignment_type": "Editor" }
     *   ],
     *   "tags": [],
     *   "created_at": "2026-07-19T17:24:47Z",
     *   "updated_at": "2026-07-19T17:24:51Z"
     * }
     * ```
     * @throws {ValidationError} If no account ID is available.
     * @throws {ApiError} If the API rejects the request.
     *
     * @example
     * ```ts
     * const { data, meta } = await client.templates.list({ search: 'nda', 'per-page': 20 });
     * ```
     */
    async list(params: IListParams = {}, accountId?: string): Promise<ITemplateListResponse> {
        const id = this.accountId(accountId);
        return this.callList<ITemplateListItem>('Failed to list templates', () =>
            this.http.get(`/accounts/${this.pathSegment(id, 'Account ID')}/templates`, {
                params: cleanListParams(params),
            }),
        );
    }

    /**
     * Get a template by ID (`GET /accounts/{id}/templates/{template_id}`).
     *
     * Returns the same shape as {@link TemplateResource.list} plus
     * `default_document_tags` (the tags auto-applied to every document created
     * from this template) and `resource`. Both endpoints return `pages` with
     * per-page `download_url`, so fetching a template again purely to read its
     * pages is unnecessary.
     *
     * @param templateId - The template to fetch.
     * @param accountId - Override the client's default account ID.
     * @returns The full template. Response shape (`status: 'Ready'`):
     * ```jsonc
     * {
     *   "resource": "template",
     *   "id": "103ad2171db7979468c3e97eb067",
     *   "name": "NDA template.pdf",
     *   "document_name": "nda.pdf",
     *   "message": null,
     *   "status": "Ready",
     *   "pages": [
     *     {
     *       "id": "103ad217673e1f978cb86179e8f8",
     *       "number": 1,
     *       "height": 1651,
     *       "width": 1275,
     *       "download_url": "https://api.assinafy.com.br/v1/accounts/…/templates/…/pages/…/download",
     *       "fields": []
     *     }
     *   ],
     *   "roles": [
     *     {
     *       "id": "19f7b68b811f8d1e1aeaf11178e",
     *       "name": "TemplateEditor",
     *       "assignment_type": "Editor",
     *       "created_at": "2026-07-19T17:24:48Z",
     *       "updated_at": "2026-07-19T17:24:48Z"
     *     }
     *   ],
     *   "tags": [],
     *   "created_at": "2026-07-19T17:24:47Z",
     *   "updated_at": "2026-07-19T17:24:51Z",
     *   "default_document_tags": []
     * }
     * ```
     * @throws {ValidationError} If `templateId` is missing or no account ID is available.
     * @throws {ApiError} `404` if the template does not exist.
     *
     * @example
     * ```ts
     * const tmpl = await client.templates.get('103ad2171db7979468c3e97eb067');
     * if (tmpl.status === 'Ready') console.log(tmpl.pages.length);
     * ```
     */
    async get(templateId: string, accountId?: string): Promise<ITemplateDetailsResponse> {
        const id = this.accountId(accountId);
        const tmplId = this.requireId(templateId, 'Template ID');
        return this.call('Failed to fetch template', () =>
            this.http.get(
                `/accounts/${this.pathSegment(id, 'Account ID')}/templates/${this.pathSegment(tmplId, 'Template ID')}`,
            ),
        );
    }

    /**
     * Update a template's `name` and/or default `message`
     * (`PUT /accounts/{id}/templates/{template_id}`).
     *
     * `message` is the default invitation message applied to documents created
     * from this template. Omit a field to leave it unchanged — the SDK strips
     * `undefined` keys before sending. Unlike uploads, `name` here is a plain
     * display name and is **not** forced to end in `.pdf`.
     *
     * @param templateId - The template to update.
     * @param payload - `name` and/or `message`; both optional.
     * @param accountId - Override the client's default account ID.
     * @returns The updated template (full details, same shape as
     * {@link TemplateResource.get}). Response shape:
     * ```jsonc
     * {
     *   "resource": "template",
     *   "id": "103ad2171db7979468c3e97eb067",
     *   "name": "NDA v2",
     *   "document_name": "nda.pdf",
     *   "message": "Please sign",
     *   "status": "Ready",
     *   "pages": [
     *     { "id": "103ad217673e1f978cb86179e8f8", "number": 1, "height": 1651, "width": 1275, "download_url": "https://api.assinafy.com.br/v1/…/download", "fields": [] }
     *   ],
     *   "roles": [
     *     { "id": "19f7b68b811f8d1e1aeaf11178e", "name": "TemplateEditor", "assignment_type": "Editor" }
     *   ],
     *   "tags": [],
     *   "created_at": "2026-07-19T17:24:47Z",
     *   "updated_at": "2026-07-19T17:24:52Z"
     * }
     * ```
     * @throws {ValidationError} If `templateId` is missing or no account ID is available.
     * @throws {ApiError} `404` if the template does not exist; `400` on an invalid payload.
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
                `/accounts/${this.pathSegment(id, 'Account ID')}/templates/${this.pathSegment(tmplId, 'Template ID')}`,
                cleanParams(payload as Record<string, unknown>),
            ),
        );
    }

    /**
     * Delete a template (`DELETE /accounts/{id}/templates/{template_id}`).
     *
     * The API responds with an empty `data` payload; this method resolves to
     * `void`.
     *
     * @param templateId - The template to delete.
     * @param accountId - Override the client's default account ID.
     * @returns Nothing (`Promise<void>`) on success.
     * @throws {ValidationError} If `templateId` is missing or no account ID is available.
     * @throws {ApiError} `404` if the template does not exist.
     *
     * @example
     * ```ts
     * await client.templates.delete('103ad2171db7979468c3e97eb067');
     * ```
     */
    async delete(templateId: string, accountId?: string): Promise<void> {
        const id = this.accountId(accountId);
        const tmplId = this.requireId(templateId, 'Template ID');
        return this.callVoid('Failed to delete template', () =>
            this.http.delete(
                `/accounts/${this.pathSegment(id, 'Account ID')}/templates/${this.pathSegment(tmplId, 'Template ID')}`,
            ),
        );
    }

    /**
     * Download a template page as a JPEG
     * (`GET /accounts/{id}/templates/{template_id}/pages/{page_id}/download`).
     *
     * Used by template editors to render page thumbnails on the client. The
     * matching `download_url` is also returned on each `template.pages[]` entry,
     * so if you already hold the template you can fetch that URL directly.
     *
     * @param templateId - The template that owns the page.
     * @param pageId - The page to download (`pages[].id` from `get()`/`list()`).
     * @param accountId - Override the client's default account ID.
     * @returns The page rendering as a {@link Buffer} of JPEG bytes.
     * @throws {ValidationError} If `templateId` or `pageId` is missing, or no
     * account ID is available.
     * @throws {ApiError} `404` if the template or page does not exist.
     *
     * @example
     * ```ts
     * const tmpl = await client.templates.get('103ad2171db7979468c3e97eb067');
     * const jpeg = await client.templates.downloadPage(tmpl.id, tmpl.pages[0].id);
     * await fs.writeFile('page-1.jpg', jpeg);
     * ```
     */
    async downloadPage(templateId: string, pageId: string, accountId?: string): Promise<Buffer> {
        const id = this.accountId(accountId);
        const tmplId = this.requireId(templateId, 'Template ID');
        const pid = this.requireId(pageId, 'Page ID');
        return this.callBinary('Failed to download template page', () =>
            this.http.get<ArrayBuffer>(
                `/accounts/${this.pathSegment(id, 'Account ID')}/templates/${this.pathSegment(tmplId, 'Template ID')}/pages/${this.pathSegment(pid, 'Page ID')}/download`,
                { responseType: 'arraybuffer' },
            ),
        );
    }
}
