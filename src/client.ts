import axios, { type AxiosInstance } from 'axios';
import type {
    AssinafyClientOptions,
    ICreateAssignmentPayload,
    ICreateSignerPayload,
    IUploadAndRequestSignaturesResult,
    IUploadAndRequestSignaturesSigner,
    Logger,
} from './types';
import { ValidationError } from './errors';
import { createNoopLogger } from './utils';
import { DocumentResource, type DocumentUploadSource } from './resources/documents';
import { SignerResource } from './resources/signers';
import { WorkspaceResource } from './resources/workspaces';
import { AssignmentResource } from './resources/assignments';
import { WebhookResource } from './resources/webhooks';
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
    private readonly defaultAccountId: string | undefined;
    private readonly logger: Logger;
    private readonly webhookSecret: string | undefined;

    public readonly documents: DocumentResource;
    public readonly signers: SignerResource;
    public readonly workspaces: WorkspaceResource;
    public readonly assignments: AssignmentResource;
    public readonly webhooks: WebhookResource;
    public readonly webhookVerifier: WebhookVerifier;

    constructor(options: AssinafyClientOptions) {
        if (!options.apiKey && !options.token) {
            throw new ValidationError(
                'An API key (options.apiKey) or legacy access token (options.token) is required.',
            );
        }

        this.defaultAccountId = options.accountId;
        this.logger = options.logger ?? createNoopLogger();
        this.webhookSecret = options.webhookSecret;

        const baseURL = normaliseBaseUrl(options.baseUrl ?? DEFAULT_BASE_URL);
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'User-Agent': 'assinafy-typescript-sdk',
        };
        if (options.apiKey) {
            headers['X-Api-Key'] = options.apiKey;
        } else if (options.token) {
            headers['Authorization'] = `Bearer ${options.token}`;
        }

        this.axiosInstance = axios.create({
            baseURL,
            timeout: options.timeout ?? 30_000,
            headers,
        });

        this.documents = new DocumentResource(this.axiosInstance, this.defaultAccountId, this.logger);
        this.signers = new SignerResource(this.axiosInstance, this.defaultAccountId, this.logger);
        this.workspaces = new WorkspaceResource(this.axiosInstance, undefined, this.logger);
        this.assignments = new AssignmentResource(
            this.axiosInstance,
            this.defaultAccountId,
            this.logger,
        );
        this.webhooks = new WebhookResource(this.axiosInstance, this.defaultAccountId, this.logger);
        this.webhookVerifier = new WebhookVerifier(this.webhookSecret);
    }

    /** Convenience factory for the common apiKey + accountId setup. */
    static create(
        apiKey: string,
        accountId: string,
        options: Omit<AssinafyClientOptions, 'apiKey' | 'accountId'> = {},
    ): AssinafyClient {
        return new AssinafyClient({ apiKey, accountId, ...options });
    }

    /** Build a client from a plain object (supports snake_case and camelCase keys). */
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
        if (config.logger !== undefined) opts.logger = config.logger;
        return new AssinafyClient(opts);
    }

    /**
     * High-level helper that uploads a PDF, ensures it's processed, creates any
     * missing signers, and kicks off a virtual signature assignment.
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

        this.logger.info('Starting upload + signature workflow', {
            signerCount: options.signers.length,
        });

        const uploadOpts: { metadata?: Record<string, unknown>; accountId?: string } = {};
        if (options.metadata !== undefined) uploadOpts.metadata = options.metadata;
        if (options.accountId !== undefined) uploadOpts.accountId = options.accountId;

        const document = await this.documents.upload(options.source, uploadOpts);

        if (options.waitForReady !== false) {
            await this.documents.waitUntilReady(document.id);
        }

        const signerIds: string[] = [];
        for (const signer of options.signers) {
            const payload: ICreateSignerPayload = {
                full_name: signer.name,
                email: signer.email,
            };
            const phone = signer.whatsapp_phone_number ?? signer.phone;
            if (phone !== undefined) {
                payload.whatsapp_phone_number = phone;
            }
            if (signer.metadata !== undefined) {
                payload.metadata = signer.metadata;
            }
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

        this.logger.info('Upload + signature workflow completed', { documentId: document.id });

        return { document, assignment, signer_ids: signerIds };
    }

    /** Expose the underlying axios instance for advanced use cases (interceptors, custom endpoints). */
    getAxiosInstance(): AxiosInstance {
        return this.axiosInstance;
    }
}

function normaliseBaseUrl(raw: string): string {
    return raw.endsWith('/') ? raw.slice(0, -1) : raw;
}
