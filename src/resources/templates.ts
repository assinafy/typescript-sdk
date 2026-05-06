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

    /** Get a template by ID. */
    async get(templateId: string, accountId?: string): Promise<ITemplateDetailsResponse> {
        const id = this.accountId(accountId);
        const tmplId = this.requireId(templateId, 'Template ID');
        return this.call('Failed to fetch template', () =>
            this.http.get(`/accounts/${id}/templates/${tmplId}`),
        );
    }
}
