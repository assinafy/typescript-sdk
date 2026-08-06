/** Document lifecycle states emitted by the API. */
export type DocumentStatus =
    | 'uploading'
    | 'uploaded'
    | 'metadata_processing'
    | 'metadata_ready'
    | 'pending_signature'
    | 'expired'
    | 'certificating'
    | 'certificated'
    | 'rejected_by_signer'
    | 'rejected_by_user'
    | 'failed';

/** Artifact names available for document download. */
export type DocumentArtifactName = 'original' | 'certificated' | 'certificate-page' | 'bundle';

/**
 * Any string, while keeping editor autocomplete for the literals it is unioned
 * with.
 *
 * `'Email' | 'Whatsapp' | string` collapses to plain `string`, so the literals
 * vanish from autocomplete. `'Email' | 'Whatsapp' | AnyString` keeps them
 * suggested while staying assignable from any string, so a value the API adds
 * later still type-checks.
 *
 * This deliberately does **not** reject unknown strings — these fields mirror
 * server-controlled vocabularies, so forward-compatibility is worth more than
 * rejecting a typo at compile time.
 */
export type AnyString = string & {};

/** Assignment methods supported by the API. */
export type AssignmentMethod = 'virtual' | 'collect';

/** Verification methods accepted by assignment signer entries. */
export type AssignmentVerificationMethod = 'Email' | 'Whatsapp' | AnyString;

/** Notification methods accepted by assignment signer entries. */
export type AssignmentNotificationMethod = 'Email' | 'Whatsapp' | AnyString;

/** Minimal logger contract (compatible with console, pino, winston, etc.). */
export interface Logger {
    debug: (message: string, context?: Record<string, unknown>) => void;
    info: (message: string, context?: Record<string, unknown>) => void;
    warn: (message: string, context?: Record<string, unknown>) => void;
    error: (message: string, context?: Record<string, unknown>) => void;
}

/** Client configuration options. */
export interface AssinafyClientOptions {
    /** Assinafy API key. Preferred authentication method (sends `X-Api-Key` header). */
    apiKey?: string;
    /**
     * Access token. If provided (and `apiKey` is not), the client will send
     * `Authorization: Bearer <token>` instead.
     */
    token?: string;
    /** Default account (workspace) ID applied to account-scoped endpoints. */
    accountId?: string;
    /** Override the API base URL. Defaults to https://api.assinafy.com.br/v1. */
    baseUrl?: string;
    /**
     * Secret for an opt-in HMAC-SHA256 convention implemented by your own
     * gateway. The public Assinafy contract does not currently define a
     * platform webhook-signature header or shared-secret exchange.
     */
    webhookSecret?: string;
    /** Request timeout in milliseconds. Defaults to 30_000. */
    timeout?: number;
    /**
     * Max automatic retries on HTTP 429 (rate limit), honoring `Retry-After`.
     * Automatic retries are limited to idempotent GET, HEAD, OPTIONS, PUT, and
     * DELETE requests, plus requests carrying an explicit `Idempotency-Key`.
     * Defaults to `2`. Set to `0` to disable retrying.
     */
    maxRetries?: number;
    /** Optional logger. Defaults to a no-op logger. */
    logger?: Logger;
}

/**
 * Payload for creating a signer.
 *
 * The official schema requires only `full_name`. Contact fields are optional;
 * name-only signers cannot receive a signing notification until updated.
 */
export interface ICreateSignerPayload {
    full_name: string;
    email?: string;
    whatsapp_phone_number?: string;
    /** Compatibility alias normalized to `whatsapp_phone_number` before sending. */
    phone?: string;
    /** Unverified request extension. Brazilian CPF; non-digits are stripped. */
    cpf?: string;
    /** Unverified request extension retained for existing integrations. */
    metadata?: Record<string, unknown>;
}

/** Payload for updating a signer. */
export interface IUpdateSignerPayload {
    full_name?: string;
    email?: string;
    whatsapp_phone_number?: string;
    /** Compatibility alias normalized to `whatsapp_phone_number` before sending. */
    phone?: string;
    /** Unverified request extension. Brazilian CPF; non-digits are stripped. */
    cpf?: string;
}

