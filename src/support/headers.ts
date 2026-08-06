/**
 * Read a single header value case-insensitively from an axios (or plain-object)
 * headers bag.
 *
 * Axios lowercases response header keys, but the callers here also accept an
 * arbitrary `Record<string, unknown>`, so the lookup iterates rather than
 * assuming a canonical case. Array-valued headers collapse to their first entry.
 */
export function readHeader(
    headers: Record<string, unknown> | undefined,
    name: string,
): string | undefined {
    if (!headers) return undefined;
    const lower = name.toLowerCase();
    for (const [key, value] of Object.entries(headers)) {
        if (key.toLowerCase() === lower && value != null) {
            return Array.isArray(value) ? String(value[0]) : String(value);
        }
    }
    return undefined;
}
