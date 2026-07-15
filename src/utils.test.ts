import { describe, test, expect } from 'bun:test';
import { cleanListParams, cleanParams, handleAssinafyResponse, toSdkError } from './utils';
import { ApiError, AssinafyError, NetworkError, ValidationError } from './errors';
import type { AxiosError } from 'axios';

describe('handleAssinafyResponse', () => {
    test('returns data on 2xx envelope', () => {
        const result = handleAssinafyResponse({ status: 200, data: { id: '123' } });
        expect(result).toEqual({ id: '123' });
    });

    test('throws ApiError on non-2xx envelope', () => {
        expect(() =>
            handleAssinafyResponse({ status: 400, message: 'Bad', data: {} }),
        ).toThrow(ApiError);
    });

    test('passes through when no envelope is present', () => {
        const result = handleAssinafyResponse({ foo: 'bar' });
        expect(result).toEqual({ foo: 'bar' });
    });
});

describe('toSdkError', () => {
    test('passes AssinafyError through unchanged', () => {
        const original = new ValidationError('bad', { field: 'x' });
        expect(toSdkError(original, 'ignored')).toBe(original);
    });

    test('wraps plain errors in AssinafyError', () => {
        const result = toSdkError(new Error('boom'), 'failed');
        expect(result).toBeInstanceOf(AssinafyError);
        expect(result.message).toContain('failed');
        expect(result.message).toContain('boom');
    });

    test('returns NetworkError for axios errors without a response', () => {
        const fake = {
            isAxiosError: true,
            message: 'connect ECONNREFUSED',
            toJSON: () => ({}),
        } as unknown as AxiosError;
        const result = toSdkError(fake, 'upload');
        expect(result).toBeInstanceOf(NetworkError);
    });

    test('preserves the original value as `cause` when a non-Error is thrown', () => {
        // Regression: this path previously passed `{ cause }` into the *context*
        // parameter, so `error.cause` was silently dropped for non-Error throws.
        const result = toSdkError('boom-string', 'Failed to do thing');
        expect(result.cause).toBe('boom-string');
        expect(result.context).toEqual({});
        expect(result.message).toBe('Failed to do thing');
    });
});

describe('cleanParams', () => {
    test('drops undefined and null values', () => {
        expect(cleanParams({ a: 1, b: undefined, c: null, d: 'x' })).toEqual({ a: 1, d: 'x' });
    });
});

describe('cleanListParams', () => {
    // The API honours only `per-page`; `per_page` is silently ignored and the
    // response falls back to 20 items. Verified live: ?per-page=2 -> 2 items,
    // ?per_page=2 -> 20. Normalising keeps the documented snake_case spelling
    // working instead of failing callers quietly.
    test('rewrites per_page to the per-page spelling the API reads', () => {
        expect(cleanListParams({ per_page: 25 })).toEqual({ 'per-page': 25 });
    });

    test('leaves an explicit per-page untouched', () => {
        expect(cleanListParams({ 'per-page': 25 })).toEqual({ 'per-page': 25 });
    });

    test('lets an explicit per-page win over per_page', () => {
        expect(cleanListParams({ per_page: 99, 'per-page': 5 })).toEqual({ 'per-page': 5 });
    });

    test('never leaks the dead per_page key to the API', () => {
        const out = cleanListParams({ per_page: 10, page: 2, search: 'x' });
        expect(out['per_page']).toBeUndefined();
        expect(out).toEqual({ 'per-page': 10, page: 2, search: 'x' });
    });

    test('still strips undefined and null like cleanParams', () => {
        expect(cleanListParams({ per_page: undefined, page: 1, sort: null })).toEqual({ page: 1 });
    });

    test('passes through params that have no per_page at all', () => {
        expect(cleanListParams({ page: 3, sort: '-created_at' })).toEqual({ page: 3, sort: '-created_at' });
    });
});

describe('toSdkError binary error bodies', () => {
    // Artifact downloads use responseType:'arraybuffer', so axios hands back a
    // Buffer even for JSON error bodies. Undecoded, the real server message was
    // dropped and every failure surfaced as the generic "API request failed".
    function axiosErr(status: number, data: unknown) {
        return Object.assign(new Error('Request failed'), {
            isAxiosError: true,
            response: { status, data },
        });
    }

    test('decodes a JSON error body delivered as a Buffer', () => {
        const body = Buffer.from(JSON.stringify({ status: 404, message: 'Artefato não está disponível.' }));
        const err = toSdkError(axiosErr(404, body), 'Failed to download document');
        expect(err.message).toBe('Artefato não está disponível.');
    });

    test('decodes a JSON error body delivered as an ArrayBuffer', () => {
        const src = Buffer.from(JSON.stringify({ message: 'Documento não encontrado.' }));
        const ab = src.buffer.slice(src.byteOffset, src.byteOffset + src.byteLength);
        const err = toSdkError(axiosErr(404, ab), 'Failed');
        expect(err.message).toBe('Documento não encontrado.');
    });

    test('keeps a non-JSON binary body as the message rather than losing it', () => {
        const err = toSdkError(axiosErr(502, Buffer.from('<html>Bad Gateway</html>')), 'Failed');
        expect(err.message).toBe('<html>Bad Gateway</html>');
    });

    test('leaves an ordinary JSON error body untouched', () => {
        const err = toSdkError(axiosErr(400, { message: 'Plain JSON' }), 'Failed');
        expect(err.message).toBe('Plain JSON');
    });
});
