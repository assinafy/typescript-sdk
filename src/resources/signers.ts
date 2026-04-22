import type {
    ICreateSignerPayload,
    ICreateSignerResponse,
    ISigner,
    ISignerListResponse,
    IUpdateSignerPayload,
    IListParams,
} from '../types';
import { ValidationError } from '../errors';
import { cleanParams } from '../utils';
import { BaseResource } from './base';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class SignerResource extends BaseResource {
    /** Create a signer in the workspace. */
    async create(payload: ICreateSignerPayload, accountId?: string): Promise<ICreateSignerResponse> {
        this.assertEmail(payload.email);
        const id = this.accountId(accountId);
        const existing = await this.findByEmail(payload.email, id);
        if (existing) {
            this.logger.info('Using existing signer', { email: payload.email });
            return existing;
        }

        this.logger.info('Creating signer', { email: payload.email });
        try {
            return await this.call('Failed to create signer', () =>
                this.http.post(`/accounts/${id}/signers`, normalizeSignerPayload(payload)),
            );
        } catch (err) {
            if (looksLikeDuplicateSignerError(err)) {
                const duplicate = await this.findByEmail(payload.email, id);
                if (duplicate) {
                    this.logger.info('Signer already exists, using existing signer', {
                        email: payload.email,
                    });
                    return duplicate;
                }
            }
            throw err;
        }
    }

    /** Get a signer by ID. */
    get(signerId: string, accountId?: string): Promise<ISigner> {
        const id = this.accountId(accountId);
        const sid = this.requireId(signerId, 'Signer ID');
        return this.call('Failed to fetch signer', () =>
            this.http.get(`/accounts/${id}/signers/${sid}`),
        );
    }

    /** List signers for the workspace (supports `page`, `per_page`, `search`, `sort`). */
    list(params: IListParams = {}, accountId?: string): Promise<ISignerListResponse> {
        const id = this.accountId(accountId);
        return this.callList<ISigner>('Failed to list signers', () =>
            this.http.get(`/accounts/${id}/signers`, { params: cleanParams(params) }),
        );
    }

    /** Update a signer. Fails if the signer has active assignments. */
    update(
        signerId: string,
        payload: IUpdateSignerPayload,
        accountId?: string,
    ): Promise<ICreateSignerResponse> {
        const id = this.accountId(accountId);
        const sid = this.requireId(signerId, 'Signer ID');
        return this.call('Failed to update signer', () =>
            this.http.put(`/accounts/${id}/signers/${sid}`, normalizeSignerPayload(payload)),
        );
    }

    /** Delete a signer. */
    delete(signerId: string, accountId?: string): Promise<void> {
        const id = this.accountId(accountId);
        const sid = this.requireId(signerId, 'Signer ID');
        return this.callVoid('Failed to delete signer', () =>
            this.http.delete(`/accounts/${id}/signers/${sid}`),
        );
    }

    /** Find a signer by email via the API's `search` parameter. Returns `null` if none match. */
    async findByEmail(email: string, accountId?: string): Promise<ISigner | null> {
        this.assertEmail(email);
        try {
            const { data } = await this.list({ search: email, per_page: 100 }, accountId);
            const lower = email.toLowerCase();
            return data.find((s) => (s.email ?? '').toLowerCase() === lower) ?? null;
        } catch (err) {
            this.logger.warn('Error searching for signer by email', {
                email,
                error: err instanceof Error ? err.message : String(err),
            });
            return null;
        }
    }

    private assertEmail(email: string): void {
        if (!email || !EMAIL_RE.test(email)) {
            throw new ValidationError('Invalid email address', { email });
        }
    }
}

function normalizeSignerPayload(
    payload: (ICreateSignerPayload | IUpdateSignerPayload) & { phone?: string },
): Record<string, unknown> {
    const normalised: Record<string, unknown> = {
        full_name: payload.full_name,
        email: payload.email,
        whatsapp_phone_number: payload.whatsapp_phone_number ?? payload.phone,
    };

    if ('metadata' in payload) {
        normalised['metadata'] = payload.metadata;
    }

    return cleanParams(normalised);
}

function looksLikeDuplicateSignerError(err: unknown): boolean {
    const message = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
    return message.includes('already exists') || message.includes('já existe');
}
