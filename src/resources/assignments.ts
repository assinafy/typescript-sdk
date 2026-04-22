import type {
    IAssignment,
    ICreateAssignmentPayload,
    ICreateAssignmentResponse,
    IResendEmailResponse,
    SignerReference,
} from '../types';
import { ValidationError } from '../errors';
import { cleanParams } from '../utils';
import { BaseResource } from './base';

/**
 * Normalise an assignment payload into the shape the API expects:
 * `signers: [{ id }]` plus optional docs-level fields.
 */
export function buildAssignmentPayload(
    payload: ICreateAssignmentPayload,
    options: { allowSignersWithoutId?: boolean } = {},
): Record<string, unknown> {
    const signers = extractSignerRefs(payload);
    if (signers.length === 0) {
        throw new ValidationError('At least one signer is required', {
            signers: payload.signers ?? payload.signer_ids ?? payload.signerIds,
        });
    }

    return cleanParams({
        method: payload.method ?? 'virtual',
        signers: signers.map((ref) => normaliseSignerRef(ref, options)),
        message: payload.message,
        expires_at: payload.expires_at,
        copy_receivers: payload.copy_receivers,
        entries: payload.entries,
    });
}

function extractSignerRefs(payload: ICreateAssignmentPayload): SignerReference[] {
    if (Array.isArray(payload.signers) && payload.signers.length > 0) {
        return payload.signers;
    }

    const legacy = payload.signer_ids ?? payload.signerIds;
    return Array.isArray(legacy) ? legacy : [];
}

function normaliseSignerRef(
    ref: SignerReference,
    options: { allowSignersWithoutId?: boolean },
): { id?: string; verification_method?: string; notification_methods?: string[] } {
    if (typeof ref === 'string') {
        if (!ref) throw new ValidationError('Signer ID cannot be empty');
        return { id: ref };
    }
    if (ref && typeof ref === 'object') {
        const input = ref as {
            id?: string;
            signer_id?: string;
            verification_method?: string;
            notification_methods?: string[];
        };
        const id = input.id ?? input.signer_id;
        const normalised = cleanParams({
            id,
            verification_method: input.verification_method,
            notification_methods: input.notification_methods,
        });

        if (typeof id === 'string' && id.length > 0) {
            return normalised as { id: string; verification_method?: string; notification_methods?: string[] };
        }

        if (options.allowSignersWithoutId && Object.keys(normalised).length > 0) {
            return normalised as { verification_method?: string; notification_methods?: string[] };
        }

        if (options.allowSignersWithoutId && Object.keys(normalised).length === 0) {
            return {};
        }
    }
    throw new ValidationError('Invalid signer reference', { ref: ref as unknown });
}

export class AssignmentResource extends BaseResource {
    /** Create a signing assignment for a document. */
    async create(
        documentId: string,
        payload: ICreateAssignmentPayload,
    ): Promise<ICreateAssignmentResponse> {
        const docId = this.requireId(documentId, 'Document ID');
        const signers = extractSignerRefs(payload);
        const body = buildAssignmentPayload(payload);
        this.logger.info('Creating assignment', {
            documentId: docId,
            signers: signers.length,
        });
        return this.call('Failed to create assignment', () =>
            this.http.post(`/documents/${docId}/assignments`, body),
        );
    }

    /** Estimate the cost (in credits) of creating the assignment. */
    async estimateCost(
        documentId: string,
        payload: ICreateAssignmentPayload,
    ): Promise<Record<string, unknown>> {
        const docId = this.requireId(documentId, 'Document ID');
        return this.call('Failed to estimate assignment cost', () =>
            this.http.post(
                `/documents/${docId}/assignments/estimate-cost`,
                buildAssignmentPayload(payload, { allowSignersWithoutId: true }),
            ),
        );
    }

    /** Update the expiration date of an existing assignment. */
    async resetExpiration(
        documentId: string,
        assignmentId: string,
        expiresAt: string,
    ): Promise<IAssignment> {
        const docId = this.requireId(documentId, 'Document ID');
        const asgId = this.requireId(assignmentId, 'Assignment ID');
        return this.call('Failed to update assignment expiration', () =>
            this.http.put(
                `/documents/${docId}/assignments/${asgId}/reset-expiration`,
                cleanParams({ expires_at: expiresAt }),
            ),
        );
    }

    /** Resend the signing notification to a single signer. */
    async resendNotification(
        documentId: string,
        assignmentId: string,
        signerId: string,
    ): Promise<IResendEmailResponse> {
        const docId = this.requireId(documentId, 'Document ID');
        const asgId = this.requireId(assignmentId, 'Assignment ID');
        const sid = this.requireId(signerId, 'Signer ID');
        return this.call('Failed to resend signer notification', () =>
            this.http.put(`/documents/${docId}/assignments/${asgId}/signers/${sid}/resend`),
        );
    }

    /** Estimate the cost of resending a signer notification. */
    async estimateResendCost(
        documentId: string,
        assignmentId: string,
        signerId: string,
    ): Promise<Record<string, unknown>> {
        const docId = this.requireId(documentId, 'Document ID');
        const asgId = this.requireId(assignmentId, 'Assignment ID');
        const sid = this.requireId(signerId, 'Signer ID');
        return this.call('Failed to estimate resend cost', () =>
            this.http.post(
                `/documents/${docId}/assignments/${asgId}/signers/${sid}/estimate-resend-cost`,
            ),
        );
    }

    /**
     * Cancel a signature request. This endpoint is not listed in the public
     * Swagger but is exposed by the platform.
     */
    async cancel(documentId: string, reason: string, accountId?: string): Promise<unknown> {
        const docId = this.requireId(documentId, 'Document ID');
        const accId = this.accountId(accountId);
        this.logger.info('Cancelling signature request', { documentId: docId, reason });
        return this.call('Failed to cancel signature request', () =>
            this.http.post(
                `/accounts/${accId}/signature-requests/${docId}/cancel`,
                { document_id: docId, reason },
            ),
        );
    }
}