/** Signer object as returned by the API. */
export interface ISigner {
    resource?: string;
    id: string;
    full_name: string;
    email: string | null;
    whatsapp_phone_number?: string | null;
    /**
     * Accepted on create/update payloads but **never echoed back** on any signer
     * response — present here only so response objects stay assignable from inputs.
     */
    cpf?: string | null;
    has_accepted_terms?: boolean;
    /** Only returned by `GET /signers/self`. */
    has_signature?: boolean;
    /** Only returned by `GET /signers/self`. */
    has_initial?: boolean;
    /** Only returned by `GET /signers/self`. */
    is_signature_reusable?: boolean;
    metadata?: Record<string, unknown>;
}

/** Signer profile returned by the signer-code-authenticated `GET /signers/self`. */
export interface ISignerSelf extends ISigner {
    has_signature: boolean;
    has_initial: boolean;
    is_signature_reusable: boolean;
}

/** Official identity fields accepted by the signer `confirm-data` operation. */
export interface IConfirmSignerDataPayload {
    /** Signer's full name as it should appear on the signed document. */
    full_name?: string;
    email?: string;
    /** Government-issued identifier recorded with the signature. */
    government_id?: string;
}

/**
 * Compatibility input retained for integrations written against older
 * Assinafy deployments. Neither extra property belongs to the current
 * `confirm-data` request schema.
 */
export interface ILegacyConfirmSignerDataPayload extends IConfirmSignerDataPayload {
    /**
     * @deprecated Unverified legacy field. Prefer updating the account signer
     * record before starting the signing flow.
     */
    whatsapp_phone_number?: string;
    /**
     * @deprecated Unverified legacy pass-through. It does not replace the
     * official `acceptTerms()` operation and must not be treated as proof of
     * legal consent.
     */
    has_accepted_terms?: boolean;
}

/** Official options for uploading the PNG signature image described by OpenAPI. */
export interface IUploadSignatureOptions {
    imageType?: 'signature' | 'initial';
    /** Persist this image so it is reused on future documents. */
    reuse?: boolean;
}

/** Source-compatible options for older deployments that accepted other media types. */
export interface ILegacyUploadSignatureOptions extends IUploadSignatureOptions {
    /**
     * @deprecated The current API contract accepts only `image/png`. Non-PNG
     * values are retained as an unverified compatibility escape hatch.
     */
    contentType?: string;
}

export type ICreateSignerResponse = ISigner;

/** Pagination metadata extracted from `X-Pagination-*` response headers. */
export interface PaginationMeta {
    current_page?: number;
    last_page?: number;
    per_page?: number;
    total?: number;
}

/** Shape returned by every paginated list call in the SDK. */
export interface PaginatedResult<T> {
    data: T[];
    meta?: PaginationMeta;
}

/** @deprecated use {@link PaginatedResult} — retained for existing type imports. */
export type IPaginatedResponse<T> = PaginatedResult<T>;

export type ISignerListResponse = PaginatedResult<ISigner>;

/** Signer reference accepted by the assignment endpoints. */
export type SignerReference =
    | string
    | {
          id?: string;
          signer_id?: string;
          verification_method?: AssignmentVerificationMethod;
          notification_methods?: AssignmentNotificationMethod[];
          /**
           * Positive integer controlling signing order. Signers sharing a step
           * sign in parallel; a step is activated (and its signers notified)
           * only after every signer in the previous step has signed. If supplied
           * for one signer it must be supplied for all, forming a contiguous
           * sequence starting at 1.
           */
          step?: number;
      };

/** Payload for creating an assignment. */
export interface ICreateAssignmentPayload {
    method?: AssignmentMethod;
    /**
     * List of signers. Each entry may be a signer id string, or an object with
     * `id` / `signer_id`.
     *
     * The SDK normalises them to the docs-sanctioned `signers: [{ ... }]`
     * shape before sending.
     */
    signers?: SignerReference[];
    /** Legacy field still accepted by the API docs and used by the PHP SDK. */
    signer_ids?: string[];
    /** Camel-case legacy alias used by the quick-start docs. */
    signerIds?: string[];
    message?: string;
    expires_at?: string;
    /**
     * Recipients CC'd on the signature request.
     *
     * ⚠️ Observed to be **silently dropped** on the sandbox plan: values sent
     * here came back as `[]` from `assignments.create`, `assignments.list` and
     * `documents.details().assignment` alike, for both email addresses and
     * signer IDs. The field is accepted (no error) but nothing is persisted.
     *
     * It is retained because this was verified on a single sandbox account and
     * may be plan-gated — the WhatsApp channel on the same account is rejected
     * with an explicit plan error, so silent no-ops for un-provisioned features
     * are plausible. **Do not rely on it without verifying against your own
     * account**, and do not treat a CC as delivered.
     */
    copy_receivers?: string[];
    /** Field placement entries used when `method` is `collect`. */
    entries?: IAssignmentEntry[];
}

