import { describe, test, expect } from 'bun:test';
import {
    AssignmentResource,
    buildAssignmentEstimatePayload,
    buildAssignmentPayload,
} from './assignments';
import { ValidationError } from '../errors';
import type { AxiosInstance } from 'axios';

describe('buildAssignmentPayload', () => {
    test('rejects malformed payload objects with ValidationError', () => {
        expect(() => buildAssignmentPayload(null as never)).toThrow(ValidationError);
        expect(() => buildAssignmentEstimatePayload([] as never)).toThrow(ValidationError);
    });

    test('normalises string signer ids into {id} objects', () => {
        const body = buildAssignmentPayload({ signers: ['a', 'b'] });
        expect(body).toEqual({ method: 'virtual', signers: [{ id: 'a' }, { id: 'b' }] });
    });

    test('accepts legacy signer_ids and signerIds payloads', () => {
        expect(buildAssignmentPayload({ signer_ids: ['a'] })).toEqual({
            method: 'virtual',
            signers: [{ id: 'a' }],
        });
        expect(buildAssignmentPayload({ signerIds: ['b'] })).toEqual({
            method: 'virtual',
            signers: [{ id: 'b' }],
        });
    });

    test('accepts objects with id or signer_id', () => {
        const body = buildAssignmentPayload({
            signers: [{ id: 'a' }, { signer_id: 'b' }],
        });
        expect(body['signers']).toEqual([{ id: 'a' }, { id: 'b' }]);
        expect(buildAssignmentPayload({
            signers: [{ id: 'certificate-signer', verification_method: 'DigitalCertificate' }],
        })['signers']).toEqual([
            { id: 'certificate-signer', verification_method: 'DigitalCertificate' },
        ]);
    });

    test('forwards the sequential-signing step on signer objects', () => {
        const body = buildAssignmentPayload({
            signers: [
                { id: 'a', step: 1 },
                { id: 'b', verification_method: 'Whatsapp', notification_methods: ['Whatsapp'], step: 2 },
            ],
        });
        expect(body['signers']).toEqual([
            { id: 'a', step: 1 },
            { id: 'b', verification_method: 'Whatsapp', notification_methods: ['Whatsapp'], step: 2 },
        ]);
    });

    test('allows estimation payloads without signer ids when methods are supplied', () => {
        const body = buildAssignmentEstimatePayload({
            signers: [{ verification_method: 'DigitalCertificate' }, {}],
        });
        expect(body).toEqual({
            method: 'virtual',
            signers: [{ verification_method: 'DigitalCertificate' }, {}],
        });
    });

    test('projects collect entries and display settings to their exact wire fields', () => {
        const entries = [{
            page_id: 'page-1',
            internal_secret: 'do-not-send',
            fields: [{
                signer_id: 'signer-1',
                field_id: 'field-1',
                internal_secret: 'do-not-send',
                display_settings: {
                    left: 10,
                    top: 20,
                    width: 120,
                    height: 30,
                    fontSize: 12,
                    fontFamily: 'Arial',
                    backgroundColor: '#ffffff',
                    internal_secret: 'do-not-send',
                },
            }],
        }];
        const expectedEntries = [{
            page_id: 'page-1',
            fields: [{
                signer_id: 'signer-1',
                field_id: 'field-1',
                display_settings: {
                    left: 10,
                    top: 20,
                    width: 120,
                    height: 30,
                    fontSize: 12,
                    fontFamily: 'Arial',
                    backgroundColor: '#ffffff',
                },
            }],
        }];
        expect(buildAssignmentPayload({
            method: 'collect',
            signers: ['signer-1'],
            entries,
        })).toEqual({
            method: 'collect',
            signers: [{ id: 'signer-1' }],
            entries: expectedEntries,
        });
        expect(buildAssignmentEstimatePayload({
            method: 'collect',
            entries,
        })).toEqual({
            method: 'collect',
            entries: expectedEntries,
        });
    });

    test('allows collect estimates with entries and no signer list', () => {
        const body = buildAssignmentEstimatePayload({
            method: 'collect',
            entries: [{ page_id: 'page-1', fields: [] }],
        });
        expect(body).toEqual({
            method: 'collect',
            entries: [{ page_id: 'page-1', fields: [] }],
        });
    });

    test('requires entries for collect requests', () => {
        expect(() => buildAssignmentPayload({ method: 'collect', signers: ['a'] })).toThrow(
            ValidationError,
        );
    });

    test('rejects malformed collect entry trees', () => {
        const malformed = [
            null,
            [null],
            [{}],
            [{ page_id: 'page-1', fields: null }],
            [{ page_id: 'page-1', fields: [null] }],
            [{ page_id: 'page-1', fields: [{ signer_id: '', field_id: 'field-1' }] }],
            [{ page_id: 'page-1', fields: [{ signer_id: 'signer-1' }] }],
            [{
                page_id: 'page-1',
                fields: [{
                    signer_id: 'signer-1',
                    field_id: 'field-1',
                    display_settings: null,
                }],
            }],
            [{
                page_id: 'page-1',
                fields: [{
                    signer_id: 'signer-1',
                    field_id: 'field-1',
                    display_settings: {
                        left: 0,
                        top: 0,
                        width: 1,
                        height: 1,
                        fontSize: 1,
                        fontFamily: 123,
                    },
                }],
            }],
            [{
                page_id: 'page-1',
                fields: [{
                    signer_id: 'signer-1',
                    field_id: 'field-1',
                    display_settings: { left: 0 },
                }],
            }],
        ];
        for (const entries of malformed) {
            expect(() => buildAssignmentPayload({
                method: 'collect',
                signers: ['signer-1'],
                entries,
            } as never)).toThrow(ValidationError);
        }
    });

    test('rejects invalid methods, signer IDs, channels, steps, and copy receivers', () => {
        expect(() =>
            buildAssignmentPayload({ method: 'other' as never, signers: ['a'] }),
        ).toThrow(ValidationError);
        expect(() => buildAssignmentPayload({ signers: [' '] })).toThrow(ValidationError);
        expect(() =>
            buildAssignmentPayload({ signers: [{ id: 'a', step: 0 }] }),
        ).toThrow(ValidationError);
        expect(() =>
            buildAssignmentPayload({
                signers: [{ id: 'a', verification_method: 'SMS' as never }],
            }),
        ).toThrow(ValidationError);
        expect(() =>
            buildAssignmentPayload({
                signers: [{ id: 'a', notification_methods: ['SMS' as never] }],
            }),
        ).toThrow(ValidationError);
        expect(() =>
            buildAssignmentPayload({ signers: ['a'], copy_receivers: [''] }),
        ).toThrow(ValidationError);
        expect(() =>
            buildAssignmentPayload({ signers: ['a'], message: 42 as never }),
        ).toThrow(ValidationError);
        expect(() =>
            buildAssignmentPayload({
                signers: [{ id: 'a', step: 1 }, { id: 'b' }],
            }),
        ).toThrow(ValidationError);
        expect(() =>
            buildAssignmentPayload({
                signers: [{ id: 'a', step: 1 }, { id: 'b', step: 3 }],
            }),
        ).toThrow(ValidationError);
        expect(() =>
            buildAssignmentPayload({
                signers: [
                    { id: 'a', verification_method: 'DigitalCertificate' },
                    { id: 'b' },
                ],
            }),
        ).toThrow(ValidationError);
        expect(() =>
            buildAssignmentPayload({ signers: ['a'], expires_at: 'not-a-date' }),
        ).toThrow(ValidationError);
    });

    test('requires the method-specific cost-estimate inputs', () => {
        expect(() =>
            buildAssignmentEstimatePayload({ method: 'other' as never, signers: [{}] }),
        ).toThrow(ValidationError);
        expect(() => buildAssignmentEstimatePayload({ method: 'virtual' })).toThrow(
            ValidationError,
        );
        expect(() => buildAssignmentEstimatePayload({ method: 'collect' })).toThrow(
            ValidationError,
        );
        expect(() =>
            buildAssignmentEstimatePayload({
                signers: [{ verification_method: 'SMS' as never }],
            }),
        ).toThrow(ValidationError);
        expect(() =>
            buildAssignmentEstimatePayload({ signers: [null as never] }),
        ).toThrow(ValidationError);
    });

    test('estimate bodies project away create-only and signer identity fields', () => {
        const payload = {
            signers: [{ id: 'ignored', step: 3, verification_method: 'Email' }],
            message: 'ignored',
            expires_at: 'ignored',
            copy_receivers: ['ignored'],
        } as never;
        expect(buildAssignmentEstimatePayload(payload)).toEqual({
            method: 'virtual',
            signers: [{ verification_method: 'Email' }],
        });
        expect(buildAssignmentEstimatePayload({ signers: ['legacy-id'] } as never)).toEqual({
            method: 'virtual',
            signers: [{}],
        });
    });

    test('includes optional fields when provided', () => {
        const body = buildAssignmentPayload({
            signers: ['a'],
            message: 'hi',
            expires_at: '2027-12-31T23:59:00Z',
            copy_receivers: ['c'],
        });
        expect(body['message']).toBe('hi');
        expect(body['expires_at']).toBe('2027-12-31T23:59:00Z');
        expect(body['copy_receivers']).toEqual(['c']);
    });

    test('omits undefined optional fields', () => {
        const body = buildAssignmentPayload({ signers: ['a'] });
        expect('message' in body).toBe(false);
        expect('expires_at' in body).toBe(false);
    });

    test('throws on empty signers array', () => {
        expect(() => buildAssignmentPayload({ signers: [] })).toThrow(ValidationError);
    });

    test('throws on invalid signer reference', () => {
        expect(() => buildAssignmentPayload({ signers: [{} as never] })).toThrow(ValidationError);
    });
});

