import type {
    IAccountTheme,
    ICreateWorkspacePayload,
    IDocumentStatsParams,
    IDocumentStatsRow,
    IWorkspaceListItem,
    IWorkspaceListResponse,
    IWorkspaceResponse,
    IUpdateWorkspacePayload,
} from '../types';
import { documentStatsParams } from '../support/stats';
import { BaseResource } from './base';
import { buildFileForm, loadSource, validateFileNotEmpty } from './upload';

/** File accepted by the account-logo upload endpoint. */
export type AccountLogoUploadSource =
    | { filePath: string; fileName?: string; contentType?: string }
    | { buffer: Buffer; fileName: string; contentType?: string };

/**
 * Manage workspaces — the Assinafy _account_ objects that own every document,
 * signer, template, tag, field, and webhook. Each endpoint lives under
 * `/accounts`, and the `accountId` used elsewhere in the SDK is a workspace id.
 *
 * Colours (`primary_color` / `secondary_color`) are stored on the workspace and
 * echoed back on the response. They must be an **exactly 6-character hex string
 * with NO leading `#`** (`'ff0066'`, not `'#ff0066'`); a `#`-prefixed value is
 * rejected with `400`. Verified live against the API.
 *
 * @example
 * ```ts
 * const ws = await client.workspaces.create({ name: 'Acme Legal' });
 * const { data } = await client.workspaces.list();
 * ```
 */
export class WorkspaceResource extends BaseResource {
    /**
     * Create a new workspace (`POST /accounts`).
     *
     * @param payload - The workspace `name` (required) plus optional brand
     * colours. Colours are 6-char hex **without** a leading `#`.
     * @returns The created workspace. Response shape:
     * ```jsonc
     * {
     *   "id": "acc_example",
     *   "name": "Acme Legal",
     *   "primary_color": "ff0066",
     *   "secondary_color": "0066ff",
     *   "created_at": "2026-05-12T18:05:11Z"
     * }
     * ```
     * @throws {ApiError} If the API rejects the request — e.g. `400` when a
     * colour is not exactly 6 hex characters (or carries a leading `#`).
     *
     * @example
     * ```ts
     * const ws = await client.workspaces.create({
     *   name: 'Acme Legal',
     *   primary_color: 'ff0066',
     *   secondary_color: '0066ff',
     * });
     * ```
     */
    async create(payload: ICreateWorkspacePayload): Promise<IWorkspaceResponse> {
        return this.call('Failed to create workspace', () => this.http.post('/accounts', payload));
    }

    /**
     * List workspaces the authenticated user can access (`GET /accounts`).
     *
     * @returns The workspaces, with any pagination in `meta`. Each item exposes
     * the caller's `roles` and whether it may be deleted:
     * ```jsonc
     * {
     *   "data": [
     *     {
     *       "id": "acc_example",
     *       "name": "MT",
     *       "roles": ["owner"],
     *       "is_delete_allowed": true,
     *       "created_at": "2026-05-12T18:05:11Z"
     *     }
     *   ]
     * }
     * ```
     * @throws {ApiError} If the API rejects the request.
     *
     * @example
     * ```ts
     * const { data } = await client.workspaces.list();
     * const owned = data.filter((w) => w.roles.includes('owner'));
     * ```
     */
    async list(): Promise<IWorkspaceListResponse> {
        return this.callList<IWorkspaceListItem>('Failed to list workspaces', () =>
            this.http.get('/accounts'),
        );
    }

    /**
     * Fetch a single workspace (`GET /accounts/{accountId}`).
     *
     * @param accountId - The workspace to fetch.
     * @returns The workspace. `primary_color` / `secondary_color` are `null`
     * until brand colours are set (6-char hex, no `#`, when present):
     * ```jsonc
     * {
     *   "id": "acc_example",
     *   "name": "MT",
     *   "primary_color": null,
     *   "secondary_color": null,
     *   "created_at": "2026-05-12T18:05:11Z"
     * }
     * ```
     * @throws {ValidationError} If `accountId` is missing.
     * @throws {ApiError} `404` if the workspace does not exist.
     *
     * @example
     * ```ts
     * const ws = await client.workspaces.get('acc_example');
     * ```
     */
    async get(accountId: string): Promise<IWorkspaceResponse> {
        const id = this.requireId(accountId, 'Account ID');
        return this.call('Failed to fetch workspace', () =>
            this.http.get(`/accounts/${this.pathSegment(id, 'Account ID')}`),
        );
    }

