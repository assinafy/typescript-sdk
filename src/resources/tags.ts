import type { ICreateTagPayload, IDeleteTagResponse, ITag, IUpdateTagPayload } from '../types';
import { ValidationError } from '../errors';
import { assertNonEmptyString, assertRecord, cleanListParams } from '../utils';
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
    /**
     * List the workspace's tags (`GET /accounts/{accountId}/tags`).
     *
     * Tags come back ordered alphabetically by name. Pass an optional
     * case-insensitive `search` substring to filter by name.
     *
     * @param params - Optional filters. `search` matches tag names
     * case-insensitively (substring).
     * @param accountId - Override the client's default account ID.
     * @returns The matching tags (list items carry no `resource` field):
     * ```jsonc
     * [
     *   {
     *     "id": "103aa221874346e6b3de41688526",
     *     "name": "Contracts",
     *     "color": "ff8800",              // 6-char hex, no leading '#'
     *     "created_at": "2026-07-18T19:03:45Z",
     *     "updated_at": "2026-07-18T19:03:45Z"
     *   },
     *   {
     *     "id": "103aa252123d3bf1843a317ee0e6",
     *     "name": "Invoices",
     *     "color": null,                  // no color set
     *     "created_at": "2026-07-18T19:09:03Z",
     *     "updated_at": "2026-07-18T19:09:03Z"
     *   }
     * ]
     * ```
     * @throws {ValidationError} If no account ID is available.
     * @throws {ApiError} If the API rejects the request.
     *
     * @example
     * ```ts
     * const all = await client.tags.list();
     * const contracts = await client.tags.list({ search: 'contract' });
     * ```
     */
    async list(params: { search?: string } = {}, accountId?: string): Promise<ITag[]> {
        assertRecord(params, 'tag list parameters');
        if (params.search !== undefined && typeof params.search !== 'string') {
            throw new ValidationError('search must be a string');
        }
        const id = this.accountId(accountId);
        return this.call('Failed to list tags', () =>
            this.http.get(`/accounts/${this.pathSegment(id, 'Account ID')}/tags`, {
                params: cleanListParams({ search: params.search }),
            }),
        );
    }

    /**
     * Create a tag (`POST /accounts/{accountId}/tags`).
     *
     * `color` is an optional 6-char hex string; the API accepts it **with or
     * without** a leading `#` and always stores it **without** — `'#ff8800'`
     * and `'ff8800'` both persist as `'ff8800'`. Omit `color`
     * (or pass `null`) for no color.
     *
     * @param payload - `name` (required, max 64 characters; trimmed with
     * internal whitespace collapsed) and optional `color`.
     * @param accountId - Override the client's default account ID.
     * @returns The created tag:
     * ```jsonc
     * {
     *   "resource": "tag",
     *   "id": "103ad216fdc641c8f0465678c813",
     *   "name": "Contracts",
     *   "color": "ff8800",
     *   "created_at": "2026-07-19T17:24:46Z",
     *   "updated_at": "2026-07-19T17:24:46Z"
     * }
     * ```
     * @throws {ValidationError} If `payload` is not an object, `name` is empty,
     * or no account ID is available.
     * @throws {ApiError} `409` if a tag with the same name already exists
     * (case-insensitive).
     *
     * @example
     * ```ts
     * const tag = await client.tags.create({ name: 'Contracts', color: '#ff8800' });
     * // → tag.color === 'ff8800'  (the leading '#' is stripped by the API)
     * ```
     */
    async create(payload: ICreateTagPayload, accountId?: string): Promise<ITag> {
        assertRecord(payload, 'tag payload');
        assertNonEmptyString(payload.name, 'Tag name');
        validateTagColor(payload.color);
        const id = this.accountId(accountId);
        const body: ICreateTagPayload = { name: payload.name };
        if (payload.color !== undefined) body.color = payload.color;
        return this.call('Failed to create tag', () =>
            this.http.post(
                `/accounts/${this.pathSegment(id, 'Account ID')}/tags`,
                body,
            ),
        );
    }

    /**
     * Update a tag's name and/or color (`PUT /accounts/{accountId}/tags/{tagId}`).
     *
     * Omit a field to leave it unchanged. Pass `color: null` to clear the color
     * — that `null` is sent in the request body as the documented "clear color"
     * signal (an omitted `color` is not sent at all). As with {@link create}, a
     * leading `#` on `color` is accepted and stripped by the API
     * (`'#112233'` → `'112233'`).
     *
     * @param tagId - The tag to update.
     * @param payload - `name` and/or `color`. `color: null` clears the color;
     * omit a field to leave it unchanged.
     * @param accountId - Override the client's default account ID.
     * @returns The updated tag:
     * ```jsonc
     * {
     *   "resource": "tag",
     *   "id": "103ad216fdc641c8f0465678c813",
     *   "name": "Contracts",
     *   "color": "112233",
     *   "created_at": "2026-07-19T17:24:46Z",
     *   "updated_at": "2026-07-19T17:24:47Z"
     * }
     * ```
     * @throws {ValidationError} If `payload` is not an object, `tagId` is
     * missing, or no account ID is available.
     * @throws {ApiError} `404` if the tag does not exist; `409` if another tag
     * already uses the new name.
     *
     * @example
     * ```ts
     * // rename + recolor
     * await client.tags.update('103ad216fdc641c8f0465678c813', {
     *   name: 'Signed contracts',
     *   color: '112233',
     * });
     * // clear the color, keep the name
     * await client.tags.update('103ad216fdc641c8f0465678c813', { color: null });
     * ```
     */
    async update(tagId: string, payload: IUpdateTagPayload, accountId?: string): Promise<ITag> {
        assertRecord(payload, 'tag payload');
        if (payload.name !== undefined) assertNonEmptyString(payload.name, 'Tag name');
        validateTagColor(payload.color);
        const id = this.accountId(accountId);
        const tid = this.requireId(tagId, 'Tag ID');
        // Don't strip `color: null` — null is the documented "clear color" signal.
        const body: Record<string, unknown> = {};
        if (payload.name !== undefined) body['name'] = payload.name;
        if ('color' in payload) body['color'] = payload.color;
        return this.call('Failed to update tag', () =>
            this.http.put(
                `/accounts/${this.pathSegment(id, 'Account ID')}/tags/${this.pathSegment(tid, 'Tag ID')}`,
                body,
            ),
        );
    }

    /**
     * Delete a tag (`DELETE /accounts/{accountId}/tags/{tagId}`).
     *
     * By default the API returns `409` if the tag is still attached to any
     * document or template. Pass `{ force: true }` to detach it everywhere
     * first — that adds a `?force=true` query param.
     *
     * @param tagId - The tag to delete.
     * @param options - `force` to detach-and-delete when the tag is still in
     * use, and `accountId` to override the client's default account ID.
     * @returns `{ deleted: true }` when the tag was deleted.
     * @throws {ValidationError} If `tagId` is missing, or no account ID is available.
     * @throws {ApiError} `404` if the tag does not exist; `409` if the tag is
     * still in use and `force` was not set.
     *
     * @example
     * ```ts
     * const { deleted } = await client.tags.delete('103ad216fdc641c8f0465678c813');
     * // detach from every document/template, then delete
     * await client.tags.delete('103ad216fdc641c8f0465678c813', { force: true });
     * ```
     */
    async delete(
        tagId: string,
        options: { force?: boolean; accountId?: string } = {},
    ): Promise<IDeleteTagResponse> {
        assertRecord(options, 'tag delete options');
        if (options.force !== undefined && typeof options.force !== 'boolean') {
            throw new ValidationError('force must be a boolean');
        }
        const id = this.accountId(options.accountId);
        const tid = this.requireId(tagId, 'Tag ID');
        const params = options.force ? { force: 'true' } : undefined;
        return this.call('Failed to delete tag', () =>
            this.http.delete(
                `/accounts/${this.pathSegment(id, 'Account ID')}/tags/${this.pathSegment(tid, 'Tag ID')}`,
                { params },
            ),
        );
    }
}

function validateTagColor(value: unknown): void {
    if (
        value !== undefined
        && value !== null
        && (typeof value !== 'string' || !/^#?[0-9a-fA-F]{6}$/.test(value))
    ) {
        throw new ValidationError(
            'color must be six hexadecimal characters with an optional leading #, or null',
        );
    }
}
