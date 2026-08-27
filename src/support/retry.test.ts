import { describe, test, expect } from 'bun:test';
import { retryDelayFromHeaders, backoffMs, nextRetryDelayMs } from './retry';

describe('retry helpers', () => {
    test('retryDelayFromHeaders reads Retry-After seconds (case-insensitive)', () => {
        expect(retryDelayFromHeaders({ 'Retry-After': '5' })).toBe(5000);
        expect(retryDelayFromHeaders({ 'retry-after': '0' })).toBe(0);
    });

    test('retryDelayFromHeaders falls back to X-Rate-Limit-Reset', () => {
        expect(retryDelayFromHeaders({ 'x-rate-limit-reset': '60' })).toBe(60_000);
    });

    test('retryDelayFromHeaders returns undefined with no usable hint', () => {
        expect(retryDelayFromHeaders(undefined)).toBeUndefined();
        expect(retryDelayFromHeaders({ 'x-other': 'value' })).toBeUndefined();
        expect(retryDelayFromHeaders({ 'retry-after': '' })).toBeUndefined();
        expect(retryDelayFromHeaders({ 'retry-after': '-1' })).toBeUndefined();
        expect(retryDelayFromHeaders({ 'retry-after': '1.5' })).toBeUndefined();
        expect(retryDelayFromHeaders({ 'x-rate-limit-reset': ' ' })).toBeUndefined();
        expect(retryDelayFromHeaders({ 'x-rate-limit-reset': '-1' })).toBeUndefined();
    });

    test('retryDelayFromHeaders accepts a future HTTP-date', () => {
        const future = new Date(Date.now() + 5_000).toUTCString();
        const delay = retryDelayFromHeaders({ 'retry-after': future });
        expect(delay).toBeGreaterThanOrEqual(3_500);
        expect(delay).toBeLessThanOrEqual(5_000);
    });

    test('backoffMs grows exponentially and caps at 8s', () => {
        expect(backoffMs(1)).toBe(1000);
        expect(backoffMs(2)).toBe(2000);
        expect(backoffMs(3)).toBe(4000);
        expect(backoffMs(10)).toBe(8000);
    });

    test('nextRetryDelayMs prefers the server hint, capped by maxDelayMs', () => {
        expect(nextRetryDelayMs({ 'retry-after': '3' }, 1)).toBe(3000);
        expect(nextRetryDelayMs({ 'retry-after': '999' }, 1, 30_000)).toBe(30_000);
        // no hint → backoff
        expect(nextRetryDelayMs({}, 2)).toBe(2000);
    });
});
