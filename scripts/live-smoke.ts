/**
 * Redaction-safe integration suite for the Assinafy API.
 *
 * Read-only checks:
 *   ASSINAFY_BASE_URL=... ASSINAFY_API_KEY=... ASSINAFY_ACCOUNT_ID=... \
 *     bun scripts/live-smoke.ts
 *
 * Full disposable-workspace checks (sandbox only by default):
 *   ASSINAFY_BASE_URL=... ASSINAFY_API_KEY=... ASSINAFY_ACCOUNT_ID=... \
 *   ASSINAFY_TEST_EMAIL_PRIMARY=... ASSINAFY_TEST_EMAIL_SECONDARY=... \
 *     bun scripts/live-smoke.ts --all
 *
 * The script intentionally never prints credentials, resource IDs, names,
 * e-mail addresses, webhook URLs, response bodies, request payloads, or raw
 * error messages. Every fixture is generated in memory and every mutable
 * resource is created inside a disposable workspace that is force-deleted in
 * `finally`.
 */

import { createHash, randomBytes } from 'node:crypto';
import {
    ApiError,
    AssinafyClient,
    AssinafyError,
    type ICreateAssignmentPayload,
    type IDocumentDetailsResponse,
    type ITemplateDetailsResponse,
    type ITemplateSigner,
} from '../src';

const SANDBOX_HOST = 'sandbox.assinafy.com.br';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TEMPLATE_WAIT_MS = 90_000;
const DISPATCH_WAIT_MS = 20_000;
// The sandbox allows 120 requests/minute; leave headroom for polling calls.
const INTEGRATION_STEP_INTERVAL_MS = 650;

type AuditStatus = 'PASS' | 'FAIL' | 'SKIP';

interface AuditRecord {
    label: string;
    status: AuditStatus;
}

type StepResult<T> = { ok: true; value: T } | { ok: false };

interface AuditConfig {
    accountId: string;
    apiKey: string;
    baseUrl: string;
    fullAudit: boolean;
    primaryEmail: string | undefined;
    secondaryEmail: string | undefined;
    webhookUrl: string | undefined;
    loginEmail: string | undefined;
    loginPassword: string | undefined;
    signerAccessCode: string | undefined;
    signerOtp: string | undefined;
    publicDocumentId: string | undefined;
}

interface SandboxState {
    workspaceId: string | undefined;
    client: AssinafyClient | undefined;
    webhookActive: boolean;
    documents: Set<string>;
    templates: Set<string>;
    tags: Set<string>;
    fields: Set<string>;
    signers: Set<string>;
}

class AuditAssertionError extends Error {}
class AuditConfigurationError extends Error {}

class Reporter {
    private readonly records: AuditRecord[] = [];
    private nextStepAt = 0;

    async step<T>(label: string, operation: () => Promise<T>): Promise<StepResult<T>> {
        try {
            await this.pace();
            const value = await operation();
            this.record('PASS', label);
            return { ok: true, value };
        } catch (error) {
            this.record('FAIL', label, safeFailure(error));
            return { ok: false };
        }
    }

    async stepWithKnownApiStatusSkip<T>(
        label: string,
        statusCode: number,
        reason: string,
        operation: () => Promise<T>,
    ): Promise<StepResult<T>> {
        try {
            await this.pace();
            const value = await operation();
            this.record('PASS', label);
            return { ok: true, value };
        } catch (error) {
            if (error instanceof ApiError && error.statusCode === statusCode) {
                this.record('SKIP', label, reason);
                return { ok: false };
            }
            this.record('FAIL', label, safeFailure(error));
            return { ok: false };
        }
    }

    skip(label: string, reason: string): void {
        this.record('SKIP', label, reason);
    }

    finish(): boolean {
        const passed = this.records.filter((record) => record.status === 'PASS').length;
        const failed = this.records.filter((record) => record.status === 'FAIL').length;
        const skipped = this.records.filter((record) => record.status === 'SKIP').length;
        console.log(`SUMMARY PASS=${passed} FAIL=${failed} SKIP=${skipped}`);
        return failed === 0;
    }

    private record(status: AuditStatus, label: string, note?: string): void {
        this.records.push({ status, label });
        console.log(note ? `${status} ${label} (${note})` : `${status} ${label}`);
    }

    private async pace(): Promise<void> {
        const waitMs = this.nextStepAt - Date.now();
        if (waitMs > 0) await delay(waitMs);
        this.nextStepAt = Date.now() + INTEGRATION_STEP_INTERVAL_MS;
    }
}

function safeFailure(error: unknown): string {
    if (error instanceof ApiError) return `HTTP ${error.statusCode}`;
    if (error instanceof AuditAssertionError) return 'contract assertion failed';
    if (error instanceof AuditConfigurationError) return 'configuration rejected';
    if (error instanceof AssinafyError) return 'SDK operation failed';
    return 'unexpected failure';
}

function assertCondition(condition: unknown): asserts condition {
    if (!condition) throw new AuditAssertionError();
}

function assertId(value: unknown): asserts value is string {
    assertCondition(typeof value === 'string' && value.length > 0);
}

function assertBuffer(value: unknown): asserts value is Buffer {
    assertCondition(Buffer.isBuffer(value) && value.byteLength > 0);
}

function assertArray(value: unknown): asserts value is unknown[] {
    assertCondition(Array.isArray(value));
}

function requiredEnv(name: string): string {
    const value = process.env[name]?.trim();
    if (!value) throw new AuditConfigurationError();
    return value;
}

function optionalEnv(name: string): string | undefined {
    const value = process.env[name]?.trim();
    return value || undefined;
}

