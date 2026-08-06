import { describe, test, expect } from 'bun:test';
import type { AxiosInstance } from 'axios';
import { BaseResource } from './base';
import { ApiError, AssinafyError } from '../errors';

/** Concrete subclass exposing the protected helpers for direct testing. */
class TestResource extends BaseResource {
    segment$(value: string, name = 'ID') {
        return this.pathSegment(value, name);
    }
    call$<T>(fn: () => Promise<{ status: number; data: unknown; headers?: unknown }>) {
        return this.call<T>('call failed', fn as never);
    }
    optional$<T>(fn: () => Promise<unknown>) {
        return this.callOptional<T>('optional failed', fn as never);
    }
    void$(fn: () => Promise<{ status: number; data?: unknown }>) {
        return this.callVoid('void failed', fn as never);
    }
    binary$(fn: () => Promise<{ status: number; data: ArrayBuffer }>) {
        return this.callBinary('binary failed', fn as never);
    }
    list$<T>(fn: () => Promise<{ status: number; data: unknown; headers?: unknown }>) {
        return this.callList<T>('list failed', fn as never);
    }
}

function res() {
    return new TestResource({} as unknown as AxiosInstance, 'acc');
}

describe('BaseResource helpers', () => {
    test('call unwraps the { status, data } envelope', async () => {
        const r = await res().call$(async () => ({ status: 200, data: { status: 200, data: { id: 'x' } } }));
        expect(r).toEqual({ id: 'x' } as never);
    });

    test('pathSegment keeps caller values inside exactly one RFC 3986 segment', () => {
        expect(res().segment$('account/child?#!*()')).toBe(
            'account%2Fchild%3F%23%21%2A%28%29',
        );
        expect(() => res().segment$('   ')).toThrow('ID is required');
        expect(() => res().segment$('\ud800')).toThrow('ID contains invalid URL characters');
    });

    test('callOptional returns null on a 404 ApiError but rethrows others', async () => {
        const nullResult = await res().optional$(async () => {
            throw ApiError.fromResponse(404, { message: 'gone' });
        });
        expect(nullResult).toBeNull();
        await expect(
            res().optional$(async () => {
                throw ApiError.fromResponse(500, { message: 'boom' });
            }),
        ).rejects.toBeInstanceOf(ApiError);
    });

    test('callVoid throws when the status is outside 2xx', async () => {
        await expect(res().void$(async () => ({ status: 204 }))).resolves.toBeUndefined();
        await expect(res().void$(async () => ({ status: 500 }))).rejects.toThrow();
        await expect(
            res().void$(async () => ({
                status: 200,
                data: { status: 400, message: 'Rejected' },
            })),
        ).rejects.toBeInstanceOf(ApiError);
    });

    test('callBinary returns a Buffer over the response bytes', async () => {
        const bytes = new Uint8Array([1, 2, 3]).buffer;
        const buf = await res().binary$(async () => ({ status: 200, data: bytes }));
        expect(Buffer.isBuffer(buf)).toBe(true);
        expect([...buf]).toEqual([1, 2, 3]);
    });

    test('callList unwraps a bare array, a {data:[]} envelope, and parses meta', async () => {
        const bare = await res().list$(async () => ({ status: 200, data: { status: 200, data: ['a', 'b'] }, headers: {} }));
        expect(bare.data).toEqual(['a', 'b'] as never);

        const withMeta = await res().list$(async () => ({
            status: 200,
            data: { status: 200, data: [] },
            headers: { 'x-pagination-current-page': '3', 'x-pagination-total-count': '50' },
        }));
        expect(withMeta.meta).toEqual({ current_page: 3, total: 50 });
    });

    test('pagination accepts only complete, non-negative safe integers', async () => {
        const result = await res().list$(async () => ({
            status: 200,
            data: { status: 200, data: [] },
            headers: {
                'x-pagination-current-page': '2junk',
                'x-pagination-per-page': ' 20 ',
                'x-pagination-total-count': '-1',
                'x-pagination-page-count': '9007199254740992',
            },
        }));
        expect(result.meta).toEqual({ per_page: 20 });
    });

    test('callList rejects a malformed success payload instead of masking it as an empty list', async () => {
        await expect(
            res().list$(async () => ({
                status: 200,
                data: { status: 200, data: { not: 'a list' } },
                headers: {},
            })),
        ).rejects.toBeInstanceOf(AssinafyError);
    });

    test('non-Axios failures are wrapped as AssinafyError', async () => {
        await expect(
            res().call$(async () => {
                throw new TypeError('socket hang up');
            }),
        ).rejects.toBeInstanceOf(AssinafyError);
    });
});
