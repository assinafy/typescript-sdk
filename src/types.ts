/** Document lifecycle states emitted by the API. */
export type DocumentStatus =
    | 'uploading'
    | 'uploaded'
    | 'metadata_processing'
    | 'metadata_ready'
    | 'pending_signature'
    | 'pending_identity_review'
    | 'expired'
    | 'certificating'
    | 'certificated'
    | 'rejected_by_signer'
    | 'rejected_by_user'
    | 'failed';

/** Artifact names available for document download. */
export type DocumentArtifactName =
    | 'original'
    | 'certificated'
    | 'certificate-page'
    | 'pades'
    | 'bundle';

/** Server-defined signature image category, with known values suggested. */
export type SignatureImageType = 'signature' | 'initial' | AnyString;

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

/**
 * How a signer proves who they are before signing.
 *
 * | Value | How the signer is verified | Requirements | Cost per signer |
 * | --- | --- | --- | --- |
 * | `Email` | One-time code sent by e-mail (the default). | An `email`. | 0 credits |
 * | `Whatsapp` | One-time code sent over WhatsApp. | A `whatsapp_phone_number`; paid plan. | 0.45 credits |
 * | `DigitalCertificate` | The signer signs with their own ICP-Brasil certificate — **A1** (software, a file on the machine) or **A3** (hardware, a token or smartcard) — through the Web PKI browser extension, producing a qualified PAdES signature. | `method: 'virtual'`; Digital Certificate feature (Standard/Pro); `government_id`; the signer must be alone in their signing step. | 0.5 credits + notification |
 * | `IdDocumentFaceMatchBasic` | Hosted identity-document and face verification, with explicit biometric consent. | ID Document + Face Match feature; valid CPF in `government_id`; account approval for any `InReview` result before certification. | Use cost estimation for current pricing. |
 * | `Bypass` | No verification code. Enabled per account by Assinafy (`signing_features.VerificationBypass`); typically for `embedded` signers your app has already authenticated. | The Verification Bypass feature (`403 PlanRestricted` otherwise). | Notification only. |
 *
 * A1 and A3 are certificate *media*, chosen by the signer in their browser at
 * signing time. The API models both as the single `DigitalCertificate` value —
 * there is no separate `A1`/`A3` field to send, and the resulting PAdES
 * signature is qualified either way.
 *
 * Verification is coupled to {@link AssignmentNotificationMethod}: the
 * verification code travels on the notification channel, so `Email` pairs only
 * with `Email` and `Whatsapp` only with `Whatsapp`. `DigitalCertificate`
 * and `IdDocumentFaceMatchBasic` carry no OTP and may be announced over either
 * channel; those and `Bypass` may also use the `Bypass` notification, which
 * sends no invitation. The SDK rejects an invalid pairing before the request; the API
 * answers `400`. `embedded` signers use `Email`, `Whatsapp` or `Bypass`.
 *
 * Send neither field to get `Email`/`Email`; send one and the other is
 * inferred from it.
 */
export type AssignmentVerificationMethod =
    | 'Email'
    | 'Whatsapp'
    | 'DigitalCertificate'
    | 'IdDocumentFaceMatchBasic'
    | 'Bypass';

/** Provider session state; `InReview` permits signing but holds certification. */
export type IdentityVerificationStatus =
    | 'Pending'
    | 'InReview'
    | 'Approved'
    | 'Declined'
    | 'Expired'
    | 'Abandoned';

/** Evidence names accepted by the account review image endpoint. */
export type IdentityVerificationImageName = 'document_front' | 'document_back' | 'document_pdf' | 'face';

/** Signer-facing identity verification state, including an optional live capture link. */
export interface ISignerIdentityVerification {
    /** True before a session exists or when the last session is Expired. */
    can_start: boolean;
    status: IdentityVerificationStatus | AnyString | null;
    /** Bearer link: preserve its fragment, never log it or persist it in browser storage. */
    url: string | null;
    /** Capture-link expiry, not a deadline for processing or account review. */
    expires_at: string | null;
    completed_at: string | null;
}

/** Explicit biometric-processing consent; never infer it from another action. */
export interface IStartIdentityVerificationPayload {
    consent: true;
}

/** A newly opened identity verification provider session. */
export interface ISignerIdentityVerificationSession {
    id: string;
    /** Open as-is, including any fragment; treat it as a credential. */
    url: string;
    expires_at: string | null;
}

/** Account review decision. Rejection cancels the document and notifies its recipients. */
export interface IReviewIdentityVerificationPayload {
    decision: 'Approved' | 'Rejected';
    /** Up to 2000 characters; recorded in activity and sent to the provider, hidden from signers. */
    note?: string | null;
}

/** Account-visible identity review summary; contains no image bytes or biometrics. */
export interface ISignerIdentityReview {
    id: string;
    status: IdentityVerificationStatus | AnyString;
    provider: 'AssinafyVerify' | AnyString;
    verification_method: 'IdDocumentFaceMatchBasic' | AnyString;
    reason_codes: Array<{ code: string; description: string }>;
    evidence_available: boolean;
    expected: { name: string | null; cpf: string | null } | null;
    document: { type: string | null; name: string | null; cpf: string | null } | null;
    matches: { cpf: boolean | null; name: number | null; birth_date: boolean | null } | null;
    checks: Array<{ name: string; result: string; score: number | null; reasons: string[] }>;
    /** Evidence available only while `InReview`; empty after the decision. */
    images: IdentityVerificationImageName[];
    ruleset_version: string | null;
    evidence_sha256: string | null;
    reviewed_by: { id: string; name: string } | null;
    reviewed_at: string | null;
    review_note: string | null;
    completed_at: string | null;
}

/**
 * How the signing invitation reaches the signer. Exactly one per signer.
 *
 * | Value | Requirements | Cost per signer |
 * | --- | --- | --- |
 * | `Email` | An `email`. | 0 credits |
 * | `Whatsapp` | A `whatsapp_phone_number`; paid plan. | 0.45 credits |
 * | `Bypass` | Sends nothing; with `Bypass`, `DigitalCertificate` or `IdDocumentFaceMatchBasic` verification. Your app delivers the link, e.g. an embed session. | — |
 *
 * Notifications are charged when the assignment is created and again on every
 * resend. See {@link AssignmentVerificationMethod} for the pairing rules.
 */
export type AssignmentNotificationMethod = 'Email' | 'Whatsapp' | 'Bypass';

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
    /**
     * Override the API base URL. Defaults to https://api.assinafy.com.br/v1.
     * Must be absolute HTTP(S) without credentials, a query, or a fragment.
     */
    baseUrl?: string;
    /**
     * Webhook endpoint signing secret (`whsec_…`, from
     * `webhooks.getEndpointSecret()`). Enables
     * `webhookVerifier.verifySignature()`.
     */
    webhookSecret?: string;
    /** Request timeout in milliseconds. Defaults to 30_000. */
    timeout?: number;
    /**
     * Max automatic retries on HTTP 429 (rate limit), honoring `Retry-After`.
     * Automatic retries are limited to replay-safe GET, HEAD, OPTIONS, and
     * DELETE requests. `GET /sign` is excluded because it records a signer
     * view. An explicit `Idempotency-Key` opts other requests into SDK replay;
     * callers must confirm server-side deduplication for the target route.
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
    /** Compatibility extension. Brazilian CPF; non-digits are stripped. */
    cpf?: string;
    /**
     * CPF (11 digits) or CNPJ (14 characters, letters allowed). Sent as given;
     * the API strips formatting and returns the normalized value.
     */
    government_id?: string;
    /** Compatibility extension retained for existing integrations. */
    metadata?: Record<string, unknown>;
}