/**
 * A field-placement entry for a `collect`-method assignment: one page and the
 * per-signer fields positioned on it.
 */
export interface IAssignmentEntry {
    page_id: string;
    fields: Array<{
        signer_id: string;
        field_id: string;
        /**
         * Opaque, server-defined placement settings (position, size, …). Left
         * loosely typed: the spec models it as a bare object and the live API
         * returns an unstable shape (an empty array on assignment items).
         */
        display_settings?: Record<string, unknown>;
    }>;
}

/** Channel descriptor accepted by assignment cost estimation. */
export interface IAssignmentCostSigner {
    verification_method?: AssignmentVerificationMethod;
    notification_methods?: AssignmentNotificationMethod[];
}

/**
 * Official request body for
 * `POST /documents/{documentId}/assignments/estimate-cost`.
 */
export interface IEstimateAssignmentCostPayload {
    method?: AssignmentMethod;
    /** Required for `virtual`; `{}` prices the default Email channel. */
    signers?: IAssignmentCostSigner[];
    /** Required for `collect`; signer descriptors are optional in that mode. */
    entries?: IAssignmentEntry[];
}

/** A signer as embedded inside an assignment (richer than the bare {@link ISigner}). */
export interface IAssignmentSigner extends ISigner {
    /** Only present in account-owner contexts; omitted from signer-code responses. */
    completed?: boolean | null;
    notification_history: INotificationHistoryEntry[] | null;
    verification_method: AssignmentVerificationMethod | null;
    notification_methods: AssignmentNotificationMethod[] | null;
    /** 1-based signing order. See {@link SignerReference.step}. */
    step: number | null;
    notified: boolean | null;
}

/** Per-channel notification delivery history embedded in an assignment signer. */
export interface INotificationHistoryEntry {
    event: string;
    status: 'sent' | 'failed';
    error_code: string | null;
    error_message: string | null;
    sent_at: string | null;
    failed_at: string | null;
}

/** A placed field/item within an assignment (one row per signer × field). */
export interface IAssignmentItem {
    id: string;
    page: {
        id: string;
        number: number;
        height: number;
        width: number;
        download_url: string;
    } | null;
    signer: ISigner;
    field: IFieldDefinition | null;
    /** Captured field value; its wire type depends on the field definition. */
    value: unknown | null;
    completed?: boolean;
    [key: string]: unknown;
}

/** Assignment object as returned by the API. */
export interface IAssignment {
    resource?: string;
    id: string;
    sender_email?: string;
    method: AssignmentMethod;
    expires_at?: string | null;
    expiration?: string;
    message?: string | null;
    signers: IAssignmentSigner[];
    /** Expanded copy-receiver objects returned by the API. */
    copy_receivers?: Array<Record<string, unknown>>;
    items?: IAssignmentItem[];
    summary?: {
        signer_count: number;
        completed_count: number;
        signers: Array<ISigner & { completed?: boolean }>;
    };
    /** Per-signer signing URLs. Array of `{ signer_id, url }` (not a map). */
    signing_urls?: Array<{ signer_id: string; url: string }>;
}

export type ICreateAssignmentResponse = IAssignment;

export interface IResendEmailResponse {
    is_sent: boolean;
    document_id: string;
    signer_id: string;
}

/**
 * Credit/document cost estimate returned by `assignments.estimateCost` and
 * `documents.estimateCostFromTemplate`.
 */
export interface ICostEstimate {
    documents: number;
    credits: number;
    needs_extra_document: boolean;
    extra_document_cost: number;
    total_credits: number;
    breakdown: Array<{
        code: string;
        name: string;
        cost: number;
        quantity?: number;
        unit_cost?: number;
    }>;
    document_balance: number;
    credit_balance: number;
    has_sufficient_resources: boolean;
    /** `null` when the operation can proceed; otherwise a reason code. */
    blocking_reason: string | null;
    message: string | null;
}

/**
 * Legacy resend-cost payload still returned by some Assinafy environments.
 *
 * The current OpenAPI contract declares {@link ICostEstimate} for this route,
 * while the sandbox has also returned this smaller, resend-specific shape.
 * The SDK models both wire formats instead of promising fields that may be
 * absent at runtime.
 */
