/**
 * AI SDK warning handler.
 *
 * The AI SDK logs provider warnings (e.g. unsupported features like
 * `maxOutputTokens` caps) to the console via `globalThis.AI_SDK_LOG_WARNINGS`.
 * These warnings are noisy during normal operation. We suppress them by
 * default and only surface them when debug mode is enabled.
 *
 * See: https://ai-sdk.dev (AI_SDK_LOG_WARNINGS global)
 */

import { isDebugEnabled } from './debug/state.ts';

type AiSdkWarning =
	| { type: 'unsupported'; feature: string; details?: string }
	| { type: 'compatibility'; feature: string; details?: string }
	| { type: 'other'; message: string };

type LogWarningsOptions = {
	warnings: AiSdkWarning[];
	provider: string;
	model: string;
};

function formatWarning(
	warning: AiSdkWarning,
	provider: string,
	model: string,
): string {
	const prefix = `AI SDK Warning (${provider} / ${model}):`;
	switch (warning.type) {
		case 'unsupported': {
			let message = `${prefix} The feature "${warning.feature}" is not supported.`;
			if (warning.details) message += ` ${warning.details}`;
			return message;
		}
		case 'compatibility': {
			let message = `${prefix} The feature "${warning.feature}" is used in a compatibility mode.`;
			if (warning.details) message += ` ${warning.details}`;
			return message;
		}
		case 'other':
			return `${prefix} ${warning.message}`;
		default:
			return `${prefix} ${JSON.stringify(warning)}`;
	}
}

type WarningHandler = ((options: LogWarningsOptions) => void) | false;

type WarningGlobal = { AI_SDK_LOG_WARNINGS?: WarningHandler };

const warningGlobal = globalThis as unknown as WarningGlobal;

let installation: {
	handler: WarningHandler;
	previous: WarningHandler | undefined;
	hadPrevious: boolean;
	refs: number;
} | null = null;

function suppressingHandler(options: LogWarningsOptions): void {
	if (!isDebugEnabled()) return;
	if (!options.warnings?.length) return;
	for (const warning of options.warnings) {
		console.warn(formatWarning(warning, options.provider, options.model));
	}
}

/**
 * Install a custom AI SDK warning handler that suppresses warnings unless
 * debug mode is enabled. Installs are reference counted; the returned
 * function restores the previous global handler once every install has been
 * released (and only if no one replaced the handler in the meantime).
 */
export function installAiSdkWarningHandler(): () => void {
	if (!installation) {
		installation = {
			handler: suppressingHandler,
			previous: warningGlobal.AI_SDK_LOG_WARNINGS,
			hadPrevious: 'AI_SDK_LOG_WARNINGS' in warningGlobal,
			refs: 0,
		};
		warningGlobal.AI_SDK_LOG_WARNINGS = suppressingHandler;
	}
	installation.refs += 1;
	let released = false;
	return () => {
		if (released || !installation) return;
		released = true;
		installation.refs -= 1;
		if (installation.refs > 0) return;
		const current = installation;
		installation = null;
		if (warningGlobal.AI_SDK_LOG_WARNINGS !== current.handler) return;
		if (current.hadPrevious) {
			warningGlobal.AI_SDK_LOG_WARNINGS = current.previous;
		} else {
			delete warningGlobal.AI_SDK_LOG_WARNINGS;
		}
	};
}
