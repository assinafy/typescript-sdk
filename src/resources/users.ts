import type {
    IAuthenticatedUser,
    IConfirmTotpPayload,
    IDocumentStatsParams,
    IDocumentStatsRow,
    IMfaReauth,
    IMfaRecoveryCodes,
    IMfaStatus,
    INotificationPreferences,
    ITotpEnrollment,
    IUpdateNotificationPreferences,
} from '../types';
import { ValidationError } from '../errors';
import { documentStatsParams } from '../support/stats';
import { assertNonEmptyString, assertRecord } from '../utils';
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
     * Request body (`application/json`):
     * ```jsonc
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
     *
     * @param preferences - One or more of the nine documented keys, each with
     * a boolean value. Request example:
     * ```json
     * { "DocumentCompleted": true, "SignerDeclined": false }
     * ```
     * @returns The complete updated nine-key preference map:
     * ```json
     * {
     *   "DocumentCompleted": true,
     *   "SignerDeclined": false,
     *   "DocumentCancelled": true,
     *   "DocumentAboutToExpire": true,
     *   "DocumentExpired": false,
     *   "DocumentExpirationReset": true,
     *   "DocumentProcessingFailed": true,
     *   "TemplateProcessingFailed": true,
     *   "SignerWhatsappFailed": true
     * }
     * ```
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

    /**
     * List the user's enrolled two-factor methods (`GET /users/self/mfa`).
     *
     * @returns Methods and unused recovery-code count:
     * ```jsonc
     * {
     *   "methods": [
     *     {
     *       "id": "a1b2c3d4e5f60718293a4b5c6d7e8f90",
     *       "type": "Totp",
     *       "label": "My phone",
     *       "confirmed_at": "2026-09-09T14:21:03Z",
     *       "last_used_at": "2026-09-09T18:02:44Z"
     *     }
     *   ],
     *   "recovery_codes_remaining": 8
     * }
     * ```
     * @throws {ApiError} `401` when credentials are missing or invalid.
     *
     * @example
     * ```ts
     * const { methods } = await client.users.getMfa();
     * const enabled = methods.some((method) => method.confirmed_at !== null);
     * ```
     */
    async getMfa(): Promise<IMfaStatus> {
        return this.call('Failed to fetch two-factor methods', () =>
            this.http.get('/users/self/mfa'),
        );
    }

    /**
     * Start authenticator-app enrollment (`POST /users/self/mfa/totp`).
     * Two-factor authentication is not active until
     * {@link UserResource.confirmTotpEnrollment} succeeds.
     *
     * Request body (`application/json`): `{ "label": "My phone" }` (optional).
     *
     * @param label - Optional name for the device.
     * @returns The pending enrollment. `secret` is returned only here:
     * ```jsonc
     * {
     *   "id": "a1b2c3d4e5f60718293a4b5c6d7e8f90",
     *   "secret": "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",
     *   "provisioning_uri": "otpauth://totp/user%40example.com?issuer=Assinafy&secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"
     * }
     * ```
     * @throws {ValidationError} If `label` is not a string.
     * @throws {ApiError} `401` when credentials are missing or invalid.
     *
     * @example
     * ```ts
     * const enrollment = await client.users.startTotpEnrollment('My phone');
     * showQrCode(enrollment.provisioning_uri);
     * ```
     */
    async startTotpEnrollment(label?: string): Promise<ITotpEnrollment> {
        if (label !== undefined && typeof label !== 'string') {
            throw new ValidationError('label must be a string');
        }
        return this.call('Failed to start authenticator enrollment', () =>
            this.http.post('/users/self/mfa/totp', label === undefined ? {} : { label }),
        );
    }

    /**
     * Activate an authenticator with a live code from the new device
     * (`PUT /users/self/mfa/totp/confirm`). From then on every login needs a
     * second factor.
     *
     * Replacing an already confirmed authenticator soft-deletes the old one,
     * reissues recovery codes, and additionally requires `password` or
     * `reauth_code`. First-time enrollment needs neither.
     *
     * Request body (`application/json`):
     * ```jsonc
     * {
     *   "id": "a1b2c3d4e5f60718293a4b5c6d7e8f90",
     *   "code": "123456",           // from the NEW device
     *   "password": "example-pass", // only when replacing; or:
     *   "reauth_code": "654321"     // code from the CURRENT device, or a recovery code
     * }
     * ```
     *
     * @param payload - Enrollment `id`, new-device `code`, and re-authentication
     * when replacing a method.
     * @returns The recovery codes, shown only once:
     * ```jsonc
     * {
     *   "recovery_codes": ["ABCD-EFGH-JKMN", "PQRS-TUVW-XYZ2"] // ten in total
     * }
     * ```
     * @throws {ValidationError} If `id` or `code` is empty.
     * @throws {ApiError} `400` for a wrong code or missing re-authentication;
     * `404` for an unknown enrollment.
     *
     * @example
     * ```ts
     * const { recovery_codes } = await client.users.confirmTotpEnrollment({
     *   id: enrollment.id,
     *   code: '123456',
     * });
     * ```
     */
    async confirmTotpEnrollment(payload: IConfirmTotpPayload): Promise<IMfaRecoveryCodes> {
        assertRecord(payload, 'payload');
        assertNonEmptyString(payload.id, 'id');
        assertNonEmptyString(payload.code, 'code');
        return this.call('Failed to confirm authenticator enrollment', () =>
            this.http.put('/users/self/mfa/totp/confirm', payload),
        );
    }

    /**
     * Issue ten fresh recovery codes and invalidate the previous set
     * (`POST /users/self/mfa/recovery-codes`).
     *
     * Request body (`application/json`): `{ "password": "…" }` or
     * `{ "code": "123456" }`.
     *
     * @param proof - Current password, or a live authenticator / recovery code.
     * @returns The new codes, shown only once:
     * ```jsonc
     * {
     *   "recovery_codes": ["ABCD-EFGH-JKMN", "PQRS-TUVW-XYZ2"] // ten in total
     * }
     * ```
     * @throws {ValidationError} If neither `password` nor `code` is given.
     * @throws {ApiError} `400` when the proof is rejected.
     *
     * @example
     * ```ts
     * const { recovery_codes } = await client.users.regenerateRecoveryCodes({ code: '123456' });
     * ```
     */
    async regenerateRecoveryCodes(proof: IMfaReauth): Promise<IMfaRecoveryCodes> {
        validateReauth(proof);
        return this.call('Failed to regenerate recovery codes', () =>
            this.http.post('/users/self/mfa/recovery-codes', proof),
        );
    }

    /**
     * Remove an enrolled two-factor method (`DELETE /users/self/mfa/{id}`).
     * Removing the last method also discards the recovery codes.
     *
     * Request body (`application/json`): `{ "password": "…" }` or
     * `{ "code": "123456" }`.
     *
     * @param methodId - The method ID from {@link UserResource.getMfa}.
     * @param proof - Current password, or a live authenticator / recovery code.
     * @returns Whether two-factor authentication is still on:
     * ```jsonc
     * { "is_mfa_enabled": false }
     * ```
     * @throws {ValidationError} If `methodId` is empty or no proof is given.
     * @throws {ApiError} `400` when the proof is rejected; `404` for an unknown
     * method.
     *
     * @example
     * ```ts
     * await client.users.deleteMfaMethod(method.id, { password });
     * ```
     */
    async deleteMfaMethod(
        methodId: string,
        proof: IMfaReauth,
    ): Promise<{ is_mfa_enabled: boolean }> {
        const id = this.pathSegment(methodId, 'Method ID');
        validateReauth(proof);
        return this.call('Failed to remove two-factor method', () =>
            this.http.delete(`/users/self/mfa/${id}`, { data: proof }),
        );
    }
}

function validateReauth(proof: IMfaReauth): void {
    assertRecord(proof, 'proof');
    if (![proof.password, proof.code].some((value) => typeof value === 'string' && value.trim())) {
        throw new ValidationError('password or code is required');
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
