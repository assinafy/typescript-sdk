import { describe, expect, test } from 'bun:test';
import { readHeader } from './headers';

describe('readHeader', () => {
    test('reads primitive and first-array values case-insensitively', () => {
        expect(readHeader({ 'Retry-After': ['3', '4'] }, 'retry-after')).toBe('3');
        expect(readHeader({ 'x-count': 2 }, 'X-Count')).toBe('2');
    });

    test('ignores malformed object values instead of stringifying them', () => {
        expect(readHeader({ 'retry-after': { seconds: 3 } }, 'retry-after')).toBeUndefined();
    });
});