function loadConfig(): AuditConfig {
    const args = new Set(process.argv.slice(2));
    const allowed = new Set(['--all', '--confirm-production']);
    if ([...args].some((argument) => !allowed.has(argument))) {
        throw new AuditConfigurationError();
    }

    const baseUrl = requiredEnv('ASSINAFY_BASE_URL').replace(/\/+$/, '');
    let parsedBaseUrl: URL;
    try {
        parsedBaseUrl = new URL(baseUrl);
    } catch {
        throw new AuditConfigurationError();
    }
    if (
        parsedBaseUrl.protocol !== 'https:' ||
        parsedBaseUrl.username ||
        parsedBaseUrl.password ||
        parsedBaseUrl.search ||
        parsedBaseUrl.hash ||
        !/^\/v1\/?$/.test(parsedBaseUrl.pathname)
    ) {
        throw new AuditConfigurationError();
    }

    const fullAudit = args.has('--all');
    const confirmProduction = args.has('--confirm-production');
    if (
        fullAudit &&
        parsedBaseUrl.host.toLowerCase() !== SANDBOX_HOST &&
        !confirmProduction
    ) {
        throw new AuditConfigurationError();
    }

    const primaryEmail = optionalEnv('ASSINAFY_TEST_EMAIL_PRIMARY');
    const secondaryEmail = optionalEnv('ASSINAFY_TEST_EMAIL_SECONDARY');
    if (fullAudit && (!primaryEmail || !secondaryEmail)) {
        throw new AuditConfigurationError();
    }
    for (const email of [primaryEmail, secondaryEmail]) {
        if (email !== undefined && !EMAIL_RE.test(email)) throw new AuditConfigurationError();
    }

    const webhookUrl = optionalEnv('ASSINAFY_TEST_WEBHOOK_URL');
    if (webhookUrl !== undefined) validateFixtureUrl(webhookUrl);

    const loginEmail = optionalEnv('ASSINAFY_TEST_LOGIN_EMAIL');
    const loginPassword = optionalEnv('ASSINAFY_TEST_LOGIN_PASSWORD');
    if ((loginEmail === undefined) !== (loginPassword === undefined)) {
        throw new AuditConfigurationError();
    }
    if (loginEmail !== undefined && !EMAIL_RE.test(loginEmail)) {
        throw new AuditConfigurationError();
    }

    return {
        accountId: requiredEnv('ASSINAFY_ACCOUNT_ID'),
        apiKey: requiredEnv('ASSINAFY_API_KEY'),
        baseUrl,
        fullAudit,
        primaryEmail,
        secondaryEmail,
        webhookUrl,
        loginEmail,
        loginPassword,
        signerAccessCode: optionalEnv('ASSINAFY_SIGNER_ACCESS_CODE'),
        signerOtp: optionalEnv('ASSINAFY_SIGNER_OTP'),
        publicDocumentId: optionalEnv('ASSINAFY_PUBLIC_DOCUMENT_ID'),
    };
}

function validateFixtureUrl(value: string): void {
    let url: URL;
    try {
        url = new URL(value);
    } catch {
        throw new AuditConfigurationError();
    }
    if (url.protocol !== 'https:' || url.username || url.password) {
        throw new AuditConfigurationError();
    }
}

function makePdf(): Buffer {
    const stream = 'BT /F1 12 Tf 72 720 Td (Assinafy SDK integration test) Tj ET\n';
    const objects = [
        '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
        '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
        '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n',
        `4 0 obj\n<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream\nendobj\n`,
        '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
    ];
    const chunks: Buffer[] = [Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'binary')];
    const offsets: number[] = [];
    let offset = chunks[0]?.byteLength ?? 0;

    for (const object of objects) {
        offsets.push(offset);
        const chunk = Buffer.from(object, 'utf8');
        chunks.push(chunk);
        offset += chunk.byteLength;
    }

    const xrefOffset = offset;
    const xref = [
        'xref\n0 6\n',
        '0000000000 65535 f \n',
        ...offsets.map((value) => `${String(value).padStart(10, '0')} 00000 n \n`),
        'trailer\n<< /Size 6 /Root 1 0 R >>\n',
        `startxref\n${xrefOffset}\n%%EOF\n`,
    ].join('');
    chunks.push(Buffer.from(xref, 'utf8'));
    return Buffer.concat(chunks);
}

function makePng(): Buffer {
    return Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        'base64',
    );
}

function randomLabel(prefix: string): string {
    return `${prefix}-${Date.now()}-${randomBytes(6).toString('hex')}`;
}

function currentMonth(): string {
    return new Date().toISOString().slice(0, 7);
}

