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
import { ValidationError } from '../errors';
import { documentStatsParams } from '../support/stats';
import { assertNonEmptyString, assertRecord } from '../utils';
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
 * Requests accept `name`, `notification_sender_type`, `primary_color`, and
 * `secondary_color`. Colours are always modeled on responses. When
 * sent, they must be exactly six hex characters with no leading `#`.
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
     * @param payload - Official fields are workspace `name` (required) and
     * optional `notification_sender_type` (`User` or `Account`). Optional brand
     * colours use six hex characters without
     * a leading `#`.
     * @returns The created workspace. Response shape:
     * ```jsonc
     * {
     *   "resource": "account",
     *   "id": "acc_example",
     *   "name": "Acme Legal",
     *   "notification_sender_type": "Account",
     *   "primary_color": "ff0066",
     *   "secondary_color": "0066ff",
     *   "roles": ["owner"],
     *   "is_delete_allowed": true,
     *   "created_at": "2026-05-12T18:05:11Z"
     * }
     * ```
     * @throws {ValidationError} If `payload` is not an object.
     * @throws {ApiError} If the API rejects the request — e.g. `400` when a
     * colour is not exactly 6 hex characters (or carries a leading `#`).
     *
     * @example
     * ```ts
     * const ws = await client.workspaces.create({
     *   name: 'Acme Legal',
     *   notification_sender_type: 'Account',
     *   primary_color: 'ff0066',
     *   secondary_color: '0066ff',
     * });
     * ```
     */
    async create(payload: ICreateWorkspacePayload): Promise<IWorkspaceResponse> {
        assertRecord(payload, 'workspace payload');
        assertNonEmptyString(payload.name, 'name');
        validateWorkspaceSender(payload.notification_sender_type);
        validateWorkspaceColor(payload.primary_color, 'primary_color', false);
        validateWorkspaceColor(payload.secondary_color, 'secondary_color', false);
        const body: ICreateWorkspacePayload = { name: payload.name };
        if (payload.notification_sender_type !== undefined) {
            body.notification_sender_type = payload.notification_sender_type;
        }
        if (payload.primary_color !== undefined) body.primary_color = payload.primary_color;
        if (payload.secondary_color !== undefined) body.secondary_color = payload.secondary_color;
        return this.call('Failed to create workspace', () => this.http.post('/accounts', body));
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
     *       "resource": "account",
     *       "id": "acc_example",
     *       "name": "MT",
     *       "primary_color": null,
     *       "secondary_color": null,
     *       "notification_sender_type": "User",
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
     *   "resource": "account",
     *   "id": "acc_example",
     *   "name": "MT",
     *   "primary_color": null,
     *   "secondary_color": null,
     *   "notification_sender_type": "User",
     *   "roles": ["owner"],
     *   "is_delete_allowed": true,
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
     * @throws {ValidationError} If `accountId` is empty.
     * @throws {ApiError} If the API rejects the request.
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
     *   "signature_requests_notification_email": 55,
     *   "signature_requests_notification_whatsapp": 18,
     *   "signature_requests_notification_bypass": 3,
     *   "signature_requests_verification_email": 48,
     *   "signature_requests_verification_whatsapp": 6,
     *   "signature_requests_verification_bypass": 3,
     *   "signature_requests_verification_digital_certificate": 4,
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
     * @param payload - Official fields are `name` and
     * `notification_sender_type` (`User` or `Account`). Brand colours use six
     * hex characters without a leading `#`;
     * pass `null` to clear one.
     * @returns The updated workspace. Response shape:
     * ```jsonc
     * {
     *   "resource": "account",
     *   "id": "acc_example",
     *   "name": "Acme Legal (Renamed)",
     *   "notification_sender_type": "Account",
     *   "primary_color": "ff0066",
     *   "secondary_color": "0066ff",
     *   "roles": ["owner"],
     *   "is_delete_allowed": true,
     *   "created_at": "2026-05-12T18:05:11Z"
     * }
     * ```
     * @throws {ValidationError} If `accountId` is missing or `payload` is not
     * an object.
     * @throws {ApiError} `400` for an invalid colour; `404` if the workspace
     * does not exist.
     *
     * @example
     * ```ts
     * await client.workspaces.update('acc_example', {
     *   name: 'Acme Legal (Renamed)',
     *   notification_sender_type: 'Account',
     *   primary_color: 'ff0066',
     * });
     * ```
     */
    async update(accountId: string, payload: IUpdateWorkspacePayload): Promise<IWorkspaceResponse> {
        assertRecord(payload, 'workspace payload');
        if (payload.name !== undefined) assertNonEmptyString(payload.name, 'name');
        validateWorkspaceSender(payload.notification_sender_type);
        validateWorkspaceColor(payload.primary_color, 'primary_color', true);
        validateWorkspaceColor(payload.secondary_color, 'secondary_color', true);
        const id = this.requireId(accountId, 'Account ID');
        const body: IUpdateWorkspacePayload = {};
        if (payload.name !== undefined) body.name = payload.name;
        if (payload.notification_sender_type !== undefined) {
            body.notification_sender_type = payload.notification_sender_type;
        }
        if (payload.primary_color !== undefined) body.primary_color = payload.primary_color;
        if (payload.secondary_color !== undefined) body.secondary_color = payload.secondary_color;
        return this.call('Failed to update workspace', () =>
            this.http.put(`/accounts/${this.pathSegment(id, 'Account ID')}`, body),
        );
    }

    /**
     * Delete a workspace (`DELETE /accounts/{accountId}`).
     *
     * A workspace with an active paid subscription is rejected with `400` and
     * a `restrictions` list. `{ force: true }` cancels that subscription and
     * proceeds with deletion; it is not documented as a blanket override for
     * unrelated restrictions. The flag is sent in the request body.
     *
     * @param accountId - The workspace to delete.
     * @param options - Set `force: true` to cancel an active paid subscription
     * and proceed with deletion.
     * @returns Nothing on success (`200` with no meaningful body).
     * @throws {ValidationError} If `accountId` is missing.
     * @throws {ApiError} `400` (with a `restrictions` list) when the workspace
     * has restrictions and `force` was not set; `404` if it does not exist.
     *
     * @example
     * ```ts
     * await client.workspaces.delete('acc_example');
     * // cancel an active paid subscription, then delete:
     * await client.workspaces.delete('acc_example', { force: true });
     * ```
     */
    async delete(accountId: string, options: { force?: boolean } = {}): Promise<void> {
        assertRecord(options, 'workspace delete options');
        if (options.force !== undefined && typeof options.force !== 'boolean') {
            throw new ValidationError('force must be a boolean');
        }
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

function validateWorkspaceSender(value: unknown): void {
    if (value !== undefined && value !== 'User' && value !== 'Account') {
        throw new ValidationError('notification_sender_type must be User or Account');
    }
}

function validateWorkspaceColor(value: unknown, name: string, nullable: boolean): void {
    if (value === undefined || (nullable && value === null)) return;
    if (typeof value !== 'string' || !/^[0-9a-fA-F]{6}$/.test(value)) {
        throw new ValidationError(
            `${name} must be exactly six hexadecimal characters without a leading #${nullable ? ', or null' : ''}`,
        );
    }
}