describe('AssignmentResource', () => {
    test('create posts to /documents/{id}/assignments with normalised body', async () => {
        let capturedUrl = '';
        let capturedBody: unknown;
        let logContext: Record<string, unknown> | undefined;
        const axiosMock = {
            post: async (url: string, body: unknown) => {
                capturedUrl = url;
                capturedBody = body;
                return { status: 200, data: { status: 200, data: { id: 'assignment-1' } } };
            },
        } as unknown as AxiosInstance;
        const logger = {
            debug: () => undefined,
            info: (_message: string, context?: Record<string, unknown>) => {
                logContext = context;
            },
            warn: () => undefined,
            error: () => undefined,
        };

        const resource = new AssignmentResource(axiosMock, 'acc', logger);
        const result = await resource.create('doc-1', { signers: ['s1', 's2'] });

        expect(capturedUrl).toBe('/documents/doc-1/assignments');
        expect(capturedBody).toEqual({
            method: 'virtual',
            signers: [{ id: 's1' }, { id: 's2' }],
        });
        expect(result).toEqual({ id: 'assignment-1' } as never);
        expect(logContext).toEqual({ signerCount: 2 });
    });

    test('resendNotification requires all three IDs', async () => {
        const axiosMock = {
            put: async () => ({ status: 200, data: { status: 200, data: {} } }),
        } as unknown as AxiosInstance;
        const resource = new AssignmentResource(axiosMock, 'acc');
        await expect(resource.resendNotification('', 'a', 's')).rejects.toThrow(ValidationError);
        await expect(resource.resendNotification('d', '', 's')).rejects.toThrow(ValidationError);
        await expect(resource.resendNotification('d', 'a', '')).rejects.toThrow(ValidationError);
    });

    test('estimateCost accepts signer descriptors without ids', async () => {
        let capturedBody: unknown;
        const axiosMock = {
            post: async (_url: string, body: unknown) => {
                capturedBody = body;
                return { status: 200, data: { status: 200, data: { total_credits: 0.45 } } };
            },
        } as unknown as AxiosInstance;

        const resource = new AssignmentResource(axiosMock, 'acc');
        await resource.estimateCost('doc-1', {
            signers: [{ verification_method: 'Whatsapp' }],
        });

        expect(capturedBody).toEqual({
            method: 'virtual',
            signers: [{ verification_method: 'Whatsapp' }],
        });
    });

    test('estimateCost accepts official collect payloads without signers', async () => {
        let capturedBody: unknown;
        const axiosMock = {
            post: async (_url: string, body: unknown) => {
                capturedBody = body;
                return { status: 200, data: { status: 200, data: { total_credits: 0 } } };
            },
        } as unknown as AxiosInstance;

        await new AssignmentResource(axiosMock, 'acc').estimateCost('doc-1', {
            method: 'collect',
            entries: [{ page_id: 'page-1', fields: [] }],
        });

        expect(capturedBody).toEqual({
            method: 'collect',
            entries: [{ page_id: 'page-1', fields: [] }],
        });
    });

    test('estimateCost returns the full ICostEstimate shape', async () => {
        const estimate = {
            documents: 1,
            credits: 0,
            needs_extra_document: false,
            extra_document_cost: 0,
            total_credits: 0,
            breakdown: [],
            document_balance: 67,
            credit_balance: 0,
            has_sufficient_resources: true,
            blocking_reason: null,
            message: null,
        };
        const axiosMock = {
            post: async () => ({ status: 200, data: { status: 200, data: estimate } }),
        } as unknown as AxiosInstance;
        const resource = new AssignmentResource(axiosMock, 'acc');
        const result = await resource.estimateCost('doc-1', { signers: [{}] });
        expect(result).toEqual(estimate);
        expect(result.has_sufficient_resources).toBe(true);
        expect(result.blocking_reason).toBeNull();
    });

    test('estimateResendCost returns the IResendCostEstimate shape', async () => {
        const estimate = {
            total: 0,
            breakdown: [{ code: 'NotificationEmailResend', name: 'Email Notification Resend', cost: 0 }],
            credit_balance: 0,
            has_sufficient_credits: true,
        };
        const axiosMock = {
            post: async () => ({ status: 200, data: { status: 200, data: estimate } }),
        } as unknown as AxiosInstance;
        const resource = new AssignmentResource(axiosMock, 'acc');
        const result = await resource.estimateResendCost('doc-1', 'asg-1', 's1');
        expect('total' in result).toBe(true);
        if (!('total' in result)) throw new Error('Expected the legacy resend-cost shape');
        expect(result.total).toBe(0);
        expect(result.breakdown[0]?.code).toBe('NotificationEmailResend');
    });

    test('create response exposes typed items, signers and array signing_urls', async () => {
        const liveShape = {
            resource: 'assignment',
            id: 'asg-1',
            method: 'virtual',
            expires_at: null,
            signers: [
                {
                    id: 's1',
                    full_name: 'A',
                    email: 'a@example.com',
                    completed: false,
                    notification_history: [],
                    verification_method: 'Email',
                    notification_methods: ['Email'],
                    step: 1,
                    notified: true,
                },
            ],
            items: [{ id: 'i1', page: null, signer: { id: 's1', full_name: 'A', email: 'a@example.com' }, field: { id: 'f1', name: 'Virtual', type: 'virtual', is_active: true }, value: null }],
            signing_urls: [{ signer_id: 's1', url: 'https://app/sign/abc' }],
        };
        const axiosMock = {
            post: async () => ({ status: 200, data: { status: 200, data: liveShape } }),
        } as unknown as AxiosInstance;
        const resource = new AssignmentResource(axiosMock, 'acc');
        const asg = await resource.create('doc-1', { signers: ['s1'] });
        // typed access compiles + matches the live wire shape
        expect(asg.signers[0]?.step).toBe(1);
        expect(asg.signers[0]?.notified).toBe(true);
        expect(asg.items?.[0]?.field?.type).toBe('virtual');
        expect(asg.signing_urls?.[0]).toEqual({ signer_id: 's1', url: 'https://app/sign/abc' });
    });

    test('keeps future server-side signer channel values representable', () => {
        type Signer = import('../types').IAssignmentSigner;
        const verification: Signer['verification_method'] = 'FutureVerificationMethod';
        const notifications: Signer['notification_methods'] = ['FutureNotificationChannel'];

        expect(verification).toBe('FutureVerificationMethod');
        expect(notifications).toEqual(['FutureNotificationChannel']);
    });

    test('resetExpiration puts the reset-expiration path with a non-null date', async () => {
        let capturedUrl = '';
        let capturedBody: unknown;
        const axiosMock = {
            put: async (url: string, body: unknown) => {
                capturedUrl = url;
                capturedBody = body;
                return { status: 200, data: { status: 200, data: { id: 'asg-1' } } };
            },
        } as unknown as AxiosInstance;

        const resource = new AssignmentResource(axiosMock, 'acc');
        await resource.resetExpiration('doc-1', 'asg-1', '2027-12-31T23:59:59Z');

        expect(capturedUrl).toBe('/documents/doc-1/assignments/asg-1/reset-expiration');
        expect(capturedBody).toEqual({ expires_at: '2027-12-31T23:59:59Z' });
    });

    test('resetExpiration keeps expires_at: null in the body (does not strip null)', async () => {
        let capturedUrl = '';
        let capturedBody: unknown;
        const axiosMock = {
            put: async (url: string, body: unknown) => {
                capturedUrl = url;
                capturedBody = body;
                return { status: 200, data: { status: 200, data: { id: 'asg-1' } } };
            },
        } as unknown as AxiosInstance;

        const resource = new AssignmentResource(axiosMock, 'acc');
        await resource.resetExpiration('doc-1', 'asg-1', null);

        expect(capturedUrl).toBe('/documents/doc-1/assignments/asg-1/reset-expiration');
        // `null` is meaningful ("no expiration") and must survive as an explicit key.
        expect(capturedBody).toEqual({ expires_at: null });
        expect('expires_at' in (capturedBody as Record<string, unknown>)).toBe(true);
    });

    test('resetExpiration requires both the document and assignment IDs', async () => {
        const axiosMock = {
            put: async () => ({ status: 200, data: { status: 200, data: {} } }),
        } as unknown as AxiosInstance;
        const resource = new AssignmentResource(axiosMock, 'acc');
        await expect(resource.resetExpiration('', 'asg-1', null)).rejects.toThrow(ValidationError);
        await expect(resource.resetExpiration('doc-1', '', null)).rejects.toThrow(ValidationError);
        await expect(
            resource.resetExpiration('doc-1', 'asg-1', 'not-a-date'),
        ).rejects.toThrow(ValidationError);
    });

    test('listWhatsAppNotifications gets the whatsapp-notifications path', async () => {
        let capturedUrl = '';
        const axiosMock = {
            get: async (url: string) => {
                capturedUrl = url;
                return { status: 200, data: { status: 200, data: [] } };
            },
        } as unknown as AxiosInstance;

        const resource = new AssignmentResource(axiosMock, 'acc');
        const result = await resource.listWhatsAppNotifications('doc-1', 'asg-1');

        expect(capturedUrl).toBe('/documents/doc-1/assignments/asg-1/whatsapp-notifications');
        expect(result).toEqual([]);
    });

    test('listWhatsAppNotifications requires both the document and assignment IDs', async () => {
        const axiosMock = {
            get: async () => ({ status: 200, data: { status: 200, data: [] } }),
        } as unknown as AxiosInstance;
        const resource = new AssignmentResource(axiosMock, 'acc');
        await expect(resource.listWhatsAppNotifications('', 'asg-1')).rejects.toThrow(ValidationError);
        await expect(resource.listWhatsAppNotifications('doc-1', '')).rejects.toThrow(ValidationError);
    });
});