function delay(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function runGlobalReads(
    config: AuditConfig,
    client: AssinafyClient,
    reporter: Reporter,
): Promise<void> {
    await reporter.step('authentication.oauth-start-url', async () => {
        const url = new URL(client.auth.getSocialLoginUrl('google'));
        assertCondition(url.protocol === 'https:');
    });
    await reporter.step('authentication.oauth-callback-url', async () => {
        const url = new URL(client.auth.getSocialLoginCallbackUrl());
        assertCondition(url.protocol === 'https:');
    });
    await reporter.step('authentication.api-key-read', async () => {
        await client.auth.getApiKey();
    });

    if (config.loginEmail && config.loginPassword) {
        await reporter.step('authentication.password-login', async () => {
            const result = await client.auth.login(config.loginEmail!, config.loginPassword!);
            assertCondition(typeof result.access_token === 'string' && result.access_token.length > 0);
        });
    } else {
        reporter.skip('authentication.password-login', 'login fixture not supplied');
    }
    reporter.skip('authentication.password-management', 'password mutation fixture not supplied');
    reporter.skip('authentication.api-key-rotation', 'credential rotation is intentionally isolated');
    reporter.skip('authentication.social-provider-login', 'provider token fixture not supplied');
    reporter.skip('authentication.social-provider-link', 'provider-link fixture not supplied');

    await reporter.step('users.self', async () => {
        const user = await client.users.getCurrent();
        assertId(user.id);
    });
    const notificationPreferences = await reporter.stepWithKnownApiStatusSkip(
        'users.notification-preferences-read',
        404,
        'official route is not deployed in sandbox',
        async () => {
            const preferences = await client.users.getNotificationPreferences();
            assertCondition(
                Object.keys(preferences).length === 9 &&
                Object.values(preferences).every((value) => typeof value === 'boolean'),
            );
            return preferences;
        },
    );
    if (config.fullAudit && notificationPreferences.ok) {
        await reporter.step('users.notification-preferences-update-noop', async () => {
            const updated = await client.users.updateNotificationPreferences(
                notificationPreferences.value,
            );
            assertCondition(
                Object.keys(updated).length === 9 &&
                Object.values(updated).every((value) => typeof value === 'boolean'),
            );
        });
    } else {
        reporter.skip(
            'users.notification-preferences-update-noop',
            config.fullAudit ? 'preference read fixture unavailable' : 'read-only mode',
        );
    }
    await reporter.stepWithKnownApiStatusSkip(
        'users.stats-monthly',
        404,
        'official route is not deployed in sandbox',
        async () => {
            assertArray(await client.users.getStats());
        },
    );
    await reporter.stepWithKnownApiStatusSkip(
        'users.stats-daily',
        404,
        'official route is not deployed in sandbox',
        async () => {
            assertArray(
                await client.users.getStats({ granularity: 'daily', month: currentMonth() }),
            );
        },
    );

    await reporter.step('workspaces.list', async () => {
        const result = await client.workspaces.list();
        assertArray(result.data);
    });
    await reporter.step('workspaces.get-source', async () => {
        const workspace = await client.workspaces.get(config.accountId);
        assertId(workspace.id);
    });
    await reporter.step('workspaces.theme-source', async () => {
        const theme = await client.workspaces.getTheme(config.accountId);
        assertCondition(typeof theme.account_name === 'string');
    });
    await reporter.stepWithKnownApiStatusSkip(
        'workspaces.stats-source-monthly',
        404,
        'official route is not deployed in sandbox',
        async () => {
            assertArray(await client.workspaces.getStats(config.accountId));
        },
    );
    await reporter.stepWithKnownApiStatusSkip(
        'workspaces.stats-source-daily',
        404,
        'official route is not deployed in sandbox',
        async () => {
            assertArray(
                await client.workspaces.getStats(config.accountId, {
                    granularity: 'daily',
                    month: currentMonth(),
                }),
            );
        },
    );

    await reporter.step('documents.statuses', async () => {
        assertArray(await client.documents.statuses());
    });
    await reporter.step('documents.verify-public', async () => {
        const verification = await client.documents.verify('0000000000000000000000000000000000000000');
        assertCondition(typeof verification.is_valid === 'boolean');
    });
    await reporter.step('fields.types', async () => {
        assertArray(await client.fields.listTypes());
    });
    await reporter.step('webhooks.event-types', async () => {
        assertArray(await client.webhooks.listEventTypes());
    });

    await runOptionalSignerReads(config, client, reporter);
}

async function runOptionalSignerReads(
    config: AuditConfig,
    client: AssinafyClient,
    reporter: Reporter,
): Promise<void> {
    const accessCode = config.signerAccessCode;
    if (!accessCode) {
        reporter.skip('signer-documents.read-suite', 'signer access-code fixture not supplied');
        reporter.skip('signer-documents.verify-otp', 'signer OTP fixture not supplied');
        reporter.skip('signer-documents.legal-and-signing-mutations', 'legal mutation fixture not supplied');
        return;
    }

    const self = await reporter.step('signer-documents.self', async () => {
        const signer = await client.signerDocuments.self(accessCode);
        assertId(signer.id);
        return signer;
    });
    if (!self.ok) {
        reporter.skip('signer-documents.list', 'signer profile was unavailable');
        reporter.skip('signer-documents.search', 'signer profile was unavailable');
        reporter.skip('signer-documents.current', 'signer profile was unavailable');
    } else {
        const signerId = self.value.id;
        const listed = await reporter.step('signer-documents.list', async () => {
            const result = await client.signerDocuments.list(signerId, accessCode, { 'per-page': 5 });
            assertArray(result.data);
            return result.data;
        });
        await reporter.step('signer-documents.search', async () => {
            const result = await client.signerDocuments.search(signerId, accessCode);
            assertArray(result.data);
        });

        const firstDocument = listed.ok ? listed.value[0] : undefined;
        if (firstDocument) {
            await reporter.step('signer-documents.current', async () => {
                const document = await client.signerDocuments.getCurrent(signerId, accessCode);
                assertId(document.id);
            });
            await reporter.step('signer-documents.download-original', async () => {
                assertBuffer(
                    await client.signerDocuments.download(
                        signerId,
                        firstDocument.id,
                        'original',
                    ),
                );
            });
        } else {
            reporter.skip('signer-documents.current', 'no signer document fixture exists');
            reporter.skip('signer-documents.download-original', 'no signer document fixture exists');
        }

        if (self.value.has_signature) {
            await reporter.step('signer-documents.download-signature', async () => {
                assertBuffer(await client.signerDocuments.downloadSignature(accessCode));
            });
        } else {
            reporter.skip('signer-documents.download-signature', 'stored signature fixture not present');
        }
    }

    if (config.signerOtp) {
        await reporter.step('signer-documents.verify-otp', async () => {
            await client.signerDocuments.verifyEmail({
                signerAccessCode: accessCode,
                verificationCode: config.signerOtp!,
            });
        });
    } else {
        reporter.skip('signer-documents.verify-otp', 'signer OTP fixture not supplied');
    }
    reporter.skip('signer-documents.accept-terms', 'explicit legal-consent fixture not supplied');
    reporter.skip('signer-documents.confirm-data', 'identity mutation fixture not supplied');
    reporter.skip('signer-documents.upload-signature', 'signature mutation fixture not supplied');
    reporter.skip('signer-documents.assignment-read', 'accepted-terms fixture not supplied');
    reporter.skip('signer-documents.sign', 'field-value signing fixture not supplied');
    reporter.skip('signer-documents.sign-multiple', 'reusable-signature fixture not supplied');
    reporter.skip('signer-documents.decline', 'decline authorization fixture not supplied');
    reporter.skip('signer-documents.decline-multiple', 'decline authorization fixture not supplied');
}

async function runReadOnlyAccountAudit(
    config: AuditConfig,
    client: AssinafyClient,
    reporter: Reporter,
): Promise<void> {
    await reporter.step('documents.list', async () => {
        const result = await client.documents.list({ 'per-page': 5 });
        assertArray(result.data);
    });
    await reporter.step('documents.search', async () => {
        const result = await client.documents.search({ 'per-page': 5 });
        assertArray(result.data);
    });
    await reporter.step('assignments.list', async () => {
        const result = await client.assignments.list({ 'per-page': 5 });
        assertArray(result.data);
    });
    await reporter.step('signers.list', async () => {
        const result = await client.signers.list({ 'per-page': 5 });
        assertArray(result.data);
    });
    await reporter.step('tags.list', async () => {
        assertArray(await client.tags.list());
    });
    await reporter.step('fields.list', async () => {
        assertArray(await client.fields.list({ include_inactive: true, include_standard: true }));
    });
    await reporter.step('templates.list', async () => {
        const result = await client.templates.list({ 'per-page': 5 });
        assertArray(result.data);
    });
    await reporter.step('webhooks.get', async () => {
        await client.webhooks.get();
    });
    await reporter.step('webhooks.dispatches', async () => {
        const result = await client.webhooks.listDispatches({ 'per-page': 5 });
        assertArray(result.data);
    });

    if (config.publicDocumentId) {
        await reporter.step('documents.public', async () => {
            const document = await client.documents.getPublic(config.publicDocumentId!);
            assertId(document.id);
        });
    } else {
        reporter.skip('documents.public', 'public document fixture not supplied');
    }
    reporter.skip('workspaces.logo-download-source', 'existing logo fixture not declared');
    reporter.skip('webhooks.retry-dispatch', 'read-only mode does not retry deliveries');
}

async function runFullSandboxAudit(
    config: AuditConfig,
    rootClient: AssinafyClient,
    reporter: Reporter,
): Promise<void> {
    assertCondition(config.primaryEmail && config.secondaryEmail);
    const primaryEmail = config.primaryEmail;
    const secondaryEmail = config.secondaryEmail;
    const pdf = makePdf();
    const png = makePng();
    const state: SandboxState = {
        workspaceId: undefined,
        client: undefined,
        webhookActive: false,
        documents: new Set(),
        templates: new Set(),
        tags: new Set(),
        fields: new Set(),
        signers: new Set(),
    };

    try {
        const workspaceCreated = await reporter.step('workspaces.create-disposable', async () => {
            const workspace = await rootClient.workspaces.create({
                name: randomLabel('sdk-integration-test'),
            });
            assertId(workspace.id);
            return workspace;
        });
        if (!workspaceCreated.ok) {
            reporter.skip('sandbox.mutable-resource-suite', 'disposable workspace was not created');
            return;
        }

        state.workspaceId = workspaceCreated.value.id;
        state.client = new AssinafyClient({
            apiKey: config.apiKey,
            accountId: state.workspaceId,
            baseUrl: config.baseUrl,
        });
        const client = state.client;
        const workspaceId = state.workspaceId;

        await reporter.step('workspaces.get-disposable', async () => {
            const workspace = await client.workspaces.get(workspaceId);
            assertCondition(workspace.id === workspaceId);
        });
        await reporter.step('workspaces.update-disposable', async () => {
            const workspace = await client.workspaces.update(workspaceId, {
                name: randomLabel('sdk-integration-test-updated'),
            });
            assertCondition(workspace.id === workspaceId);
        });
        await reporter.step('workspaces.update-notification-sender', async () => {
            const workspace = await client.workspaces.update(workspaceId, {
                notification_sender_type: 'Account',
            });
            assertCondition(workspace.id === workspaceId);
        });
        await reporter.step('workspaces.update-brand-colors-extension', async () => {
            const workspace = await client.workspaces.update(workspaceId, {
                primary_color: '2255aa',
                secondary_color: '11aa77',
            });
            assertCondition(workspace.id === workspaceId);
        });
        await reporter.step('workspaces.theme-disposable', async () => {
            const theme = await client.workspaces.getTheme(workspaceId);
            assertCondition(typeof theme.account_name === 'string');
        });
        await reporter.stepWithKnownApiStatusSkip(
            'workspaces.stats-disposable-monthly',
            404,
            'official route is not deployed in sandbox',
            async () => {
                assertArray(await client.workspaces.getStats(workspaceId));
            },
        );
        await reporter.stepWithKnownApiStatusSkip(
            'workspaces.stats-disposable-daily',
            404,
            'official route is not deployed in sandbox',
            async () => {
                assertArray(
                    await client.workspaces.getStats(workspaceId, {
                        granularity: 'daily',
                        month: currentMonth(),
                    }),
                );
            },
        );

        const logoUploaded = await reporter.step('workspaces.logo-upload', async () => {
            await client.workspaces.uploadLogo(workspaceId, {
                buffer: png,
                fileName: 'sdk-integration-test.png',
                contentType: 'image/png',
            });
        });
        if (logoUploaded.ok) {
            await reporter.step('workspaces.logo-download', async () => {
                assertBuffer(await client.workspaces.downloadLogo(workspaceId));
            });
            await reporter.step('workspaces.logo-delete', async () => {
                await client.workspaces.deleteLogo(workspaceId);
            });
        } else {
            reporter.skip('workspaces.logo-download', 'logo upload failed');
            reporter.skip('workspaces.logo-delete', 'logo upload failed');
        }

        await configureDisposableWebhook(config, client, reporter, state, secondaryEmail);

        const firstTag = await reporter.step('tags.create-primary', async () => {
            const tag = await client.tags.create({
                name: randomLabel('sdk-integration-primary'),
                color: '3366aa',
            });
            assertId(tag.id);
            state.tags.add(tag.id);
            return tag;
        });
        const secondTag = await reporter.step('tags.create-secondary', async () => {
            const tag = await client.tags.create({
                name: randomLabel('sdk-integration-secondary'),
            });
            assertId(tag.id);
            state.tags.add(tag.id);
            return tag;
        });
        await reporter.step('tags.list', async () => {
            assertArray(await client.tags.list());
        });
        if (firstTag.ok) {
            await reporter.step('tags.update', async () => {
                const tag = await client.tags.update(firstTag.value.id, {
                    name: randomLabel('sdk-integration-updated'),
                    color: '7744aa',
                });
                assertCondition(tag.id === firstTag.value.id);
            });
        } else {
            reporter.skip('tags.update', 'tag fixture was not created');
        }

        const fieldCreated = await reporter.step('fields.create', async () => {
            const field = await client.fields.create({
                type: 'text',
                name: randomLabel('SDK integration field'),
                is_required: true,
                is_active: true,
            });
            assertId(field.id);
            state.fields.add(field.id);
            return field;
        });
        await reporter.step('fields.list', async () => {
            assertArray(await client.fields.list({ include_inactive: true, include_standard: true }));
        });
        if (fieldCreated.ok) {
            await reporter.step('fields.get', async () => {
                const field = await client.fields.get(fieldCreated.value.id);
                assertCondition(field.id === fieldCreated.value.id);
            });
            await reporter.step('fields.update', async () => {
                const field = await client.fields.update(fieldCreated.value.id, {
                    name: randomLabel('SDK integration field updated'),
                    regex: null,
                    is_required: false,
                });
                assertCondition(field.id === fieldCreated.value.id);
            });
            await reporter.step('fields.validate', async () => {
                const result = await client.fields.validate(fieldCreated.value.id, 'test-ok');
                assertCondition(typeof result.success === 'boolean');
            });
            await reporter.step('fields.validate-multiple', async () => {
                const results = await client.fields.validateMultiple([
                    { field_id: fieldCreated.value.id, value: 'test-ok' },
                    { field_id: fieldCreated.value.id, value: 'test-not-ok' },
                ]);
                assertCondition(results.length === 2);
            });
        } else {
            reporter.skip('fields.get', 'field fixture was not created');
            reporter.skip('fields.update', 'field fixture was not created');
            reporter.skip('fields.validate', 'field fixture was not created');
            reporter.skip('fields.validate-multiple', 'field fixture was not created');
        }

        const firstSigner = await createDisposableSigner(
            client,
            reporter,
            state,
            'signers.create-primary',
            primaryEmail,
            randomLabel('SDK Integration Signer Primary'),
        );
        const secondSigner = await createDisposableSigner(
            client,
            reporter,
            state,
            'signers.create-secondary',
            secondaryEmail,
            randomLabel('SDK Integration Signer Secondary'),
        );
        const unassignedSigner = await reporter.step('signers.create-delete-fixture', async () => {
            const signer = await client.signers.create({
                full_name: randomLabel('SDK Integration Unassigned Signer'),
            });
            assertId(signer.id);
            state.signers.add(signer.id);
            return signer;
        });
        if (unassignedSigner.ok) {
            await deleteTrackedSigner(
                client,
                reporter,
                state,
                unassignedSigner.value.id,
                'signers.delete-unassigned',
            );
        } else {
            reporter.skip('signers.delete-unassigned', 'unassigned signer fixture was not created');
        }
        await reporter.step('signers.list', async () => {
            const result = await client.signers.list({ 'per-page': 10 });
            assertArray(result.data);
        });
        if (firstSigner.ok) {
            await reporter.step('signers.get', async () => {
                const signer = await client.signers.get(firstSigner.value.id);
                assertCondition(signer.id === firstSigner.value.id);
            });
            await reporter.step('signers.find-by-email-primary', async () => {
                const signer = await client.signers.findByEmail(primaryEmail);
                assertCondition(signer?.id === firstSigner.value.id);
            });
            await reporter.step('signers.update', async () => {
                const signer = await client.signers.update(firstSigner.value.id, {
                    full_name: randomLabel('SDK Integration Signer Updated'),
                });
                assertCondition(signer.id === firstSigner.value.id);
            });
            await reporter.stepWithKnownApiStatusSkip(
                'signers.update-government-id',
                400,
                'production-only field is not deployed or enabled in sandbox',
                async () => {
                    const signer = await client.signers.update(firstSigner.value.id, {
                        government_id: '390.533.447-05',
                    });
                    assertCondition(signer.id === firstSigner.value.id);
                },
            );
        } else {
            reporter.skip('signers.get', 'signer fixture was not created');
            reporter.skip('signers.find-by-email-primary', 'signer fixture was not created');
            reporter.skip('signers.update', 'signer fixture was not created');
            reporter.skip('signers.update-government-id', 'signer fixture was not created');
        }
        if (secondSigner.ok) {
            await reporter.step('signers.find-by-email-secondary', async () => {
                const signer = await client.signers.findByEmail(secondaryEmail);
                assertCondition(signer?.id === secondSigner.value.id);
            });
        } else {
            reporter.skip('signers.find-by-email-secondary', 'signer fixture was not created');
        }

        const uploadName = randomLabel('sdk-integration-document');
        const documentUploaded = await reporter.step('documents.upload', async () => {
            const document = await client.documents.upload(
                { buffer: pdf, fileName: 'sdk-integration-test.pdf' },
                { name: uploadName, metadata: { source: 'sdk-integration-test' } },
            );
            assertId(document.id);
            state.documents.add(document.id);
            return document;
        });

        let readyDocument: IDocumentDetailsResponse | undefined;
        if (documentUploaded.ok) {
            const documentId = documentUploaded.value.id;
            const ready = await reporter.step('documents.wait-until-ready', async () => {
                const document = await client.documents.waitUntilReady(documentId, {
                    maxWaitMs: 120_000,
                    pollIntervalMs: 2_000,
                });
                assertCondition(document.pages.length > 0);
                return document;
            });
            if (ready.ok) readyDocument = ready.value;

            await reporter.step('documents.details', async () => {
                const document = await client.documents.details(documentId);
                assertCondition(document.id === documentId);
            });
            await reporter.step('documents.get-alias', async () => {
                const document = await client.documents.get(documentId);
                assertCondition(document.id === documentId);
            });
            await reporter.step('documents.list', async () => {
                const result = await client.documents.list({ 'per-page': 10 });
                assertArray(result.data);
            });
            await reporter.step('documents.search-before-rename', async () => {
                const result = await client.documents.search({ search: uploadName, 'per-page': 10 });
                assertArray(result.data);
            });

            if (ready.ok) {
                const renamed = randomLabel('sdk-integration-document-renamed');
                await reporter.step('documents.rename', async () => {
                    const document = await client.documents.rename(documentId, renamed);
                    assertCondition(document.id === documentId);
                });
                await reporter.step('documents.search-after-rename', async () => {
                    const result = await client.documents.search({ search: renamed, 'per-page': 10 });
                    assertArray(result.data);
                });
                await reporter.step('documents.thumbnail', async () => {
                    assertBuffer(await client.documents.thumbnail(documentId));
                });
                const firstPage = ready.value.pages[0];
                if (firstPage) {
                    await reporter.step('documents.page-download', async () => {
                        assertBuffer(await client.documents.downloadPage(documentId, firstPage.id));
                    });
                } else {
                    reporter.skip('documents.page-download', 'rendered page fixture not available');
                }
            } else {
                reporter.skip('documents.rename', 'document did not reach a ready state');
                reporter.skip('documents.search-after-rename', 'document was not renamed');
                reporter.skip('documents.thumbnail', 'document did not reach a ready state');
                reporter.skip('documents.page-download', 'rendered page fixture not available');
            }

            await reporter.step('documents.download-original', async () => {
                assertBuffer(await client.documents.download(documentId, 'original'));
            });
            reporter.skip('documents.download-certificated', 'unsigned document has no final artifact');
            reporter.skip('documents.download-certificate-page', 'unsigned document has no certificate page');
            reporter.skip('documents.download-pades', 'unsigned document has no PAdES artifact');
            reporter.skip('documents.download-bundle', 'unsigned document has no signed bundle');
            await reporter.step('documents.activities', async () => {
                assertArray(await client.documents.activities(documentId));
            });
            await runDocumentTagSuite(client, reporter, documentId, firstTag, secondTag);
        } else {
            reporter.skip('documents.dependent-suite', 'document fixture was not uploaded');
        }

        await deleteTrackedTag(client, reporter, state, firstTag, 'tags.delete-primary');
        await deleteTrackedTag(client, reporter, state, secondTag, 'tags.delete-secondary');

        const availableSigners = [firstSigner, secondSigner]
            .filter((result): result is { ok: true; value: { id: string; email: string } } => result.ok)
            .map((result) => result.value);
        if (documentUploaded.ok && readyDocument && availableSigners.length > 0) {
            await runAssignmentSuite(
                client,
                reporter,
                documentUploaded.value.id,
                availableSigners,
                fieldCreated.ok && readyDocument.pages[0]
                    ? { fieldId: fieldCreated.value.id, pageId: readyDocument.pages[0].id }
                    : undefined,
            );
        } else {
            reporter.skip('assignments.mutable-suite', 'ready document or signer fixture was unavailable');
        }
        await deleteTrackedField(client, reporter, state, fieldCreated);

        if (documentUploaded.ok) {
            const documentId = documentUploaded.value.id;
            await reporter.step('documents.public', async () => {
                const document = await client.documents.getPublic(documentId);
                assertCondition(document.id === documentId);
            });
            await reporter.step('documents.signing-progress', async () => {
                const progress = await client.documents.getSigningProgress(documentId);
                assertCondition(progress.total >= progress.signed && progress.pending >= 0);
            });
            await reporter.step('documents.is-fully-signed', async () => {
                assertCondition(typeof (await client.documents.isFullySigned(documentId)) === 'boolean');
            });
            await reporter.step('documents.verify-generated-hash', async () => {
                const hash = createHash('sha1').update(pdf).digest('hex').toUpperCase();
                const verification = await client.documents.verify(hash);
                assertCondition(typeof verification.is_valid === 'boolean');
            });
            await deleteTrackedDocument(client, reporter, state, documentId, 'documents.delete');
        }

        await runTemplateSuite(
            client,
            reporter,
            state,
            pdf,
            availableSigners[0]?.id,
        );

        await finishDisposableWebhook(client, reporter, state);

        if (firstSigner.ok) {
            await deleteTrackedSigner(
                client,
                reporter,
                state,
                firstSigner.value.id,
                'signers.delete-primary',
                {
                    skipStatusCode: 400,
                    skipReason: 'active assignment is removed by final workspace force-delete',
                },
            );
        }
        if (secondSigner.ok) {
            await deleteTrackedSigner(
                client,
                reporter,
                state,
                secondSigner.value.id,
                'signers.delete-secondary',
                {
                    skipStatusCode: 400,
                    skipReason: 'active assignment is removed by final workspace force-delete',
                },
            );
        }

        await reporter.step('client.upload-and-request-signatures-immediate-virtual', async () => {
            const result = await client.uploadAndRequestSignatures({
                source: { buffer: pdf, fileName: 'sdk-integration-helper.pdf' },
                signers: [{ name: randomLabel('SDK Integration Helper Signer'), email: primaryEmail }],
                message: 'SDK integration helper test',
                waitForReady: false,
            });
            assertId(result.document.id);
            state.documents.add(result.document.id);
            assertId(result.assignment.id);
            assertCondition(result.signer_ids.length === 1);
        });
    } finally {
        await cleanupSandbox(rootClient, reporter, state);
    }
}

async function configureDisposableWebhook(
    config: AuditConfig,
    client: AssinafyClient,
    reporter: Reporter,
    state: SandboxState,
    notificationEmail: string,
): Promise<void> {
    if (config.webhookUrl) {
        const registered = await reporter.step('webhooks.register', async () => {
            const subscription = await client.webhooks.register({
                url: config.webhookUrl!,
                email: notificationEmail,
                events: ['document_ready', 'document_prepared', 'document_processing_failed'],
                is_active: true,
            });
            assertCondition(subscription.is_active === true);
        });
        state.webhookActive = registered.ok;
    } else {
        reporter.skip('webhooks.register', 'webhook fixture URL not supplied');
    }

    await reporter.step('webhooks.get', async () => {
        await client.webhooks.get();
    });
    await reporter.step('webhooks.dispatches-initial', async () => {
        const result = await client.webhooks.listDispatches({ 'per-page': 10 });
        assertArray(result.data);
    });
}

async function finishDisposableWebhook(
    client: AssinafyClient,
    reporter: Reporter,
    state: SandboxState,
): Promise<void> {
    const dispatches = await reporter.step('webhooks.dispatches-after-events', async () => {
        const deadline = Date.now() + DISPATCH_WAIT_MS;
        let result = await client.webhooks.listDispatches({ 'per-page': 10 });
        while (result.data.length === 0 && state.webhookActive && Date.now() < deadline) {
            await delay(2_000);
            result = await client.webhooks.listDispatches({ 'per-page': 10 });
        }
        const data = result.data;
        assertArray(data);
        return data;
    });

    const dispatch = dispatches.ok ? dispatches.value[0] : undefined;
    if (dispatch) {
        await reporter.step('webhooks.retry-dispatch', async () => {
            const retried = await client.webhooks.retryDispatch(dispatch.id);
            assertId(retried.id);
            assertCondition(typeof retried.delivered === 'boolean');
        });
    } else {
        reporter.skip('webhooks.retry-dispatch', 'no disposable dispatch fixture exists');
    }

    if (state.webhookActive) {
        const inactive = await reporter.step('webhooks.inactivate', async () => {
            const subscription = await client.webhooks.inactivate();
            assertCondition(subscription.is_active === false);
        });
        if (inactive.ok) state.webhookActive = false;
    } else {
        reporter.skip('webhooks.inactivate', 'active disposable subscription does not exist');
    }
}

async function createDisposableSigner(
    client: AssinafyClient,
    reporter: Reporter,
    state: SandboxState,
    label: string,
    email: string,
    fullName: string,
): Promise<StepResult<{ id: string; email: string }>> {
    return reporter.step(label, async () => {
        const signer = await client.signers.create({ full_name: fullName, email });
        assertId(signer.id);
        state.signers.add(signer.id);
        return { id: signer.id, email };
    });
}

async function runDocumentTagSuite(
    client: AssinafyClient,
    reporter: Reporter,
    documentId: string,
    firstTag: StepResult<{ id: string }>,
    secondTag: StepResult<{ id: string }>,
): Promise<void> {
    await reporter.step('documents.tags-list', async () => {
        assertArray(await client.documents.listTags(documentId));
    });
    if (!firstTag.ok) {
        reporter.skip('documents.tags-replace', 'tag fixture was not created');
        reporter.skip('documents.tags-add', 'tag fixture was not created');
        reporter.skip('documents.tags-detach', 'tag fixture was not created');
        return;
    }

    await reporter.step('documents.tags-replace', async () => {
        assertArray(await client.documents.replaceTags(documentId, [firstTag.value.id]));
    });
    if (secondTag.ok) {
        await reporter.step('documents.tags-add', async () => {
            assertArray(await client.documents.addTags(documentId, [secondTag.value.id]));
        });
    } else {
        reporter.skip('documents.tags-add', 'second tag fixture was not created');
    }
    await reporter.step('documents.tags-detach', async () => {
        await client.documents.detachTag(documentId, firstTag.value.id);
    });
    await reporter.step('documents.tags-clear', async () => {
        assertArray(await client.documents.replaceTags(documentId, []));
    });
}

async function runAssignmentSuite(
    client: AssinafyClient,
    reporter: Reporter,
    documentId: string,
    signers: Array<{ id: string; email: string }>,
    collectFixture?: { fieldId: string; pageId: string },
): Promise<void> {
    const signingSigners = signers.slice(0, 1);
    const copyReceiver = signers[1];
    const signerPayload: NonNullable<ICreateAssignmentPayload['signers']> = signingSigners.map(
        (signer) => ({
            id: signer.id,
            verification_method: 'Email',
            notification_methods: ['Email'],
            step: 1,
        }),
    );
    const payload: ICreateAssignmentPayload = {
        method: 'virtual',
        signers: signerPayload,
        message: 'SDK integration test notification',
    };
    if (copyReceiver) payload.copy_receivers = [copyReceiver.id];

    await reporter.step('assignments.estimate-cost', async () => {
        const estimate = await client.assignments.estimateCost(documentId, {
            method: 'virtual',
            signers: signingSigners.map(() => ({
                verification_method: 'Email',
                notification_methods: ['Email'],
            })),
        });
        assertCondition(typeof estimate.total_credits === 'number');
    });
    await reporter.stepWithKnownApiStatusSkip(
        'assignments.estimate-cost-digital-certificate',
        400,
        'Digital Certificate feature is unavailable on the sandbox plan',
        async () => {
            const estimate = await client.assignments.estimateCost(documentId, {
                method: 'virtual',
                signers: [{ verification_method: 'DigitalCertificate' }],
            });
            assertCondition(typeof estimate.total_credits === 'number');
        },
    );
    if (collectFixture) {
        await reporter.step('assignments.estimate-cost-collect-display-settings', async () => {
            const estimate = await client.assignments.estimateCost(documentId, {
                method: 'collect',
                signers: signingSigners.map(() => ({
                    verification_method: 'Email',
                    notification_methods: ['Email'],
                })),
                entries: [{
                    page_id: collectFixture.pageId,
                    fields: [{
                        signer_id: signers[0]!.id,
                        field_id: collectFixture.fieldId,
                        display_settings: {
                            left: 20,
                            top: 20,
                            width: 180,
                            height: 32,
                            fontSize: 12,
                        },
                    }],
                }],
            });
            assertCondition(typeof estimate.total_credits === 'number');
        });
    } else {
        reporter.skip(
            'assignments.estimate-cost-collect-display-settings',
            'rendered page or field fixture unavailable',
        );
    }
    const assignment = await reporter.step('assignments.create', async () => {
        const created = await client.assignments.create(documentId, payload);
        assertId(created.id);
        return created;
    });
    await reporter.step('assignments.list', async () => {
        const result = await client.assignments.list({ 'per-page': 10 });
        assertArray(result.data);
    });
    if (!assignment.ok) {
        reporter.skip('assignments.copy-receivers-persisted', 'assignment fixture was not created');
        reporter.skip('documents.send-token-email', 'assignment fixture was not created');
        reporter.skip('signer-documents.download-public-original', 'assignment fixture was not created');
        reporter.skip('signer-documents.download-public-pades', 'assignment fixture was not created');
        reporter.skip('assignments.reset-expiration', 'assignment fixture was not created');
        reporter.skip('assignments.estimate-resend-cost', 'assignment fixture was not created');
        reporter.skip('assignments.resend-notification', 'assignment fixture was not created');
        reporter.skip('assignments.whatsapp-history', 'assignment fixture was not created');
        return;
    }

    if (!copyReceiver) {
        reporter.skip('assignments.copy-receivers-persisted', 'second signer fixture unavailable');
    } else if (
        !assignment.value.copy_receivers?.some(
            (receiver) =>
                receiver['id'] === copyReceiver.id || receiver['signer_id'] === copyReceiver.id,
        )
    ) {
        reporter.skip(
            'assignments.copy-receivers-persisted',
            'sandbox plan accepted but did not persist the signer ID',
        );
    } else {
        await reporter.step('assignments.copy-receivers-persisted', async () => undefined);
    }

    const signer = signingSigners[0];
    assertCondition(signer);
    await reporter.step('documents.send-token-email', async () => {
        await client.documents.sendToken(documentId, signer.email);
    });
    await reporter.step('signer-documents.download-public-original', async () => {
        assertBuffer(await client.signerDocuments.download(signer.id, documentId, 'original'));
    });
    reporter.skip(
        'signer-documents.download-public-pades',
        'unsigned document has no PAdES artifact',
    );
    await reporter.step('assignments.reset-expiration', async () => {
        const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1_000).toISOString();
        const updated = await client.assignments.resetExpiration(
            documentId,
            assignment.value.id,
            expiresAt,
        );
        assertCondition(updated.id === assignment.value.id);
    });
    await reporter.step('assignments.estimate-resend-cost', async () => {
        await client.assignments.estimateResendCost(documentId, assignment.value.id, signer.id);
    });
    await reporter.step('assignments.resend-notification', async () => {
        const response = await client.assignments.resendNotification(
            documentId,
            assignment.value.id,
            signer.id,
        );
        assertCondition(typeof response.is_sent === 'boolean');
    });
    await reporter.step('assignments.whatsapp-history', async () => {
        assertArray(
            await client.assignments.listWhatsAppNotifications(documentId, assignment.value.id),
        );
    });
}

