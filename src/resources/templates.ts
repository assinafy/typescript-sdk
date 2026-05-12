import type {
    IListParams,
    ITemplateDetailsResponse,
    ITemplateListResponse,
    ITemplateListItem,
} from '../types';
import { cleanParams } from '../utils';
import { BaseResource } from './base';

export class TemplateResource extends BaseResource {
    /** List templates for the workspace. */
    async list(params: IListParams = {}, accountId?: string): Promise<ITemplateListResponse> {
        const id = this.accountId(accountId);
        return this.callList<ITemplateListItem>('Failed to list templates', () =>
            this.http.get(`/accounts/${id}/templates`, { params: cleanParams(params) }),
        );
    }

    /**
     * Get a template by ID.
     *
     * Note: the swagger only documents the list endpoint; this single-resource
     * `GET /accounts/{id}/templates/{id}` is exposed by the platform and used
     * by the official PHP SDK.
     */
    async get(templateId: string, accountId?: string): Promise<ITemplateDetailsResponse> {
        const id = this.accountId(accountId);
        const tmplId = this.requireId(templateId, 'Template ID');
        return this.call('Failed to fetch template', () =>
            this.http.get(`/accounts/${id}/templates/${tmplId}`),
        );
    }

    /**
     * `GET /accounts/{id}/templates/{template_id}/pages/{page_id}/download` —
     * download a template page as a JPEG (used by template editors to render
     * thumbnails on the client).
     */
    async downloadPage(
        templateId: string,
        pageId: string,
        accountId?: string,
    ): Promise<Buffer> {
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
