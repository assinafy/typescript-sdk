import type {
    IAuthenticatedUser,
    IDocumentStatsParams,
    IDocumentStatsRow,
    INotificationPreferences,
    IUpdateNotificationPreferences,
} from '../types';
import { ValidationError } from '../errors';
import { documentStatsParams } from '../support/stats';
import { assertRecord } from '../utils';
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
        // Some deployments wrap the user in `{ user, accounts }` inside the
        // normal envelope. Normalize that compatibility shape while keeping the
        // public method aligned with the direct user return type.
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

    /**
     * Return the authenticated user's owner-facing document e-mail settings
     * (`GET /users/self/notification-preferences`).
     *
     * Request body: none. Authentication: `X-Api-Key` or Bearer token.
     *
     * @returns The complete nine-key preference map:
     * ```json
     * {
     *   "DocumentCompleted": true,
     *   "SignerDeclined": true,
     *   "DocumentCancelled": true,
     *   "DocumentAboutToExpire": true,
     *   "DocumentExpired": true,
     *   "DocumentExpirationReset": true,
     *   "DocumentProcessingFailed": true,
     *   "TemplateProcessingFailed": true,
     *   "SignerWhatsappFailed": true
     * }
     * ```
     * @throws {ApiError} `401` when credentials are missing/invalid, or `500`
     * when the API cannot load the preferences.
     *
     * @example
     * ```ts
     * const preferences = await client.users.getNotificationPreferences();
     * ```
     */
    async getNotificationPreferences(): Promise<INotificationPreferences> {
        return this.call('Failed to fetch notification preferences', () =>
            this.http.get('/users/self/notification-preferences'),
        );
    }

    /**
     * Merge owner-facing document e-mail settings for the authenticated user
     * (`PUT /users/self/notification-preferences`). Omitted keys retain their
     * current values; account/security e-mails are not configurable here.
     *
     * @param preferences - One or more of the nine documented keys, each with
     * a boolean value. Request example:
     * ```json
     * { "DocumentCompleted": true, "SignerDeclined": false }
     * ```
     * @returns The complete updated map; its shape is identical to
     * {@link UserResource.getNotificationPreferences}.
     * @throws {ValidationError} Before requesting when the map is empty, has an
     * unknown key, or contains a non-boolean value.
     * @throws {ApiError} `400` if the API rejects the map, `401` for invalid
     * credentials, or `500` on a server error.
     *
     * @example
     * ```ts
     * await client.users.updateNotificationPreferences({
     *   SignerDeclined: false,
     *   DocumentExpired: false,
     * });
     * ```
     */
    async updateNotificationPreferences(
        preferences: IUpdateNotificationPreferences,
    ): Promise<INotificationPreferences> {
        validateNotificationPreferences(preferences);
        return this.call('Failed to update notification preferences', () =>
            this.http.put('/users/self/notification-preferences', preferences),
        );
    }
}

const NOTIFICATION_PREFERENCE_KEYS = new Set<keyof INotificationPreferences>([
    'DocumentCompleted',
    'SignerDeclined',
    'DocumentCancelled',
    'DocumentAboutToExpire',
    'DocumentExpired',
    'DocumentExpirationReset',
    'DocumentProcessingFailed',
    'TemplateProcessingFailed',
    'SignerWhatsappFailed',
]);

function validateNotificationPreferences(preferences: IUpdateNotificationPreferences): void {
    assertRecord(preferences, 'notification preferences');
    const entries = Object.entries(preferences);
    if (entries.length === 0) {
        throw new ValidationError('at least one notification preference is required');
    }
    for (const [key, value] of entries) {
        if (!NOTIFICATION_PREFERENCE_KEYS.has(key as keyof INotificationPreferences)) {
            throw new ValidationError(`unknown notification preference: ${key}`);
        }
        if (typeof value !== 'boolean') {
            throw new ValidationError(`${key} must be a boolean`);
        }
    }
}
