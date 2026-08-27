/**
 * Rate-limit retry helpers.
 *
 * Assinafy deployments may return standard `Retry-After` or
 * `X-Rate-Limit-Reset` hints on a 429. The client honors a usable hint when
 * present and otherwise applies bounded exponential backoff.
 */

import { readHeader } from './headers';

/**
 * Delay (ms) the server asks us to wait, derived from `Retry-After` (seconds or
 * HTTP-date) or `X-Rate-Limit-Reset` (seconds). Returns `undefined` when the
 * response carries no usable hint.
 */
export function retryDelayFromHeaders(headers: Record<string, unknown> | undefined): number | undefined {
    const retryAfter = readHeader(headers, 'retry-after');
    if (retryAfter !== undefined) {
        const value = retryAfter.trim();
        if (/^\d+$/.test(value)) return Number(value) * 1000;
        if (value && !/^[+-]?\d+(?:\.\d+)?$/.test(value)) {
            const date = Date.parse(value);
            if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
        }
    }
    const reset = readHeader(headers, 'x-rate-limit-reset');
    if (reset !== undefined) {
        const value = reset.trim();
        if (/^\d+$/.test(value)) return Number(value) * 1000;
    }
    return undefined;
}

/** Exponential backoff (1s, 2s, 4s, …) used when the server gives no hint. */
export function backoffMs(attempt: number): number {
    return Math.min(1000 * 2 ** Math.max(0, attempt - 1), 8000);
}

/**
 * Effective wait before a retry: the server hint (capped at `maxDelayMs`) if
 * present, otherwise exponential backoff.
 */
export function nextRetryDelayMs(
    headers: Record<string, unknown> | undefined,
    attempt: number,
    maxDelayMs = 30_000,
): number {
    const hinted = retryDelayFromHeaders(headers);
    if (hinted !== undefined) return Math.min(hinted, maxDelayMs);
    return Math.min(backoffMs(attempt), maxDelayMs);
}