export interface ILegacyResendCostEstimate {
    total: number;
    breakdown: Array<{ code: string; name: string; cost: number }>;
    credit_balance: number;
    has_sufficient_credits: boolean;
}

/** Cost estimate returned by `assignments.estimateResendCost`. */
export type IResendCostEstimate = ICostEstimate | ILegacyResendCostEstimate;

/** Webhook payload envelope. */
export interface IWebhookPayload {
    /** Internal activity id; use it as an idempotency/deduplication key. */
    id?: number;
    event?: WebhookEventType | AnyString;
    type?: string;
    message?: string | null;
    payload?: Record<string, unknown> | null;
    origin?: Record<string, unknown> | null;
    /** Unix timestamp in seconds. */
    created_at?: number;
    subject?: Record<string, unknown>;
    object?: Record<string, unknown>;
    account_id?: string;
    /** Legacy envelope accepted by the verifier for backwards compatibility. */
    data?: {
        document_uuid?: string;
        document_id?: string;
        [key: string]: unknown;
    };
    [key: string]: unknown;
}

/** Known webhook event names. */
export type WebhookEventType =
    | 'document_uploaded'
    | 'document_metadata_ready'
    | 'document_prepared'
    | 'assignment_created'
    | 'document_ready'
    | 'signature_requested'
    | 'signer_created'
    | 'signer_email_verified'
    | 'signer_whatsapp_verified'
    | 'signer_data_confirmed'
    | 'signer_viewed_document'
    | 'signer_signed_document'
    | 'signer_rejected_document'
    | 'user_rejected_document'
    | 'document_processing_failed'
    | 'template_created'
    | 'template_processed'
    | 'template_processing_failed';

/** Document listing item (paginated). */
export interface IDocumentListItem {
    id: string;
    name: string;
    status: DocumentStatus;
    account_id?: string;
    template_id?: string | null;
    /** Artifact download URLs keyed by name (`original`, `thumbnail`, …). */
    artifacts?: IDocumentUploadResponse['artifacts'];
    /** Public signing-portal URL for the document. */
    signing_url?: string;
    pages?: IDocumentUploadResponse['pages'];
    assignment?: IAssignment | null;
    decline_reason?: string | null;
    declined_by?: ISigner | null;
    /** Tags attached to the document (inline `{ id, name, color }` shape). */
    tags?: IInlineTag[];
    created_at: string;
    updated_at?: string;
    is_closed?: boolean;
}

export type IDocumentListResponse = PaginatedResult<IDocumentListItem>;

/** Query parameters accepted by `documents.list`. */
export interface IDocumentListParams extends IListParams {
    /** Filter by document status, e.g. `pending_signature`. */
    status?: DocumentStatus | AnyString;
    /** Filter by signature method (`virtual` or `collect`). */
    method?: AssignmentMethod;
    /** Comma-separated list of tag IDs (AND semantics). */
    tags?: string;
}

/**
 * Response of `documents.rename` (`PATCH /documents/{documentId}`).
 *
 * The rename endpoint returns the document **without** `pages` or
 * `assignment` — verified against the live API, which echoes only
 * `resource`, `id`, `account_id`, `template_id`, `name`, `status`,
 * `artifacts`, `signing_url`, `is_closed`, `decline_reason`, `declined_by`,
 * `tags`, `created_at` and `updated_at`. Typing it as a full
 * {@link IDocumentDetailsResponse} would promise a required `pages` array that
 * is absent at runtime, so `result.pages.length` would throw.
 */
export type IRenameDocumentResponse = Omit<IDocumentDetailsResponse, 'pages' | 'assignment'>;

/** Query parameters accepted by `documents.search`. */
export interface IDocumentSearchParams extends IListParams {
    /** Free-text term matched against the document name. */
    search?: string;
    /** Filter by document status, e.g. `pending_signature`. */
    status?: DocumentStatus | AnyString;
    /** Page number (1-based). */
    page?: number;
    /** Results per page. */
    'per-page'?: number;
}

/** Query parameters accepted by `assignments.list`. */
export interface IAssignmentListParams extends IListParams {
    /** Page number (1-based). */
    page?: number;
    /** Results per page. */
    'per-page'?: number;
}

/** Paginated result of `assignments.list`. */
export type IAssignmentListResponse = PaginatedResult<IAssignment>;

