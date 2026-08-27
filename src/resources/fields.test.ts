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
            if (url.endsWith('/validate-multiple')) {
                return ok([
                    { field_id: 'f1', type: 'cpf', success: true, error_message: '' },
                    { field_id: 'f2', type: 'text', success: true, error_message: '' },
                ]);
            }
            if (url.endsWith('/validate')) {
                return ok({ type: 'text', success: true, error_message: '' });
            }
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
    test('rejects malformed payload and option objects before requesting', async () => {
        const { http, calls } = mockHttp();
        const fields = new FieldsResource(http, 'acc');
        const requests = [
            () => fields.create(null as never),
            () => fields.create({ type: 42, name: 'Field' } as never),
            () => fields.create({ type: 'text', name: 'Field', is_required: 'true' } as never),
            () => fields.update('f1', null as never),
            () => fields.update('f1', { regex: 42 } as never),
            () => fields.list({ include_inactive: 'true' } as never),
            () => fields.validate('f1', 'value', null as never),
            () => fields.validate('f1', 'value', { signerAccessCode: 42 } as never),
            () => fields.validate('f1', undefined),
            () => fields.validateMultiple([{ field_id: 'f1', value: 'value' }], null as never),
        ];

        for (const request of requests) {
            await expect(request()).rejects.toBeInstanceOf(ValidationError);
        }
        expect(calls).toHaveLength(0);
    });

    test('create validates inputs and POSTs to /accounts/{id}/fields', async () => {
        const { http, calls } = mockHttp();
        const fields = new FieldsResource(http, 'acc');
        await expect(fields.create({ type: '', name: 'x' } as never)).rejects.toThrow(ValidationError);
        await expect(fields.create({ type: 'text', name: '' } as never)).rejects.toThrow(ValidationError);
        await fields.create({
            type: 'text',
            name: 'My Field',
            internal_secret: 'do-not-send',
        } as never);
        expect(calls[0]).toEqual({ method: 'POST', url: '/accounts/acc/fields', body: { type: 'text', name: 'My Field' }, config: undefined });
    });

    test('list propagates include_inactive / include_standard params', async () => {
        const { http, calls } = mockHttp();
        const fields = new FieldsResource(http, 'acc');
        await fields.list({
            include_inactive: true,
            internal_secret: 'do-not-send',
        } as never);
        expect(calls[0]?.config).toEqual({ params: { include_inactive: true } });
    });

    test('validate adds signer-access-code when provided', async () => {
        const { http, calls } = mockHttp();
        const fields = new FieldsResource(http, 'acc');
        const result = await fields.validate('f1', 'value', { signerAccessCode: 'code-1' });
        expect(calls[0]?.config).toEqual({ params: { 'signer-access-code': 'code-1' } });
        expect(calls[0]?.body).toEqual({ value: 'value' });
        expect(result).toEqual({ type: 'text', success: true, error_message: '' });
        expect(result.field_id).toBeUndefined();
    });

    test('validateMultiple rejects empty arrays', async () => {
        const { http } = mockHttp();
        const fields = new FieldsResource(http, 'acc');
        await expect(fields.validateMultiple([])).rejects.toThrow(ValidationError);
    });

    test('validateMultiple rejects malformed entries before requesting', async () => {
        const { http, calls } = mockHttp();
        const fields = new FieldsResource(http, 'account-1');

        await expect(
            fields.validateMultiple([{ field_id: '', value: 'x' }]),
        ).rejects.toBeInstanceOf(ValidationError);
        await expect(
            fields.validateMultiple([{ field_id: 'f1' } as never]),
        ).rejects.toBeInstanceOf(ValidationError);
        await expect(fields.validateMultiple([null as never])).rejects.toBeInstanceOf(
            ValidationError,
        );
        expect(calls).toHaveLength(0);
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
        await fields.update('f1', {
            name: 'Updated',
            is_active: false,
            internal_secret: 'do-not-send',
        } as never);
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
            { field_id: 'f1', value: '123.456.789-09', internal_secret: 'do-not-send' },
            { field_id: 'f2', value: 'Jane Doe' },
        ];
        const result = await fields.validateMultiple(entries, { signerAccessCode: 'code-2' });
        expect(calls[0]?.method).toBe('POST');
        expect(calls[0]?.url).toBe('/accounts/acc/fields/validate-multiple');
        expect(calls[0]?.body).toEqual([
            { field_id: 'f1', value: '123.456.789-09' },
            { field_id: 'f2', value: 'Jane Doe' },
        ]);
        expect(calls[0]?.config).toEqual({ params: { 'signer-access-code': 'code-2' } });
        expect(result[0]?.field_id).toBe('f1');
        expect(result[1]?.field_id).toBe('f2');
    });

    test('validateMultiple omits params when no signer access code', async () => {
        const { http, calls } = mockHttp();
        const fields = new FieldsResource(http, 'acc');
        await fields.validateMultiple([{ field_id: 'f1', value: 'x' }]);
        expect(calls[0]?.url).toBe('/accounts/acc/fields/validate-multiple');
        expect(calls[0]?.config).toEqual({ params: undefined });
    });
});
