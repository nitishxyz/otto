import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { getSecureOAuthDir } from '../../../../config/src/paths.ts';

export interface StoredOAuthData {
	tokens?: {
		access_token: string;
		token_type?: string;
		expires_in?: number;
		refresh_token?: string;
		scope?: string;
		expires_at?: number;
	};
	clientInfo?: {
		client_id: string;
		client_secret?: string;
		[key: string]: unknown;
	};
	codeVerifier?: string;
}

type StoredOAuthFile = StoredOAuthData & { identity?: string };

const updateQueues = new Map<string, Promise<unknown>>();

function serialize<T>(key: string, task: () => Promise<T>): Promise<T> {
	const previous = updateQueues.get(key) ?? Promise.resolve();
	const run = previous.catch(() => {}).then(task);
	const tail = run.catch(() => {});
	updateQueues.set(key, tail);
	void tail.then(() => {
		if (updateQueues.get(key) === tail) updateQueues.delete(key);
	});
	return run;
}

/**
 * File-backed OAuth credential store. Filenames are derived from a hash of
 * the canonical identity (so distinct identities never collide), every
 * read-modify-write is serialized per identity, and writes are atomic
 * (temp file + rename, mode 0600).
 */
export class OAuthCredentialStore {
	private storePath: string;

	constructor(storePath?: string) {
		this.storePath = storePath ?? getSecureOAuthDir();
	}

	private filePath(identity: string): string {
		const readable = identity.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 48);
		const digest = createHash('sha256')
			.update(identity)
			.digest('hex')
			.slice(0, 16);
		return join(this.storePath, `${readable}-${digest}.json`);
	}

	/** Pre-hash filename; read only as a migration fallback. */
	private legacyFilePath(identity: string): string {
		const safe = identity.replace(/[^a-zA-Z0-9_-]/g, '_');
		return join(this.storePath, `${safe}.json`);
	}

	private async readFile(path: string): Promise<StoredOAuthFile | null> {
		try {
			return JSON.parse(await fs.readFile(path, 'utf-8')) as StoredOAuthFile;
		} catch {
			return null;
		}
	}

	private async read(identity: string): Promise<StoredOAuthData> {
		const current = await this.readFile(this.filePath(identity));
		if (current) {
			if (current.identity && current.identity !== identity) return {};
			const { identity: _identity, ...data } = current;
			return data;
		}
		const legacy = await this.readFile(this.legacyFilePath(identity));
		if (!legacy) return {};
		const { identity: _identity, ...data } = legacy;
		return data;
	}

	private async write(identity: string, data: StoredOAuthData): Promise<void> {
		await fs.mkdir(this.storePath, { recursive: true, mode: 0o700 });
		const path = this.filePath(identity);
		const temporaryPath = `${path}.${crypto.randomUUID()}.tmp`;
		const file: StoredOAuthFile = { identity, ...data };
		await fs.writeFile(temporaryPath, JSON.stringify(file, null, '\t'), {
			encoding: 'utf-8',
			mode: 0o600,
		});
		try {
			await fs.rename(temporaryPath, path);
		} catch (error) {
			await fs.rm(temporaryPath, { force: true });
			throw error;
		}
	}

	private update(
		identity: string,
		mutate: (data: StoredOAuthData) => void,
	): Promise<void> {
		return serialize(this.filePath(identity), async () => {
			const data = await this.read(identity);
			mutate(data);
			await this.write(identity, data);
		});
	}

	async loadTokens(
		serverName: string,
	): Promise<StoredOAuthData['tokens'] | undefined> {
		const data = await this.read(serverName);
		return data.tokens;
	}

	async saveTokens(
		serverName: string,
		tokens: StoredOAuthData['tokens'],
	): Promise<void> {
		await this.update(serverName, (data) => {
			data.tokens = tokens;
		});
	}

	async loadClientInfo(
		serverName: string,
	): Promise<StoredOAuthData['clientInfo'] | undefined> {
		const data = await this.read(serverName);
		return data.clientInfo;
	}

	async saveClientInfo(
		serverName: string,
		clientInfo: StoredOAuthData['clientInfo'],
	): Promise<void> {
		await this.update(serverName, (data) => {
			data.clientInfo = clientInfo;
		});
	}

	async loadCodeVerifier(serverName: string): Promise<string | undefined> {
		const data = await this.read(serverName);
		return data.codeVerifier;
	}

	async saveCodeVerifier(
		serverName: string,
		codeVerifier: string,
	): Promise<void> {
		await this.update(serverName, (data) => {
			data.codeVerifier = codeVerifier;
		});
	}

	async clearTokens(serverName: string): Promise<void> {
		await this.update(serverName, (data) => {
			delete data.tokens;
		});
	}

	async clearClientInfo(serverName: string): Promise<void> {
		await this.update(serverName, (data) => {
			delete data.clientInfo;
		});
	}

	async clearCodeVerifier(serverName: string): Promise<void> {
		await this.update(serverName, (data) => {
			delete data.codeVerifier;
		});
	}

	async clearServer(serverName: string): Promise<void> {
		await serialize(this.filePath(serverName), async () => {
			await fs.rm(this.filePath(serverName), { force: true });
			await fs.rm(this.legacyFilePath(serverName), { force: true });
		});
	}

	async isAuthenticated(serverName: string): Promise<boolean> {
		const tokens = await this.loadTokens(serverName);
		if (!tokens?.access_token) return false;
		if (tokens.expires_at && tokens.expires_at < Date.now() / 1000) {
			return !!tokens.refresh_token;
		}
		return true;
	}
}
