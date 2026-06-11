/**
 * OAuth Provider Adapter
 *
 * Consolidates all OAuth-specific LLM call adaptations into one place.
 * Each OAuth provider has quirks (no system prompt, must stream, needs
 * spoof prompt, special providerOptions, etc.). Instead of duplicating
 * that branching logic across every callsite (title gen, compaction,
 * commit, runner), this module exposes two layers:
 *
 * ## Layer 1 — Detection (`detectOAuth`)
 *   Examines provider + auth and returns an `OAuthContext` describing
 *   what adaptations are needed. Used by ALL callsites (simple + complex).
 *
 * ## Layer 2 — Simple call adaptation (`adaptSimpleCall`)
 *   For single-shot LLM calls (title gen, compaction, commit) that follow
 *   the pattern: system + user message → text result.
 *   Returns a ready-to-spread `AdaptedLLMCall` object.
 *
 * ## Adding a new OAuth provider
 *   1. Add detection branch in `detectOAuth()`
 *   2. Add adaptation branch in `adaptSimpleCall()`
 *   3. If the provider needs a custom fetch wrapper, add it under
 *      `packages/sdk/src/providers/src/<provider>-oauth-client.ts`
 *   4. Zero changes needed at any callsite.
 *
 * ## Architecture
 *
 * ```
 *   callsite (commit.ts, service.ts, compaction-auto.ts, runner-setup.ts)
 *       │
 *       ├─ detectOAuth(provider, auth)  →  OAuthContext
 *       │
 *       ├─ adaptSimpleCall(ctx, input)  →  AdaptedLLMCall  (title, commit, compaction)
 *       │
 *       └─ adaptRunnerCall(ctx, composed, opts)  →  AdaptedRunnerSetup  (main chat)
 *              │
 *              ├─ OpenAI OAuth (Codex):  no system, inline instructions,
 *              │     providerOptions.openai.store=false, forceStream=true
 *              │
 *              ├─ Anthropic OAuth:  spoofPrompt as system, instructions
 *              │     folded into user message, normal maxOutputTokens
 *              │
 *              └─ API key (default):  system=instructions, plain user msg
 * ```
 */
import { getProviderSpoofPrompt } from '../prompt/builder.ts';
import type { SharedV3ProviderOptions } from '@ai-sdk/provider';

export type OAuthContext = {
	isOAuth: boolean;
	needsSpoof: boolean;
	isOpenAIOAuth: boolean;
	isXaiOAuth: boolean;
	spoofPrompt: string | undefined;
};

/**
 * Detect OAuth mode for a provider and return flags describing
 * what adaptations are needed. This replaces the 4-line pattern
 * that was previously copy-pasted at every callsite:
 *
 *   const isOAuth = auth?.type === 'oauth';
 *   const needsSpoof = isOAuth && provider === 'anthropic';
 *   const isOpenAIOAuth = isOAuth && provider === 'openai';
 *   const spoofPrompt = needsSpoof ? getProviderSpoofPrompt(...) : undefined;
 */
export function detectOAuth(
	provider: string,
	auth: { type: string } | null | undefined,
): OAuthContext {
	const isOAuth = auth?.type === 'oauth';
	const needsSpoof = !!isOAuth && provider === 'anthropic';
	return {
		isOAuth: !!isOAuth,
		needsSpoof,
		isOpenAIOAuth: !!isOAuth && provider === 'openai',
		isXaiOAuth: !!isOAuth && provider === 'xai',
		spoofPrompt: needsSpoof ? getProviderSpoofPrompt(provider) : undefined,
	};
}

/**
 * Build OpenAI Codex-specific providerOptions.
 * Codex requires `store: false` and passes the system prompt via
 * `instructions` instead of the normal `system` field.
 *
 * Used directly by runner-setup.ts (complex flow) and indirectly
 * by adaptSimpleCall (simple flows).
 */
const CODEX_INSTRUCTIONS =
	'You are a coding agent. Follow all developer messages. Use tools to complete tasks.';

export function buildCodexProviderOptions(instructions?: string) {
	return {
		openai: {
			store: false as const,
			instructions: instructions?.trim() || CODEX_INSTRUCTIONS,
			parallelToolCalls: false,
		},
	};
}

/**
 * Build xAI OAuth (Grok CLI proxy) providerOptions.
 * The grok cli-chat proxy persists conversations server-side when
 * `store` is left at its default (`true`), which leaks context from
 * previous sessions into the first turn of new sessions. Forcing
 * `store: false` keeps every request stateless (the AI SDK then also
 * requests `reasoning.encrypted_content` so reasoning replay still works).
 */
export function buildXaiOAuthProviderOptions() {
	return {
		xai: {
			store: false as const,
		},
	};
}

export type AdaptedLLMCall = {
	system?: string;
	messages: Array<{ role: 'user'; content: string }>;
	maxOutputTokens?: number;
	providerOptions?: SharedV3ProviderOptions;
	forceStream: boolean;
};

