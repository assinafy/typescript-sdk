import { describe, test, expect, beforeEach } from 'bun:test';
import { TagResource } from './tags';
import { ValidationError } from '../errors';
import type { AxiosInstance } from 'axios';

describe('TagResource', () => {
    let mockAxios: AxiosInstance;
    let tags: TagResource;

    beforeEach(() => {
        mockAxios = {
            get: async () => ({ status: 200, data: { status: 200, data: [] }, headers: {} }),
            post: async () => ({ status: 200, data: { status: 200, data: { id: 't1' } } }),
            put: async () => ({ status: 200, data: { status: 200, data: { id: 't1' } } }),
            delete: async () => ({ status: 200 }),
        } as unknown as AxiosInstance;
        tags = new TagResource(mockAxios, 'acc');
    });

    test('list hits the account-scoped tags endpoint and forwards search', async () => {
        let url = '';
        let params: unknown;
        const ax = {
            ...mockAxios,
            get: async (u: string, cfg: { params: unknown }) => {
                url = u;
                params = cfg.params;
                return { status: 200, data: { status: 200, data: [] }, headers: {} };
            },
        } as unknown as AxiosInstance;
        await new TagResource(ax, 'acc').list({ search: 'contract' });
        expect(url).toBe('/accounts/acc/tags');
        expect(params).toEqual({ search: 'contract' });
    });

    test('create requires a name', async () => {
        await expect(tags.create({ name: '' })).rejects.toThrow(ValidationError);
    });

    test('create posts name + color to the account-scoped path', async () => {
        let url = '';
        let body: unknown;
        const ax = {
            ...mockAxios,
            post: async (u: string, b: unknown) => {
                url = u;
                body = b;
                return { status: 200, data: { status: 200, data: { id: 't1' } } };
            },
        } as unknown as AxiosInstance;
        await new TagResource(ax, 'acc').create({ name: 'Contracts', color: 'ff8800' });
        expect(url).toBe('/accounts/acc/tags');
        expect(body).toEqual({ name: 'Contracts', color: 'ff8800' });
    });

    test('create omits color when not provided', async () => {
        let body: unknown;
        const ax = {
            ...mockAxios,
            post: async (_u: string, b: unknown) => {
                body = b;
                return { status: 200, data: { status: 200, data: { id: 't1' } } };
            },
        } as unknown as AxiosInstance;
        await new TagResource(ax, 'acc').create({ name: 'Contracts' });
        expect(body).toEqual({ name: 'Contracts' });
    });

    test('create forwards color verbatim (leading # is stripped server-side, not by the SDK)', async () => {
        let body: unknown;
        const ax = {
            ...mockAxios,
            post: async (_u: string, b: unknown) => {
                body = b;
                return { status: 200, data: { status: 200, data: { id: 't1' } } };
            },
        } as unknown as AxiosInstance;
        await new TagResource(ax, 'acc').create({ name: 'Contracts', color: '#ff8800' });
        expect(body).toEqual({ name: 'Contracts', color: '#ff8800' });
    });

    test('update preserves color:null (clear) but omits absent fields', async () => {
        let body: unknown;
        const ax = {
            ...mockAxios,
            put: async (_u: string, b: unknown) => {
                body = b;
                return { status: 200, data: { status: 200, data: { id: 't1' } } };
            },
        } as unknown as AxiosInstance;
        await new TagResource(ax, 'acc').update('t1', { color: null });
        expect(body).toEqual({ color: null });
    });

    test('update puts name + color to the tag path', async () => {
        let url = '';
        let body: unknown;
        const ax = {
            ...mockAxios,
            put: async (u: string, b: unknown) => {
                url = u;
                body = b;
                return { status: 200, data: { status: 200, data: { id: 't1' } } };
            },
        } as unknown as AxiosInstance;
        await new TagResource(ax, 'acc').update('t1', { name: 'Signed', color: '112233' });
        expect(url).toBe('/accounts/acc/tags/t1');
        expect(body).toEqual({ name: 'Signed', color: '112233' });
    });

    test('update omits an absent color (name-only change)', async () => {
        let body: unknown;
        const ax = {
            ...mockAxios,
            put: async (_u: string, b: unknown) => {
                body = b;
                return { status: 200, data: { status: 200, data: { id: 't1' } } };
            },
        } as unknown as AxiosInstance;
        await new TagResource(ax, 'acc').update('t1', { name: 'Signed' });
        expect(body).toEqual({ name: 'Signed' });
    });

    test('update requires a tag id', async () => {
        await expect(tags.update('', { name: 'x' })).rejects.toThrow(ValidationError);
    });

    test('delete requires a tag id', async () => {
        await expect(tags.delete('')).rejects.toThrow(ValidationError);
    });

    test('delete sends force=true when requested', async () => {
        let url = '';
        let params: unknown;
        const ax = {
            ...mockAxios,
            delete: async (u: string, cfg: { params: unknown }) => {
                url = u;
                params = cfg?.params;
                return { status: 200 };
            },
        } as unknown as AxiosInstance;
        await new TagResource(ax, 'acc').delete('t1', { force: true });
        expect(url).toBe('/accounts/acc/tags/t1');
        expect(params).toEqual({ force: 'true' });
    });

    test('delete sends no params when force is not requested', async () => {
        let url = '';
        let params: unknown = 'unset';
        const ax = {
            ...mockAxios,
            delete: async (u: string, cfg: { params: unknown }) => {
                url = u;
                params = cfg?.params;
                return { status: 200 };
            },
        } as unknown as AxiosInstance;
        await new TagResource(ax, 'acc').delete('t1');
        expect(url).toBe('/accounts/acc/tags/t1');
        expect(params).toBeUndefined();
    });
});
