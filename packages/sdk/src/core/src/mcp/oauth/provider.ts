import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import type {
	OAuthClientMetadata,
	OAuthClientInformationMixed,
	OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import type { OAuthCredentialStore } from './store.ts';

const DEFAULT_CALLBACK_PORT = 8090;

export interface OttoOAuthProviderOptions {
	clientId?: string;
	callbackPort?: number;
	scopes?: string[];
}

export class OttoOAuthProvider implements OAuthClientProvider {
	private serverName: string;
	private store: OAuthCredentialStore;
	private callbackPort: number;
	private presetClientId?: string;
	private scopes?: string[];
	private _pendingAuthUrl: string | null = null;

	constructor(
		serverName: string,
		store: OAuthCredentialStore,
		options?: OttoOAuthProviderOptions,
	) {
		this.serverName = serverName;
		this.store = store;
		this.callbackPort = options?.callbackPort ?? DEFAULT_CALLBACK_PORT;
		this.presetClientId = options?.clientId;
		this.scopes = options?.scopes;
	}

	get redirectUrl(): string {
		return `http://localhost:${this.callbackPort}/callback`;
	}

	get clientMetadata(): OAuthClientMetadata {
		return {
			client_name: 'ottocode',
			redirect_uris: [this.redirectUrl],
			grant_types: ['authorization_code', 'refresh_token'],
			response_types: ['code'],
			token_endpoint_auth_method: 'none',
			...(this.scopes?.length ? { scope: this.scopes.join(' ') } : {}),
		} as OAuthClientMetadata;
	}

	get pendingAuthUrl(): string | null {
		return this._pendingAuthUrl;
	}

	async clientInformation(): Promise<OAuthClientInformationMixed | undefined> {
		if (this.presetClientId) {
			return { client_id: this.presetClientId } as OAuthClientInformationMixed;
		}

		const stored = await this.store.loadClientInfo(this.serverName);
		if (stored?.client_id) {
			return stored as unknown as OAuthClientInformationMixed;
		}
		return undefined;
	}

	async saveClientInformation(
		clientInformation: OAuthClientInformationMixed,
	): Promise<void> {
		await this.store.saveClientInfo(
			this.serverName,
			clientInformation as unknown as {
				client_id: string;
				[key: string]: unknown;
			},
		);
	}

	async tokens(): Promise<OAuthTokens | undefined> {
		const stored = await this.store.loadTokens(this.serverName);
		if (!stored) return undefined;
		return stored as unknown as OAuthTokens;
	}

	async saveTokens(tokens: OAuthTokens): Promise<void> {
		const expiresAt = tokens.expires_in
			? Math.floor(Date.now() / 1000) + tokens.expires_in
			: undefined;

		await this.store.saveTokens(this.serverName, {
			...(tokens as unknown as Record<string, unknown>),
			expires_at: expiresAt,
		} as {
			access_token: string;
			token_type?: string;
			expires_in?: number;
			refresh_token?: string;
			scope?: string;
			expires_at?: number;
		});
	}

	async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
		this._pendingAuthUrl = authorizationUrl.toString();
	}

	async saveCodeVerifier(codeVerifier: string): Promise<void> {
		await this.store.saveCodeVerifier(this.serverName, codeVerifier);
	}

	async codeVerifier(): Promise<string> {
		const stored = await this.store.loadCodeVerifier(this.serverName);
		if (!stored) throw new Error('No code verifier found');
		return stored;
	}

	cleanup(): void {
		this._pendingAuthUrl = null;
	}

	async clearCredentials(): Promise<void> {
		await this.store.clearServer(this.serverName);
	}
}
