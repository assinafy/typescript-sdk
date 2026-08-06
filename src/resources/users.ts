import type {
    IAuthenticatedUser,
    IDocumentStatsParams,
    IDocumentStatsRow,
} from '../types';
import { documentStatsParams } from '../support/stats';
import { BaseResource } from './base';

/** Operations for the authenticated Assinafy user. */
export class UserResource extends BaseResource {
    /**
     * Return the authenticated user's profile (`GET /users/self`).
     *
     * Request body: none. Authentication: `X-Api-Key` or Bearer token.
     *
     * @returns The unwrapped user payload:
     * ```jsonc
     * {
     *   "id": "bgjazeo5r9v2lq7l36dx48np",
     *   "name": "John Smith",
     *   "email": "john@example.com",
     *   "telephone": null,
     *   "government_id": null,
     *   "is_email_verified": true,
     *   "has_accepted_terms": true,
     *   "created_at": "2026-06-03T03:54:16Z",
     *   "to_be_deleted_at": null
     * }
     * ```
     * @throws {ApiError} `401` when credentials are missing/invalid, or `500`
     * when the API cannot load the user.
     *
     * @example
     * ```ts
     * const user = await client.users.getCurrent();
     * console.log(user.email);
     * ```
     */
    async getCurrent(): Promise<IAuthenticatedUser> {
        const result = await this.call<IAuthenticatedUser | { user: IAuthenticatedUser }>(
            'Failed to fetch current user',
            () => this.http.get('/users/self'),
        );
        // The published response is AuthUser directly. The sandbox deployment
        // audited on 2026-08-06 still returns the older `{ user, accounts }`
        // payload inside the normal envelope. Normalize that live variant while
        // keeping the public method aligned with the official return type.
        if (
            result
            && typeof result === 'object'
            && 'user' in result
            && result.user
            && typeof result.user === 'object'
        ) {
            return result.user;
        }
        return result as IAuthenticatedUser;
    }

    /**
     * Return document-funnel KPIs summed across all accounts the user currently
     * belongs to (`GET /users/self/stats`).
     *
     * @param params - Omit for the latest 12 monthly rows. For daily rows pass
     * `{ granularity: 'daily', month: '2026-06' }`.
     * @returns A zero-filled series, most recent period first:
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
     * @throws {ValidationError} If daily granularity has no month or `month`
     * does not use `YYYY-MM`.
     * @throws {ApiError} `400` for an invalid query or `401` for invalid auth.
     *
     * @example
     * ```ts
     * const monthly = await client.users.getStats();
     * const daily = await client.users.getStats({
     *   granularity: 'daily',
     *   month: '2026-06',
     * });
     * ```
     */
    async getStats(params: IDocumentStatsParams = {}): Promise<IDocumentStatsRow[]> {
        return this.call('Failed to fetch current-user document statistics', () =>
            this.http.get('/users/self/stats', { params: documentStatsParams(params) }),
        );
    }
}
