import { describe, expect, test } from 'bun:test';
import { parseWwwAuthenticate, readHeader } from './headers';

describe('readHeader', () => {
    test('reads case-insensitively and collapses array values', () => {
        expect(readHeader(undefined, 'x')).toBeUndefined();
        expect(readHeader({ 'X-Total': 7 }, 'x-total')).toBe('7');
        expect(readHeader({ 'x-total': ['7', '8'] }, 'X-Total')).toBe('7');
        expect(readHeader({ 'x-total': null }, 'x-total')).toBeUndefined();
        expect(readHeader({ 'x-total': { nested: true } }, 'x-total')).toBeUndefined();
        expect(readHeader({ other: '1' }, 'x-total')).toBeUndefined();
    });
});

describe('parseWwwAuthenticate', () => {
    test('parses the insufficient_scope challenge Assinafy sends on a 403', () => {
        expect(
            parseWwwAuthenticate(
                'Bearer error="insufficient_scope", scope="documents:write templates:read", '
                + 'resource_metadata="https://api.assinafy.com.br/.well-known/oauth-protected-resource"',
            ),
        ).toEqual({
            scheme: 'Bearer',
            error: 'insufficient_scope',
            scope: 'documents:write templates:read',
            resource_metadata: 'https://api.assinafy.com.br/.well-known/oauth-protected-resource',
        });
    });

    test('parses the bare resource_metadata challenge sent on a 401', () => {
        expect(
            parseWwwAuthenticate(
                'Bearer resource_metadata="https://api.assinafy.com.br/.well-known/oauth-protected-resource"',
            ),
        ).toEqual({
            scheme: 'Bearer',
            resource_metadata: 'https://api.assinafy.com.br/.well-known/oauth-protected-resource',
        });
    });

    test('accepts unquoted values, mixed-case keys and an error_description', () => {
        expect(
            parseWwwAuthenticate('Bearer Error=invalid_token, Error_Description="Token expired"'),
        ).toEqual({
            scheme: 'Bearer',
            error: 'invalid_token',
            error_description: 'Token expired',
        });
    });

    test('ignores unknown auth-params and keeps the scheme alone', () => {
        expect(parseWwwAuthenticate('Bearer realm="api", charset="UTF-8"')).toEqual({
            scheme: 'Bearer',
        });
        expect(parseWwwAuthenticate('Basic')).toEqual({ scheme: 'Basic' });
    });

    test('returns undefined when there is no usable header', () => {
        expect(parseWwwAuthenticate(undefined)).toBeUndefined();
        expect(parseWwwAuthenticate('')).toBeUndefined();
        expect(parseWwwAuthenticate('   ')).toBeUndefined();
        expect(parseWwwAuthenticate('="broken"')).toBeUndefined();
    });
});