describe('AssignmentResource.list', () => {
    const okList = { status: 200, data: { status: 200, data: [] }, headers: {} };

    test('sends the account as an `accountId` query param (not account_id)', async () => {
        let url = '';
        let params: Record<string, unknown> = {};
        const ax = {
            get: async (u: string, cfg: { params: Record<string, unknown> }) => {
                url = u;
                params = cfg.params;
                return okList;
            },
        } as unknown as AxiosInstance;
        await new AssignmentResource(ax, 'acc').list(
            { 'per-page': 20, accountId: 'attacker-account' } as never,
        );
        expect(url).toBe('/assignments');
        // The API 400s on account_id / X-Account-Id; only camelCase accountId works.
        expect(params).toEqual({ accountId: 'acc', 'per-page': 20 });
        expect(params['account_id']).toBeUndefined();
        expect(params['accountId']).toBe('acc');
    });

    test('honours an explicit accountId override', async () => {
        let params: Record<string, unknown> = {};
        const ax = {
            get: async (_u: string, cfg: { params: Record<string, unknown> }) => {
                params = cfg.params;
                return okList;
            },
        } as unknown as AxiosInstance;
        await new AssignmentResource(ax, 'acc').list({}, 'other-acc');
        expect(params['accountId']).toBe('other-acc');
    });

    test('throws ValidationError when no account ID is available', async () => {
        const ax = { get: async () => okList } as unknown as AxiosInstance;
        await expect(new AssignmentResource(ax).list()).rejects.toThrow(ValidationError);
    });
});

