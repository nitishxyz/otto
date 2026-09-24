import { client } from '@ottocode/api';
import { extractErrorMessage } from './utils';

/**
 * Contract for `GET`/`PUT /v1/config/memory`. Mirrors the judge config route:
 * `settings` is the persisted, user-editable state; `typesafe.configured`
 * reports whether the shared TypeSafe judge credential resolves so the UI can
 * explain which memory features degrade without it.
 */
export type MemoryConfigSettings = {
	/** Master switch: when false, no recall, capture, or memory tools run. */
	enabled: boolean;
	/** Judge-backed capture of durable user statements on each main turn. */
	autoCapture: boolean;
	/** Automatic recall of relevant memories into every turn's context. */
	recall: boolean;
};

export type MemoryConfigResponse = {
	settings: MemoryConfigSettings;
	typesafe: {
		/** True when a TypeSafe credential resolves (stored key or env var). */
		configured: boolean;
	};
	/** Absolute path of the shared user-local SQLite database. */
	path?: string;
};

export type MemoryConfigUpdate = Partial<MemoryConfigSettings>;

const MEMORY_CONFIG_URL = '/v1/config/memory';
type MemoryConfigResponses = { 200: MemoryConfigResponse };

// TODO(memory): swap these generic calls for the generated
// `getMemoryConfig` / `updateMemoryConfig` once `@ottocode/api` is regenerated.
export const memoryMixin = {
	async getMemoryConfig(): Promise<MemoryConfigResponse> {
		const response = await client.get<MemoryConfigResponses>({
			url: MEMORY_CONFIG_URL,
			responseType: 'json',
		});
		if (response.error) throw new Error(extractErrorMessage(response.error));
		return response.data;
	},

	async updateMemoryConfig(
		update: MemoryConfigUpdate,
	): Promise<MemoryConfigResponse> {
		const response = await client.put<MemoryConfigResponses>({
			url: MEMORY_CONFIG_URL,
			body: update,
			responseType: 'json',
		});
		if (response.error) throw new Error(extractErrorMessage(response.error));
		return response.data;
	},
};
