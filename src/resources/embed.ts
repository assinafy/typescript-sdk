import type { IEmbedOrigin, IEmbedSession } from '../types';
import { assertNonEmptyString } from '../utils';
import { BaseResource } from './base';

/**
 * Server-side half of embedded signing: register the origins allowed to frame
 * the signing page and mint single-use sessions for `embedded` signers. The
 * browser half (iframe, `postMessage` handshake) is outside this SDK.
 *
 * Needs the Embed plan feature (`403 PlanRestricted` otherwise) and an API key
 * or user token: OAuth application tokens cannot reach these routes. Keep
 * these calls on your backend.
 */
export class EmbedResource extends BaseResource {
    /**
     * List the origins allowed to embed signing pages, oldest first
     * (`GET /accounts/{accountId}/embed-origins`).
     *
     * @param accountId - Override the client's default account ID.
     * @returns Registered origins:
     * ```jsonc
     * [{ "id": "1052c7d8e9f0a1b2c3d4e5f6a7b8", "origin": "https://app.example.com", "created_at": "2026-11-04T12:05:00Z" }]
     * ```
     * @throws {ValidationError} If no account ID is available.
     * @throws {ApiError} `403` (`PlanRestricted`, or an OAuth application token).
     *
     * @example
     * ```ts
     * const origins = await client.embed.listOrigins();
     * ```
     */
    async listOrigins(accountId?: string): Promise<IEmbedOrigin[]> {
        return this.call('Failed to list embed origins', () => this.http.get(this.originsPath(accountId)));
    }

    /**
     * Allow one more origin to embed signing pages
     * (`POST /accounts/{accountId}/embed-origins`).
     *
     * An origin is an exact `https://host[:port]` (`http` only for `localhost`
     * and `127.0.0.1`) without path, query, fragment, credentials or wildcard;
     * the API lowercases the host and drops a default port. Up to 10 per account.
     *
     * @param origin - Origin of the page that will host the iframe.
     * @param accountId - Override the client's default account ID.
     * @returns The stored origin, e.g.
     * `{ "id": "1052c7d8e9f0a1b2c3d4e5f6a7b8", "origin": "https://app.example.com", "created_at": "2026-11-04T12:05:00Z" }`.
     * @throws {ValidationError} If `origin` is blank.
     * @throws {ApiError} `400` when it is invalid, already registered, or the
     * account has 10; `403` (`PlanRestricted`, or an OAuth application token).
     *
     * @example
     * ```ts
     * await client.embed.addOrigin('https://app.example.com');
     * ```
     */
    async addOrigin(origin: string, accountId?: string): Promise<IEmbedOrigin> {
        assertNonEmptyString(origin, 'origin');
        return this.call('Failed to add embed origin', () =>
            this.http.post(this.originsPath(accountId), { origin }),
        );
    }

    /**
     * Replace an allowed origin, keeping its ID
     * (`PUT /accounts/{accountId}/embed-origins/{originId}`).
     *
     * @param originId - Embed origin ID.
     * @param origin - New origin, with the rules of {@link EmbedResource.addOrigin}.
     * @param accountId - Override the client's default account ID.
     * @returns The updated origin.
     * @throws {ValidationError} If an ID or the origin is blank.
     * @throws {ApiError} `400` for an invalid or duplicate origin, `403`, `404` for
     * an unknown origin ID.
     *
     * @example
     * ```ts
     * await client.embed.updateOrigin(originId, 'https://sign.example.com');
     * ```
     */
    async updateOrigin(originId: string, origin: string, accountId?: string): Promise<IEmbedOrigin> {
        assertNonEmptyString(origin, 'origin');
        return this.call('Failed to update embed origin', () =>
            this.http.put(this.originPath(originId, accountId), { origin }),
        );
    }

    /**
     * Stop allowing an origin (`DELETE /accounts/{accountId}/embed-origins/{originId}`).
     *
     * Removing the last origin disables embedding: new sessions answer `409`
     * (`embed_origins_missing`).
     *
     * @param originId - Embed origin ID.
     * @param accountId - Override the client's default account ID.
     * @throws {ValidationError} If an ID is missing or invalid.
     * @throws {ApiError} `403`, or `404` for an unknown origin ID.
     *
     * @example
     * ```ts
     * await client.embed.deleteOrigin(originId);
     * ```
     */
    async deleteOrigin(originId: string, accountId?: string): Promise<void> {
        return this.callVoid('Failed to remove embed origin', () =>
            this.http.delete(this.originPath(originId, accountId)),
        );
    }

    /**
     * Mint a single-use embed URL for an `embedded` signer
     * (`POST /documents/{documentId}/assignments/{assignmentId}/signers/{signerId}/embed-sessions`).
     *
     * Load the URL in an iframe on a registered origin within 5 minutes;
     * opening it spends the token, so mint a new one each time the frame is
     * shown, including reloads. Treat it as a credential: hand it only to that
     * signer's page and never store or log it. Limited to 30 sessions per signer
     * per hour. For an envelope signer, mint on any of their documents still
     * waiting for them; the frame lists every document they still have to sign.
     * Frame events are UI hints: confirm the outcome from webhooks.
     *
     * @param documentId - Document ID.
     * @param assignmentId - Assignment ID.
     * @param signerId - Signer created with `embedded: true`.
     * @returns The session:
     * ```jsonc
     * {
     *   "url": "https://app.assinafy.com.br/embed/3b1f0c7e9a2d4c58b6e1f4a07d93c2e85a1b0f6d4c7e2a9183b5d6f0e4c8a712",
     *   "expires_at": "2026-11-04T12:05:00Z"
     * }
     * ```
     * @throws {ValidationError} If an ID is missing or invalid.
     * @throws {ApiError} `400` (`embed_not_enabled_for_signer`), `403`
     * (`PlanRestricted`), `404` for an unknown document, assignment or signer,
     * `409` (`already_signed`, `document_not_ready` — retry shortly,
     * `document_unavailable`, `embed_origins_missing`), `429` past 30 per hour.
     *
     * @example
     * ```ts
     * const { url } = await client.embed.createSession(document.id, assignment.id, signer.id);
     * response.json({ url }); // to the signer's browser only
     * ```
     */
    async createSession(
        documentId: string,
        assignmentId: string,
        signerId: string,
    ): Promise<IEmbedSession> {
        return this.call('Failed to create embed session', () =>
            this.http.post(
                `/documents/${this.pathSegment(documentId, 'Document ID')}/assignments/${this.pathSegment(assignmentId, 'Assignment ID')}/signers/${this.pathSegment(signerId, 'Signer ID')}/embed-sessions`,
            ),
        );
    }

    private originsPath(accountId?: string): string {
        return `/accounts/${this.pathSegment(this.accountId(accountId), 'Account ID')}/embed-origins`;
    }

    private originPath(originId: string, accountId?: string): string {
        return `${this.originsPath(accountId)}/${this.pathSegment(originId, 'Embed origin ID')}`;
    }
}
