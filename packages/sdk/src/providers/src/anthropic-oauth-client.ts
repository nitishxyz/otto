import { createAnthropic } from '@ai-sdk/anthropic';
import type { OAuth } from '../../types/src/index.ts';
import { getAuth, setAuth } from '../../auth/src/index.ts';
import { refreshToken } from '../../auth/src/oauth.ts';
import { warn as loggerWarn } from '../../core/src/utils/logger.ts';
import { addAnthropicCacheControl } from './anthropic-caching.ts';
import { retry } from '../../runtime/retry.ts';

const CLAUDE_CLI_VERSION = '1.0.61';
const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000;
const TOKEN_REFRESH_MAX_RETRIES = 2;
const TOKEN_REFRESH_RETRY_DELAY_MS = 1000;

type FetchLike = (
	input: Parameters<typeof fetch>[0],
	init?: Parameters<typeof fetch>[1],
) => Promise<Response>;

const refreshPromises = new Map<string, Promise<OAuth>>();

export type AnthropicOAuthConfig = {
	oauth: {
		access: string;
		refresh: string;
		expires: number;
	};
	projectRoot?: string;
	toolNameTransformer?: (name: string) => string;
};

function refreshKey(projectRoot?: string) {
	return projectRoot ?? 'global';
}

function toOAuth(oauth: AnthropicOAuthConfig['oauth']): OAuth {
	return {
		type: 'oauth',
		access: oauth.access,
		refresh: oauth.refresh,
		expires: oauth.expires,
	};
}

function isAccessValidBeyondBuffer(oauth: OAuth) {
	return Boolean(
		oauth.access && oauth.expires > Date.now() + TOKEN_EXPIRY_BUFFER_MS,
	);
}

async function refreshAndPersist(
	oauth: OAuth,
	projectRoot?: string,
): Promise<OAuth> {
	const key = refreshKey(projectRoot);
	const inFlight = refreshPromises.get(key);
	if (inFlight) {
		return inFlight;
	}

	const promise = (async () => {
		const diskAuth = await getAuth('anthropic', projectRoot);
		if (diskAuth?.type === 'oauth' && isAccessValidBeyondBuffer(diskAuth)) {
			return diskAuth;
		}

		const refreshFrom =
			diskAuth?.type === 'oauth' ? diskAuth.refresh : oauth.refresh;
		return retry(
			async () => {
				const tokens = await refreshToken(refreshFrom);
				const updated: OAuth = {
					type: 'oauth',
					access: tokens.access,
					refresh: tokens.refresh,
					expires: tokens.expires,
				};
				await setAuth('anthropic', updated, projectRoot, 'global');
				return updated;
			},
			{
				maxRetries: TOKEN_REFRESH_MAX_RETRIES,
				delayMs: ({ attempt }) => TOKEN_REFRESH_RETRY_DELAY_MS * (attempt + 1),
				shouldRetry: (error) =>
					!(error instanceof Error ? error.message : String(error)).includes(
						'refresh token rejected',
					),
			},
		).catch((error) => {
			throw error instanceof Error ? error : new Error(String(error));
		});
	})().finally(() => {
		refreshPromises.delete(key);
	});

	refreshPromises.set(key, promise);
	return promise;
}

async function ensureValidToken(
	currentOAuth: OAuth,
	projectRoot?: string,
): Promise<OAuth> {
	if (isAccessValidBeyondBuffer(currentOAuth)) {
		return currentOAuth;
	}

	try {
		return await refreshAndPersist(currentOAuth, projectRoot);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		loggerWarn(
			`[anthropic-oauth] Token refresh failed: ${message.replace(/\s+/g, ' ').trim()}`,
		);
		throw error;
	}
}

function buildOAuthHeaders(accessToken: string): Record<string, string> {
	const headers: Record<string, string> = {
		authorization: `Bearer ${accessToken}`,
		'anthropic-beta':
			'claude-code-20250219,oauth-2025-04-20,interleaved-thinking-2025-05-14',
		'anthropic-dangerous-direct-browser-access': 'true',
		'anthropic-version': '2023-06-01',
		'user-agent': `claude-cli/${CLAUDE_CLI_VERSION} (external, cli)`,
		'x-app': 'cli',
		'content-type': 'application/json',
		accept: 'application/json',
		'x-stainless-arch': process.arch === 'arm64' ? 'arm64' : 'x64',
		'x-stainless-helper-method': 'stream',
		'x-stainless-lang': 'js',
		'x-stainless-os':
			process.platform === 'darwin'
				? 'MacOS'
				: process.platform === 'win32'
					? 'Windows'
					: 'Linux',
		'x-stainless-package-version': '0.70.0',
		'x-stainless-retry-count': '0',
		'x-stainless-runtime': 'node',
		'x-stainless-runtime-version': process.version,
		'x-stainless-timeout': '600',
	};
	return headers;
}

