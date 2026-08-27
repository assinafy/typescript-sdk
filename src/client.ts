import axios, { type AxiosInstance, type InternalAxiosRequestConfig } from 'axios';
import { setTimeout as delay } from 'node:timers/promises';
import type {
    AssinafyClientOptions,
    ICreateAssignmentPayload,
    ICreateSignerPayload,
    IUploadAndRequestSignaturesResult,
    IUploadAndRequestSignaturesSigner,
    Logger,
} from './types';
import { AssinafyError, ValidationError } from './errors';
import { assertDateTime, assertRecord, createSafeLogger } from './utils';
import { nextRetryDelayMs } from './support/retry';
import {
    DocumentResource,
    validateDocumentWaitOptions,
    type DocumentUploadSource,
} from './resources/documents';
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
import { SDK_USER_AGENT, withoutCredentials } from './support/transport';

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
     * (default 30 s), `maxRetries` (default 2, for HTTP 429 on replay-safe
     * requests), `webhookSecret` (enables
     * {@link AssinafyClient.webhookVerifier}) and `logger` are optional.
     * Automatic retries cover `GET`, `HEAD`, `OPTIONS`, and `DELETE`, except
     * `GET /sign` because that read records a signer view. An
     * `Idempotency-Key` opts advanced/custom requests into SDK replay only;
     * confirm that the target route actually deduplicates that key first.
     *
     * @throws {ValidationError} If `timeout` / `maxRetries` is invalid or
     * `baseUrl` is not an absolute HTTP(S) URL.
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
        assertRecord(options, 'client options');
        assertOptionalNonEmptyString(options.apiKey, 'apiKey');
        assertOptionalNonEmptyString(options.token, 'token');
        assertOptionalNonEmptyString(options.accountId, 'accountId');
        assertOptionalNonEmptyString(options.webhookSecret, 'webhookSecret');
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

        const baseURL = normaliseBaseUrl(
            options.baseUrl === undefined ? DEFAULT_BASE_URL : options.baseUrl,
        );
        const headers: Record<string, string> = {
            'User-Agent': SDK_USER_AGENT,
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
        this.axiosInstance = axios.create({
            ...transportOptions,
            headers,
            // Authorization is stripped by the redirect stack already;
            // X-Api-Key is custom, so mark it explicitly as sensitive too.
            sensitiveHeaders: ['Authorization', 'X-Api-Key'],
        });
        installCredentialOriginGuard(this.axiosInstance, baseURL);
        // Public and signer-access-code calls must never inherit privileged
        // account credentials. Both transports still target the same configured
        // Assinafy host and share timeout/retry behavior.
        this.publicAxiosInstance = withoutCredentials(
            axios.create({
                ...transportOptions,
                headers: { 'User-Agent': SDK_USER_AGENT },
            }),
        );

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
            this.publicAxiosInstance,
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
     * @throws {ValidationError} If an extra client option is invalid.
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
        assertRecord(options, 'client options');
        if (typeof apiKey !== 'string' || !apiKey.trim()) {
            throw new ValidationError('apiKey is required');
        }
        if (typeof accountId !== 'string' || !accountId.trim()) {
            throw new ValidationError('accountId is required');
        }
        return new AssinafyClient({ ...options, apiKey, accountId });
    }

    /**
     * Build a client from a plain object, accepting both snake_case and
     * camelCase keys (e.g. `api_key`/`apiKey`, `account_id`/`accountId`,
     * `webhook_secret`/`webhookSecret`). Handy for loading config straight from
     * environment variables or a JSON file.
     *
     * @param config - Loosely-typed configuration ({@link ClientConfigInput}).
     * @returns A configured {@link AssinafyClient}.
     * @throws {ValidationError} If `config` is not an object or contains an
     * invalid timeout, retry count, or base URL.
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
        assertRecord(config, 'client config');
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
     * Flagship helper: upload a PDF, ensure each signer exists, and open a
     * **virtual** signature assignment — the whole "send this
     * document for signature" flow in a single call.
     *
     * Sequence of API calls:
     * 1. `POST /accounts/{accountId}/documents` — upload the PDF
     *    ({@link DocumentResource.upload}).
     * 2. For each signer, reuse an existing signer by email or
     *    `POST /accounts/{accountId}/signers` to create one
     *    ({@link SignerResource.create} — idempotent by email).
     * 3. `POST /documents/{id}/assignments` with `method: 'virtual'` and the
     *    collected signer IDs ({@link AssignmentResource.create}).
     * 4. When `waitForReady` is not `false`, poll `GET /documents/{id}` until
     *    processing finishes; otherwise return the upload response immediately.
     *
     * @param options - Workflow options.
     * @param options.source - The PDF to upload, as a file path or in-memory
     * buffer (see {@link DocumentUploadSource}).
     * @param options.signers - Signers to request signatures from — at least one
     * is required. Each is `{ name, email?, whatsapp_phone_number? | phone?,
     * cpf?, metadata? }`; a signer needs an email or a WhatsApp number to be
     * notified. Phone-only signers automatically use WhatsApp for verification
     * and notification, which requires a paid plan and incurs the channel cost;
     * signers with e-mail default to the e-mail channel.
     * @param options.message - Optional invitation message attached to the
     * assignment.
     * @param options.metadata - Optional metadata attached to the uploaded
     * document.
     * @param options.waitForReady - Wait for document processing before
     * returning. Defaults to `true`. Virtual assignments are created directly
     * from `uploaded`, `metadata_processing`, or `metadata_ready`, as allowed by
     * the API; only `collect` assignments require pre-rendered pages.
     * @param options.waitOptions - Optional `maxWaitMs` / `pollIntervalMs`
     * forwarded to {@link DocumentResource.waitUntilReady}.
     * @param options.expiresAt - Optional ISO-8601 assignment expiry, e.g.
     * `'2026-08-01T00:00:00Z'`.
     * @param options.copyReceivers - Optional existing signer IDs (not email
     * addresses) that receive a copy. See the caveat on
     * {@link ICreateAssignmentPayload.copy_receivers}; some plans silently drop
     * the field.
     * @param options.accountId - Override the client's default account ID.
     * @returns `{ document, assignment, signer_ids }`. `document` is the
     * re-fetched {@link IDocumentDetailsResponse} when `waitForReady` (the
     * default), otherwise the {@link IDocumentUploadResponse} upload response;
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
     * This workflow is not transactional. If any post-upload step fails, its
     * {@link AssinafyError} includes the uploaded `documentId`, accumulated
     * `signerIds`, and `assignmentId` (once created) in `context`; a
     * {@link ValidationError} also exposes them in `errors`. Inspect those IDs
     * before retrying. The SDK does not auto-delete successfully created data.
     *
     * @throws {ValidationError} If the workflow/options or a signer is invalid,
     * the upload is empty / non-PDF / larger than 25 MB, or `waitForReady` is
     * enabled and processing exceeds the {@link DocumentResource.waitUntilReady}
     * timeout.
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
     * console.log(document.status);          // usually 'pending_signature'
     * console.log(signer_ids.length);        // 2
     * console.log(assignment.signing_urls?.length); // one protected link per signer
     * ```
     */
    async uploadAndRequestSignatures(options: {
        source: DocumentUploadSource;
        signers: IUploadAndRequestSignaturesSigner[];
        message?: string;
        metadata?: Record<string, unknown>;
        waitForReady?: boolean;
        waitOptions?: { maxWaitMs?: number; pollIntervalMs?: number };
        expiresAt?: string;
        copyReceivers?: string[];
        accountId?: string;
    }): Promise<IUploadAndRequestSignaturesResult> {
        assertRecord(options, 'upload and signature options');
        if (!Array.isArray(options.signers) || options.signers.length === 0) {
            throw new ValidationError('At least one signer is required');
        }
        if (options.waitOptions !== undefined) {
            validateDocumentWaitOptions(options.waitOptions);
        }
        if (options.waitForReady !== undefined && typeof options.waitForReady !== 'boolean') {
            throw new ValidationError('waitForReady must be a boolean');
        }
        if (options.message !== undefined && typeof options.message !== 'string') {
            throw new ValidationError('message must be a string');
        }
        if (options.metadata !== undefined) {
            assertRecord(options.metadata, 'metadata');
        }
        if (options.expiresAt !== undefined) assertDateTime(options.expiresAt, 'expiresAt');
        if (
            options.copyReceivers !== undefined
            && (!Array.isArray(options.copyReceivers)
                || options.copyReceivers.some(
                    (id) => typeof id !== 'string' || id.trim().length === 0,
                ))
        ) {
            throw new ValidationError('copyReceivers must be an array of non-empty signer IDs');
        }

        // Validate the complete workflow input before the document upload. A
        // bad later signer must not leave an otherwise avoidable orphaned
        // document (or a prefix of created signers) behind.
        const signerPayloads = options.signers.map(toCreateSignerPayload);
        for (const payload of signerPayloads) {
            validateCreateSignerPayload(payload);
            validateWorkflowSignerContact(payload);
        }
        validateUniqueWorkflowSignerContacts(signerPayloads);

        this.logger.info('Starting upload + signature workflow', {
            signerCount: options.signers.length,
        });

        const uploadOpts: { metadata?: Record<string, unknown>; accountId?: string } = {};
        if (options.metadata !== undefined) uploadOpts.metadata = options.metadata;
        if (options.accountId !== undefined) uploadOpts.accountId = options.accountId;

        const document = await this.documents.upload(options.source, uploadOpts);
        const waitForReady = options.waitForReady !== false;

        const signerIds: string[] = [];
        let assignmentId: string | undefined;
        try {
            const assignmentSigners: NonNullable<ICreateAssignmentPayload['signers']> = [];
            for (const payload of signerPayloads) {
                const created = await this.signers.create(payload, options.accountId);
                signerIds.push(created.id);
                assignmentSigners.push(
                    payload.email
                        ? { id: created.id }
                        : {
                            id: created.id,
                            verification_method: 'Whatsapp',
                            notification_methods: ['Whatsapp'],
                        },
                );
            }

            const assignmentPayload: ICreateAssignmentPayload = {
                method: 'virtual',
                signers: assignmentSigners,
            };
            if (options.message !== undefined) assignmentPayload.message = options.message;
            if (options.expiresAt !== undefined) assignmentPayload.expires_at = options.expiresAt;
            if (options.copyReceivers !== undefined) {
                assignmentPayload.copy_receivers = options.copyReceivers;
            }

            const assignment = await this.assignments.create(document.id, assignmentPayload);
            assignmentId = assignment.id;

            // Virtual assignments are accepted while metadata is processing. Wait
            // only when the caller wants the rendered/current document back.
            let finalDocument: IUploadAndRequestSignaturesResult['document'] = document;
            if (waitForReady) {
                finalDocument = await this.documents.waitUntilReady(
                    document.id,
                    options.waitOptions,
                );
            }

            this.logger.info('Upload + signature workflow completed', { documentId: document.id });

            return { document: finalDocument, assignment, signer_ids: signerIds };
        } catch (error) {
            const createdIds: Record<string, unknown> = {
                documentId: document.id,
                signerIds,
            };
            if (assignmentId !== undefined) createdIds['assignmentId'] = assignmentId;
            if (error instanceof ValidationError) Object.assign(error.errors, createdIds);
            if (error instanceof AssinafyError) Object.assign(error.context, createdIds);
            throw error;
        }
    }

    /**
     * Expose the underlying axios instance for advanced use cases: adding
     * interceptors, inspecting defaults, or calling endpoints not yet wrapped by
     * a resource.
     *
     * @returns The configured `AxiosInstance` — auth headers, base URL, timeout,
     * and the HTTP 429 retry interceptor are already applied. Automatic retries
     * are limited to read-safe `GET`, `HEAD`, `OPTIONS`, and `DELETE` requests;
     * `GET /sign` is excluded because it records that the assignment was viewed.
     * An `Idempotency-Key` opts a custom request into SDK replay only after the
     * caller confirms that the target route deduplicates it server-side.
     * Same-origin absolute URLs are supported; cross-origin requests are
     * rejected before dispatch, and credentials are removed from cross-origin
     * redirects. Use a separate axios client for unrelated hosts.
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

function assertOptionalNonEmptyString(value: unknown, name: string): void {
    if (value !== undefined && (typeof value !== 'string' || !value.trim())) {
        throw new ValidationError(`${name} must be a non-empty string when provided`);
    }
}

function toCreateSignerPayload(signer: IUploadAndRequestSignaturesSigner): ICreateSignerPayload {
    assertRecord(signer, 'signer');
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

function validateUniqueWorkflowSignerContacts(payloads: ICreateSignerPayload[]): void {
    const emails = new Set<string>();
    const phones = new Set<string>();
    for (const payload of payloads) {
        if (payload.email !== undefined) {
            const email = payload.email.toLowerCase();
            if (emails.has(email)) {
                throw new ValidationError('Signer email addresses must be unique');
            }
            emails.add(email);
        }
        if (payload.whatsapp_phone_number !== undefined) {
            if (phones.has(payload.whatsapp_phone_number)) {
                throw new ValidationError('Signer WhatsApp numbers must be unique');
            }
            phones.add(payload.whatsapp_phone_number);
        }
    }
}

function normaliseBaseUrl(raw: string): string {
    if (typeof raw !== 'string' || raw.trim().length === 0) {
        throw new ValidationError('baseUrl must be a valid absolute URL');
    }
    let url: URL;
    try {
        url = new URL(raw);
    } catch {
        throw new ValidationError('baseUrl must be a valid absolute URL');
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
        throw new ValidationError('baseUrl must use http or https');
    }
    if (url.username || url.password || raw.includes('?') || raw.includes('#')) {
        throw new ValidationError('baseUrl must not contain credentials, a query, or a fragment');
    }
    return url.href.replace(/\/+$/, '');
}

type RetryableConfig = InternalAxiosRequestConfig & { _retryCount?: number };

function installCredentialOriginGuard(http: AxiosInstance, baseURL: string): void {
    const allowedOrigin = new URL(baseURL).origin;
    http.interceptors.request.use((config) => {
        let requestedOrigin: string;
        try {
            requestedOrigin = new URL(config.url ?? '', config.baseURL ?? baseURL).origin;
        } catch {
            throw new ValidationError('Request URL must be a valid HTTP(S) URL');
        }
        if (requestedOrigin !== allowedOrigin) {
            throw new ValidationError('Credentialed requests must use the configured API origin');
        }
        return config;
    });
}

const RETRYABLE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS', 'DELETE']);

/**
 * Retry HTTP 429 (Too Many Requests) responses a bounded number of times,
 * waiting for the server-provided `Retry-After` / `X-Rate-Limit-Reset` delay.
 * PUT is excluded even though HTTP defines it as idempotent: Assinafy also uses
 * PUT for actions that mutate credentials, record legal actions, and dispatch
 * notifications. `GET /sign` is also excluded because the operation records a
 * signer view. A caller can explicitly opt another request into SDK retry with
 * a unique, non-empty `Idempotency-Key`, but must first confirm that the target
 * route deduplicates that key server-side. Otherwise a potentially
 * side-effecting 429 is returned immediately because the server may already
 * have accepted it.
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
            await delay(delayMs, undefined, { signal: config.signal as AbortSignal | undefined });
            return http(config);
        },
    );
}

function isRetryableRequest(config: InternalAxiosRequestConfig): boolean {
    const method = (config.method ?? 'GET').toUpperCase();
    if (method === 'GET' && isSignerViewRequest(config.url)) return false;
    if (hasIdempotencyKey(config.headers)) return true;
    return RETRYABLE_METHODS.has(method);
}

function isSignerViewRequest(url: string | undefined): boolean {
    if (!url) return false;
    try {
        const path = new URL(url, 'https://sdk.invalid').pathname.replace(/\/+$/u, '');
        return path === '/sign' || path === '/v1/sign';
    } catch {
        return false;
    }
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
