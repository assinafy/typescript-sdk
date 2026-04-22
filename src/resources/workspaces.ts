import type {
    ICreateWorkspacePayload,
    IWorkspaceListItem,
    IWorkspaceListResponse,
    IWorkspaceResponse,
    IUpdateWorkspacePayload,
} from '../types';
import { BaseResource } from './base';

export class WorkspaceResource extends BaseResource {
    /** Create a new workspace. */
    async create(payload: ICreateWorkspacePayload): Promise<IWorkspaceResponse> {
        return this.call('Failed to create workspace', () => this.http.post('/accounts', payload));
    }

    /** List workspaces the authenticated user can access. */
    async list(): Promise<IWorkspaceListResponse> {
        return this.callList<IWorkspaceListItem>('Failed to list workspaces', () =>
            this.http.get('/accounts'),
        );
    }

    /** Fetch a single workspace. */
    async get(accountId: string): Promise<IWorkspaceResponse> {
        const id = this.requireId(accountId, 'Account ID');
        return this.call('Failed to fetch workspace', () => this.http.get(`/accounts/${id}`));
    }

    /** Update a workspace. */
    async update(accountId: string, payload: IUpdateWorkspacePayload): Promise<IWorkspaceResponse> {
        const id = this.requireId(accountId, 'Account ID');
        return this.call('Failed to update workspace', () => this.http.put(`/accounts/${id}`, payload));
    }

    /** Delete a workspace. */
    async delete(accountId: string): Promise<void> {
        const id = this.requireId(accountId, 'Account ID');
        return this.callVoid('Failed to delete workspace', () => this.http.delete(`/accounts/${id}`));
    }
}
