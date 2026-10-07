import { describe, expect, test } from 'bun:test';
import type { AxiosInstance } from 'axios';
import { ValidationError } from '../errors';
import { UserResource } from './users';

describe('UserResource', () => {
    test('getCurrent fetches and unwraps /users/self', async () => {
        let path = '';
        const user = {
            id: 'u1',
            name: 'Test User',
            email: 'ana@example.com',
            telephone: null,
            government_id: null,
            is_email_verified: true,
            has_accepted_terms: true,
            created_at: '2026-08-06T12:00:00Z',
            to_be_deleted_at: null,
        };
        const http = {
            get: async (url: string) => {
                path = url;
                return { status: 200, data: { status: 200, message: '', data: user } };
            },
        } as unknown as AxiosInstance;

        await expect(new UserResource(http).getCurrent()).resolves.toEqual(user);
        expect(path).toBe('/users/self');
    });

    test('getCurrent normalizes the sandbox legacy { user, accounts } variant', async () => {
        const user = {
            id: 'u1',
            name: 'Test User',
            email: 'test@example.com',
            telephone: null,
            government_id: null,
            is_email_verified: true,
            has_accepted_terms: true,
            is_password_set: true,
            created_at: '2026-08-06T12:00:00Z',
            to_be_deleted_at: null,
        };
        const http = {
            get: async () => ({
                status: 200,
                data: { status: 200, data: { user, accounts: [] } },
            }),
        } as unknown as AxiosInstance;

        await expect(new UserResource(http).getCurrent()).resolves.toEqual(user);
    });

    test('getStats serializes monthly/daily queries and unwraps rows', async () => {
        const calls: Array<{ url: string; params: unknown }> = [];
        const rows = [{
            period: '2026-06-01',
            documents_uploaded: 1,
            documents_sent: 1,
            signature_requests: 1,
            signature_requests_notification_email: 1,
            signature_requests_notification_whatsapp: 0,
            signature_requests_notification_bypass: 0,
            signature_requests_verification_email: 1,
            signature_requests_verification_whatsapp: 0,
            signature_requests_verification_bypass: 0,
            signature_requests_verification_digital_certificate: 0,
            signature_requests_viewed: 1,
            signature_requests_completed: 1,
            documents_certified: 1,
        }];
        const http = {
            get: async (url: string, config: { params: unknown }) => {
                calls.push({ url, params: config.params });
                return { status: 200, data: { status: 200, message: '', data: rows } };
            },
        } as unknown as AxiosInstance;
        const users = new UserResource(http);

        await expect(users.getStats()).resolves.toEqual(rows);
        await users.getStats({ granularity: 'daily', month: '2026-06' });
        expect(calls).toEqual([
            { url: '/users/self/stats', params: {} },
            {
                url: '/users/self/stats',
                params: { granularity: 'daily', month: '2026-06' },
            },
        ]);
    });

    test('getStats rejects an invalid daily query before requesting', async () => {
        const users = new UserResource({} as AxiosInstance);
        await expect(users.getStats({ granularity: 'daily' })).rejects.toBeInstanceOf(
            ValidationError,
        );
        await expect(users.getStats({ month: '06-2026' })).rejects.toBeInstanceOf(
            ValidationError,
        );
    });

    test('getStats rejects an unknown granularity before requesting', async () => {
        let calls = 0;
        const ax = {
            get: async () => {
                calls++;
                return { status: 200, data: { status: 200, data: [] } };
            },
        } as unknown as AxiosInstance;
        await expect(
            new UserResource(ax).getStats({ granularity: 'weekly' as never }),
        ).rejects.toThrow('granularity must be monthly or daily');
        expect(calls).toBe(0);
    });

    test('notification preferences use the documented GET and PUT contracts', async () => {
        const calls: Array<{ method: string; url: string; body?: unknown }> = [];
        const preferences = {
            DocumentCompleted: true,
            SignerDeclined: false,
            DocumentCancelled: true,
            DocumentAboutToExpire: true,
            DocumentExpired: true,
            DocumentExpirationReset: true,
            DocumentProcessingFailed: true,
            TemplateProcessingFailed: true,
            SignerWhatsappFailed: true,
        };
        const response = { status: 200, data: { status: 200, message: '', data: preferences } };
        const http = {
            get: async (url: string) => {
                calls.push({ method: 'GET', url });
                return response;
            },
            put: async (url: string, body: unknown) => {
                calls.push({ method: 'PUT', url, body });
                return response;
            },
        } as unknown as AxiosInstance;
        const users = new UserResource(http);

        await expect(users.getNotificationPreferences()).resolves.toEqual(preferences);
        await expect(users.updateNotificationPreferences({ SignerDeclined: false })).resolves.toEqual(
            preferences,
        );
        expect(calls).toEqual([
            { method: 'GET', url: '/users/self/notification-preferences' },
            {
                method: 'PUT',
                url: '/users/self/notification-preferences',
                body: { SignerDeclined: false },
            },
        ]);
    });

    test('updateNotificationPreferences rejects invalid maps before requesting', async () => {
        const users = new UserResource({} as AxiosInstance);
        await expect(
            users.updateNotificationPreferences(null as never),
        ).rejects.toBeInstanceOf(ValidationError);
        await expect(users.updateNotificationPreferences({})).rejects.toBeInstanceOf(ValidationError);
        await expect(
            users.updateNotificationPreferences({ Unknown: true } as never),
        ).rejects.toBeInstanceOf(ValidationError);
        await expect(
            users.updateNotificationPreferences({ SignerDeclined: 'no' } as never),
        ).rejects.toBeInstanceOf(ValidationError);
    });

    test('two-factor methods use the documented routes and bodies', async () => {
        const calls: Array<{ method: string; url: string; body?: unknown }> = [];
        const reply = (data: unknown) => ({ status: 200, data: { status: 200, data } });
        const http = {
            get: async (url: string) => {
                calls.push({ method: 'GET', url });
                return reply({ methods: [], recovery_codes_remaining: 0 });
            },
            post: async (url: string, body: unknown) => {
                calls.push({ method: 'POST', url, body });
                return reply(url.endsWith('/totp')
                    ? { id: 'm1', secret: 'S', provisioning_uri: 'otpauth://totp/x' }
                    : { recovery_codes: ['ABCD-EFGH-JKMN'] });
            },
            put: async (url: string, body: unknown) => {
                calls.push({ method: 'PUT', url, body });
                return reply({ recovery_codes: ['ABCD-EFGH-JKMN'] });
            },
            delete: async (url: string, config: { data: unknown }) => {
                calls.push({ method: 'DELETE', url, body: config.data });
                return reply({ is_mfa_enabled: false });
            },
        } as unknown as AxiosInstance;
        const users = new UserResource(http);

        expect(await users.getMfa()).toEqual({ methods: [], recovery_codes_remaining: 0 });
        expect((await users.startTotpEnrollment()).id).toBe('m1');
        await users.startTotpEnrollment('My phone');
        expect(
            await users.confirmTotpEnrollment({ id: 'm1', code: '123456', reauth_code: '654321' }),
        ).toEqual({ recovery_codes: ['ABCD-EFGH-JKMN'] });
        await users.regenerateRecoveryCodes({ code: '123456' });
        expect(await users.deleteMfaMethod('m1', { password: 'pw' })).toEqual({
            is_mfa_enabled: false,
        });

        expect(calls).toEqual([
            { method: 'GET', url: '/users/self/mfa' },
            { method: 'POST', url: '/users/self/mfa/totp', body: {} },
            { method: 'POST', url: '/users/self/mfa/totp', body: { label: 'My phone' } },
            {
                method: 'PUT',
                url: '/users/self/mfa/totp/confirm',
                body: { id: 'm1', code: '123456', reauth_code: '654321' },
            },
            { method: 'POST', url: '/users/self/mfa/recovery-codes', body: { code: '123456' } },
            { method: 'DELETE', url: '/users/self/mfa/m1', body: { password: 'pw' } },
        ]);
    });

    test('two-factor methods reject malformed input before requesting', async () => {
        let requested = false;
        const http = new Proxy({}, {
            get: () => async () => {
                requested = true;
            },
        }) as unknown as AxiosInstance;
        const users = new UserResource(http);
        const requests = [
            () => users.startTotpEnrollment(5 as never),
            () => users.confirmTotpEnrollment(null as never),
            () => users.confirmTotpEnrollment({ id: '', code: '123456' }),
            () => users.confirmTotpEnrollment({ id: 'm1', code: '' }),
            () => users.regenerateRecoveryCodes({}),
            () => users.regenerateRecoveryCodes({ password: ' ' }),
            () => users.regenerateRecoveryCodes(undefined as never),
            () => users.deleteMfaMethod('', { password: 'pw' }),
            () => users.deleteMfaMethod('m1', {}),
        ];
        for (const request of requests) {
            await expect(request()).rejects.toBeInstanceOf(ValidationError);
        }
        expect(requested).toBe(false);
    });
});
