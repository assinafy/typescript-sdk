import type {
    IAssignment,
    ICostEstimate,
    ICreateAssignmentPayload,
    ICreateAssignmentResponse,
    IResendCostEstimate,
    IResendEmailResponse,
    IWhatsAppNotification,
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
): { id?: string; verification_method?: string; notification_methods?: string[]; step?: number } {
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
            step?: number;
        };
        const id = input.id ?? input.signer_id;
        const normalised = cleanParams({
            id,
            verification_method: input.verification_method,
            notification_methods: input.notification_methods,
            step: input.step,
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

    /**
     * Estimate the cost (in credits/documents) of creating the assignment.
     *
     * Signer entries may omit `id` and supply only `verification_method` /
     * `notification_methods` when only the channel mix matters for the estimate.
     *
     * @returns an {@link ICostEstimate} with `total_credits`, balances, and a
     * line-item `breakdown`.
     */
    async estimateCost(
        documentId: string,
        payload: ICreateAssignmentPayload,
    ): Promise<ICostEstimate> {
        const docId = this.requireId(documentId, 'Document ID');
        return this.call('Failed to estimate assignment cost', () =>
            this.http.post(
                `/documents/${docId}/assignments/estimate-cost`,
                buildAssignmentPayload(payload, { allowSignersWithoutId: true }),
            ),
        );
    }

    /**
     * Update the expiration date of an existing assignment.
     * Pass `null` to remove the expiration entirely.
     */
    async resetExpiration(
        documentId: string,
        assignmentId: string,
        expiresAt: string | null,
    ): Promise<IAssignment> {
        const docId = this.requireId(documentId, 'Document ID');
        const asgId = this.requireId(assignmentId, 'Assignment ID');
        // `null` is meaningful here ("no expiration"), so don't strip it.
        return this.call('Failed to update assignment expiration', () =>
            this.http.put(`/documents/${docId}/assignments/${asgId}/reset-expiration`, {
                expires_at: expiresAt,
            }),
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

    /**
     * Estimate the cost of resending a signer notification.
     *
     * @returns an {@link IResendCostEstimate} (`total`, `breakdown`, balances).
     */
    async estimateResendCost(
        documentId: string,
        assignmentId: string,
        signerId: string,
    ): Promise<IResendCostEstimate> {
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
     * `GET /documents/{documentId}/assignments/{assignmentId}/whatsapp-notifications`
     * — list every WhatsApp notification rendered + sent for an assignment.
     */
    async listWhatsAppNotifications(
        documentId: string,
        assignmentId: string,
    ): Promise<IWhatsAppNotification[]> {
        const docId = this.requireId(documentId, 'Document ID');
        const asgId = this.requireId(assignmentId, 'Assignment ID');
        return this.call('Failed to list WhatsApp notifications', () =>
            this.http.get(`/documents/${docId}/assignments/${asgId}/whatsapp-notifications`),
        );
    }
}
