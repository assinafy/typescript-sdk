import axios, { type AxiosInstance, type InternalAxiosRequestConfig } from 'axios';
import type {
    AssinafyClientOptions,
    ICreateAssignmentPayload,
    ICreateSignerPayload,
    IUploadAndRequestSignaturesResult,
    IUploadAndRequestSignaturesSigner,
    Logger,
} from './types';
import { ValidationError } from './errors';
import { createSafeLogger } from './utils';
import { nextRetryDelayMs } from './support/retry';
import { DocumentResource, type DocumentUploadSource } from './resources/documents';
import { SignerResource, validateCreateSignerPayload } from './resources/signers';
import { WorkspaceResource } from './resources/workspaces';
import { AssignmentResource } from './resources/assignments';
import { WebhookResource } from './resources/webhooks';
import { TemplateResource } from './resources/templates';
import { TagResource } from './resources/tags';
import { AuthenticationResource } from './resources/authentication';
import { FieldsResource } from './resources/fields';
import { SignerDocumentsResource } from './resources/signer-documents';
import { UserResource } from './resources/users';
import { WebhookVerifier } from './support/webhook-verifier';

/** Flexible input accepted by {@link AssinafyClient.fromConfig} (snake_case or camelCase). */
export interface ClientConfigInput {
    api_key?: string;
    apiKey?: string;
    token?: string;
    access_token?: string;
    accessToken?: string;
    account_id?: string;
    accountId?: string;
    base_url?: string;
    baseUrl?: string;
    webhook_secret?: string;
    webhookSecret?: string;
    timeout?: number;
    maxRetries?: number;
    max_retries?: number;
    logger?: Logger;
}

const DEFAULT_BASE_URL = 'https://api.assinafy.com.br/v1';

/**
 * Primary entry point for the Assinafy API.
 *
 * @example
 * ```ts
 * const client = new AssinafyClient({
 *   apiKey: process.env.ASSINAFY_API_KEY!,
 *   accountId: process.env.ASSINAFY_ACCOUNT_ID!,
 *   webhookSecret: process.env.ASSINAFY_WEBHOOK_SECRET,
 * });
 *
 * const document = await client.documents.upload({ filePath: './contract.pdf' });
 * ```
 */
export class AssinafyClient {
    private readonly axiosInstance: AxiosInstance;
    private readonly publicAxiosInstance: AxiosInstance;
    private readonly defaultAccountId: string | undefined;
    private readonly logger: Logger;
    private readonly webhookSecret: string | undefined;

    public readonly documents: DocumentResource;
    public readonly signers: SignerResource;
    public readonly workspaces: WorkspaceResource;
    public readonly assignments: AssignmentResource;
    public readonly webhooks: WebhookResource;
    public readonly templates: TemplateResource;
    public readonly tags: TagResource;
    public readonly auth: AuthenticationResource;
    public readonly fields: FieldsResource;
    public readonly signerDocuments: SignerDocumentsResource;
    public readonly users: UserResource;
    public readonly webhookVerifier: WebhookVerifier;

