/**
 * Rate-limit retry helpers.
 *
 * Every Assinafy response carries `X-Rate-Limit-*` headers and a `Retry-After`
 * header on 429s (the documented limit is 120 req/min). The client retries
 * 429 responses a bounded number of times, honoring `Retry-After` when present.
 */

/** Read a header case-insensitively from an axios headers bag. */
function header(headers: Record<string, unknown> | undefined, name: string): string | undefined {
    if (!headers) return undefined;
    const lower = name.toLowerCase();
    for (const [key, value] of Object.entries(headers)) {
        if (key.toLowerCase() === lower && value != null) {
            return Array.isArray(value) ? String(value[0]) : String(value);
        }
    }
    return undefined;
}

/**
 * Delay (ms) the server asks us to wait, derived from `Retry-After` (seconds or
 * HTTP-date) or `X-Rate-Limit-Reset` (seconds). Returns `undefined` when the
 * response carries no usable hint.
 */
export function retryDelayFromHeaders(headers: Record<string, unknown> | undefined): number | undefined {
    const retryAfter = header(headers, 'retry-after');
    if (retryAfter !== undefined) {
        const seconds = Number(retryAfter);
        if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
        const date = Date.parse(retryAfter);
        if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
    }
    const reset = header(headers, 'x-rate-limit-reset');
    if (reset !== undefined) {
        const seconds = Number(reset);
        if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
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