    /**
     * Fetch account branding (`GET /accounts/{accountId}/theme`).
     *
     * Request body/query: none.
     *
     * @param accountId - Account whose public branding should be returned.
     * @returns The unwrapped theme:
     * ```jsonc
     * {
     *   "account_name": "Acme Inc.",
     *   "primary_color": "aabbcc",
     *   "secondary_color": "112233",
     *   "logo": "https://api.assinafy.com.br/v1/accounts/account-id/logo"
     * }
     * ```
     * @throws {ValidationError} If `accountId` is empty.
     * @throws {ApiError} `401` for invalid credentials or `500` on failure.
     *
     * @example
     * ```ts
     * const theme = await client.workspaces.getTheme('acc_example');
     * ```
     */
    async getTheme(accountId: string): Promise<IAccountTheme> {
        const id = this.requireId(accountId, 'Account ID');
        return this.call('Failed to fetch account theme', () =>
            this.http.get(`/accounts/${this.pathSegment(id, 'Account ID')}/theme`),
        );
    }

    /**
     * Download the account logo (`GET /accounts/{accountId}/logo`).
     *
     * @param accountId - Account whose current logo should be downloaded.
     * @returns Raw image bytes as a Node {@link Buffer}. The endpoint's response
     * content type is `image/*` and depends on the uploaded file.
     * @throws {ValidationError} If `accountId` is empty.
     * @throws {ApiError} `404` when no logo exists.
     *
     * @example
     * ```ts
     * const logo = await client.workspaces.downloadLogo('acc_example');
     * ```
     */
    async downloadLogo(accountId: string): Promise<Buffer> {
        const id = this.requireId(accountId, 'Account ID');
        return this.callBinary('Failed to download account logo', () =>
            this.http.get<ArrayBuffer>(`/accounts/${this.pathSegment(id, 'Account ID')}/logo`, {
                responseType: 'arraybuffer',
            }),
        );
    }

    /**
     * Upload or replace the account logo (`POST /accounts/{accountId}/logo`).
     *
     * The request is `multipart/form-data` with exactly one `file` part. No
     * response data is defined; the method resolves once the API acknowledges
     * the update.
     *
     * @param accountId - Account whose logo will be replaced.
     * @param source - File path or `{ buffer, fileName }`; optionally set an
     * explicit MIME `contentType` for an in-memory image.
     * @returns Resolves when the API acknowledges the multipart upload.
     * @throws {ValidationError} If an id/file name is missing or the file is empty.
     * Unlike PDF uploads, the official logo operation defines no 25 MB cap, so
     * the SDK does not impose the document limit here.
     * @throws {ApiError} `400`/`415` if the API rejects the image.
     *
     * @example
     * ```ts
     * await client.workspaces.uploadLogo('acc_example', {
     *   buffer: logoPng,
     *   fileName: 'logo.png',
     *   contentType: 'image/png',
     * });
     * ```
     */
    async uploadLogo(accountId: string, source: AccountLogoUploadSource): Promise<void> {
        const id = this.requireId(accountId, 'Account ID');
        const { buffer, fileName } = await loadSource(source);
        validateFileNotEmpty(buffer, fileName);
        const contentType = source.contentType ?? imageContentType(fileName);
        const form = buildFileForm(buffer, fileName, contentType);
        return this.callVoid('Failed to upload account logo', () =>
            this.http.post(`/accounts/${this.pathSegment(id, 'Account ID')}/logo`, form, {
                headers: { 'Content-Type': 'multipart/form-data' },
            }),
        );
    }

    /**
     * Delete the current account logo (`DELETE /accounts/{accountId}/logo`).
     *
     * Request/response data: none beyond the standard status/message envelope.
     *
     * @param accountId - Account whose logo should be removed.
     * @returns Resolves when the API acknowledges deletion.
     * @example
     * ```ts
     * await client.workspaces.deleteLogo('acc_example');
     * ```
     */
    async deleteLogo(accountId: string): Promise<void> {
        const id = this.requireId(accountId, 'Account ID');
        return this.callVoid('Failed to delete account logo', () =>
            this.http.delete(`/accounts/${this.pathSegment(id, 'Account ID')}/logo`),
        );
    }