    /**
     * Create a client. Supply `apiKey` (preferred, sent as `X-Api-Key`) or a
     * Bearer `token` for protected operations. Credentials are optional so the
     * same client can drive public login, verification, OAuth-URL and
     * signer-access-code flows; a protected request without credentials receives
     * the API's normal `401` {@link ApiError}.
     *
     * @param options - Credentials and configuration. `apiKey` or `token`
     * authenticates protected operations; `accountId` sets the default
     * workspace used by every account-scoped resource; `baseUrl` (default the
     * production API), `timeout`
     * (default 30 s), `maxRetries` (default 2, for HTTP 429 on idempotent
     * requests), `webhookSecret` (enables
     * {@link AssinafyClient.webhookVerifier}) and `logger` are optional.
     * Non-idempotent requests are retried only when they explicitly carry an
     * `Idempotency-Key` header.
     *
     * @example
     * ```ts
     * const client = new AssinafyClient({
     *   apiKey: process.env.ASSINAFY_API_KEY!,
     *   accountId: process.env.ASSINAFY_ACCOUNT_ID!,
     * });
     * ```
     */
    constructor(options: AssinafyClientOptions = {}) {
        const timeout = options.timeout ?? 30_000;
        if (!Number.isFinite(timeout) || timeout < 0) {
            throw new ValidationError('timeout must be a finite, non-negative number');
        }
        const maxRetries = options.maxRetries ?? 2;
        if (!Number.isSafeInteger(maxRetries) || maxRetries < 0) {
            throw new ValidationError('maxRetries must be a non-negative safe integer');
        }

        this.defaultAccountId = options.accountId;
        // Resource logging is routed through this failure-isolated, redacting
        // facade. A logger callback must never change request semantics or see
        // payload-derived PII/credentials.
        this.logger = createSafeLogger(options.logger);
        this.webhookSecret = options.webhookSecret;

        const baseURL = normaliseBaseUrl(options.baseUrl ?? DEFAULT_BASE_URL);
        const headers: Record<string, string> = {
            'User-Agent': 'assinafy-typescript-sdk',
        };
        if (options.apiKey) {
            headers['X-Api-Key'] = options.apiKey;
        } else if (options.token) {
            headers['Authorization'] = `Bearer ${options.token}`;
        }

        const transportOptions = {
            baseURL,
            timeout,
        };
        this.axiosInstance = axios.create({ ...transportOptions, headers });
        // Public and signer-access-code calls must never inherit privileged
        // account credentials. Both transports still target the same configured
        // Assinafy host and share timeout/retry behavior.
        this.publicAxiosInstance = axios.create({
            ...transportOptions,
            headers: { 'User-Agent': 'assinafy-typescript-sdk' },
        });

        if (maxRetries > 0) {
            installRateLimitRetry(this.axiosInstance, maxRetries, this.logger);
            installRateLimitRetry(this.publicAxiosInstance, maxRetries, this.logger);
        }

        this.documents = new DocumentResource(
            this.axiosInstance,
            this.defaultAccountId,
            this.logger,
            this.publicAxiosInstance,
        );
        this.signers = new SignerResource(this.axiosInstance, this.defaultAccountId, this.logger);
        this.workspaces = new WorkspaceResource(this.axiosInstance, undefined, this.logger);
        this.assignments = new AssignmentResource(
            this.axiosInstance,
            this.defaultAccountId,
            this.logger,
        );
        this.webhooks = new WebhookResource(this.axiosInstance, this.defaultAccountId, this.logger);
        this.templates = new TemplateResource(this.axiosInstance, this.defaultAccountId, this.logger);
        this.tags = new TagResource(this.axiosInstance, this.defaultAccountId, this.logger);
        this.auth = new AuthenticationResource(
            this.axiosInstance,
            undefined,
            this.logger,
            this.publicAxiosInstance,
        );
        this.fields = new FieldsResource(this.axiosInstance, this.defaultAccountId, this.logger);
        this.signerDocuments = new SignerDocumentsResource(
            this.publicAxiosInstance,
            this.defaultAccountId,
            this.logger,
        );
        this.users = new UserResource(this.axiosInstance, undefined, this.logger);
        this.webhookVerifier = new WebhookVerifier(this.webhookSecret);
    }

    /**
     * Convenience factory for the common apiKey + accountId setup.
     *
     * @param apiKey - Workspace API key (sent as the `X-Api-Key` header).
     * @param accountId - Default account ID used by account-scoped calls.
     * @param options - Extra client options (`baseUrl`, `timeout`, `maxRetries`,
     * `webhookSecret`, `logger`), minus `apiKey`/`accountId`.
     * @returns A configured {@link AssinafyClient}.
     *
     * @example
     * ```ts
     * const client = AssinafyClient.create(
     *   process.env.ASSINAFY_API_KEY!,
     *   process.env.ASSINAFY_ACCOUNT_ID!,
     *   { webhookSecret: process.env.ASSINAFY_WEBHOOK_SECRET },
     * );
     * ```
     */
    static create(
        apiKey: string,
        accountId: string,
        options: Omit<AssinafyClientOptions, 'apiKey' | 'accountId'> = {},
    ): AssinafyClient {
        return new AssinafyClient({ apiKey, accountId, ...options });
    }

