import { describe, test, expect } from 'bun:test';
import type { AxiosInstance } from 'axios';
import { FieldsResource } from './fields';
import { ValidationError } from '../errors';

function mockHttp(): { http: AxiosInstance; calls: Array<{ method: string; url: string; body?: unknown; config?: unknown }> } {
    const calls: Array<{ method: string; url: string; body?: unknown; config?: unknown }> = [];
    const ok = (data: unknown) => ({ status: 200, data: { status: 200, data } });
    const http = {
        get: async (url: string, config?: unknown) => {
            calls.push({ method: 'GET', url, config });
            return ok([{ id: 'f1', name: 'CPF', type: 'cpf', is_active: true }]);
        },
        post: async (url: string, body: unknown, config?: unknown) => {
            calls.push({ method: 'POST', url, body, config });
            return ok({ id: 'f1', name: 'CPF', type: 'cpf', is_active: true });
        },
        put: async (url: string, body: unknown) => {
            calls.push({ method: 'PUT', url, body });
            return ok({ id: 'f1', name: 'Updated', type: 'text', is_active: true });
        },
        delete: async (url: string) => {
            calls.push({ method: 'DELETE', url });
            return ok([]);
        },
    } as unknown as AxiosInstance;
    return { http, calls };
}

describe('FieldsResource', () => {
    test('create validates inputs and POSTs to /accounts/{id}/fields', async () => {
        const { http, calls } = mockHttp();
        const fields = new FieldsResource(http, 'acc');
        await expect(fields.create({ type: '', name: 'x' } as never)).rejects.toThrow(ValidationError);
        await expect(fields.create({ type: 'text', name: '' } as never)).rejects.toThrow(ValidationError);
        await fields.create({ type: 'text', name: 'My Field' });
        expect(calls[0]).toEqual({ method: 'POST', url: '/accounts/acc/fields', body: { type: 'text', name: 'My Field' }, config: undefined });
    });

    test('list propagates include_inactive / include_standard params', async () => {
        const { http, calls } = mockHttp();
        const fields = new FieldsResource(http, 'acc');
        await fields.list({ include_inactive: true });
        expect(calls[0]?.config).toEqual({ params: { include_inactive: true } });
    });

    test('validate adds signer-access-code when provided', async () => {
        const { http, calls } = mockHttp();
        const fields = new FieldsResource(http, 'acc');
        await fields.validate('f1', 'value', { signerAccessCode: 'code-1' });
        expect(calls[0]?.config).toEqual({ params: { 'signer-access-code': 'code-1' } });
        expect(calls[0]?.body).toEqual({ value: 'value' });
    });

    test('validateMultiple rejects empty arrays', async () => {
        const { http } = mockHttp();
        const fields = new FieldsResource(http, 'acc');
        await expect(fields.validateMultiple([])).rejects.toThrow(ValidationError);
    });

    test('listTypes hits /field-types', async () => {
        const { http, calls } = mockHttp();
        const fields = new FieldsResource(http, 'acc');
        await fields.listTypes();
        expect(calls[0]).toEqual({ method: 'GET', url: '/field-types', config: undefined });
    });
});
