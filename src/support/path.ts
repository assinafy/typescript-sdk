/**
 * Encode an untrusted value for use as exactly one URL path segment.
 *
 * `encodeURIComponent` prevents values containing `/`, `?`, or `#` from
 * changing the route selected by the caller. The extra replacements follow
 * RFC 3986's stricter definition of an encoded path component.
 */
export function encodePathSegment(value: string): string {
    // URL parsers normalize dot segments even when the dots are percent-encoded.
    if (value === '.' || value === '..') throw new Error('Dot segments are not resource IDs');
    return encodeURIComponent(value).replace(/[!'()*]/g, (character) =>
        `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
    );
}