    /**
     * Build a client from a plain object, accepting both snake_case and
     * camelCase keys (e.g. `api_key`/`apiKey`, `account_id`/`accountId`,
     * `webhook_secret`/`webhookSecret`). Handy for loading config straight from
     * environment variables or a JSON file.
     *
     * @param config - Loosely-typed configuration ({@link ClientConfigInput}).
     * @returns A configured {@link AssinafyClient}.
     *
     * @example
     * ```ts
     * const client = AssinafyClient.fromConfig({
     *   api_key: process.env.ASSINAFY_API_KEY,
     *   account_id: process.env.ASSINAFY_ACCOUNT_ID,
     * });
     * ```
     */
    static fromConfig(config: ClientConfigInput): AssinafyClient {
        const opts: AssinafyClientOptions = {};
        const apiKey = config.api_key ?? config.apiKey;
        const token = config.token ?? config.access_token ?? config.accessToken;
        const accountId = config.account_id ?? config.accountId;
        const baseUrl = config.base_url ?? config.baseUrl;
        const webhookSecret = config.webhook_secret ?? config.webhookSecret;
        if (apiKey !== undefined) opts.apiKey = apiKey;
        if (token !== undefined) opts.token = token;
        if (accountId !== undefined) opts.accountId = accountId;
        if (baseUrl !== undefined) opts.baseUrl = baseUrl;
        if (webhookSecret !== undefined) opts.webhookSecret = webhookSecret;
        if (config.timeout !== undefined) opts.timeout = config.timeout;
        const maxRetries = config.maxRetries ?? config.max_retries;
        if (maxRetries !== undefined) opts.maxRetries = maxRetries;
        if (config.logger !== undefined) opts.logger = config.logger;
        return new AssinafyClient(opts);
    }