function filterExistingHeaders(
	initHeaders: RequestInit['headers'] | undefined,
): Record<string, string> {
	const headers: Record<string, string> = {};
	if (!initHeaders) return headers;

	if (initHeaders instanceof Headers) {
		initHeaders.forEach((value, key) => {
			if (key.toLowerCase() !== 'x-api-key') {
				headers[key] = value;
			}
		});
	} else if (Array.isArray(initHeaders)) {
		for (const [key, value] of initHeaders) {
			if (
				key &&
				key.toLowerCase() !== 'x-api-key' &&
				typeof value === 'string'
			) {
				headers[key] = value;
			}
		}
	} else {
		for (const [key, value] of Object.entries(initHeaders)) {
			if (key.toLowerCase() !== 'x-api-key' && typeof value === 'string') {
				headers[key] = value;
			}
		}
	}
	return headers;
}

function prepareAnthropicRequest(
	input: string | URL | Request,
	init: RequestInit | undefined,
	accessToken: string,
	toolNameTransformer?: (name: string) => string,
) {
	const existingHeaders = filterExistingHeaders(init?.headers);
	const oauthHeaders = buildOAuthHeaders(accessToken);
	const headers = { ...existingHeaders, ...oauthHeaders };

	let url = typeof input === 'string' ? input : input.toString();
	if (url.includes('/v1/messages') && !url.includes('beta=true')) {
		url += url.includes('?') ? '&beta=true' : '?beta=true';
	}

	let body = init?.body;
	if (body && typeof body === 'string') {
		try {
			const parsed = JSON.parse(body);

			if (toolNameTransformer) {
				if (parsed.tools && Array.isArray(parsed.tools)) {
					parsed.tools = parsed.tools.map(
						(tool: { name: string; [key: string]: unknown }) => ({
							...tool,
							name: toolNameTransformer(tool.name),
						}),
					);
				}

				if (parsed.messages && Array.isArray(parsed.messages)) {
					parsed.messages = parsed.messages.map(
						(msg: { content: unknown; [key: string]: unknown }) => {
							if (Array.isArray(msg.content)) {
								const content = msg.content.map(
									(block: {
										type: string;
										name?: string;
										[key: string]: unknown;
									}) => {
										if (
											(block.type === 'tool_use' ||
												block.type === 'tool_result') &&
											block.name
										) {
											return {
												...block,
												name: toolNameTransformer(block.name),
											};
										}
										return block;
									},
								);
								return { ...msg, content };
							}
							return msg;
						},
					);
				}
			}

			const withCache = addAnthropicCacheControl(parsed);
			body = JSON.stringify(withCache);
		} catch {
			// If parsing fails, send as-is
		}
	}

	return { url, body, headers };
}

export function createAnthropicOAuthFetch(
	config: AnthropicOAuthConfig,
): FetchLike {
	const { toolNameTransformer, projectRoot } = config;
	let currentOAuth = toOAuth(config.oauth);

	return async (input: string | URL | Request, init?: RequestInit) => {
		currentOAuth = await ensureValidToken(currentOAuth, projectRoot);

		const execute = async (accessToken: string) => {
			const prepared = prepareAnthropicRequest(
				input,
				init,
				accessToken,
				toolNameTransformer,
			);
			return fetch(prepared.url, {
				...init,
				body: prepared.body,
				headers: prepared.headers,
			});
		};

		let response = await execute(currentOAuth.access);

		if (response.status === 401) {
			const diskAuth = await getAuth('anthropic', projectRoot);
			if (
				diskAuth?.type === 'oauth' &&
				diskAuth.access !== currentOAuth.access &&
				isAccessValidBeyondBuffer(diskAuth)
			) {
				currentOAuth = diskAuth;
			} else {
				currentOAuth = await refreshAndPersist(currentOAuth, projectRoot);
			}

			response = await execute(currentOAuth.access);
		}

		return response;
	};
}

export function createAnthropicOAuthModel(
	model: string,
	config: AnthropicOAuthConfig,
) {
	const customFetch = createAnthropicOAuthFetch(config);
	return createAnthropic({
		apiKey: '',
		fetch: customFetch as typeof fetch,
	})(model);
}