/** Payload for updating a signer. */
export interface IUpdateSignerPayload {
    /** Cannot be cleared. */
    full_name?: string;
    /** `null` or `''` clears it. */
    email?: string | null;
    /** `null` or `''` clears it (stored as `null`). */
    whatsapp_phone_number?: string | null;
    /** Compatibility alias normalized to `whatsapp_phone_number` before sending. */
    phone?: string | null;
    /** Compatibility extension. Brazilian CPF; non-digits are stripped. */
    cpf?: string;
    /**
     * CPF (11 digits) or CNPJ (14 characters, letters allowed). Sent as given;
     * the API strips formatting and returns the normalized value. `null` or `''`
     * clears it.
     */
    government_id?: string | null;
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
    /** Normalized CPF or CNPJ, e.g. `'39053344705'` or `'12ABC34501DE35'`. */
    government_id?: string | null;
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
    /** Available before verification so the signing UI can select OTP, certificate or identity capture. */
    verification_method?: AssignmentVerificationMethod | AnyString;
    /** Optional for compatibility with deployments that omit this field. */
    has_signature?: boolean;
    /** Optional for compatibility with deployments that omit this field. */
    has_initial?: boolean;
    /** Optional for compatibility with deployments that omit this field. */
    is_signature_reusable?: boolean;
}

/** Official identity fields accepted by the signer `confirm-data` operation. */
export interface IConfirmSignerDataPayload {
    /**
     * Required when the signer is verified or notified by e-mail. Saved when
     * the signer has none; otherwise it must be theirs.
     */
    email?: string;
    /**
     * Required when the signer is verified or notified by WhatsApp (E.164).
     * Saved when the signer has none; otherwise it must be theirs.
     */
    whatsapp_phone_number?: string;
    /**
     * Accept terms atomically with the confirmation. Required before opening a
     * DigitalCertificate assignment unless `acceptTerms()` was called.
     */
    has_accepted_terms?: boolean;
    /** @deprecated Ignored by production; read only by older deployments. */
    full_name?: string;
    /** @deprecated Ignored by production; read only by older deployments. */
    government_id?: string;
}

/** @deprecated Identical to {@link IConfirmSignerDataPayload}; kept for existing imports. */
export type ILegacyConfirmSignerDataPayload = IConfirmSignerDataPayload;

/** Official options for uploading the PNG signature image described by OpenAPI. */
export interface IUploadSignatureOptions {
    imageType?: SignatureImageType;
    /** Persist this image so it is reused on future documents. */
    reuse?: boolean;
}

/** Source-compatible options for older deployments that accepted other media types. */
export interface ILegacyUploadSignatureOptions extends IUploadSignatureOptions {
    /**
     * @deprecated The current API contract accepts only `image/png`. Non-PNG
     * values are retained as a compatibility escape hatch.
     */
    contentType?: string;
}

/** Signer returned after create or update. */
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

/** Paginated signer-list response. */
export type ISignerListResponse = PaginatedResult<ISigner>;

/** Signer reference accepted by the assignment endpoints. */
export type SignerReference =
    | string
    | {
          id?: string;
          signer_id?: string;
          /** `DigitalCertificate` is valid only when the assignment method is `virtual`. */
          verification_method?: AssignmentVerificationMethod;
          notification_methods?: AssignmentNotificationMethod[];
          /**
           * Sign inside your app through `embed.createSession()`: the signer gets
           * no link in `signing_urls`. Needs the Embed feature and `Email`,
           * `Whatsapp` or `Bypass` verification.
           */
          embedded?: boolean;
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
    /** Compatibility alias rewritten by the SDK to the official `signers` field. */
    signer_ids?: string[];
    /** Camel-case legacy alias used by the quick-start docs. */
    signerIds?: string[];
    message?: string;
    expires_at?: string;
    /**
     * Existing signer IDs to CC on the signature request (not email addresses).
     *
     * This can be plan-dependent. Confirm that returned assignment data retains
     * the IDs before treating a copy as delivered; unsupported plans may accept
     * the field but return an empty array.
     */
    copy_receivers?: string[];
    /** Field placement entries used when `method` is `collect`. */
    entries?: IAssignmentEntry[];
    /** Refuse with `409 CreditCeilingExceeded`, creating and charging nothing, above this many credits. */
    max_total_credits?: number;
}

/**
 * Field rectangle used by collect assignments. Coordinates are pixels in the
 * API's 150-DPI page image, measured from the upper-left corner.
 */
export interface IDisplaySettings {
    left: number;
    top: number;
    width: number;
    height: number;
    fontSize: number;
    fontFamily?: string;
    backgroundColor?: string;
}

/**
 * Assignment-item rendering metadata. Collect items use
 * {@link IDisplaySettings}; older virtual responses can contain an empty array
 * or another JSON primitive instead.
 */
export type AssignmentDisplaySettings =
    | IDisplaySettings
    | unknown[]
    | string
    | number
    | boolean
    | null;

/**
 * A field-placement entry for a `collect`-method assignment: one page and the
 * per-signer fields positioned on it.
 */
export interface IAssignmentEntry {
    page_id: string;
    fields: Array<{
        signer_id: string;
        field_id: string;
        /** Rectangle and presentation metadata for this field. */
        display_settings?: IDisplaySettings;
    }>;
}

/** Channel descriptor accepted by assignment cost estimation. `DigitalCertificate` requires `method: 'virtual'`. */
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
    /**
     * Required for both methods — the API rejects an estimate without it, and
     * per-signer `verification_method` is what the estimate prices. `{}` prices
     * the default Email channel.
     */
    signers: IAssignmentCostSigner[];
    /** Required for `collect`. */
    entries?: IAssignmentEntry[];
}

/** A signer as embedded inside an assignment (richer than the bare {@link ISigner}). */
export interface IAssignmentSigner extends ISigner {
    /** `InReview` requires an account decision before document certification. */
    identity_verification_status?: IdentityVerificationStatus | AnyString | null;
    /** Only present in account-owner contexts; omitted from signer-code responses. */
    completed?: boolean | null;
    /** Optional because some deployments omit notification history. */
    notification_history?: INotificationHistoryEntry[] | null;
    /** Server-controlled response value; request payloads use the strict request enum. */
    verification_method: AssignmentVerificationMethod | AnyString | null;
    /** Server-controlled response values; request payloads use the strict request enum. */
    notification_methods: Array<AssignmentNotificationMethod | AnyString> | null;
    /** 1-based signing order. See {@link SignerReference.step}. */
    step: number | null;
    notified: boolean | null;
}

/** Per-channel notification delivery history embedded in an assignment signer. */
export interface INotificationHistoryEntry {
    event: string;
    /** Furthest delivery stage: `opened` means the e-mail was opened/clicked or the WhatsApp message read. */
    status: 'sent' | 'delivered' | 'opened' | 'failed' | AnyString;
    /** Set only when `status` is `failed`. */
    error_code:
        | 'MailboxFull'
        | 'AddressNotFound'
        | 'AddressSuppressed'
        | 'ContentRejected'
        | 'MarkedAsSpam'
        | 'NotOnWhatsapp'
        | 'RecipientRestricted'
        | 'NotSent'
        | 'Unknown'
        | AnyString
        | null;
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
    /** Collect settings or a documented legacy/non-object wire value. */
    display_settings?: AssignmentDisplaySettings;
    /** Captured field value; its wire type depends on the field definition. */
    value: unknown | null;
    completed?: boolean;
    [key: string]: unknown;
}

/** Per-signer browser URL returned with a created assignment. */
export interface ISigningUrl {
    signer_id: string;
    /** `null` for an embedded signer (mint `embed.createSession()`) and a WhatsApp-only signer. */
    url: string | null;
    /** Whether the signer was created with `embedded: true`. */
    embedded?: boolean;
}