    /**
     * Flagship helper: upload a PDF, wait for it to process, ensure each signer
     * exists, and open a **virtual** signature assignment — the whole "send this
     * document for signature" flow in a single call.
     *
     * Sequence of API calls:
     * 1. `POST /accounts/{accountId}/documents` — upload the PDF
     *    ({@link DocumentResource.upload}).
     * 2. Poll `GET /documents/{id}` until the document reaches a ready status
     *    ({@link DocumentResource.waitUntilReady}).
     * 3. For each signer, reuse an existing signer by email or
     *    `POST /accounts/{accountId}/signers` to create one
     *    ({@link SignerResource.create} — idempotent by email).
     * 4. `POST /documents/{id}/assignments` with `method: 'virtual'` and the
     *    collected signer IDs ({@link AssignmentResource.create}).
     * 5. When `waitForReady` is not `false`, re-fetch `GET /documents/{id}` so
     *    the returned document reflects the just-created assignment; otherwise
     *    the upload snapshot is returned, avoiding only this final round-trip.
     *
     * @param options - Workflow options.
     * @param options.source - The PDF to upload, as a file path or in-memory
     * buffer (see {@link DocumentUploadSource}).
     * @param options.signers - Signers to request signatures from — at least one
     * is required. Each is `{ name, email?, whatsapp_phone_number? | phone?,
     * cpf?, metadata? }`; a signer needs an email or a WhatsApp number to be
     * notified.
     * @param options.message - Optional invitation message attached to the
     * assignment.
     * @param options.metadata - Optional metadata attached to the uploaded
     * document.
     * @param options.waitForReady - Controls the final document re-fetch and
     * return shape. Defaults to `true`. The workflow always waits for
     * `metadata_ready` before creating an assignment because the API rejects
     * assignments for documents that are still being processed.
     * @param options.expiresAt - Optional ISO-8601 assignment expiry, e.g.
     * `'2026-08-01T00:00:00Z'`.
     * @param options.copyReceivers - Optional CC recipients (see the caveat on
     * {@link ICreateAssignmentPayload.copy_receivers} — silently dropped on some
     * plans).
     * @param options.accountId - Override the client's default account ID.
     * @returns `{ document, assignment, signer_ids }`. `document` is the
     * re-fetched {@link IDocumentDetailsResponse} when `waitForReady` (the
     * default), otherwise the {@link IDocumentUploadResponse} upload snapshot;
     * `signer_ids` are the created/reused signer IDs in signer order:
     * ```jsonc
     * {
     *   "document": {
     *     "resource": "document",
     *     "id": "103ad216846e6b90710cb9acef59",
     *     "name": "contract.pdf",
     *     "status": "pending_signature",   // re-fetched after assignment when waitForReady is true
     *     "artifacts": { "original": "https://…", "thumbnail": "https://…" },
     *     "assignment": { "id": "1032c55c58bb00a8dc35db916751" },  // the just-created assignment (same as the top-level `assignment` below)
     *     "pages": [
     *       { "id": "103ad216be62159d3087452d7cf8", "number": 1, "height": 1651, "width": 1275, "download_url": "https://…" }
     *     ]
     *   },
     *   "assignment": {
     *     "id": "1032c55c58bb00a8dc35db916751",
     *     "method": "virtual",
     *     "sender_email": "sender@example.com",
     *     "message": "Please sign the attached agreement.",
     *     "expires_at": null,
     *     "signers": [
     *       { "id": "1032becb82a279550bc3e5df9bbb", "step": 1, "email": "ana@example.com", "full_name": "Ana Souza", "notified": true, "completed": false }
     *     ],
     *     "signing_urls": [
     *       { "signer_id": "1032becb82a279550bc3e5df9bbb", "url": "https://app-sandbox.assinafy.com.br/sign/103ad216846e6b90710cb9acef59?email=ana%40example.com" }
     *     ]
     *   },
     *   "signer_ids": ["1032becb82a279550bc3e5df9bbb"]
     * }
     * ```
     * @throws {ValidationError} If `signers` is empty, the upload fails
     * validation (empty / non-PDF / larger than 25 MB), or the document never
     * reaches a ready status before the
     * {@link DocumentResource.waitUntilReady} timeout.
     * @throws {ApiError} If any underlying API call is rejected.
     *
     * @example
     * ```ts
     * const { document, assignment, signer_ids } = await client.uploadAndRequestSignatures({
     *   source: { filePath: './contract.pdf' },
     *   signers: [
     *     { name: 'Ana Souza', email: 'ana@example.com' },
     *     { name: 'Bruno Lima', whatsapp_phone_number: '+5511999999999' },
     *   ],
     *   message: 'Please sign the attached agreement.',
     * });
     * console.log(document.status);          // 'metadata_ready'
     * console.log(signer_ids.length);        // 2
     * console.log(assignment.signing_urls);  // per-signer signing links
     * ```
     */
    async uploadAndRequestSignatures(options: {
        source: DocumentUploadSource;
        signers: IUploadAndRequestSignaturesSigner[];
        message?: string;
        metadata?: Record<string, unknown>;
        waitForReady?: boolean;
        expiresAt?: string;
        copyReceivers?: string[];
        accountId?: string;
    }): Promise<IUploadAndRequestSignaturesResult> {
        if (!options.signers || options.signers.length === 0) {
            throw new ValidationError('At least one signer is required');
        }

        // Validate the complete workflow input before the document upload. A
        // bad later signer must not leave an otherwise avoidable orphaned
        // document (or a prefix of created signers) behind.
        const signerPayloads = options.signers.map(toCreateSignerPayload);
        for (const payload of signerPayloads) {
            validateCreateSignerPayload(payload);
            validateWorkflowSignerContact(payload);
        }

        this.logger.info('Starting upload + signature workflow', {
            signerCount: options.signers.length,
        });

        const uploadOpts: { metadata?: Record<string, unknown>; accountId?: string } = {};
        if (options.metadata !== undefined) uploadOpts.metadata = options.metadata;
        if (options.accountId !== undefined) uploadOpts.accountId = options.accountId;

        const document = await this.documents.upload(options.source, uploadOpts);
        const waitForReady = options.waitForReady !== false;

        // Assignment creation requires a metadata-ready document. This wait is
        // a correctness boundary, not an optional presentation detail: skipping
        // it creates a race where a fresh upload is commonly rejected.
        await this.documents.waitUntilReady(document.id);

        const signerIds: string[] = [];
        for (const payload of signerPayloads) {
            const created = await this.signers.create(payload, options.accountId);
            signerIds.push(created.id);
        }

        const assignmentPayload: ICreateAssignmentPayload = {
            method: 'virtual',
            signers: signerIds,
        };
        if (options.message !== undefined) assignmentPayload.message = options.message;
        if (options.expiresAt !== undefined) assignmentPayload.expires_at = options.expiresAt;
        if (options.copyReceivers !== undefined) assignmentPayload.copy_receivers = options.copyReceivers;

        const assignment = await this.assignments.create(document.id, assignmentPayload);

        // By default, return the current document
        // (status, pages and the just-created assignment) instead of the stale
        // upload snapshot. The compatibility flag only avoids this extra
        // post-assignment round-trip; readiness was already required above.
        const finalDocument = waitForReady
            ? await this.documents.details(document.id)
            : document;

        this.logger.info('Upload + signature workflow completed', { documentId: document.id });

        return { document: finalDocument, assignment, signer_ids: signerIds };
    }

