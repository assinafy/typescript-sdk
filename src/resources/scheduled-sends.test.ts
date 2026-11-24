import { describe, expect, test } from 'bun:test';
import axios from 'axios';
import { AssinafyClient } from '../client';
import { ValidationError } from '../errors';
import { recordingHttp } from '../testing/recording-http';
import type { IScheduledSend } from '../types';
import { ScheduledSendResource } from './scheduled-sends';

const pending: IScheduledSend = {
    resource: 'scheduled_send', id: 'send-1', type: 'assignment', document_ids: ['doc-1'],
    status: 'pending', send_at: '2026-12-01T12:00:00Z', assignment_id: null,
    envelope_id: null, failure_reason: null, created_at: '2026-11-24T12:00:00Z', processed_at: null,
};

describe('ScheduledSendResource', () => {
    test('never replays schedule, cancel or immediate-send requests after a 429', async () => {
        const client = new AssinafyClient({ apiKey: 'test-key', accountId: 'acc', maxRetries: 2 });
        let calls = 0;
        client.getAxiosInstance().defaults.adapter = async (config) => {
            calls++;
            throw new axios.AxiosError('Too Many Requests', 'ERR_BAD_RESPONSE', config, {}, {
                status: 429, statusText: 'Too Many Requests', headers: { 'retry-after': '0' },
                data: {}, config,
            });
        };
        for (const operation of [
            () => client.scheduledSends.createAssignment('doc', { signers: ['signer'], send_at: 1_800_000_000 }),
            () => client.scheduledSends.createEnvelope({
                name: 'Agreement', signers: [{ id: 'signer' }],
                documents: [{ id: 'doc', signer_ids: ['signer'] }], send_at: 1_800_000_000,
            }),
            () => client.scheduledSends.cancel('send'),
            () => client.scheduledSends.sendNow('send'),
        ]) {
            const before = calls;
            await expect(operation()).rejects.toMatchObject({ statusCode: 429 });
            expect(calls).toBe(before + 1);
        }
    });

    test('the client exposes scheduled sends', () => {
        expect(new AssinafyClient().scheduledSends).toBeInstanceOf(ScheduledSendResource);
    });

    test('schedules normalized assignments, preserving Unix timestamps and null deadlines', async () => {
        const { http, calls } = recordingHttp(pending);
        const resource = new ScheduledSendResource(http);
        for (const expires_at of [undefined, null, 1_800_000_000, '2027-01-15T12:00:00']) {
            const payload = {
                signer_ids: ['signer-1'], send_at: 1_799_000_000,
                ...(expires_at === undefined ? {} : { expires_at }),
            };
            expect(await resource.createAssignment('doc/1', payload)).toEqual(pending);
            expect(calls.at(-1)).toEqual({
                method: 'POST', url: '/documents/doc%2F1/scheduled-sends', config: undefined,
                body: { method: 'virtual', signers: [{ id: 'signer-1' }], send_at: payload.send_at,
                    ...(expires_at === undefined ? {} : { expires_at }) },
            });
        }
    });

    test('schedules envelopes with shared validation and no idempotency header', async () => {
        const { http, calls } = recordingHttp({ ...pending, type: 'envelope' });
        const resource = new ScheduledSendResource(http, 'default');
        const payload = {
            name: 'Agreement', signers: [{ id: 'signer-1' }],
            documents: [{ id: 'doc-1', signer_ids: ['signer-1'], expires_at: null }],
            send_at: '2026-12-01T12:00:00', max_total_credits: 0,
        };
        expect((await resource.createEnvelope(payload, 'acc/1')).type).toBe('envelope');
        expect(calls).toEqual([{
            method: 'POST', url: '/accounts/acc%2F1/scheduled-sends', config: undefined,
            body: { ...payload, documents: [{ ...payload.documents[0], method: 'virtual' }] },
        }]);
    });

    test('lists, cancels and sends on the correct paths without mutation bodies', async () => {
        const { http, calls } = recordingHttp([pending]);
        const resource = new ScheduledSendResource(http, 'acc');
        expect(await resource.list()).toEqual({ data: [pending] });
        await resource.list({ document_id: 'doc-1', per_page: 5 }, 'other');
        await resource.cancel('send/1');
        await resource.sendNow('send/1', 'other');
        expect(calls).toEqual([
            { method: 'GET', url: '/accounts/acc/scheduled-sends', config: { params: {} } },
            { method: 'GET', url: '/accounts/other/scheduled-sends', config: { params: { document_id: 'doc-1', 'per-page': 5 } } },
            { method: 'PUT', url: '/accounts/acc/scheduled-sends/send%2F1/cancel', body: undefined, config: undefined },
            { method: 'PUT', url: '/accounts/other/scheduled-sends/send%2F1/send', body: undefined, config: undefined },
        ]);
    });

    test('rejects invalid inputs before dispatch, including shared paid-channel rules', async () => {
        const { http, calls } = recordingHttp();
        const resource = new ScheduledSendResource(http, 'acc');
        for (const value of [undefined, null, '', 'bad', '2027-02-29', NaN, Infinity, -1, 1.5, {}, []]) {
            await expect(resource.createAssignment('d', { signers: ['s'], send_at: value as never })).rejects.toBeInstanceOf(ValidationError);
        }
        for (const operation of [
            () => resource.createAssignment('d', null as never),
            () => resource.createEnvelope(null as never),
            () => resource.createAssignment('d', { signers: [], send_at: 1_800_000_000 }),
            () => resource.createAssignment('d', { signers: ['s'], send_at: 1_800_000_000, expires_at: -1 }),
            () => resource.createAssignment('d', { send_at: 1_800_000_000, signers: [{ id: 's', verification_method: 'Email', notification_methods: ['Whatsapp'] }] }),
            () => resource.createEnvelope({ name: 'Agreement', signers: [{ id: 's' }], documents: [{ id: 'd', signer_ids: ['s'], method: 'collect' }], send_at: 1_800_000_000 }),
            () => resource.list(null as never),
            () => resource.list({ document_id: '' }),
            () => resource.cancel('..'),
            () => resource.sendNow(''),
            () => new ScheduledSendResource(http).list(),
        ]) await expect(operation()).rejects.toBeInstanceOf(ValidationError);
        expect(calls).toHaveLength(0);
    });
});
