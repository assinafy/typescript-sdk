import { describe, test, expect } from 'bun:test';
import { cleanParams, handleAssinafyResponse, toSdkError } from './utils';
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
});

describe('cleanParams', () => {
    test('drops undefined and null values', () => {
        expect(cleanParams({ a: 1, b: undefined, c: null, d: 'x' })).toEqual({ a: 1, d: 'x' });
    });
});