    /**
     * Expose the underlying axios instance for advanced use cases: adding
     * interceptors, inspecting defaults, or calling endpoints not yet wrapped by
     * a resource.
     *
     * @returns The configured `AxiosInstance` — auth headers, base URL, timeout,
     * and the HTTP 429 retry interceptor are already applied. Automatic retries
     * are limited to `GET`, `HEAD`, `OPTIONS`, `PUT`, and `DELETE`; add a unique
     * `Idempotency-Key` header to explicitly permit replay of another method.
     *
     * @example
     * ```ts
     * client.getAxiosInstance().interceptors.request.use((cfg) => {
     *   cfg.headers['X-Trace-Id'] = crypto.randomUUID();
     *   return cfg;
     * });
     * ```
     */
    getAxiosInstance(): AxiosInstance {
        return this.axiosInstance;
    }
}

function toCreateSignerPayload(signer: IUploadAndRequestSignaturesSigner): ICreateSignerPayload {
    const payload: ICreateSignerPayload = { full_name: signer.name };
    if (signer.email !== undefined) payload.email = signer.email;
    const phone = signer.whatsapp_phone_number ?? signer.phone;
    if (phone !== undefined) payload.whatsapp_phone_number = phone;
    if (signer.cpf !== undefined) payload.cpf = signer.cpf;
    if (signer.metadata !== undefined) payload.metadata = signer.metadata;
    return payload;
}

function validateWorkflowSignerContact(payload: ICreateSignerPayload): void {
    const phone = payload.whatsapp_phone_number ?? payload.phone;
    const hasEmail = typeof payload.email === 'string' && payload.email.trim().length > 0;
    const hasPhone = typeof phone === 'string' && phone.trim().length > 0;
    if (!hasEmail && !hasPhone) {
        throw new ValidationError(
            'uploadAndRequestSignatures requires each signer to have an email or WhatsApp number',
        );
    }
}

function normaliseBaseUrl(raw: string): string {
    const value = raw.replace(/\/+$/, '');
    let url: URL;
    try {
        url = new URL(value);
    } catch {
        throw new ValidationError('baseUrl must be a valid absolute URL');
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
        throw new ValidationError('baseUrl must use http or https');
    }
    return value;
}

type RetryableConfig = InternalAxiosRequestConfig & { _retryCount?: number };

const IDEMPOTENT_METHODS = new Set(['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE']);

/**
 * Retry HTTP 429 (Too Many Requests) responses a bounded number of times,
 * waiting for the server-provided `Retry-After` / `X-Rate-Limit-Reset` delay.
 * Replays are restricted to HTTP's idempotent methods. A caller can explicitly
 * opt a non-idempotent request into retry by assigning a unique, non-empty
 * `Idempotency-Key` header; without that signal a `POST`/`PATCH` 429 is returned
 * immediately because the server may have accepted work before rate limiting.
 */
function installRateLimitRetry(http: AxiosInstance, maxRetries: number, logger: Logger): void {
    http.interceptors.response.use(
        (response) => response,
        async (error: unknown) => {
            if (!axios.isAxiosError(error) || error.response?.status !== 429 || !error.config) {
                throw error;
            }
            const config = error.config as RetryableConfig;
            if (!isRetryableRequest(config)) throw error;
            const attempt = (config._retryCount ?? 0) + 1;
            if (attempt > maxRetries) throw error;
            config._retryCount = attempt;

            const delayMs = nextRetryDelayMs(
                error.response.headers as Record<string, unknown>,
                attempt,
            );
            logger.warn('Rate limited (429); retrying after delay', { attempt, maxRetries, delayMs });
            await new Promise((resolve) => setTimeout(resolve, delayMs));
            return http(config);
        },
    );
}

function isRetryableRequest(config: InternalAxiosRequestConfig): boolean {
    const method = (config.method ?? 'GET').toUpperCase();
    return IDEMPOTENT_METHODS.has(method) || hasIdempotencyKey(config.headers);
}

function hasIdempotencyKey(headers: unknown): boolean {
    if (!headers || typeof headers !== 'object') return false;

    const getter = (headers as { get?: unknown }).get;
    if (typeof getter === 'function') {
        const value = getter.call(headers, 'Idempotency-Key') as unknown;
        if (typeof value === 'string' && value.trim().length > 0) return true;
    }

    return Object.entries(headers).some(
        ([key, value]) =>
            key.toLowerCase() === 'idempotency-key'
            && typeof value === 'string'
            && value.trim().length > 0,
    );
}
