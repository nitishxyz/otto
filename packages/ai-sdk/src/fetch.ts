import type { WalletContext } from './auth.ts';
import type {
	PaymentCallbacks,
	PaymentOptions,
	CacheOptions,
	BalanceUpdate,
	FetchFunction,
	OttoRouterAuth,
} from './types.ts';
import { isTopupRequired, pickTopupAmount } from './payment.ts';
import { addAnthropicCacheControl } from './cache.ts';
import { createOAuthAccessTokenManager } from './token.ts';

const DEFAULT_MAX_ATTEMPTS = 3;

function tryParseOttoRouterComment(
	line: string,
	onBalanceUpdate: (update: BalanceUpdate) => void,
) {
	const prefix = ': ottorouter ';
	const trimmed = line.replace(/\r$/, '');
	if (!trimmed.startsWith(prefix)) return;
	try {
		const data = JSON.parse(trimmed.slice(prefix.length));
		onBalanceUpdate({
			costUsd: parseFloat(data.cost_usd ?? '0'),
			balanceRemaining: parseFloat(data.balance_remaining ?? '0'),
			inputTokens: data.input_tokens ? Number(data.input_tokens) : undefined,
			outputTokens: data.output_tokens ? Number(data.output_tokens) : undefined,
		});
	} catch {}
}

function wrapResponseWithBalanceSniffing(
	response: Response,
	callbacks: PaymentCallbacks,
): Response {
	if (!callbacks.onBalanceUpdate) return response;

	const balanceHeader = response.headers.get('x-balance-remaining');
	const costHeader = response.headers.get('x-cost-usd');
	if (balanceHeader && costHeader) {
		callbacks.onBalanceUpdate({
			costUsd: parseFloat(costHeader),
			balanceRemaining: parseFloat(balanceHeader),
		});
		return response;
	}

	if (!response.body) return response;
	if (typeof TransformStream === 'undefined') return response;
	if (typeof response.body.pipeThrough !== 'function') return response;

	const onBalanceUpdate = callbacks.onBalanceUpdate;
	let partial = '';
	const decoder = new TextDecoder();

	try {
		const transform = new TransformStream<Uint8Array, Uint8Array>({
			transform(chunk, controller) {
				controller.enqueue(chunk);
				partial += decoder.decode(chunk, { stream: true });
				let nlIndex = partial.indexOf('\n');
				while (nlIndex !== -1) {
					const line = partial.slice(0, nlIndex);
					partial = partial.slice(nlIndex + 1);
					tryParseOttoRouterComment(line, onBalanceUpdate);
					nlIndex = partial.indexOf('\n');
				}
			},
			flush() {
				if (partial.trim()) {
					tryParseOttoRouterComment(partial, onBalanceUpdate);
				}
			},
		});

		return new Response(response.body.pipeThrough(transform), {
			status: response.status,
			statusText: response.statusText,
			headers: response.headers,
		});
	} catch {
		return response;
	}
}

function getRequestUrl(input: string | URL | Request): URL | null {
	try {
		if (input instanceof Request) {
			return new URL(input.url);
		}
		return new URL(input.toString(), 'https://ottorouter.local');
	} catch {
		return null;
	}
}

async function rewriteOttoRouterOpenRouterChatRequest(
	input: string | URL | Request,
	init?: RequestInit,
): Promise<{ input: string | URL | Request; init?: RequestInit }> {
	const url = getRequestUrl(input);
	if (!url || !url.pathname.endsWith('/chat/completions')) {
		return { input, init };
	}

	let bodyText = typeof init?.body === 'string' ? init.body : null;
	if (!bodyText && input instanceof Request && !init?.body) {
		const contentType = input.headers.get('content-type') ?? '';
		if (contentType.includes('application/json')) {
			bodyText = await input.clone().text();
		}
	}

	if (!bodyText) {
		return { input, init };
	}

	try {
		const parsed = JSON.parse(bodyText) as { model?: unknown };
		if (
			typeof parsed.model !== 'string' ||
			!parsed.model.startsWith('openrouter/')
		) {
			return { input, init };
		}

		parsed.model = parsed.model.slice('openrouter/'.length);
		const nextBody = JSON.stringify(parsed);

		if (input instanceof Request && !init) {
			const headers = new Headers(input.headers);
			if (!headers.has('content-type')) {
				headers.set('content-type', 'application/json');
			}
			return {
				input: new Request(input, {
					body: nextBody,
					headers,
				}),
			};
		}

		return {
			input,
			init: {
				...init,
				body: nextBody,
			},
		};
	} catch {
		return { input, init };
	}
}

export interface CreateOttoRouterFetchOptions {
	wallet?: WalletContext;
	auth?: OttoRouterAuth;
	baseURL: string;
	fetch?: FetchFunction;
	rpcURL?: string;
	callbacks?: PaymentCallbacks;
	cache?: CacheOptions;
	payment?: PaymentOptions;
}