async function runTemplateSuite(
    client: AssinafyClient,
    reporter: Reporter,
    state: SandboxState,
    pdf: Buffer,
    signerId: string | undefined,
): Promise<void> {
    const created = await reporter.step('templates.extension-create', async () => {
        const template = await client.templates.create(
            { buffer: pdf, fileName: 'sdk-integration-template.pdf' },
            { name: randomLabel('sdk-integration-template') },
        );
        assertId(template.id);
        state.templates.add(template.id);
        return template;
    });
    await reporter.step('templates.extension-list', async () => {
        const result = await client.templates.list({ 'per-page': 10 });
        assertArray(result.data);
    });

    let prepared: ITemplateDetailsResponse | undefined;
    if (created.ok) {
        const ready = await reporter.step('templates.extension-get-ready', async () =>
            waitForTemplate(client, created.value.id),
        );
        if (ready.ok) prepared = ready.value;
        await reporter.step('templates.extension-update', async () => {
            const template = await client.templates.update(created.value.id, {
                name: randomLabel('sdk-integration-template-updated'),
                message: 'SDK integration test template',
            });
            assertCondition(template.id === created.value.id);
        });

        const page = prepared?.pages?.[0];
        if (page) {
            await reporter.step('templates.extension-page-download', async () => {
                assertBuffer(await client.templates.downloadPage(created.value.id, page.id));
            });
        } else {
            reporter.skip('templates.extension-page-download', 'rendered template page not available');
        }
    } else {
        reporter.skip('templates.extension-get-ready', 'template fixture was not created');
        reporter.skip('templates.extension-update', 'template fixture was not created');
        reporter.skip('templates.extension-page-download', 'template fixture was not created');
    }

    const freshRoleId = prepared?.roles?.[0]?.id;
    const fixtureTemplateId = created.ok ? created.value.id : undefined;
    const fixtureRoleId = freshRoleId;
    if (!fixtureTemplateId || !fixtureRoleId || !signerId) {
        reporter.skip('templates.documents.estimate-cost', 'template role or signer fixture unavailable');
        reporter.skip('templates.documents.create', 'template role or signer fixture unavailable');
    } else {
        const signers: ITemplateSigner[] = [
            {
                role_id: fixtureRoleId,
                id: signerId,
                verification_method: 'Email',
                notification_methods: ['Email'],
            },
        ];
        await reporter.step('templates.documents.estimate-cost', async () => {
            const estimate = await client.documents.estimateCostFromTemplate(
                fixtureTemplateId,
                [{
                    role_id: fixtureRoleId,
                    verification_method: 'Email',
                    notification_methods: ['Email'],
                }],
            );
            assertCondition(typeof estimate.total_credits === 'number');
        });
        await reporter.stepWithKnownApiStatusSkip(
            'templates.documents.estimate-cost-digital-certificate',
            400,
            'Digital Certificate feature is unavailable on the sandbox plan',
            async () => {
                const estimate = await client.documents.estimateCostFromTemplate(
                    fixtureTemplateId,
                    [{
                        role_id: fixtureRoleId,
                        verification_method: 'DigitalCertificate',
                    }],
                );
                assertCondition(typeof estimate.total_credits === 'number');
            },
        );
        const document = await reporter.step('templates.documents.create', async () => {
            const result = await client.documents.createFromTemplate(
                fixtureTemplateId,
                signers,
                {
                    name: randomLabel('sdk-integration-from-template'),
                    message: 'SDK integration test template document',
                },
            );
            assertId(result.id);
            state.documents.add(result.id);
            return result;
        });
        if (document.ok) {
            await reporter.step('templates.documents.get', async () => {
                const result = await client.documents.details(document.value.id);
                assertCondition(result.id === document.value.id);
            });
            await deleteTrackedDocument(
                client,
                reporter,
                state,
                document.value.id,
                'templates.documents.delete',
                {
                    skipStatusCode: 400,
                    skipReason: 'template assignment prevents direct deletion; workspace cleanup remains',
                },
            );
        } else {
            reporter.skip('templates.documents.get', 'template document was not created');
            reporter.skip('templates.documents.delete', 'template document was not created');
        }
    }

    if (created.ok) {
        await deleteTrackedTemplate(
            client,
            reporter,
            state,
            created.value.id,
            'templates.extension-delete',
        );
    }
}

