import { publish } from '../../events/bus.ts';
import { scopedCallKey } from '../projects/scope.ts';
import type { SecureInputKind } from './secure-prompt.ts';

const DEFAULT_CACHE_TTL_MS = 15 * 60 * 1000;

interface CachedSecureInput {
	value: string;
	expiresAt: number;
	timeoutId: ReturnType<typeof setTimeout>;
}

export interface PendingSecureInput {
	projectRoot?: string;
	promptId: string;
	sessionId: string;
	messageId: string;
	callId?: string;
	prompt: string;
	inputKind: SecureInputKind;
	allowRemember: boolean;
	allowEmpty: boolean;
	cacheKey?: string;
	cacheTtlMs: number;
	timeoutId?: ReturnType<typeof setTimeout>;
	resolve: (value: string | null) => void;
	createdAt: number;
}

const pendingSecureInputs = new Map<string, PendingSecureInput>();
const cachedSecureInputs = new Map<string, CachedSecureInput>();

function secureInputCacheKey(
	projectRoot: string | undefined,
	cacheKey: string,
) {
	return scopedCallKey(projectRoot, `secure-input:${cacheKey}`);
}

function getCachedSecureInput(
	projectRoot: string | undefined,
	cacheKey: string | undefined,
): string | undefined {
	if (!cacheKey) return undefined;
	const key = secureInputCacheKey(projectRoot, cacheKey);
	const cached = cachedSecureInputs.get(key);
	if (!cached) return undefined;
	if (cached.expiresAt <= Date.now()) {
		clearTimeout(cached.timeoutId);
		cachedSecureInputs.delete(key);
		return undefined;
	}
	return cached.value;
}

export function invalidateCachedSecureInput(
	projectRoot: string | undefined,
	cacheKey: string,
): void {
	const key = secureInputCacheKey(projectRoot, cacheKey);
	const cached = cachedSecureInputs.get(key);
	if (cached) clearTimeout(cached.timeoutId);
	cachedSecureInputs.delete(key);
}

export function requestSecureInput(args: {
	projectRoot?: string;
	sessionId: string;
	messageId: string;
	callId?: string;
	prompt: string;
	inputKind?: SecureInputKind;
	allowRemember?: boolean;
	allowEmpty?: boolean;
	cacheKey?: string;
	cacheTtlMs?: number;
	bypassCache?: boolean;
	timeoutMs?: number;
}): Promise<string | null> {
	const promptId = crypto.randomUUID();
	const timeoutMs = args.timeoutMs ?? 120000;
	const inputKind = args.inputKind ?? 'password';
	const allowRemember = args.allowRemember ?? inputKind === 'password';
	const allowEmpty = args.allowEmpty ?? false;
	const cacheKey = allowRemember
		? (args.cacheKey ?? args.prompt.trim())
		: undefined;
	if (args.bypassCache && cacheKey) {
		invalidateCachedSecureInput(args.projectRoot, cacheKey);
	}
	const cached = getCachedSecureInput(args.projectRoot, cacheKey);
	if (cached !== undefined) return Promise.resolve(cached);

	return new Promise((resolve) => {
		const pending: PendingSecureInput = {
			projectRoot: args.projectRoot,
			promptId,
			sessionId: args.sessionId,
			messageId: args.messageId,
			callId: args.callId,
			prompt: args.prompt,
			inputKind,
			allowRemember,
			allowEmpty,
			cacheKey,
			cacheTtlMs: args.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS,
			resolve,
			createdAt: Date.now(),
		};

		const key = scopedCallKey(args.projectRoot, promptId);
		pendingSecureInputs.set(key, pending);

		publish({
			type: 'shell.secure_input.required',
			sessionId: args.sessionId,
			projectRoot: args.projectRoot,
			payload: {
				promptId,
				messageId: args.messageId,
				callId: args.callId,
				prompt: args.prompt,
				inputKind,
				allowRemember,
			},
		});

		pending.timeoutId = setTimeout(() => {
			if (!pendingSecureInputs.has(key)) return;
			pendingSecureInputs.delete(key);
			if (pending.timeoutId) clearTimeout(pending.timeoutId);
			resolve(null);
			publish({
				type: 'shell.secure_input.resolved',
				sessionId: args.sessionId,
				projectRoot: args.projectRoot,
				payload: {
					promptId,
					messageId: args.messageId,
					callId: args.callId,
					cancelled: true,
					reason: 'timeout',
				},
			});
		}, timeoutMs);
	});
}

export function resolveSecureInput(
	promptId: string,
	value: string | null,
	projectRoot?: string,
	remember = false,
): { ok: boolean; error?: string } {
	const key = scopedCallKey(projectRoot, promptId);
	const pending = pendingSecureInputs.get(key);
	if (!pending) {
		return {
			ok: false,
			error: 'No pending secure input found for this promptId',
		};
	}

	pendingSecureInputs.delete(key);
	if (pending.timeoutId) clearTimeout(pending.timeoutId);
	if (value !== null && remember && pending.allowRemember && pending.cacheKey) {
		const cacheKey = secureInputCacheKey(pending.projectRoot, pending.cacheKey);
		const previous = cachedSecureInputs.get(cacheKey);
		if (previous) clearTimeout(previous.timeoutId);
		const cached: CachedSecureInput = {
			value,
			expiresAt: Date.now() + pending.cacheTtlMs,
			timeoutId: setTimeout(() => {
				if (cachedSecureInputs.get(cacheKey) === cached) {
					cachedSecureInputs.delete(cacheKey);
				}
			}, pending.cacheTtlMs),
		};
		cached.timeoutId.unref();
		cachedSecureInputs.set(cacheKey, cached);
	}
	pending.resolve(value);

	publish({
		type: 'shell.secure_input.resolved',
		sessionId: pending.sessionId,
		projectRoot: pending.projectRoot,
		payload: {
			promptId,
			messageId: pending.messageId,
			callId: pending.callId,
			cancelled: value === null,
			reason: value === null ? 'user_cancelled' : 'user_submitted',
		},
	});

	return { ok: true };
}

export function getPendingSecureInput(
	promptId: string,
	projectRoot?: string,
): PendingSecureInput | undefined {
	return pendingSecureInputs.get(scopedCallKey(projectRoot, promptId));
}

export function getPendingSecureInputsForSession(
	sessionId: string,
	projectRoot?: string,
): PendingSecureInput[] {
	return Array.from(pendingSecureInputs.values()).filter(
		(input) =>
			input.sessionId === sessionId && input.projectRoot === projectRoot,
	);
}

export function clearPendingSecureInputsForSession(
	sessionId: string,
	projectRoot?: string,
): void {
	for (const [promptId, pending] of pendingSecureInputs) {
		if (
			pending.sessionId === sessionId &&
			pending.projectRoot === projectRoot
		) {
			if (pending.timeoutId) clearTimeout(pending.timeoutId);
			pending.resolve(null);
			pendingSecureInputs.delete(promptId);
		}
	}
}