    /**
     * Return this account's document-funnel KPIs
     * (`GET /accounts/{accountId}/stats`).
     *
     * @param accountId - Account to aggregate.
     * @param params - Omit for 12 monthly rows, or request daily rows with
     * `{ granularity: 'daily', month: '2026-06' }`.
     * @returns Zero-filled KPI rows:
     * ```jsonc
     * [{
     *   "period": "2026-06",
     *   "documents_uploaded": 42,
     *   "documents_sent": 37,
     *   "signature_requests": 61,
     *   "signature_requests_email": 55,
     *   "signature_requests_whatsapp": 18,
     *   "signature_requests_viewed": 44,
     *   "signature_requests_completed": 52,
     *   "documents_certified": 30
     * }]
     * ```
     * @throws {ValidationError} For an empty account id, missing daily month,
     * or a month not formatted as `YYYY-MM`.
     * @throws {ApiError} `401` for invalid credentials or `404` when the route
     * is not deployed in a lagging environment.
     *
     * @example
     * ```ts
     * const monthly = await client.workspaces.getStats('acc_example');
     * const daily = await client.workspaces.getStats('acc_example', {
     *   granularity: 'daily',
     *   month: '2026-06',
     * });
     * ```
     */
    async getStats(
        accountId: string,
        params: IDocumentStatsParams = {},
    ): Promise<IDocumentStatsRow[]> {
        const id = this.requireId(accountId, 'Account ID');
        return this.call('Failed to fetch account document statistics', () =>
            this.http.get(`/accounts/${this.pathSegment(id, 'Account ID')}/stats`, {
                params: documentStatsParams(params),
            }),
        );
    }

    /**
     * Update a workspace (`PUT /accounts/{accountId}`).
     *
     * @param accountId - The workspace to update.
     * @param payload - The fields to change (`name` and/or brand colours).
     * Colours are 6-char hex **without** a leading `#`; pass `null` to clear one.
     * @returns The updated workspace. Response shape:
     * ```jsonc
     * {
     *   "id": "acc_example",
     *   "name": "Acme Legal (Renamed)",
     *   "primary_color": "ff0066",
     *   "secondary_color": "0066ff",
     *   "created_at": "2026-05-12T18:05:11Z"
     * }
     * ```
     * @throws {ValidationError} If `accountId` is missing.
     * @throws {ApiError} `400` for an invalid colour; `404` if the workspace
     * does not exist.
     *
     * @example
     * ```ts
     * await client.workspaces.update('acc_example', {
     *   name: 'Acme Legal (Renamed)',
     *   primary_color: 'ff0066',
     * });
     * ```
     */
    async update(accountId: string, payload: IUpdateWorkspacePayload): Promise<IWorkspaceResponse> {
        const id = this.requireId(accountId, 'Account ID');
        return this.call('Failed to update workspace', () =>
            this.http.put(`/accounts/${this.pathSegment(id, 'Account ID')}`, payload),
        );
    }

    /**
     * Delete a workspace (`DELETE /accounts/{accountId}`).
     *
     * A workspace with restrictions (e.g. remaining documents) is rejected with
     * `400` and a `restrictions` list; pass `{ force: true }` to override and
     * delete it anyway. The flag is sent in the request body, per the API.
     *
     * @param accountId - The workspace to delete.
     * @param options - Set `force: true` to delete despite restrictions.
     * @returns Nothing on success (`200` with no meaningful body).
     * @throws {ValidationError} If `accountId` is missing.
     * @throws {ApiError} `400` (with a `restrictions` list) when the workspace
     * has restrictions and `force` was not set; `404` if it does not exist.
     *
     * @example
     * ```ts
     * await client.workspaces.delete('acc_example');
     * // override restrictions:
     * await client.workspaces.delete('acc_example', { force: true });
     * ```
     */
    async delete(accountId: string, options: { force?: boolean } = {}): Promise<void> {
        const id = this.requireId(accountId, 'Account ID');
        const config = options.force ? { data: { force: true } } : undefined;
        return this.callVoid('Failed to delete workspace', () =>
            this.http.delete(`/accounts/${this.pathSegment(id, 'Account ID')}`, config),
        );
    }
}

function imageContentType(fileName: string): string {
    const name = fileName.toLowerCase();
    if (name.endsWith('.png')) return 'image/png';
    if (name.endsWith('.jpg') || name.endsWith('.jpeg')) return 'image/jpeg';
    if (name.endsWith('.gif')) return 'image/gif';
    if (name.endsWith('.webp')) return 'image/webp';
    if (name.endsWith('.svg')) return 'image/svg+xml';
    return 'application/octet-stream';
}