/** Document upload response. */
export interface IDocumentUploadResponse {
    resource?: string;
    id: string;
    account_id: string;
    template_id: string | null;
    name: string;
    status: DocumentStatus;
    /** Absent on a fresh upload; an {@link IAssignment} (or `null`) once one exists. */
    assignment?: IAssignment | null;
    artifacts: {
        original: string;
        certificated?: string;
        'certificate-page'?: string;
        bundle?: string;
        thumbnail?: string;
    };
    /** Public signing-portal URL for the document (always returned by the upload endpoint). */
    signing_url?: string;
    /** Empty (`[]`) on fresh upload (status `uploaded`); populated once `metadata_ready`. */
    pages: Array<{
        id: string;
        number: number;
        height: number;
        width: number;
        download_url: string;
    }>;
    /** Tags attached to the document (inline `{ id, name, color }` shape). */
    tags?: IInlineTag[];
    created_at: string;
    updated_at: string;
    is_closed: boolean;
    decline_reason: string | null;
    /** The signer who declined, once one has (matches the sibling document response types); `null` otherwise. */
    declined_by: ISigner | null;
}

/** Detailed document response. */
export interface IDocumentDetailsResponse {
    resource?: string;
    id: string;
    account_id: string;
    template_id?: string | null;
    name: string;
    status: DocumentStatus;
    assignment: IAssignment | null;
    download_url?: string;
    download_final_url?: string;
    signing_url?: string;
    artifacts?: {
        original: string;
        certificated?: string;
        'certificate-page'?: string;
        bundle?: string;
        thumbnail?: string;
    };
    /** Rendered pages. Empty until the document reaches `metadata_ready`. */
    pages: IPage[];
    /** Tags attached to the document (inline `{ id, name, color }` shape). */
    tags?: IInlineTag[];
    created_at: string;
    updated_at: string;
    is_closed: boolean;
    decline_reason?: string | null;
    declined_by?: ISigner | null;
    activities?: Array<IDocumentActivity>;
}

export interface IDocumentActivity {
    id: number;
    event: string;
    message: string;
    /** Event-specific payload snapshot. Object for most events, occasionally `[]` or `null`. */
    payload?: Record<string, unknown> | unknown[] | null;
    /** Request origin (`ip` / `user-agent`) when available; `null` for system events. */
    origin: { ip?: string; 'user-agent'?: string } | string | null;
    created_at: string;
}

/** Progress summary returned by `documents.getSigningProgress`. */
export interface ISigningProgress {
    signed: number;
    total: number;
    percentage: number;
    pending: number;
}

/** Query parameters accepted by paginated list endpoints. */
export interface IListParams {
    page?: number;
    per_page?: number;
    'per-page'?: number;
    search?: string;
    sort?: string;
    [key: string]: string | number | boolean | undefined;
}

/**
 * Workspace creation payload.
 *
 * Colours are persisted and echoed back on the workspace object. Unlike tags —
 * which accept a leading `#` and strip it — the account endpoints require an
 * **exactly 6-character hex string with NO leading `#`** (`'ff0066'`, not
 * `'#ff0066'`); a 7-character `#`-prefixed value is rejected with `400`
 * ("Primary Color" deve conter 6 caracteres). Verified live against the API.
 */
export interface ICreateWorkspacePayload {
    name: string;
    /** Who signers see as the notification sender (`User` is the API default). */
    notification_sender_type?: NotificationSenderType;
    /** 6-char hex, no leading `#` (e.g. `'ff0066'`). */
    primary_color?: string;
    /** 6-char hex, no leading `#` (e.g. `'0066ff'`). */
    secondary_color?: string;
}

/** Workspace update payload. Colours follow the same 6-char-no-`#` rule as {@link ICreateWorkspacePayload}. */
export interface IUpdateWorkspacePayload {
    name?: string;
    /** Who signers see as the notification sender. */
    notification_sender_type?: NotificationSenderType;
    /** 6-char hex, no leading `#`. */
    primary_color?: string | null;
    /** 6-char hex, no leading `#`. */
    secondary_color?: string | null;
}

export interface IWorkspaceResponse {
    resource?: string;
    id: string;
    name: string;
    primary_color?: string | null;
    secondary_color?: string | null;
    notification_sender_type?: NotificationSenderType;
    roles?: string[];
    is_delete_allowed?: boolean;
    created_at: string;
}

/** Notification sender identity accepted by account create/update operations. */
export type NotificationSenderType = 'User' | 'Account';