async function waitForTemplate(
    client: AssinafyClient,
    templateId: string,
): Promise<ITemplateDetailsResponse> {
    const deadline = Date.now() + TEMPLATE_WAIT_MS;
    do {
        const template = await client.templates.get(templateId);
        const status = template.status.toLowerCase();
        if (status === 'ready') return template;
        if (status === 'failed') throw new AuditAssertionError();
        await delay(2_000);
    } while (Date.now() < deadline);
    throw new AuditAssertionError();
}

async function deleteTrackedDocument(
    client: AssinafyClient,
    reporter: Reporter,
    state: SandboxState,
    documentId: string,
    label: string,
    options?: { skipStatusCode: number; skipReason: string },
): Promise<void> {
    const operation = async () => client.documents.delete(documentId);
    const deleted = options
        ? await reporter.stepWithKnownApiStatusSkip(
            label,
            options.skipStatusCode,
            options.skipReason,
            operation,
        )
        : await reporter.step(label, operation);
    if (deleted.ok) state.documents.delete(documentId);
}

async function deleteTrackedTemplate(
    client: AssinafyClient,
    reporter: Reporter,
    state: SandboxState,
    templateId: string,
    label: string,
): Promise<void> {
    const deleted = await reporter.step(label, async () => client.templates.delete(templateId));
    if (deleted.ok) state.templates.delete(templateId);
}

