import type { ICreateTagPayload, ITag, IUpdateTagPayload } from '../types';
import { ValidationError } from '../errors';
import { cleanParams } from '../utils';
import { BaseResource } from './base';

/**
 * Workspace-scoped tags used to label documents and templates.
 *
 * Covers the full Tag section of the API docs:
 *  - `GET    /accounts/{id}/tags`            → {@link list}
 *  - `POST   /accounts/{id}/tags`            → {@link create}
 *  - `PUT    /accounts/{id}/tags/{tag_id}`   → {@link update}
 *  - `DELETE /accounts/{id}/tags/{tag_id}`   → {@link delete}
 *
 * Document-level attach/detach lives on {@link DocumentResource} (`listTags`,
 * `replaceTags`, `addTags`, `detachTag`).
 */
export class TagResource extends BaseResource {
    /** List the workspace's tags, ordered alphabetically. Optional case-insensitive `search`. */
    async list(params: { search?: string } = {}, accountId?: string): Promise<ITag[]> {
        const id = this.accountId(accountId);
        return this.call('Failed to list tags', () =>
            this.http.get(`/accounts/${id}/tags`, {
                params: cleanParams(params as Record<string, unknown>),
            }),
        );
    }

    /** Create a tag. Throws `ApiError` (409) if the name already exists (case-insensitive). */
    async create(payload: ICreateTagPayload, accountId?: string): Promise<ITag> {
        if (!payload.name) throw new ValidationError('Tag name is required');
        const id = this.accountId(accountId);
        return this.call('Failed to create tag', () =>
            this.http.post(`/accounts/${id}/tags`, cleanParams({ ...payload })),
        );
    }

    /**
     * Update a tag's name and/or color. Omit a field to leave it unchanged;
     * pass `color: null` to clear the color. Throws `ApiError` (409) if another
     * tag already uses the new name.
     */
    async update(tagId: string, payload: IUpdateTagPayload, accountId?: string): Promise<ITag> {
        const id = this.accountId(accountId);
        const tid = this.requireId(tagId, 'Tag ID');
        // Don't strip `color: null` — null is the documented "clear color" signal.
        const body: Record<string, unknown> = {};
        if (payload.name !== undefined) body['name'] = payload.name;
        if ('color' in payload) body['color'] = payload.color;
        return this.call('Failed to update tag', () =>
            this.http.put(`/accounts/${id}/tags/${tid}`, body),
        );
    }

    /**
     * Delete a tag. By default fails with `ApiError` (409) if the tag is still
     * attached to anything; pass `{ force: true }` to detach everywhere first.
     */
    async delete(
        tagId: string,
        options: { force?: boolean; accountId?: string } = {},
    ): Promise<void> {
        const id = this.accountId(options.accountId);
        const tid = this.requireId(tagId, 'Tag ID');
        const params = options.force ? { force: 'true' } : undefined;
        return this.callVoid('Failed to delete tag', () =>
            this.http.delete(`/accounts/${id}/tags/${tid}`, { params }),
        );
    }
}
