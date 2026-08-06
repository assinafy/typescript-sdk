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

    test('get fetches /accounts/{id}/fields/{fieldId}', async () => {
        const { http, calls } = mockHttp();
        const fields = new FieldsResource(http, 'acc');
        await fields.get('f1');
        expect(calls[0]).toEqual({ method: 'GET', url: '/accounts/acc/fields/f1', config: undefined });
    });

    test('update PUTs body to /accounts/{id}/fields/{fieldId}', async () => {
        const { http, calls } = mockHttp();
        const fields = new FieldsResource(http, 'acc');
        await fields.update('f1', { name: 'Updated', is_active: false });
        expect(calls[0]).toEqual({
            method: 'PUT',
            url: '/accounts/acc/fields/f1',
            body: { name: 'Updated', is_active: false },
        });
    });

    test('delete hits /accounts/{id}/fields/{fieldId}', async () => {
        const { http, calls } = mockHttp();
        const fields = new FieldsResource(http, 'acc');
        await fields.delete('f1');
        expect(calls[0]).toEqual({ method: 'DELETE', url: '/accounts/acc/fields/f1' });
    });

    test('validateMultiple POSTs entries body with signer-access-code param', async () => {
        const { http, calls } = mockHttp();
        const fields = new FieldsResource(http, 'acc');
        const entries = [
            { field_id: 'f1', value: '123.456.789-09' },
            { field_id: 'f2', value: 'Jane Doe' },
        ];
        await fields.validateMultiple(entries, { signerAccessCode: 'code-2' });
        expect(calls[0]?.method).toBe('POST');
        expect(calls[0]?.url).toBe('/accounts/acc/fields/validate-multiple');
        expect(calls[0]?.body).toEqual(entries);
        expect(calls[0]?.config).toEqual({ params: { 'signer-access-code': 'code-2' } });
    });

    test('validateMultiple omits params when no signer access code', async () => {
        const { http, calls } = mockHttp();
        const fields = new FieldsResource(http, 'acc');
        await fields.validateMultiple([{ field_id: 'f1', value: 'x' }]);
        expect(calls[0]?.url).toBe('/accounts/acc/fields/validate-multiple');
        expect(calls[0]?.config).toEqual({ params: undefined });
    });
});