/** Assignment object as returned by the API. */
export interface IAssignment {
    resource?: string;
    id: string;
    /** The document this assignment belongs to; null only after document deletion. */
    document_id?: string | null;
    created_at?: string;
    /** `null` once the sending user deleted their account. */
    sender_email?: string | null;
    method: AssignmentMethod;
    expires_at?: string | null;
    /** Compatibility extension; absent from the OpenAPI Assignment schema. */
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
    /** Per-signer signing URLs. Array of `{ signer_id, url, embedded? }` (not a map). */
    signing_urls?: ISigningUrl[];
}

/** Assignment returned after requesting signatures. */
export type ICreateAssignmentResponse = IAssignment;

/** Acknowledgement returned after resending a signature notification. */
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
    /** `null` when the account's documents are not limited. */
    document_balance: number | null;
    /** `null` when the account's credits are not limited. */
    credit_balance: number | null;
    has_sufficient_resources: boolean;
    /** `null` when the operation can proceed; otherwise the documented reason code. */
    blocking_reason:
        | 'PendingPayment'
        | 'InsufficientDocuments'
        | 'InsufficientCredits'
        | null;
    message: string | null;
}

/**
 * Resend-cost payload (`ResendCostEstimate`): `total`, not `total_credits`.
 * The name is historical; this is the shape production documents.
 */
export interface ILegacyResendCostEstimate {
    total: number;
    breakdown: Array<{ code: string; name: string; cost: number }>;
    /** `null` when the account's credits are not limited. */
    credit_balance: number | null;
    has_sufficient_credits: boolean;
}

/**
 * Cost estimate returned by `assignments.estimateResendCost`: the compact
 * {@link ILegacyResendCostEstimate}, or {@link ICostEstimate} on older deployments.
 */
export type IResendCostEstimate = ILegacyResendCostEstimate | ICostEstimate;

