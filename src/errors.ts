import type { IAuthenticateChallenge } from './support/headers';

/** Used when a failure response carries nothing that explains it. */
const FALLBACK_MESSAGE = 'API request failed';

/** Upper bound on an `Error.message` lifted out of an unstructured body. */
const MAX_MESSAGE_LENGTH = 500;

/**
 * Keep an unstructured error body readable in logs.
 *
 * An HTML error page is a legitimate response body but a terrible
 * `Error.message`, so collapse its whitespace and cap the length. The untouched
 * body always remains on {@link ApiError.responseData}.
 */
function summarize(text: string): string {
    const collapsed = text.replaceAll(/\s+/gu, ' ');
    return collapsed.length > MAX_MESSAGE_LENGTH
        ? `${collapsed.slice(0, MAX_MESSAGE_LENGTH)}…`
        : collapsed;
}

/** Base class for all Assinafy SDK errors. */
export class AssinafyError extends Error {
    public readonly context: Record<string, unknown>;

    /**
     * Create a base SDK error with structured diagnostic context.
     *
     * @param message - Human-readable error summary.
     * @param context - Structured details safe for the caller to inspect.
     * @param options - Standard JavaScript error options, including `cause`.
     *
     * @example
     * ```ts
     * throw new AssinafyError('Operation failed', { operation: 'upload' });
     * ```
     */
    constructor(message: string, context: Record<string, unknown> = {}, options?: ErrorOptions) {
        super(message, options);
        this.name = 'AssinafyError';
        this.context = context;
    }
}

/** Thrown when the API returns a non-success HTTP status. */
export class ApiError extends AssinafyError {
    public readonly statusCode: number;
    public readonly responseData: unknown;
    /**
     * Parsed `WWW-Authenticate` challenge, when the response carried one.
     *
     * A `403` whose challenge is `{ error: 'insufficient_scope', scope: '…' }`
     * means the OAuth token is valid but was never granted that permission:
     * send the user through the authorization flow again asking for the scope
     * named in `scope`. A `403` without a challenge has a different cause —
     * another workspace, the user's role, or a surface OAuth tokens never
     * reach — and reconnecting will not fix it.
     *
     * @example
     * ```ts
     * try {
     *   await connected.documents.upload({ filePath: './contract.pdf' });
     * } catch (error) {
     *   if (error instanceof ApiError && error.challenge?.error === 'insufficient_scope') {
     *     return reconnect(error.challenge.scope);   // 'documents:write'
     *   }
     *   throw error;
     * }
     * ```
     */
    public challenge?: IAuthenticateChallenge;

    /**
     * Create an error representing a non-success API response.
     *
     * @param message - API-provided or fallback error summary.
     * @param statusCode - HTTP response status.
     * @param responseData - Parsed response body, when available.
     * @param options - Standard JavaScript error options, including `cause`.
     */
    constructor(message: string, statusCode: number, responseData: unknown = null, options?: ErrorOptions) {
        super(message, { statusCode, responseData }, options);
        this.name = 'ApiError';
        this.statusCode = statusCode;
        this.responseData = responseData;
    }

    /**
     * Convert a status/body pair into an {@link ApiError}.
     *
     * @param statusCode - Non-success HTTP response status.
     * @param responseData - API body. For a JSON object, string `message` takes
     * priority, followed by string `error`. A non-JSON body (a proxy's
     * `text/plain` or HTML error page) is used verbatim rather than discarded —
     * otherwise the only failures reported as the generic fallback would be the
     * ones with no structured body to explain them. Anything else falls back to
     * the stable message.
     * @returns An `ApiError` retaining the original response body in
     * {@link ApiError.responseData}; `message` is truncated for legibility.
     *
     * @example
     * ```ts
     * const error = ApiError.fromResponse(422, { message: 'Invalid signer' });
     * console.log(error.statusCode, error.message);
     * ```
     */
    static fromResponse(statusCode: number, responseData: unknown): ApiError {
        if (typeof responseData === 'string') {
            const text = responseData.trim();
            return new ApiError(text ? summarize(text) : FALLBACK_MESSAGE, statusCode, responseData);
        }
        const data = (responseData ?? {}) as Record<string, unknown>;
        const rawMessage = data['message'];
        const rawError = data['error'];
        const message =
            typeof rawMessage === 'string' && rawMessage.length > 0
                ? rawMessage
                : typeof rawError === 'string'
                    ? rawError
                    : FALLBACK_MESSAGE;
        return new ApiError(message, statusCode, responseData);
    }
}

