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
        await new TagResource(ax, 'acc').list({
            search: 'contract',
            internal_secret: 'do-not-send',
        } as never);
        expect(url).toBe('/accounts/acc/tags');
        expect(params).toEqual({ search: 'contract' });
    });

    test('create requires a name', async () => {
        await expect(tags.create({ name: '' })).rejects.toThrow(ValidationError);
    });

    test('rejects malformed payload and option objects before requesting', async () => {
        const requests = [
            () => tags.create(null as never),
            () => tags.create({ name: 42 } as never),
            () => tags.create({ name: 'Tag', color: 42 } as never),
            () => tags.update('t1', null as never),
            () => tags.update('t1', { name: 42 } as never),
            () => tags.list({ search: 42 } as never),
            () => tags.delete('t1', null as never),
        ];

        for (const request of requests) {
            await expect(request()).rejects.toBeInstanceOf(ValidationError);
        }
    });

    test('rejects malformed colours before create or update requests', async () => {
        let calls = 0;
        const ax = {
            ...mockAxios,
            post: async () => {
                calls++;
                return { data: { status: 200, data: { id: 't1' } } };
            },
            put: async () => {
                calls++;
                return { data: { status: 200, data: { id: 't1' } } };
            },
        } as unknown as AxiosInstance;
        const resource = new TagResource(ax, 'acc');

        for (const color of ['abcde', 'gg0011', '##112233']) {
            await expect(
                resource.create({ name: 'Contracts', color }),
            ).rejects.toBeInstanceOf(ValidationError);
            await expect(
                resource.update('t1', { color }),
            ).rejects.toBeInstanceOf(ValidationError);
        }

        expect(calls).toBe(0);
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
        await new TagResource(ax, 'acc').create({
            name: 'Contracts',
            color: 'ff8800',
            internal_secret: 'do-not-send',
        } as never);
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
        await new TagResource(ax, 'acc').update('t1', {
            name: 'Signed',
            color: '112233',
            internal_secret: 'do-not-send',
        } as never);
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
                return { status: 200, data: { status: 200, data: { deleted: true } } };
            },
        } as unknown as AxiosInstance;
        const result = await new TagResource(ax, 'acc').delete('t1', { force: true });
        expect(url).toBe('/accounts/acc/tags/t1');
        expect(params).toEqual({ force: 'true' });
        expect(result).toEqual({ deleted: true });
    });

    test('delete sends no params when force is not requested', async () => {
        let url = '';
        let params: unknown = 'unset';
        const ax = {
            ...mockAxios,
            delete: async (u: string, cfg: { params: unknown }) => {
                url = u;
                params = cfg?.params;
                return { status: 200, data: { status: 200, data: { deleted: true } } };
            },
        } as unknown as AxiosInstance;
        await new TagResource(ax, 'acc').delete('t1');
        expect(url).toBe('/accounts/acc/tags/t1');
        expect(params).toBeUndefined();
    });

    test('delete rejects non-boolean force values before requesting', async () => {
        let calls = 0;
        const ax = {
            ...mockAxios,
            delete: async () => {
                calls++;
                return { status: 200 };
            },
        } as unknown as AxiosInstance;
        await expect(
            new TagResource(ax, 'acc').delete('t1', { force: 'false' as never }),
        ).rejects.toBeInstanceOf(ValidationError);
        expect(calls).toBe(0);
    });
});