export interface IWorkspaceListItem extends IWorkspaceResponse {
    is_delete_allowed: boolean;
    roles: string[];
}

export type IWorkspaceListResponse = PaginatedResult<IWorkspaceListItem>;

/** Branding returned by `GET /accounts/{accountId}/theme`. */
export interface IAccountTheme {
    account_name: string;
    /** Six-character hex colour without a leading `#`. */
    primary_color: string;
    secondary_color: string | null;
    /** Absolute URL of the account logo. */
    logo: string;
}

/** Granularity accepted by account/user document-statistics endpoints. */
export type DocumentStatsGranularity = 'monthly' | 'daily';

/** Query for account/user document-statistics endpoints. */
export interface IDocumentStatsParams {
    /** Defaults to `monthly`. */
    granularity?: DocumentStatsGranularity;
    /** Target `YYYY-MM`; required when `granularity` is `daily`. */
    month?: string;
}

/** One zero-filled document-funnel KPI period. */
export interface IDocumentStatsRow {
    /** `YYYY-MM` for monthly results or `YYYY-MM-DD` for daily results. */
    period: string;
    documents_uploaded: number;
    documents_sent: number;
    signature_requests: number;
    signature_requests_email: number;
    signature_requests_whatsapp: number;
    signature_requests_viewed: number;
    signature_requests_completed: number;
    documents_certified: number;
}

/** Webhook subscription payload. */
export interface IWebhookRegisterPayload {
    url: string;
    email: string;
    /**
     * Events to subscribe to. Known {@link WebhookEventType} literals are
     * suggested in editors while any server-controlled string is still accepted
     * (via {@link AnyString}), matching the open-enum convention used elsewhere.
     */
    events?: (WebhookEventType | AnyString)[];
    is_active?: boolean;
}

/**
 * Webhook subscription as returned by the API. There is exactly one
 * subscription per workspace, keyed by URL — the API returns
 * `{ events, is_active, url, email, updated_at }` (no `id` / `created_at`).
 */
export interface IWebhookSubscription {
    url: string | null;
    email: string | null;
    events: string[];
    is_active: boolean;
    updated_at?: string | null;
}

export interface IWebhookEventTypeInfo {
    id: WebhookEventType | AnyString;
    description: string;
}

export interface IWebhookDispatch {
    resource?: string;
    id: string;
    event: WebhookEventType | AnyString;
    activity_id: number;
    endpoint: string | null;
    payload: IWebhookPayload | Record<string, unknown> | null;
    delivered: boolean;
    http_status: number | null;
    response_body: string | null;
    error: string | null;
    /** ISO-8601 UTC timestamp, e.g. `'2026-07-15T20:04:36Z'`. */
    created_at: string;
    /** ISO-8601 UTC timestamp, e.g. `'2026-07-15T20:04:36Z'`. */
    updated_at?: string;
}

export interface IWebhookDispatchListParams extends IListParams {
    event?: WebhookEventType | AnyString;
    delivered?: boolean | 'true' | 'false';
    from?: number;
    to?: number;
}

/** Shape of the high-level `uploadAndRequestSignatures` helper result. */
export interface IUploadAndRequestSignaturesResult {
    /**
     * The document. When `waitForReady` is enabled (the default) this is the
     * fully-processed {@link IDocumentDetailsResponse} re-fetched after the
     * assignment is created — so `status`, `pages` and the embedded `assignment`
     * are current. When `waitForReady` is `false` it is the raw
     * {@link IDocumentUploadResponse} upload snapshot (`status: 'uploaded'`).
     */
    document: IDocumentUploadResponse | IDocumentDetailsResponse;
    assignment: IAssignment;
    signer_ids: string[];
}

/** Input for a signer in `uploadAndRequestSignatures`. */
export interface IUploadAndRequestSignaturesSigner {
    name: string;
    email?: string;
    whatsapp_phone_number?: string;
    /** PHP SDK compatibility alias for `whatsapp_phone_number`. */
    phone?: string;
    /** Brazilian tax ID (CPF). Non-digits are stripped before sending. */
    cpf?: string;
    metadata?: Record<string, unknown>;
}

/** Template role definition. */
export interface ITemplateRole {
    id: string;
    name: string;
    /** Role kind, e.g. `Editor` or `Signer`. */
    assignment_type?: string;
    created_at?: string;
    updated_at?: string;
    [key: string]: unknown;
}

