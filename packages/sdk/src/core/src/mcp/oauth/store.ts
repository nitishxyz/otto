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

export class OAuthCredentialStore {
	private storePath: string;

	constructor(storePath?: string) {
		this.storePath = storePath ?? getSecureOAuthDir();
	}

	private filePath(serverName: string): string {
		const safe = serverName.replace(/[^a-zA-Z0-9_-]/g, '_');
		return join(this.storePath, `${safe}.json`);
	}

	private async read(serverName: string): Promise<StoredOAuthData> {
		try {
			const text = await fs.readFile(this.filePath(serverName), 'utf-8');
			return JSON.parse(text);
		} catch {
			return {};
		}
	}

	private async write(
		serverName: string,
		data: StoredOAuthData,
	): Promise<void> {
		await fs.mkdir(this.storePath, { recursive: true, mode: 0o700 });
		await fs.writeFile(
			this.filePath(serverName),
			JSON.stringify(data, null, '\t'),
			{ encoding: 'utf-8', mode: 0o600 },
		);
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
		const data = await this.read(serverName);
		data.tokens = tokens;
		await this.write(serverName, data);
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
		const data = await this.read(serverName);
		data.clientInfo = clientInfo;
		await this.write(serverName, data);
	}

	async loadCodeVerifier(serverName: string): Promise<string | undefined> {
		const data = await this.read(serverName);
		return data.codeVerifier;
	}

	async saveCodeVerifier(
		serverName: string,
		codeVerifier: string,
	): Promise<void> {
		const data = await this.read(serverName);
		data.codeVerifier = codeVerifier;
		await this.write(serverName, data);
	}

	async clearTokens(serverName: string): Promise<void> {
		const data = await this.read(serverName);
		delete data.tokens;
		await this.write(serverName, data);
	}

	async clearClientInfo(serverName: string): Promise<void> {
		const data = await this.read(serverName);
		delete data.clientInfo;
		await this.write(serverName, data);
	}

	async clearCodeVerifier(serverName: string): Promise<void> {
		const data = await this.read(serverName);
		delete data.codeVerifier;
		await this.write(serverName, data);
	}

	async clearServer(serverName: string): Promise<void> {
		try {
			await fs.unlink(this.filePath(serverName));
		} catch {}
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
