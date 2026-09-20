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
            const first = Array.isArray(value) ? value[0] : value;
            if (
                typeof first === 'string'
                || typeof first === 'number'
                || typeof first === 'boolean'
            ) {
                return String(first);
            }
            return undefined;
        }
    }
    return undefined;
}

/**
 * One parsed `WWW-Authenticate` challenge.
 *
 * Assinafy answers an OAuth request that is missing a scope with
 * `403` and `WWW-Authenticate: Bearer error="insufficient_scope",
 * scope="documents:write", resource_metadata="…"`. `scope` names the permission
 * to request on the next authorization round-trip, so the challenge is the only
 * machine-readable way to tell "reconnect asking for more" apart from "this
 * token can never reach that surface".
 */
export interface IAuthenticateChallenge {
    /** Authentication scheme, e.g. `Bearer`. */
    scheme: string;
    /** RFC 6750 error code, e.g. `insufficient_scope` or `invalid_token`. */
    error?: string;
    /** Human-readable explanation, when the server sends one. */
    error_description?: string;
    /** Space-separated scopes required by the rejected operation. */
    scope?: string;
    /** RFC 9728 URL of the protected-resource metadata document. */
    resource_metadata?: string;
}

const CHALLENGE_PARAM = /([A-Za-z0-9_-]+)\s*=\s*(?:"([^"]*)"|([^\s,]+))/gu;

/**
 * Parse a `WWW-Authenticate` header into its scheme and auth-param map.
 *
 * Only the first challenge is read: Assinafy sends exactly one, and a parser
 * that split on commas would corrupt quoted values containing them.
 *
 * @param value - Raw header value, or `undefined` when absent.
 * @returns The parsed challenge, or `undefined` when there is no header or it
 * carries no scheme.
 */
export function parseWwwAuthenticate(
    value: string | undefined,
): IAuthenticateChallenge | undefined {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    const scheme = /^[A-Za-z0-9_-]+/u.exec(trimmed)?.[0];
    if (!scheme) return undefined;

    const challenge: IAuthenticateChallenge = { scheme };
    CHALLENGE_PARAM.lastIndex = 0;
    for (const match of trimmed.slice(scheme.length).matchAll(CHALLENGE_PARAM)) {
        const key = match[1]?.toLowerCase();
        const paramValue = match[2] ?? match[3];
        if (paramValue === undefined) continue;
        if (key === 'error') challenge.error = paramValue;
        else if (key === 'error_description') challenge.error_description = paramValue;
        else if (key === 'scope') challenge.scope = paramValue;
        else if (key === 'resource_metadata') challenge.resource_metadata = paramValue;
    }
    return challenge;
}