/** Webhook payload envelope. */
export interface IWebhookPayload {
    /** Activity ID. To deduplicate retries prefer the `webhook-id` header, unique per endpoint. */
    id?: number;
    event?: WebhookDeliveryEventType | AnyString;
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

/**
 * Event names a delivery can carry: every subscribable {@link WebhookEventType}
 * plus `webhook_test`, sent only by `webhooks.testEndpoint()` and never subscribable.
 */
export type WebhookDeliveryEventType = WebhookEventType | 'webhook_test';

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
    | 'signer_identity_verified'
    | 'signer_identity_verification_failed'
    | 'signer_identity_review_required'
    | 'signer_identity_review_approved'
    | 'signer_identity_review_rejected'
    | 'signer_signed_document'
    | 'signer_rejected_document'
    | 'user_rejected_document'
    | 'document_processing_failed'
    | 'template_created'
    | 'template_processed'
    | 'template_processing_failed'
    | 'document_contract_updated'
    | 'document_contract_renewal_notice'
    | 'document_contract_expiring'
    | 'document_contract_expired'
    | 'document_contract_renewed'
    | 'document_contract_terminated'
    | 'document_contract_amended'
    | 'document_contract_amendment_updated';

/** Document listing item (paginated). */
export interface IDocumentListItem {
    id: string;
    name: string;
    status: DocumentStatus | AnyString;
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
    /** Code printed on the certificate page; `null` until `certificated`. */
    verification_code?: string | null;
    /** Public verification page; `null` until `certificated`. */
    verification_url?: string | null;
    created_at: string;
    updated_at?: string;
    is_closed?: boolean;
}

/** Paginated document-list/search response. */
export type IDocumentListResponse = PaginatedResult<IDocumentListItem>;

/** Lifecycle state of contract terms tracked on a document. */
export type DocumentContractStatus = 'draft' | 'active' | 'expired' | 'terminated';

/** How a signed instrument changes its parent contract. */
export type DocumentContractRelationType = 'amendment' | 'renewal' | 'termination';

/** External-system identifier attached to contract terms. */
export interface IDocumentContractExternalReference {
    system: string;
    id: string;
}

/** Contract terms tracked on one workspace document. */
export interface IDocumentContract {
    resource?: 'document_contract' | AnyString;
    document_id: string;
    status: DocumentContractStatus;
    counterparty_name: string | null;
    /** Normalized CPF or CNPJ. */
    counterparty_taxpayer_id: string | null;
    value: number | null;
    /** ISO 4217 currency code, or null when the contract has no value. */
    currency: string | null;
    /** Calendar dates use `YYYY-MM-DD`. */
    start_date: string | null;
    end_date: string | null;
    auto_renew: boolean;
    renewal_term_months: number | null;
    notice_period_days: number | null;
    /** Starts at 1 and increments on every renewal. */
    term: number;
    owner_id: string | null;
    metadata: Record<string, string> | null;
    external_references: IDocumentContractExternalReference[];
    /** Present only when `contracts.list({ expand: 'document' })` is used. */
    document?: IDocumentDetailsResponse;
    /** Present on single-contract and related-family reads. */
    amendments?: IDocumentContractAmendment[];
    created_at: string;
    updated_at: string;
}

/** A document linked to amend, renew, or terminate a parent contract. */
export interface IDocumentContractAmendment {
    resource?: 'document_contract_amendment' | AnyString;
    document_id: string;
    document_name: string;
    parent_document_id: string;
    relation_type: DocumentContractRelationType;
    /** Position among applied amendments; null while the instrument is pending. */
    number: number | null;
    status: 'pending' | 'applied';
    document_status: DocumentStatus | AnyString;
    apply_error: string | null;
    currency: string | null;
    /** Only the parent terms this instrument changes. */
    terms: Record<string, unknown> | null;
    /** Parent fields moved by the instrument, as `{ from, to }`. */
    changes: Record<string, { from: unknown; to: unknown }> | null;
    applied_at: string | null;
    created_at: string;
    updated_at: string;
}

/** Partial terms accepted by `contracts.set()`. Null clears the field where documented. */
export interface IDocumentContractInput {
    status?: DocumentContractStatus;
    counterparty_name?: string | null;
    counterparty_taxpayer_id?: string | null;
    value?: number | null;
    currency?: string | null;
    start_date?: string | null;
    end_date?: string | null;
    auto_renew?: boolean;
    renewal_term_months?: number | null;
    notice_period_days?: number | null;
    owner_id?: string | null;
    metadata?: Record<string, string> | null;
    /** Replaces the complete list; an empty array or null clears it. */
    external_references?: IDocumentContractExternalReference[] | null;
    /** Link this document as an instrument, or null to unlink a pending one. */
    parent_document_id?: string | null;
    relation_type?: DocumentContractRelationType;
    /** Optimistic-concurrency value read from the contract or pending amendment. */
    updated_at?: string | null;
}

/** Filters accepted by `contracts.list()`. */
export interface IDocumentContractListParams {
    status?: DocumentContractStatus[];
    counterparty?: string;
    search?: string;
    end_date_from?: string;
    end_date_to?: string;
    ending_within_days?: number;
    external_system?: string;
    external_id?: string;
    sort?: 'end_date' | '-end_date' | 'updated_at' | '-updated_at';
    expand?: 'document';
    page?: number;
    per_page?: number;
    'per-page'?: number;
}

/** Body accepted by `contracts.renew()`. */
export interface IRenewDocumentContractPayload {
    end_date?: string | null;
    value?: number | null;
    /** Current contract term; makes a renewal safe to repeat. */
    term?: number;
    /** Optional optimistic-concurrency value read from the contract. */
    updated_at?: string;
}

/** Body accepted by `contracts.terminate()`. */
export interface ITerminateDocumentContractPayload {
    reason?: string | null;
    /** Optional optimistic-concurrency value read from the contract. */
    updated_at?: string;
}

/** Paginated workspace contract list. */
export type IDocumentContractListResponse = PaginatedResult<IDocumentContract>;

/** Query parameters accepted by `documents.list`. */
export interface IDocumentListParams extends IListParams {
    /** Free-text term matched against document fields. */
    search?: string;
    /** Sort expression accepted by the document list endpoint. */
    sort?: string;
    /** Filter by document status, e.g. `pending_signature`. */
    status?: DocumentStatus | AnyString;
    /** Filter by signature method (`virtual` or `collect`). */
    method?: AssignmentMethod;
    /** Comma-separated list of tag IDs (AND semantics). */
    tags?: string;
    /** Only the documents of this envelope. */
    envelope_id?: string;
}

/**
 * Response of `documents.rename` (`PATCH /documents/{documentId}`).
 *
 * The response can omit `pages` and `assignment` and return only
 * `resource`, `id`, `account_id`, `template_id`, `name`, `status`,
 * `artifacts`, `signing_url`, `is_closed`, `decline_reason`, `declined_by`,
 * `tags`, `created_at` and `updated_at`. The two fields are therefore optional:
 * callers get the complete document fields without being promised values that
 * can be absent at runtime.
 */
export type IRenameDocumentResponse = Omit<IDocumentDetailsResponse, 'pages' | 'assignment'> &
    Partial<Pick<IDocumentDetailsResponse, 'pages' | 'assignment'>>;

/** Query parameters accepted by `documents.search`. */
export interface IDocumentSearchParams extends IListParams {
    /** Free-text term matched against the document name. */
    search?: string;
    /** Filter by document status, e.g. `pending_signature`. */
    status?: DocumentStatus | AnyString;
    /** Only the documents of this envelope. */
    envelope_id?: string;
    /** `name` or `updated_at`, `-` prefix for descending (`-updated_at` is the default). */
    sort?: 'name' | '-name' | 'updated_at' | '-updated_at' | AnyString;
    /** Page number (1-based). */
    page?: number;
    /** Results per page. */
    'per-page'?: number;
}

/** Query parameters accepted by `assignments.list`. */
export interface IAssignmentListParams extends IListParams {
    /** `created_at` (default, oldest first), `expires_at` or `id`; `-` prefix for descending. */
    sort?: 'created_at' | '-created_at' | 'expires_at' | '-expires_at' | 'id' | '-id' | AnyString;
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
    status: DocumentStatus | AnyString;
    /** Absent on a fresh upload; an {@link IAssignment} (or `null`) once one exists. */
    assignment?: IAssignment | null;
    artifacts: {
        original: string;
        certificated?: string;
        'certificate-page'?: string;
        pades?: string;
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
    status: DocumentStatus | AnyString;
    assignment: IAssignment | null;
    download_url?: string;
    download_final_url?: string;
    signing_url?: string;
    verification_code?: string | null;
    verification_url?: string | null;
    /** Present only on workspace detail reads when contract tracking is available. */
    has_contract?: boolean;
    /** Only with `expand: ['envelope_id']`: the envelope the document is in, or `null`. */
    envelope_id?: string | null;
    /** Only with `expand: ['envelope']`: the document's envelope, or `null`. */
    envelope?: IDocumentEnvelopeRef | null;
    artifacts?: {
        original: string;
        certificated?: string;
        'certificate-page'?: string;
        pades?: string;
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

/** One immutable activity event returned by `documents.activities()`. */
export interface IDocumentActivity {
    id: number;
    event: string;
    message: string;
    /** Event-specific payload. Object for most events, occasionally `[]` or `null`. */
    payload?: Record<string, unknown> | unknown[] | null;
    /** Request origin (`ip` / `user-agent`) when available; `null` for system events. */
    origin: { ip?: string | null; 'user-agent'?: string } | string | null;
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
    /** Compatibility filter used by several list endpoints. */
    search?: string;
    /** Compatibility sort expression retained for existing integrations. */
    sort?: string;
    /** Deployment-specific list filters retained for backwards compatibility. */
    [key: string]: string | number | boolean | undefined;
}

/** Query parameters accepted by `signers.list`. */
export interface ISignerListParams extends IListParams {
    search?: string;
}

/** Query parameters accepted by `templates.list`. */
export interface ITemplateListParams extends IListParams {
    search?: string;
}

/**
 * Workspace creation payload.
 *
 * Colours are persisted and echoed back on the workspace object. Unlike tags —
 * which accept a leading `#` and strip it — the account endpoints require an
 * **exactly 6-character hex string with NO leading `#`** (`'ff0066'`, not
 * `'#ff0066'`); a 7-character `#`-prefixed value is rejected with `400`
 * ("Primary Color" deve conter 6 caracteres).
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

/** Workspace returned by account create/get/update operations. */
export interface IWorkspaceResponse {
    resource?: string;
    id: string;
    name: string;
    primary_color?: string | null;
    secondary_color?: string | null;
    notification_sender_type?: NotificationSenderType;
    roles?: string[];
    is_delete_allowed?: boolean;
    /** Returned by `workspaces.get()`, not in workspace lists. More keys may appear. */
    limits?: IAccountLimits;
    /** Only with `workspaces.get(accountId, { expand: 'signing_features' })`. */
    signing_features?: IAccountSigningFeatures;
    created_at: string;
}

/** Notification sender identity accepted by account create/update operations. */
export type NotificationSenderType = 'User' | 'Account';

/** Workspace list item with the caller's roles and deletion permission. */
export interface IWorkspaceListItem extends IWorkspaceResponse {
    is_delete_allowed: boolean;
    roles: string[];
}

/** Paginated workspace-list response. */
export type IWorkspaceListResponse = PaginatedResult<IWorkspaceListItem>;

/** Branding returned by `GET /accounts/{accountId}/theme`. */
export interface IAccountTheme {
    account_name: string;
    /** Button background: six-character hex colour without a leading `#`. */
    primary_color: string;
    /** Button text: six-character hex colour without a leading `#`. */
    secondary_color: string;
    /**
     * Absolute logo URL for the caller (`/accounts/{accountId}/logo` for members,
     * `/sign/logo` for signers), or `null` when the account has none.
     */
    logo: string | null;
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

/**
 * One zero-filled document-funnel KPI period. Notification counters are not
 * mutually exclusive; verification counters are and sum to
 * `signature_requests`.
 */
export interface IDocumentStatsRow {
    /** `YYYY-MM` for monthly results or `YYYY-MM-DD` for daily results. */
    period: string;
    documents_uploaded: number;
    documents_sent: number;
    signature_requests: number;
    signature_requests_notification_email: number;
    signature_requests_notification_whatsapp: number;
    signature_requests_notification_bypass: number;
    signature_requests_verification_email: number;
    signature_requests_verification_whatsapp: number;
    signature_requests_verification_bypass: number;
    signature_requests_verification_digital_certificate: number;
    signature_requests_viewed: number;
    signature_requests_completed: number;
    documents_certified: number;
    /** @deprecated Older deployment field; use `signature_requests_notification_email`. */
    signature_requests_email?: number;
    /** @deprecated Older deployment field; use `signature_requests_notification_whatsapp`. */
    signature_requests_whatsapp?: number;
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
 * The account's oldest webhook endpoint, as returned by the legacy
 * subscription routes: `{ events, is_active, is_held, held_since, url, email, updated_at }`
 * (no `id` / `created_at`). Use {@link IWebhookEndpoint} for multi-endpoint
 * accounts.
 */
export interface IWebhookSubscription {
    url: string | null;
    email: string | null;
    events: string[];
    is_active: boolean;
    /** Whether delivery is paused after repeated failures. */
    is_held?: boolean;
    /** Unix timestamp when delivery was paused; `null` while it is running. */
    held_since?: number | null;
    updated_at?: string | null;
}

/** Body for `webhooks.createEndpoint()`. */
export interface IWebhookEndpointCreatePayload extends IWebhookRegisterPayload {
    /** Label to tell endpoints apart. */
    name?: string;
    /** Sign deliveries with a Standard Webhooks signature. Defaults to `false`. */
    signing_enabled?: boolean;
}

/** Body for `webhooks.updateEndpoint()`; only the fields sent are changed. */
export type IWebhookEndpointUpdatePayload = Partial<IWebhookEndpointCreatePayload>;

/**
 * One of the account's webhook endpoints. Accounts have 1 endpoint, or up to
 * 3 on paid plans; every active endpoint subscribed to an event receives it.
 */
export interface IWebhookEndpoint {
    resource?: string;
    id: string;
    name: string | null;
    url: string;
    email: string;
    events: (WebhookEventType | AnyString)[];
    is_active: boolean;
    /** Whether delivery is paused after repeated failures. */
    is_held?: boolean;
    /** Unix timestamp when delivery was paused; `null` while it is running. */
    held_since?: number | null;
    /** Whether deliveries carry a `webhook-signature` header. */
    signing_enabled: boolean;
    /** ISO-8601 UTC timestamp. */
    created_at: string;
    /** ISO-8601 UTC timestamp. */
    updated_at: string;
}

/** Endpoint creation/update also returns a newly generated signing secret. */
export interface IWebhookEndpointCreateResponse extends IWebhookEndpoint {
    /** Store securely when returned; OAuth applications cannot read it later. */
    secret?: string;
}

/** An endpoint's Standard Webhooks signing secret. */
export interface IWebhookEndpointSecret {
    /** `whsec_` followed by the base64-encoded key. */
    secret: string;
}

/** Result of `webhooks.rotateEndpointSecret()`. */
export interface IWebhookEndpointSecretRotation extends IWebhookEndpointSecret {
    /** Only with `keep_previous: true`: when the previous secret stops signing (24 hours). */
    previous_secret_expires_at?: string;
}

/** Event code and human-readable description from the webhook event catalog. */
export interface IWebhookEventTypeInfo {
    id: WebhookEventType | AnyString;
    description: string;
}

/** One webhook delivery attempt returned by the delivery-history endpoints. */
export interface IWebhookDispatch {
    resource?: string;
    id: string;
    event: WebhookDeliveryEventType | AnyString;
    activity_id: number;
    /** Endpoint the delivery went to; `null` once that endpoint is deleted. */
    endpoint_id?: string | null;
    /** URL that received the request. */
    endpoint: string | null;
    payload: IWebhookPayload | Record<string, unknown> | null;
    delivered: boolean;
    /** Stable `webhook-id` header across attempts for this event and endpoint. */
    webhook_id?: string | null;
    /** Attempt number for this event and endpoint, counted from 1. */
    attempt?: number | null;
    /** `scheduled` delivery, recovery `probe` to a paused endpoint, or `manual` (retry or test delivery). */
    kind?: 'scheduled' | 'probe' | 'manual' | AnyString;
    /** Whether another automatic attempt follows this entry. */
    will_retry?: boolean;
    /** Milliseconds the endpoint took; `null` when no request was sent or before it was measured. */
    duration_ms?: number | null;
    http_status: number | null;
    /** Receiving endpoint body, truncated by Assinafy to 2,000 characters. */
    response_body: string | null;
    error: string | null;
    /** ISO-8601 UTC timestamp, e.g. `'2026-07-15T20:04:36Z'`. */
    created_at: string;
    /** ISO-8601 UTC timestamp, e.g. `'2026-07-15T20:04:36Z'`. */
    updated_at?: string;
}

/** Filters accepted by `webhooks.listDispatches()`. */
export interface IWebhookDispatchListParams extends IListParams {
    /** Only deliveries to this webhook endpoint. */
    endpoint_id?: string;
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
     * {@link IDocumentUploadResponse} upload response (`status: 'uploaded'`).
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
    /** Always `template`. */
    resource?: string;
    id: string;
    name: string;
    document_name?: string | null;
    message?: string | null;
    status: string;
    /**
     * Rendered pages, each with a `download_url`. Empty until the template
     * finishes processing (`status: 'Ready'`). Both the list and get endpoints
     * return `pages`, so there is no need to fetch a template again just to read
     * them. The URL requires API-key authentication; prefer
     * `templates.downloadPage()` to fetch its bytes.
     */
    pages?: IPage[];
    roles?: ITemplateRole[];
    /** Tags attached to the template itself (inline `{ id, name }` shape). */
    tags?: IInlineTag[];
    created_at: string;
    updated_at?: string;
}

/** Paginated template-list response. */
export type ITemplateListResponse = PaginatedResult<ITemplateListItem>;

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
    /** Absolute API-key-authenticated URL of the page's JPEG rendering. */
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

/** Full template details returned by `templates.get()`. */
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
    /** Existing signer ID. Takes precedence over the email fields when present. */
    id?: string;
    /** Reuses the matching signer or creates one when `id` is omitted. */
    email?: string;
    /** Full name used when the email does not match an existing signer. */
    name?: string;
    /** E.164 number used when the email does not match an existing signer. */
    whatsapp_phone_number?: string;
    verification_method?: AssignmentVerificationMethod;
    notification_methods?: AssignmentNotificationMethod[];
    /** Sign inside your app (see {@link SignerReference}); Email, Whatsapp or Bypass verification. */
    embedded?: boolean;
    /** Positive integer controlling signing order (see {@link SignerReference}). */
    step?: number;
}

/**
 * Role/channel descriptor used only for template cost estimation. The official
 * schema intentionally omits signer identity and sequential-signing fields.
 */
export interface ITemplateCostSigner {
    role_id: string;
    verification_method?: AssignmentVerificationMethod;
    notification_methods?: AssignmentNotificationMethod[];
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
    /**
     * Refuse with `409 CreditCeilingExceeded` above this many credits. A cost
     * that rises after acceptance ends the document `failed` instead.
     */
    max_total_credits?: number;
    /** New per document; a retry with the same key returns the first document without charging again. */
    idempotencyKey?: string;
}

/**
 * Item returned by `GET /documents/statuses`.
 *
 * The API uses `code` (the status name); we mirror that field. `description`
 * is optional because responses can omit it.
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
    /** Optional compatibility response field. */
    page_count?: string | number;
    /** Optional compatibility response field. */
    created_by?: string;
    [key: string]: unknown;
}

/** Result returned by public document signature-hash verification. */
export interface IDocumentVerification {
    hash: string;
    id: string | null;
    /**
     * Agreement code printed on the document certificate; `null` when the hash
     * does not verify. Absent from deployments that predate the field.
     */
    agreement_code?: string | null;
    status: DocumentStatus | AnyString | null;
    page_count: string | null;
    signer_count: string | null;
    completed_count: number | null;
    completed_at: string | null;
    /** When certification was first recorded. */
    certificated_at?: string | null;
    verified_at: string;
    is_valid: boolean;
    message: string;
}

/** Channel accepted by the `send-token` endpoint; the contract allows only `email`. */
export type SendTokenChannel = 'email';

/**
 * `data` returned by `PUT /public/documents/{documentId}/send-token`.
 *
 * ```jsonc
 * {
 *   "document": { "resource": "document", "id": "a1b2…", "name": "Contract.pdf", "page_count": 3, "created_by": "Jane Doe" },
 *   "channel": "email",
 *   "recipient": "signer@example.com"
 * }
 * ```
 */
export interface ISendTokenResult {
    /** Summary of the document the token unlocks. */
    document: {
        resource: string;
        id: string;
        name: string;
        page_count: number;
        created_by: string;
    };
    /** Channel the token was sent through. */
    channel: string;
    /** Address the token was sent to. */
    recipient: string;
}

/** Authenticated user profile returned by login and `users.getCurrent()`. */
export interface IAuthenticatedUser {
    id: string;
    name: string;
    email: string;
    telephone: string | null;
    government_id: string | null;
    is_email_verified: boolean;
    has_accepted_terms: boolean;
    /** Compatibility field. */
    is_password_set?: boolean;
    created_at: string;
    to_be_deleted_at: string | null;
}

/**
 * Owner-facing document e-mail preferences returned by
 * `GET /users/self/notification-preferences`. The API always returns all thirteen
 * keys; `true` means that notification is enabled.
 */
export interface INotificationPreferences {
    DocumentCompleted: boolean;
    SignerDeclined: boolean;
    DocumentCancelled: boolean;
    DocumentAboutToExpire: boolean;
    DocumentExpired: boolean;
    DocumentExpirationReset: boolean;
    DocumentProcessingFailed: boolean;
    TemplateProcessingFailed: boolean;
    SignerWhatsappFailed: boolean;
    ContractRenewalNotice: boolean;
    ContractExpiring: boolean;
    ContractExpired: boolean;
    ContractRenewed: boolean;
}

/** Partial preference map accepted by `PUT /users/self/notification-preferences`. */
export type IUpdateNotificationPreferences = Partial<INotificationPreferences>;

/** Login/social-login response containing the bearer token, user, and accounts. */
export interface ILoginResponse {
    access_token: string;
    /**
     * Returned by `auth.login()` when the user has two-factor authentication
     * enabled: exchange it with `auth.verifyMfa()` within 5 minutes.
     */
    mfa_token?: string;
    user: IAuthenticatedUser;
    accounts: Array<{
        id: string;
        name: string;
        roles: string[];
        is_delete_allowed: boolean;
        created_at: string;
    }>;
}

/** An enrolled two-factor method. */
export interface IMfaMethod {
    id: string;
    /** `'Totp'` for authenticator apps. */
    type: 'Totp' | AnyString;
    label: string | null;
    /** ISO-8601 UTC timestamp. */
    confirmed_at: string | null;
    /** ISO-8601 UTC timestamp. */
    last_used_at: string | null;
}

/** Result of `users.getMfa()`. */
export interface IMfaStatus {
    methods: IMfaMethod[];
    recovery_codes_remaining: number;
}

/** Unconfirmed authenticator enrollment from `users.startTotpEnrollment()`. */
export interface ITotpEnrollment {
    id: string;
    /** Base32 shared secret; returned only by this call. */
    secret: string;
    /** `otpauth://` URI to render as a QR code. */
    provisioning_uri: string;
}

/** Recovery codes; shown only once. */
export interface IMfaRecoveryCodes {
    recovery_codes: string[];
}

/**
 * Re-authentication proof for sensitive two-factor changes: the current
 * `password`, or `code` — a live authenticator code or an unused recovery
 * code (which is then consumed).
 */
export interface IMfaReauth {
    password?: string;
    code?: string;
}

/** Body for `users.confirmTotpEnrollment()`. */
export interface IConfirmTotpPayload {
    /** Enrollment ID from `startTotpEnrollment()`. */
    id: string;
    /** Live code from the new device. */
    code: string;
    /** Current password; needed (or `reauth_code`) only when replacing a confirmed method. */
    password?: string;
    /** Alternative to `password`: a code from the current device, or a recovery code. */
    reauth_code?: string;
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
    /** Compatibility extension. */
    is_active?: boolean;
}

/** Payload for updating a field definition. */
export interface IUpdateFieldPayload {
    /** Compatibility extension. */
    type?: string;
    name?: string;
    regex?: string | null;
    /** Compatibility extension. */
    is_required?: boolean;
    is_active?: boolean;
}

/** Field type description returned by `GET /field-types`. */
export interface IFieldType {
    type: string;
    name: string;
}

/**
 * @deprecated Compatibility shape previously shared by both field-validation
 * endpoints. Prefer {@link IFieldValidationResponse} for a single value or
 * {@link IFieldValidationMultipleResult} for one item in a batch response.
 */
export interface IFieldValidationResult {
    type?: string;
    field_id?: string;
    success: boolean;
    error_message: string;
}

/** Result returned by `POST /accounts/{id}/fields/{id}/validate`. */
export interface IFieldValidationResponse extends IFieldValidationResult {
    type: string;
    /** The single-value endpoint does not return a field ID. */
    field_id?: never;
}

/** One item returned by `POST /accounts/{id}/fields/validate-multiple`. */
export interface IFieldValidationMultipleResult extends IFieldValidationResult {
    type: string;
    field_id: string;
}

/** Payload entry for `POST /accounts/{id}/fields/validate-multiple`. */
export interface IFieldValidateMultipleEntry {
    field_id: string;
    value: unknown;
}

/** Item returned by `GET /documents/{id}/assignments/{id}/whatsapp-notifications`. */
export interface IWhatsAppNotification {
    /** ISO-8601 UTC timestamp. */
    sent_at: string;
    header: string;
    body: string;
    /** Production strips button URLs; sandbox includes them, and they carry access codes. */
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

/** Acknowledgement returned after detaching a tag from a document. */
export interface IDetachDocumentTagResponse {
    detached: boolean;
}

/** Acknowledgement returned after deleting a workspace tag. */
export interface IDeleteTagResponse {
    deleted: boolean;
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

/**
 * Permission an OAuth application can request.
 *
 * Known literals stay suggested in editors while any server-added scope still
 * type-checks (see {@link AnyString}). The authoritative list is
 * `scopes_supported` in
 * {@link IOAuthAuthorizationServerMetadata}.
 */
export type OAuthScope =
    | 'documents:read'
    | 'documents:write'
    | 'templates:read'
    | 'templates:write'
    | 'account:read'
    | 'webhooks:write'
    | 'openid'
    | 'profile'
    | 'email'
    | 'offline_access'
    | AnyString;

/**
 * RFC 9728 protected-resource metadata served at
 * `https://api.assinafy.com.br/.well-known/oauth-protected-resource`.
 *
 * Served bare, without the `{ status, message, data }` envelope, as RFC 8615
 * requires. `scopes_supported` omits `offline_access`, which is a request-time
 * signal to the authorization server rather than a permission this API checks.
 */
export interface IOAuthProtectedResourceMetadata {
    /** Canonical identifier of this API, e.g. `https://api.assinafy.com.br`. */
    resource: string;
    /** Issuers allowed to mint tokens for it, e.g. `['https://auth.assinafy.com.br']`. */
    authorization_servers: string[];
    /** Scopes this API accepts. */
    scopes_supported: string[];
    /** How a token may be presented; Assinafy accepts `header` only. */
    bearer_methods_supported: string[];
}

/**
 * RFC 8414 authorization-server metadata served at
 * `{issuer}/.well-known/oauth-authorization-server`.
 *
 * The browser-facing `authorization_endpoint` lives on the authorization server
 * while `token_endpoint` and friends live on this API, so read the URLs from
 * here rather than deriving them from one host.
 */
export interface IOAuthAuthorizationServerMetadata {
    /** Issuer identifier; must equal the URL the document was fetched from. */
    issuer: string;
    /** Browser-facing consent URL. */
    authorization_endpoint: string;
    /** Token endpoint, on the API host. */
    token_endpoint: string;
    revocation_endpoint?: string;
    userinfo_endpoint?: string;
    jwks_uri?: string;
    scopes_supported?: string[];
    response_types_supported?: string[];
    grant_types_supported?: string[];
    /** Assinafy supports `S256` only; plain PKCE is rejected. */
    code_challenge_methods_supported?: string[];
    token_endpoint_auth_methods_supported?: string[];
    /** RFC 9207. `true` means the callback carries `iss` and clients must check it. */
    authorization_response_iss_parameter_supported?: boolean;
    client_id_metadata_document_supported?: boolean;
}

/**
 * Everything one authorization attempt needs, returned by
 * {@link OAuthResource.createAuthorizationUrl}.
 *
 * Store every field except `url` in the user's session: the callback handler
 * needs `state` and `issuer` to prove the response is yours, the token exchange
 * needs `codeVerifier`, and `nonce` validates the `id_token`.
 */
export interface IOAuthAuthorizationRequest {
    /** Absolute URL to send the browser to with a full page navigation. */
    url: string;
    /** Single-use CSRF value echoed back on the redirect URI. */
    state: string;
    /** RFC 7636 code verifier; never leaves your server after this. */
    codeVerifier: string;
    /** Issuer expected in the callback's `iss` parameter. */
    issuer: string;
    /** Present when `openid` was requested; compare it to the `id_token` claim. */
    nonce?: string;
}

/**
 * Validated authorization response read off the redirect URI by
 * {@link OAuthResource.readAuthorizationCallback}.
 */
export interface IOAuthAuthorizationCallback {
    /** Single-use authorization code. Expires 60 seconds after approval. */
    code: string;
    /** The `state` value, already checked against the stored one. */
    state: string;
    /** The `iss` value, already checked against the expected issuer. */
    issuer?: string;
}

/**
 * RFC 6749 §5.1 token response. Returned flat, without this API's
 * `{ status, message, data }` envelope.
 */
export interface IOAuthTokenResponse {
    access_token: string;
    /** Always `Bearer`. */
    token_type: string;
    /** Access-token lifetime in seconds; Assinafy issues 3600. */
    expires_in: number;
    /**
     * Present only when `offline_access` was requested and granted. Every
     * refresh returns a new one and retires the old one — persist it before
     * using the access token.
     */
    refresh_token?: string | null;
    /**
     * Scopes actually granted to the access token. Read this instead of
     * assuming the request was honoured in full; `offline_access` never appears
     * here because it is a request-time signal, not a permission.
     */
    scope?: string;
    /** Signed OIDC identity token (RS256). Present only when `openid` was granted. */
    id_token?: string | null;
    /**
     * RFC 8693 token type. Returned only by the token-exchange grant, which is
     * reserved for Assinafy's own services; absent from the two grants the SDK
     * sends.
     */
    issued_token_type?: string;
}

/** OpenID Connect claims returned by `GET /oauth/userinfo`. */
export interface IOAuthUserInfo {
    /** Stable user identifier. Always present. */
    sub: string;
    /** Requires the `profile` scope. */
    name?: string | null;
    /** Requires the `email` scope. */
    email?: string | null;
    /** Requires the `email` scope. */
    email_verified?: boolean | null;
}

/** Signing features a workspace's plan enables (`GET /accounts/{accountId}?expand=signing_features`). */
export interface IAccountSigningFeatures {
    /** `DigitalCertificate` verification (ICP-Brasil A1/A3). */
    DigitalCertificate: boolean;
    /** `IdDocumentFaceMatchBasic` verification. */
    VerificationIdDocumentFaceMatchBasic: boolean;
    /** The `Whatsapp` notification method, and therefore `Whatsapp` verification. */
    WhatsappNotification: boolean;
    /** The `Bypass` verification method, enabled per account by Assinafy. */
    VerificationBypass: boolean;
    /** Embedded signing: embed origins, `embedded` signers and embed sessions. */
    Embed: boolean;
    [feature: string]: boolean;
}

/** Plan limits returned on the workspace read. */
export interface IAccountLimits {
    /** Webhook endpoints the workspace may register (1, or 3 on paid plans). */
    webhook_endpoints: number;
    [limit: string]: number;
}

/** One plan meter in {@link IAccountUsage}. */
export interface IAccountUsageBalance {
    /** Remaining quantity; `null` for unlimited. */
    balance: number | null;
    /** Allowance per cycle or pool; `null` when not cycle-limited or unlimited. */
    limit: number | null;
    /** Quantity consumed in the current cycle. */
    spent: number;
}

/** Plan and balances returned by `GET /accounts/{accountId}/usage`. */
export interface IAccountUsage {
    /** Plan name; `null` when the subscription has no plan or it was retired. */
    plan: string | null;
    /** `YYYY-MM-DD` when the document allowance renews, or `null`. */
    documents_renewal_date: string | null;
    balances: {
        documents: IAccountUsageBalance;
        credits: IAccountUsageBalance;
    };
}

/** Document alert codes governed by the workspace notification policy. */
export type NotificationPolicyEvent =
    | 'DocumentCompleted'
    | 'SignerDeclined'
    | 'DocumentCancelled'
    | 'DocumentAboutToExpire'
    | 'DocumentExpired'
    | 'DocumentExpirationReset'
    | 'DocumentProcessingFailed'
    | 'TemplateProcessingFailed'
    | 'SignerWhatsappFailed'
    | 'ContractRenewalNotice'
    | 'ContractExpiring'
    | 'ContractExpired'
    | 'ContractRenewed'
    | 'SignerViewed'
    | 'SignerSigned'
    | 'SignerIdentityReviewRequired';

/** Workspace-wide alert policy returned by `GET /accounts/{accountId}/notification-policy`. */
export interface INotificationPolicy {
    /** Whether the requesting user is an owner and can change the policy. */
    editable: boolean;
    /** Owners also receive push alerts for every member's documents. */
    owners_receive_all: boolean;
    /** `false` silences that alert for everyone in the workspace, on every channel. */
    events: Record<NotificationPolicyEvent, boolean> & Record<string, boolean>;
}

/** Partial policy accepted by `PUT /accounts/{accountId}/notification-policy`. */
export interface IUpdateNotificationPolicyPayload {
    events?: Partial<Record<NotificationPolicyEvent, boolean>>;
    owners_receive_all?: boolean;
}

/** Push-notification alert codes for the authenticated user. */
export type PushPreferenceEvent =
    | 'SignerViewed'
    | 'SignerSigned'
    | 'DocumentCompleted'
    | 'SignerDeclined'
    | 'DocumentAboutToExpire'
    | 'DocumentExpired'
    | 'SignerIdentityReviewRequired'
    | 'SignerWhatsappFailed';

/** Push preferences returned by `GET /users/self/push-preferences`; new keys may appear. */
export type IPushPreferences = Record<PushPreferenceEvent, boolean> & Record<string, boolean>;

/** Partial map accepted by `PUT /users/self/push-preferences`. */
export type IUpdatePushPreferences = Partial<Record<PushPreferenceEvent, boolean>>;

/** An origin allowed to embed the workspace's signing pages. */
export interface IEmbedOrigin {
    id: string;
    /** Exact `scheme://host[:port]`, lowercased, without a trailing `/` or default port. */
    origin: string;
    created_at: string;
}

/** Single-use embed session returned by `embed.createSession()`. */
export interface IEmbedSession {
    /** Load in an iframe within 5 minutes; opening it spends the token. Never store or log it. */
    url: string;
    expires_at: string;
}

/** Signer of one envelope document; a signer appears only on their documents. */
export interface IEnvelopeDocumentSigner {
    id: string;
    full_name: string;
    email: string | null;
    whatsapp_phone_number: string | null;
    /** Whether they signed this document. */
    completed: boolean;
    signed_at: string | null;
}

/** One document of an envelope, in envelope order. */
export interface IEnvelopeDocument {
    id: string;
    /** Position in the envelope, from 1. */
    position: number;
    name: string;
    status: DocumentStatus | AnyString;
    /** Download URLs keyed by artifact name, as on the document read. */
    artifacts: Partial<Record<DocumentArtifactName, string>> & Record<string, string>;
    signers: IEnvelopeDocumentSigner[];
}

/** Envelope returned by every envelope read and mutation. */
export interface IEnvelope {
    resource?: string;
    id: string;
    name: string;
    message: string | null;
    documents: IEnvelopeDocument[];
    /** Documents per status code (only statuses present); `null` once it lists no document. */
    counts: Record<string, number> | null;
    /** One entry per signer; `url` is `null` for embedded and WhatsApp-only signers. */
    signing_urls: ISigningUrl[];
    created_at: string;
}

/** Paginated envelope-list response. */
export type IEnvelopeListResponse = PaginatedResult<IEnvelope>;

/** Filters accepted by `envelopes.list()`. */
export interface IEnvelopeListParams extends IListParams {
    /** Part of the envelope name. */
    search?: string;
    /** `open`: a document is still open; `closed`: every document is closed. */
    status?: 'open' | 'closed';
}

/** An envelope signer, listed once by ID. Envelope signers take no `step`. */
export interface IEnvelopeSignerInput {
    id: string;
    verification_method?: AssignmentVerificationMethod;
    notification_methods?: AssignmentNotificationMethod[];
    /** Sign inside your app through `embed.createSession()`; needs the Embed feature. */
    embedded?: boolean;
}

/** A `metadata_ready`, unassigned workspace document to put in an envelope. */
export interface IEnvelopeDocumentInput {
    id: string;
    method?: AssignmentMethod;
    /** Required for `collect`: its signers are exactly those on its fields. */
    entries?: IAssignmentEntry[];
    /** This document's signers, each listed once in the envelope's `signers`. */
    signer_ids: string[];
    /** At least one hour ahead; date-only means 23:59 UTC, no offset means UTC. `null` for none. */
    expires_at?: string | null;
    /** Signer IDs that only receive a copy of this document. */
    copy_receiver_ids?: string[];
}

/** Body for `POST /accounts/{accountId}/envelopes` and its cost estimate. */
export interface ICreateEnvelopePayload {
    /** 1–255 characters without `<`; replaces document names in invitations. */
    name: string;
    message?: string | null;
    /** Refuse with `409 CreditCeilingExceeded` when the total would exceed it. Ignored by the estimate. */
    max_total_credits?: number;
    /** 1–20 signers; each must be on at least one document. */
    signers: IEnvelopeSignerInput[];
    /** 1–20 documents, in envelope order. */
    documents: IEnvelopeDocumentInput[];
}

/** Body for `POST /accounts/{accountId}/envelopes/{envelopeId}/documents`. */
export interface IAddEnvelopeDocumentPayload extends IEnvelopeDocumentInput {
    /** Refuse with `409 CreditCeilingExceeded` when this document costs more. */
    max_total_credits?: number;
}

/** Body for `PATCH /accounts/{accountId}/envelopes/{envelopeId}`; send only what changes. */
export interface IUpdateEnvelopePayload {
    name?: string;
    /** `null` removes the message. */
    message?: string | null;
    /** Every document of the envelope, each once, in the new order. */
    document_ids?: string[];
}

/** Envelope activity: a document activity naming its document. */
export interface IEnvelopeActivity extends IDocumentActivity {
    document_id: string;
    document_name: string;
}

/** Per-document outcome of `envelopes.cancel()`. */
export interface IEnvelopeCancelResult {
    id: string;
    /** The document's status after the call. */
    status: DocumentStatus | AnyString;
    /** Whether this call cancelled it. */
    cancelled: boolean;
}

/** Acknowledgement of `envelopes.resendNotification()`. */
export interface IEnvelopeResendResponse {
    /** Whether every notification method sent it. */
    is_sent: boolean;
    envelope_id: string;
    signer_id: string;
}

/** Envelope a signer's code belongs to (`expand: 'envelope'`). */
export interface IDocumentEnvelopeRef {
    id: string;
    name: string;
}

/** Whether a signer can ask for the certified copy again. */
export interface ISignerCertifiedCopyStatus {
    available: boolean;
    notification_method: AssignmentNotificationMethod | null;
    /** WhatsApp re-sends left; `null` for e-mail. */
    resends_left: number | null;
}

/** Result of asking for the certified copy again. */
export interface ICertifiedCopyResendResult {
    /** Whether it can be asked for again. */
    available: boolean;
    notification_method: AssignmentNotificationMethod;
    /** WhatsApp re-sends left; `null` for e-mail. */
    resends_left: number | null;
    /** Masked contact it went to, e.g. `j***@example.com`. */
    sent_to: string;
}

/** Signer as `GET /sign` and `GET /signers/{signerId}/document` describe them. */
export type ISigningCurrentSigner = Partial<ISigner> & {
    id: string;
    verification_method: AssignmentVerificationMethod | AnyString;
    /** `null` on requests stored before they were recorded. */
    notification_methods: Array<AssignmentNotificationMethod | AnyString> | null;
    /** Whether this signer has signed. */
    completed: boolean;
};

/**
 * Document read with a signer access code. While the code is open it is the
 * full document, whose `assignment` carries only this signer's items (no other
 * signers, `signing_urls`, copy receivers or `summary`). Once the signer has
 * been done for 30 minutes the code closes: only `id`, `name`, `status`,
 * `current_signer`, `certified_copy` (and `envelope`, when asked for) remain,
 * with `is_signer_access_closed: true`.
 */
export type ISigningDocument = Partial<Omit<IDocumentDetailsResponse, 'assignment'>> & {
    /** The signer's own items only: no `signers`, `signing_urls`, `copy_receivers` or `summary`. */
    assignment?: Omit<IAssignment, 'signers' | 'signing_urls' | 'copy_receivers' | 'summary'> | null;
    id: string;
    name: string;
    status: DocumentStatus | AnyString;
    current_signer: ISigningCurrentSigner;
    is_signer_access_closed: boolean;
    certified_copy: ISignerCertifiedCopyStatus;
    /** Only with `expand: ['envelope']`; `null` outside an envelope. */
    envelope?: IDocumentEnvelopeRef | null;
};

/** Signer state returned by `PUT /signers/accept-terms`. */
export interface IAcceptTermsResult {
    full_name: string;
    email: string | null;
    has_accepted_terms: boolean;
}

/** Filters accepted by the signer document list. */
export interface ISignerDocumentListParams extends IListParams {
    /** Only the documents of this envelope. */
    envelope_id?: string;
}

/** Options for reading the document to sign (`GET /sign`). */
export interface ISigningReadOptions {
    /** Sent as `has_accepted_terms`; records the signer's acceptance. */
    hasAcceptedTerms?: boolean;
    /** `['envelope']` adds the envelope the code belongs to. */
    expand?: Array<'envelope'>;
    /** With an envelope code: another document of that envelope the signer is on. */
    documentId?: string;
}

/** Options for `documents.details()` / `documents.get()`. */
export interface IDocumentDetailsOptions {
    /** `envelope_id` adds the document's envelope ID; `envelope` its `{ id, name }`. */
    expand?: Array<'envelope_id' | 'envelope'>;
}

/** Options for `documents.thumbnail()` / `documents.downloadPage()`. */
export interface IDocumentRenderOptions {
    /** `certificated`: render as in the signed document (`404` until certified, `503` while pending). */
    artifact?: 'certificated';
}