/** Payload for `PUT /accounts/{id}/templates/{template_id}`. Omit a field to leave it unchanged. */
export interface IUpdateTemplatePayload {
    name?: string;
    /** Default invitation message applied to documents created from the template. */
    message?: string;
}

/** Template list item (paginated). */
export interface ITemplateListItem {
    id: string;
    name: string;
    document_name?: string | null;
    message?: string | null;
    status: string;
    /**
     * Rendered pages, each with a `download_url`. Empty until the template
     * finishes processing (`status: 'Ready'`). Both the list and get endpoints
     * return `pages`, so there is no need to fetch a template again just to read
     * them.
     */
    pages?: IPage[];
    roles?: ITemplateRole[];
    /** Tags attached to the template itself (inline `{ id, name }` shape). */
    tags?: IInlineTag[];
    created_at: string;
    updated_at?: string;
}

export type ITemplateListResponse = PaginatedResult<ITemplateListItem>;

/** Full template details. */
/**
 * A rendered page of a document or template.
 *
 * `download_url` is an absolute, API-key-authenticated URL for the page's JPEG
 * rendering — the same bytes returned by `templates.downloadPage()` /
 * `documents.downloadPage()`.
 *
 * @example
 * ```jsonc
 * {
 *   "id": "e5f6a7b8c9d0e1f2a3b4c5d6e7f8",
 *   "number": 1,
 *   "height": 1651,
 *   "width": 1275,
 *   "download_url": "https://api.assinafy.com.br/v1/accounts/…/pages/…/download",
 *   "fields": []
 * }
 * ```
 */
export interface IPage {
    id: string;
    /** 1-based page number. */
    number: number;
    /** Rendered height in pixels (150 DPI). */
    height: number;
    /** Rendered width in pixels (150 DPI). */
    width: number;
    /** Absolute URL of the page's JPEG rendering. */
    download_url?: string;
    /** Fields positioned on this page. Present on templates; absent on documents. */
    fields?: ITemplateFieldPlacement[];
}

/** A field placement returned on a rendered template page. */
export interface ITemplateFieldPlacement {
    id?: string;
    field_id?: string;
    role_id?: string;
    label?: string;
    /** Opaque rendering metadata; the current schema intentionally leaves it untyped. */
    display_settings?: unknown;
    created_at?: string;
    updated_at?: string;
}

export interface ITemplateDetailsResponse {
    resource?: string;
    id: string;
    name: string;
    document_name?: string | null;
    message?: string | null;
    status: string;
    /** Empty until the template finishes processing (`status: 'Ready'`). */
    pages?: IPage[];
    roles?: ITemplateRole[];
    /** Tags attached to the template itself. */
    tags?: IInlineTag[];
    /** Tags auto-applied to every document created from this template. */
    default_document_tags?: IInlineTag[];
    created_at: string;
    updated_at?: string;
    [key: string]: unknown;
}

/** Signer assignment for creating a document from a template. */
export interface ITemplateSigner {
    role_id: string;
    id: string;
    verification_method?: string;
    notification_methods?: string[];
    /** Positive integer controlling signing order (see {@link SignerReference}). */
    step?: number;
}

/**
 * Role/channel descriptor used only for template cost estimation. The official
 * schema intentionally omits signer `id` and sequential-signing `step`.
 */
export interface ITemplateCostSigner {
    role_id: string;
    verification_method?: string;
    notification_methods?: string[];
}

/** Options for creating a document from a template. */
export interface ICreateDocumentFromTemplateOptions {
    name?: string;
    message?: string;
    expires_at?: string;
    editor_fields?: Array<{ field_id: string; value: string }>;
    /**
     * Tag names to attach to the new document. Names that don't exist yet are
     * auto-created; the template's default-document-tags are always merged in.
     */
    tags?: string[];
}

/**
 * Item returned by `GET /documents/statuses`.
 *
 * The API uses `code` (the status name); we mirror that field. `description`
 * is documented in the table but is not currently present in the JSON payload.
 */
export interface IDocumentStatusInfo {
    code: DocumentStatus | AnyString;
    deletable: boolean;
    description?: string;
}

/** Item returned by `GET /public/documents/{id}`. */
export interface IPublicDocumentInfo
    extends Partial<Omit<IDocumentDetailsResponse, 'id' | 'name'>> {
    resource?: string;
    id: string;
    name: string;
    /** Observed legacy/public response field; not present in the current schema. */
    page_count?: string | number;
    /** Observed legacy/public response field; not present in the current schema. */
    created_by?: string;
    [key: string]: unknown;
}