/**
 * Thrown when an OAuth endpoint returns an RFC 6749 error object, or when an
 * authorization response comes back on the redirect URI carrying `?error=`.
 *
 * The OAuth endpoints answer with a flat `{ error, error_description }` body
 * instead of this API's `{ status, message, data }` envelope, because no
 * standard OAuth client would look for `error` inside a `data` key. This class
 * still extends {@link ApiError}, so existing `catch (err) { if (err instanceof
 * ApiError) … }` blocks keep matching.
 *
 * Branch on {@link OAuthError.error}, not on the message:
 *
 * | `error` | What to do |
 * | --- | --- |
 * | `invalid_grant` | The code or refresh token is spent, expired, or bound to other parameters. Send the user through the authorization flow again. |
 * | `invalid_client` | Wrong `client_id`/`client_secret`, or the application was disabled. Fix the configuration; retrying will not help. |
 * | `invalid_target` | The `resource` does not match the one that was authorized. |
 * | `unsupported_grant_type` | Only `authorization_code` and `refresh_token` exist. |
 * | `access_denied` | The user declined on the consent screen. |
 * | `invalid_scope` | A scope the application is not registered for. |
 * | `invalid_request` | Missing or malformed PKCE / request parameters. |
 */
export class OAuthError extends ApiError {
    /** RFC 6749 error code, e.g. `invalid_grant`. */
    public readonly error: string;
    /** The server's human-readable explanation, when it sent one. */
    public readonly errorDescription: string | null;

    /**
     * Create an OAuth protocol error.
     *
     * @param error - RFC 6749 error code.
     * @param errorDescription - Server-provided explanation, or `null`.
     * @param statusCode - HTTP status that carried it. Authorization responses
     * arrive as redirect query parameters rather than an HTTP response, so
     * {@link OAuthResource.readAuthorizationCallback} reports them as `400`.
     * @param responseData - The raw error object.
     *
     * @example
     * ```ts
     * throw new OAuthError('invalid_grant', 'Authorization code expired.', 400);
     * ```
     */
    constructor(
        error: string,
        errorDescription: string | null = null,
        statusCode = 400,
        responseData: unknown = null,
    ) {
        super(errorDescription ? `${error}: ${errorDescription}` : error, statusCode, responseData);
        this.name = 'OAuthError';
        this.error = error;
        this.errorDescription = errorDescription;
    }

    /**
     * Upgrade an {@link ApiError} to an {@link OAuthError} when its body is an
     * RFC 6749 error object; otherwise return the value untouched.
     *
     * @param error - Any thrown value.
     * @returns An `OAuthError` when the body carries a non-empty string
     * `error`, else the original value.
     */
    static upgrade(error: unknown): unknown {
        if (!(error instanceof ApiError) || error instanceof OAuthError) return error;
        const body = error.responseData;
        if (body === null || typeof body !== 'object') return error;
        const code = (body as Record<string, unknown>)['error'];
        if (typeof code !== 'string' || code.length === 0) return error;
        const description = (body as Record<string, unknown>)['error_description'];
        return new OAuthError(
            code,
            typeof description === 'string' && description.length > 0 ? description : null,
            error.statusCode,
            body,
        );
    }
}

/** Thrown when SDK validation fails, including invalid input or workflow state. */
export class ValidationError extends AssinafyError {
    public readonly errors: Record<string, unknown>;

    /**
     * Create an SDK validation failure.
     *
     * @param message - Human-readable validation summary.
     * @param errors - Field/value diagnostics for programmatic handling.
     *
     * @example
     * ```ts
     * throw new ValidationError('Signer ID is required', { signerId: '' });
     * ```
     */
    constructor(message = 'Validation failed', errors: Record<string, unknown> = {}) {
        super(message, { errors });
        this.name = 'ValidationError';
        this.errors = errors;
    }
}

/** Thrown when the HTTP transport itself fails (DNS, timeout, etc.). */
export class NetworkError extends AssinafyError {
    /**
     * Create a transport-layer failure such as DNS, connection, or timeout.
     *
     * @param message - Sanitized transport error summary.
     * @param options - Standard JavaScript error options carrying a safe cause.
     *
     * @example
     * ```ts
     * throw new NetworkError('Request timed out', { cause });
     * ```
     */
    constructor(message: string, options?: ErrorOptions) {
        super(message, {}, options);
        this.name = 'NetworkError';
    }
}