async function deleteTrackedTag(
    client: AssinafyClient,
    reporter: Reporter,
    state: SandboxState,
    tag: StepResult<{ id: string }>,
    label: string,
): Promise<void> {
    if (!tag.ok) {
        reporter.skip(label, 'tag fixture was not created');
        return;
    }
    const deleted = await reporter.step(label, async () => client.tags.delete(tag.value.id));
    if (deleted.ok) state.tags.delete(tag.value.id);
}

async function deleteTrackedField(
    client: AssinafyClient,
    reporter: Reporter,
    state: SandboxState,
    field: StepResult<{ id: string }>,
): Promise<void> {
    if (!field.ok) {
        reporter.skip('fields.delete', 'field fixture was not created');
        return;
    }
    const deleted = await reporter.step('fields.delete', async () =>
        client.fields.delete(field.value.id),
    );
    if (deleted.ok) state.fields.delete(field.value.id);
}

async function deleteTrackedSigner(
    client: AssinafyClient,
    reporter: Reporter,
    state: SandboxState,
    signerId: string,
    label: string,
    options?: { skipStatusCode: number; skipReason: string },
): Promise<void> {
    const operation = async () => client.signers.delete(signerId);
    const deleted = options
        ? await reporter.stepWithKnownApiStatusSkip(
            label,
            options.skipStatusCode,
            options.skipReason,
            operation,
        )
        : await reporter.step(label, operation);
    if (deleted.ok) state.signers.delete(signerId);
}

