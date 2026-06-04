import type { LanguageModelV3Middleware } from '@ai-sdk/provider';

export type ProviderId =
	| 'openai'
	| 'anthropic'
	| 'google'
	| 'moonshot'
	| 'qwen'
	| 'zai'
	| 'minimax'
	| (string & {});

export type ProviderApiFormat =
	| 'openai-responses'
	| 'anthropic-messages'
	| 'openai-chat'
	| 'openrouter-chat'
	| 'xai-chat'
	| 'google-native';

export type FetchFunction = (
	input: string | URL | Request,
	init?: RequestInit,
) => Promise<Response>;

export interface ProviderConfig {
	id: ProviderId;
	apiFormat: ProviderApiFormat;
	models?: string[];
	modelPrefix?: string;
}

export interface ExternalSigner {
	walletAddress: string;
	signNonce: (nonce: string) => Promise<string> | string;
	signTransaction?: (transaction: Uint8Array) => Promise<Uint8Array>;
}

export interface OttoRouterAuth {
	privateKey?: string;
	signer?: ExternalSigner;
}

export interface BalanceUpdate {
	costUsd: number;
	balanceRemaining: number;
	inputTokens?: number;
	outputTokens?: number;
}

export interface PaymentCallbacks {
	onPaymentRequired?: (amountUsd: number, currentBalance?: number) => void;
	onPaymentSigning?: () => void;
	onPaymentComplete?: (data: {
		amountUsd: number;
		newBalance: number;
		transactionId?: string;
	}) => void;
	onPaymentError?: (error: string) => void;
	onPaymentApproval?: (info: {
		amountUsd: number;
		currentBalance: number;
	}) => Promise<'crypto' | 'fiat' | 'cancel'>;
	onBalanceUpdate?: (update: BalanceUpdate) => void;
}

export type AnthropicCacheStrategy = 'auto' | 'manual' | 'custom' | false;

export type AnthropicCachePlacement = 'first' | 'last' | 'all';

export interface AnthropicCacheConfig {
	strategy?: AnthropicCacheStrategy;
	systemBreakpoints?: number;
	messageBreakpoints?: number;
	systemPlacement?: AnthropicCachePlacement;
	messagePlacement?: AnthropicCachePlacement;
	cacheType?: 'ephemeral';
	transform?: (body: Record<string, unknown>) => Record<string, unknown>;
}

export interface CacheOptions {
	promptCacheKey?: string;
	promptCacheRetention?: 'in_memory' | '24h';
	anthropicCaching?: boolean | AnthropicCacheConfig;
}

export interface PaymentOptions {
	topupApprovalMode?: 'auto' | 'approval';
	autoPayThresholdUsd?: number;
	maxRequestAttempts?: number;
	maxPaymentAttempts?: number;
}

export interface OttoRouterConfig {
	auth: OttoRouterAuth;
	baseURL?: string;
	fetch?: FetchFunction;
	rpcURL?: string;
	providers?: ProviderConfig[];
	modelMap?: Record<string, ProviderId>;
	callbacks?: PaymentCallbacks;
	cache?: CacheOptions;
	payment?: PaymentOptions;
	middleware?: LanguageModelV3Middleware | LanguageModelV3Middleware[];
}

export interface BalanceResponse {
	walletAddress: string;
	balance: number;
	totalSpent: number;
	totalTopups: number;
	requestCount: number;
	createdAt?: string;
	lastRequest?: string;
	scope?: 'wallet' | 'account';
	payg?: {
		walletBalanceUsd: number;
		accountBalanceUsd: number;
		rawPoolUsd: number;
		effectiveSpendableUsd: number;
	};
	limits?: {
		enabled: boolean;
		dailyLimitUsd: number | null;
		dailySpentUsd: number;
		dailyRemainingUsd: number | null;
		monthlyLimitUsd: number | null;
		monthlySpentUsd: number;
		monthlyRemainingUsd: number | null;
		capRemainingUsd: number | null;
	} | null;
	subscription?: {
		active: boolean;
		tierId?: string;
		tierName?: string;
		creditsIncluded?: number;
		creditsUsed?: number;
		creditsRemaining?: number;
		creditsWeeklyLimit?: number | null;
		creditsFiveHourLimit?: number | null;
		usageWindows?: {
			weekly: {
				limit: number | null;
				used: number;
				remaining: number | null;
				percentUsed: number;
			};
			fiveHour: {
				limit: number | null;
				used: number;
				remaining: number | null;
				percentUsed: number;
			};
		};
		periodStart?: string;
		periodEnd?: string;
	} | null;
}

export interface WalletUsdcBalance {
	walletAddress: string;
	usdcBalance: number;
	network: 'mainnet' | 'devnet';
}
