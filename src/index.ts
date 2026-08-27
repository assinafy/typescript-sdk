export { AssinafyClient } from './client';
export type { ClientConfigInput } from './client';
export * from './types';
export * from './errors';
export { DocumentResource } from './resources/documents';
export type { DocumentUploadSource, IDocumentUploadOptions } from './resources/documents';
/** The API's hard 25 MB upload limit — check a file against it before uploading. */
export { MAX_UPLOAD_BYTES } from './resources/upload';
/** Largest page any list endpoint returns; larger `per-page` values are clamped. */
export { MAX_LIST_PAGE_SIZE } from './utils';
export { SignerResource } from './resources/signers';
export { WorkspaceResource } from './resources/workspaces';
export type { AccountLogoUploadSource } from './resources/workspaces';
export { AssignmentResource, buildAssignmentPayload } from './resources/assignments';
export { WebhookResource, DEFAULT_WEBHOOK_EVENTS } from './resources/webhooks';
export { TemplateResource } from './resources/templates';
export { TagResource } from './resources/tags';
export { AuthenticationResource } from './resources/authentication';
export { FieldsResource } from './resources/fields';
export { SignerDocumentsResource } from './resources/signer-documents';
export { UserResource } from './resources/users';
export { WebhookVerifier } from './support/webhook-verifier';
/** User-Agent sent by every SDK HTTP transport. */
export { SDK_USER_AGENT } from './support/transport';