async function cleanupSandbox(
    rootClient: AssinafyClient,
    reporter: Reporter,
    state: SandboxState,
): Promise<void> {
    const client = state.client;
    if (client) {
        if (state.webhookActive) {
            const inactive = await reporter.step('cleanup.webhooks.inactivate', async () => {
                await client.webhooks.inactivate();
            });
            if (inactive.ok) state.webhookActive = false;
        }
        for (const documentId of [...state.documents]) {
            await deleteTrackedDocument(
                client,
                reporter,
                state,
                documentId,
                'cleanup.documents.delete',
                {
                    skipStatusCode: 400,
                    skipReason: 'active assignment requires final workspace force-delete',
                },
            );
        }
        for (const templateId of [...state.templates]) {
            await deleteTrackedTemplate(
                client,
                reporter,
                state,
                templateId,
                'cleanup.templates.delete',
            );
        }
        for (const tagId of [...state.tags]) {
            const deleted = await reporter.step('cleanup.tags.force-delete', async () =>
                client.tags.delete(tagId, { force: true }),
            );
            if (deleted.ok) state.tags.delete(tagId);
        }
        for (const fieldId of [...state.fields]) {
            const deleted = await reporter.step('cleanup.fields.delete', async () =>
                client.fields.delete(fieldId),
            );
            if (deleted.ok) state.fields.delete(fieldId);
        }
        for (const signerId of [...state.signers]) {
            await deleteTrackedSigner(
                client,
                reporter,
                state,
                signerId,
                'cleanup.signers.delete',
                {
                    skipStatusCode: 400,
                    skipReason: 'active assignment requires final workspace force-delete',
                },
            );
        }
    }

    if (state.workspaceId) {
        const workspaceId = state.workspaceId;
        const deleted = await reporter.step('workspaces.delete-disposable-force', async () =>
            rootClient.workspaces.delete(workspaceId, { force: true }),
        );
        if (deleted.ok) state.workspaceId = undefined;
    }
}

async function main(): Promise<void> {
    let config: AuditConfig;
    try {
        config = loadConfig();
    } catch (error) {
        console.error(`FAIL startup (${safeFailure(error)})`);
        process.exitCode = 1;
        return;
    }

    const reporter = new Reporter();
    const client = new AssinafyClient({
        apiKey: config.apiKey,
        accountId: config.accountId,
        baseUrl: config.baseUrl,
    });

    await runGlobalReads(config, client, reporter);
    if (config.fullAudit) {
        await runFullSandboxAudit(config, client, reporter);
    } else {
        await runReadOnlyAccountAudit(config, client, reporter);
    }

    if (!reporter.finish()) process.exitCode = 1;
}

void main().catch((error: unknown) => {
    console.error(`FAIL fatal (${safeFailure(error)})`);
    process.exitCode = 1;
});
