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
            email: 'bill@example.com',
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
});
