/**
 * Encode an untrusted value for use as exactly one URL path segment.
 *
 * `encodeURIComponent` prevents values containing `/`, `?`, or `#` from
 * changing the route selected by the caller. The extra replacements follow
 * RFC 3986's stricter definition of an encoded path component.
 */
export function encodePathSegment(value: string): string {
    return encodeURIComponent(value).replace(/[!'()*]/g, (character) =>
        `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
    );
}
