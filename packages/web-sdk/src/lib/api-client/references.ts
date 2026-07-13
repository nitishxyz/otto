import {
	deleteReference as apiDeleteReference,
	listReferenceDirectories as apiListReferenceDirectories,
	listReferences as apiListReferences,
	upsertReference as apiUpsertReference,
} from '@ottocode/api';
import { extractErrorMessage } from './utils';

export type ReferenceScope = 'global' | 'local';
export type Reference = {
	description: string;
	enabled?: boolean;
	source:
		| { type: 'git'; url: string; ref?: string }
		| { type: 'local'; path: string };
};
export type ReferenceDirectoryListing = {
	path: string;
	parent: string | null;
	directories: Array<{ name: string; path: string }>;
};

export const referencesMixin = {
	async listReferences(
		scope: ReferenceScope,
	): Promise<{ references: Record<string, Reference> }> {
		const response = await apiListReferences({ query: { scope } });
		if (response.error) throw new Error(extractErrorMessage(response.error));
		return response.data as { references: Record<string, Reference> };
	},

	async listReferenceDirectories(
		path?: string,
	): Promise<ReferenceDirectoryListing> {
		const response = await apiListReferenceDirectories({
			query: path ? { path } : {},
		});
		if (response.error) throw new Error(extractErrorMessage(response.error));
		return response.data as ReferenceDirectoryListing;
	},

	async saveReference(
		name: string,
		reference: Reference,
		scope: ReferenceScope,
	): Promise<{ references: Record<string, Reference> }> {
		const response = await apiUpsertReference({
			path: { name },
			query: { scope },
			body: reference,
		});
		if (response.error) throw new Error(extractErrorMessage(response.error));
		return response.data as { references: Record<string, Reference> };
	},

	async deleteReference(name: string, scope: ReferenceScope): Promise<void> {
		const response = await apiDeleteReference({
			path: { name },
			query: { scope },
		});
		if (response.error) throw new Error(extractErrorMessage(response.error));
	},
};