describe('AssignmentResource.resendNotification', () => {
    test('PUTs the signer resend endpoint without a request body and unwraps the result', async () => {
        let capturedUrl = '';
        let argumentCount = 0;
        const response = { is_sent: true, document_id: 'doc-1', signer_id: 'signer-1' };
        const http = {
            put: async (...args: unknown[]) => {
                capturedUrl = args[0] as string;
                argumentCount = args.length;
                return { status: 200, data: { status: 200, data: response } };
            },
        } as unknown as AxiosInstance;

        const result = await new AssignmentResource(http, 'acc').resendNotification(
            'doc-1',
            'assignment-1',
            'signer-1',
        );

        expect(capturedUrl).toBe(
            '/documents/doc-1/assignments/assignment-1/signers/signer-1/resend',
        );
        expect(argumentCount).toBe(1);
        expect(result).toEqual(response);
    });

    test('encodes every caller-controlled ID as one path segment', async () => {
        let capturedUrl = '';
        const ax = {
            put: async (url: string) => {
                capturedUrl = url;
                return {
                    status: 200,
                    data: {
                        status: 200,
                        data: { is_sent: true, document_id: 'doc/1', signer_id: 'signer/1' },
                    },
                };
            },
        } as unknown as AxiosInstance;

        await new AssignmentResource(ax, 'acc').resendNotification(
            'doc/1',
            'assignment/1',
            'signer/1',
        );
        expect(capturedUrl).toBe(
            '/documents/doc%2F1/assignments/assignment%2F1/signers/signer%2F1/resend',
        );
    });
});