/**
 * Adapt a simple (single-shot) LLM call for the current OAuth context.
 *
 * Takes raw `instructions` (what would normally be the system prompt) and
 * `userContent`, then returns the correct shape for the provider:
 *
 * - **OpenAI OAuth (Codex)**: no system prompt, instructions baked into
 *   user message AND providerOptions.openai.instructions, forceStream=true,
 *   no maxOutputTokens (Codex doesn't support it).
 *
 * - **Anthropic OAuth**: spoof prompt as system, real instructions folded
 *   into user message, normal maxOutputTokens.
 *
 * - **API key (default)**: instructions as system, plain user message,
 *   normal maxOutputTokens.
 *
 * Callsites just spread the result into streamText/generateText:
 * ```ts
 * const adapted = adaptSimpleCall(oauth, { instructions, userContent });
 * const result = streamText({ model, ...adapted }); // almost — see forceStream
 * ```
 */
export function adaptSimpleCall(
	ctx: OAuthContext,
	input: {
		instructions: string;
		userContent: string;
		maxOutputTokens?: number;
	},
): AdaptedLLMCall {
	if (ctx.isOpenAIOAuth) {
		return {
			system: input.instructions,
			messages: [
				{
					role: 'user',
					content: input.userContent,
				},
			],
			providerOptions: buildCodexProviderOptions(input.instructions),
			forceStream: true,
		};
	}

	if (ctx.needsSpoof && ctx.spoofPrompt) {
		return {
			system: ctx.spoofPrompt,
			messages: [
				{
					role: 'user',
					content: `${input.instructions}\n\n${input.userContent}`,
				},
			],
			maxOutputTokens: input.maxOutputTokens,
			forceStream: false,
		};
	}

	if (ctx.isXaiOAuth) {
		return {
			system: input.instructions,
			messages: [{ role: 'user', content: input.userContent }],
			maxOutputTokens: input.maxOutputTokens,
			providerOptions: buildXaiOAuthProviderOptions(),
			forceStream: false,
		};
	}

	return {
		system: input.instructions,
		messages: [{ role: 'user', content: input.userContent }],
		maxOutputTokens: input.maxOutputTokens,
		forceStream: false,
	};
}

export type AdaptedRunnerSetup = {
	system: string;
	systemComponents: string[];
	additionalSystemMessages: Array<{
		role: 'system' | 'user';
		content: string;
	}>;
	maxOutputTokens: number | undefined;
	providerOptions: SharedV3ProviderOptions;
};

/**
 * Adapt the main chat runner's system prompt placement, maxOutputTokens,
 * and providerOptions based on the OAuth context.
 *
 * Unlike `adaptSimpleCall` (which builds the full message), this only
 * decides WHERE the already-composed system prompt goes:
 *
 * - **OpenAI OAuth (Codex)**: system='', composed prompt sent as a user
 *   system message in additionalSystemMessages (becomes developer role in
 *   Responses API), providerOptions with store=false
 *   + instructions, maxOutputTokens stripped.
 *
 * - **Anthropic OAuth**: spoof prompt as system, composed prompt sent as
 *   an additional system message. Normal maxOutputTokens.
 *
 * - **API key (default)**: composed prompt IS the system prompt directly.
 *   No additional messages needed.
 *
 * ```ts
 * const composed = await composeSystemPrompt({ ... });
 * const adapted = adaptRunnerCall(oauth, composed, { provider, rawMaxOutputTokens });
 * // adapted.system, adapted.additionalSystemMessages, adapted.providerOptions ready to use
 * ```
 */
export function adaptRunnerCall(
	ctx: OAuthContext,
	composed: { prompt: string; components: string[] },
	opts: {
		provider: string;
		rawMaxOutputTokens: number | undefined;
	},
): AdaptedRunnerSetup {
	if (ctx.spoofPrompt) {
		return {
			system: ctx.spoofPrompt,
			systemComponents: [`spoof:${opts.provider || 'unknown'}`],
			additionalSystemMessages: [{ role: 'system', content: composed.prompt }],
			maxOutputTokens: opts.rawMaxOutputTokens,
			providerOptions: {},
		};
	}

	if (ctx.isOpenAIOAuth) {
		return {
			system: '',
			systemComponents: composed.components,
			additionalSystemMessages: [],
			maxOutputTokens: undefined,
			providerOptions: buildCodexProviderOptions(composed.prompt),
		};
	}

	if (ctx.isXaiOAuth) {
		return {
			system: composed.prompt,
			systemComponents: composed.components,
			additionalSystemMessages: [],
			maxOutputTokens: opts.rawMaxOutputTokens,
			providerOptions: buildXaiOAuthProviderOptions(),
		};
	}

	return {
		system: composed.prompt,
		systemComponents: composed.components,
		additionalSystemMessages: [],
		maxOutputTokens: opts.rawMaxOutputTokens,
		providerOptions: {},
	};
}