export function createOttoRouterOpenRouterFetch(
	baseFetch: FetchFunction,
): FetchFunction {
	return async (input, init) => {
		const rewrittenRequest = await rewriteOttoRouterOpenRouterChatRequest(
			input,
			init,
		);
		return baseFetch(rewrittenRequest.input, rewrittenRequest.init);
	};
}

export function createOttoRouterFetch(options: CreateOttoRouterFetchOptions) {
	const {
		auth,
		baseURL,
		fetch: customFetch,
		callbacks = {},
		cache,
		payment,
	} = options;

	const maxAttempts = payment?.maxRequestAttempts ?? DEFAULT_MAX_ATTEMPTS;
	const baseFetch = customFetch ?? globalThis.fetch.bind(globalThis);
	const apiKey = auth?.apiKey;
	const tokenManager =
		!apiKey && (auth?.accessToken || auth?.refreshToken)
			? createOAuthAccessTokenManager({
					auth,
					baseURL,
					fetch: baseFetch,
				})
			: null;
	if (!apiKey && !tokenManager) {
		throw new Error('OttoRouter: API key or OAuth token is required.');
	}
	const getCredential = async (forceRefresh = false) => {
		if (apiKey) return apiKey;
		if (!tokenManager) {
			throw new Error('OttoRouter: API key or OAuth token is required.');
		}
		return tokenManager.getToken(forceRefresh);
	};

	return async (
		input: Parameters<typeof fetch>[0],
		init?: Parameters<typeof fetch>[1],
	) => {
		let attempt = 0;

		while (attempt < maxAttempts) {
			attempt++;
			const performAuthenticatedRequest = async (forceRefresh = false) => {
				const headers = new Headers(init?.headers);
				if (cache?.promptCacheKey && !headers.has('x-session-id')) {
					headers.set('x-session-id', cache.promptCacheKey);
				}
				const credential = await getCredential(forceRefresh);
				headers.set('authorization', `Bearer ${credential}`);
				return baseFetch(input, { ...init, body, headers });
			};

			let body = init?.body;
			if (body && typeof body === 'string') {
				try {
					const parsed = JSON.parse(body);
					const requestUrl = getRequestUrl(input);
					const isAnthropicRoute =
						requestUrl?.pathname.endsWith('/messages') ?? false;
					const supportsOpenAICacheFields =
						requestUrl?.pathname.endsWith('/responses') ||
						requestUrl?.pathname.endsWith('/chat/completions');
					if (
						supportsOpenAICacheFields &&
						cache?.promptCacheKey &&
						typeof parsed.prompt_cache_key !== 'string'
					) {
						parsed.prompt_cache_key = cache.promptCacheKey;
					}
					if (
						supportsOpenAICacheFields &&
						cache?.promptCacheRetention &&
						typeof parsed.prompt_cache_retention !== 'string'
					) {
						parsed.prompt_cache_retention = cache.promptCacheRetention;
					}
					if (isAnthropicRoute) {
						const cacheConfig = cache?.anthropicCaching;
						if (cacheConfig !== false) {
							const anthropicConfig =
								typeof cacheConfig === 'object' ? cacheConfig : undefined;
							addAnthropicCacheControl(parsed, anthropicConfig);
						}
					}
					body = JSON.stringify(parsed);
				} catch {}
			}

			let response = await performAuthenticatedRequest();
			if (response.status === 401 && tokenManager) {
				tokenManager.invalidate();
				response = await performAuthenticatedRequest(true);
			}

			if (response.status !== 402) {
				return wrapResponseWithBalanceSniffing(response, callbacks);
			}

			const payload = await response.json().catch(() => ({}));
			if (!isTopupRequired(payload)) {
				callbacks.onPaymentError?.('Unsupported 402 response from server');
				throw new Error('OttoRouter: unsupported 402 response');
			}
			if (attempt >= maxAttempts) {
				callbacks.onPaymentError?.('Payment failed after multiple attempts');
				throw new Error('OttoRouter: payment failed after multiple attempts');
			}

			const topupAmount = pickTopupAmount(payload);
			callbacks.onPaymentRequired?.(topupAmount, 0);
			const approval = await callbacks.onPaymentApproval?.({
				amountUsd: topupAmount,
				currentBalance: 0,
			});
			if (approval === 'cancel') {
				callbacks.onPaymentError?.('Payment cancelled by user');
				throw new Error('OttoRouter: payment cancelled by user');
			}
			if (approval === 'fiat') {
				const err = new Error('OttoRouter: fiat payment selected') as Error & {
					code: string;
				};
				err.code = 'OTTOROUTER_FIAT_SELECTED';
				throw err;
			}
			callbacks.onPaymentError?.('Top up required before retrying');
			throw new Error('OttoRouter: top up required');
		}

		throw new Error('OttoRouter: max attempts exceeded');
	};
}