/** Result returned by public document signature-hash verification. */
export interface IDocumentVerification {
    hash: string;
    id: string | null;
    status: DocumentStatus | AnyString | null;
    page_count: string | null;
    signer_count: string | null;
    completed_count: number | null;
    completed_at: string | null;
    verified_at: string;
    is_valid: boolean;
    message: string;
}

/** Channel accepted by the `send-token` endpoint. */
export type SendTokenChannel = 'email' | 'whatsapp' | AnyString;

/** Authentication: login response (also returned by social login). */
/** Authenticated user profile returned by login and `users.getCurrent()`. */
export interface IAuthenticatedUser {
    id: string;
    name: string;
    email: string;
    telephone: string | null;
    government_id: string | null;
    is_email_verified: boolean;
    has_accepted_terms: boolean;
    /** Live compatibility field; absent from the current OpenAPI `AuthUser` schema. */
    is_password_set?: boolean;
    created_at: string;
    to_be_deleted_at: string | null;
}

export interface ILoginResponse {
    access_token: string;
    user: IAuthenticatedUser;
    accounts: Array<{
        id: string;
        name: string;
        roles: string[];
        is_delete_allowed: boolean;
        created_at: string;
    }>;
}

/** Authentication: API key payload returned by `POST /users/api-keys`. */
export interface IApiKeyResponse {
    api_key: string | null;
}

/** Authentication: masked API key returned by `GET /users/api-keys`. */
export type IMaskedApiKeyResponse = { api_key: string | null } | null;

/** Field definition object. */
export interface IFieldDefinition {
    resource?: string;
    id: string;
    name: string;
    type: string;
    regex?: string | null;
    is_pre_defined?: boolean;
    is_active: boolean;
    is_required?: boolean;
    is_standard?: boolean;
    is_read_only?: boolean;
    is_visible?: boolean;
}

/** Payload for creating a field definition. */
export interface ICreateFieldPayload {
    type: string;
    name: string;
    regex?: string | null;
    is_required?: boolean;
    /** Live compatibility extension; absent from the current create schema. */
    is_active?: boolean;
}

/** Payload for updating a field definition. */
export interface IUpdateFieldPayload {
    /** Live compatibility extension; absent from the current update schema. */
    type?: string;
    name?: string;
    regex?: string | null;
    /** Live compatibility extension; absent from the current update schema. */
    is_required?: boolean;
    is_active?: boolean;
}

/** Field type description returned by `GET /field-types`. */
export interface IFieldType {
    type: string;
    name: string;
}

/** Single result returned by `POST /accounts/{id}/fields/{id}/validate`. */
export interface IFieldValidationResult {
    type?: string;
    field_id?: string;
    success: boolean;
    error_message: string;
}

/** Payload entry for `POST /accounts/{id}/fields/validate-multiple`. */
export interface IFieldValidateMultipleEntry {
    field_id: string;
    value: unknown;
}

/** Item returned by `GET /documents/{id}/assignments/{id}/whatsapp-notifications`. */
export interface IWhatsAppNotification {
    sent_at: number;
    header: string;
    body: string;
    buttons: Array<{ text: string; url?: string }>;
    phone_number: string;
    signer_id: string;
}

/** Body entry for the signer-side `POST /documents/{id}/assignments/{id}` sign endpoint. */
export interface ISignFieldEntry {
    itemId: string;
    fieldId: string;
    pageId: string;
    value: string;
}

/**
 * Workspace tag object. Tag names are unique per workspace (case-insensitive)
 * and `color` is an optional 6-char hex string (without the leading `#`).
 */
export interface ITag {
    resource?: string;
    id: string;
    name: string;
    color: string | null;
    created_at: string;
    updated_at: string;
}

/** Inline tag shape embedded inside documents/templates (`{ id, name, color? }`). */
export interface IInlineTag {
    id: string;
    name: string;
    color?: string | null;
}

/** Payload for `POST /accounts/{id}/tags`. */
export interface ICreateTagPayload {
    name: string;
    /** 6-char hex color, with or without a leading `#`. Omit/`null` for none. */
    color?: string | null;
}

/** Payload for `PUT /accounts/{id}/tags/{id}`. Omit a field to leave it unchanged. */
export interface IUpdateTagPayload {
    name?: string;
    /** Pass `null` to clear the color; omit to leave unchanged. */
    color?: string | null;
}
