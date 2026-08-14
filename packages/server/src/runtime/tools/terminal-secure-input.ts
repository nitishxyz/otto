import { getTerminalManager } from '@ottocode/sdk';
import type { ToolAdapterContext } from './context.ts';
import {
	invalidateCachedSecureInput,
	requestSecureInput,
} from './secure-input.ts';
import {
	detectSecurePrompt,
	hasAuthenticationFailure,
} from './secure-prompt.ts';

interface TerminalSecureInputWatcher {
	waitForPromptResolution: (timeoutMs?: number) => Promise<boolean>;
}

const watchedTerminals = new Map<string, TerminalSecureInputWatcher>();

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export function attachTerminalSecureInput(args: {
	ctx: Pick<ToolAdapterContext, 'projectRoot' | 'sessionId' | 'messageId'>;
	terminalId: string;
	callId?: string;
}): TerminalSecureInputWatcher | null {
	const terminalManager = getTerminalManager(args.ctx.projectRoot);
	const terminal = terminalManager?.get(args.terminalId);
	if (!terminal) return null;
	const activeTerminal = terminal;

	const watchKey = `${args.ctx.projectRoot}:${args.ctx.sessionId}:${args.terminalId}`;
	const existing = watchedTerminals.get(watchKey);
	if (existing) return existing;

	let recentOutput = '';
	let securePromptPending = false;
	let currentPromptPromise: Promise<void> | null = null;
	let lastSecureInputCacheKey: string | null = null;
	let suppressedPrompt: string | null = null;
	let suppressionTimeout: ReturnType<typeof setTimeout> | null = null;
	let cancelKillTimeout: ReturnType<typeof setTimeout> | null = null;
	const promptWaiters = new Set<() => void>();

	const notifyPromptWaiters = () => {
		for (const waiter of promptWaiters) {
			waiter();
		}
		promptWaiters.clear();
	};

	const waitForPromptResolution = async (timeoutMs = 2000) => {
		if (currentPromptPromise) {
			await currentPromptPromise;
			return true;
		}

		return new Promise<boolean>((resolve) => {
			let settled = false;
			const finish = (value: boolean) => {
				if (settled) return;
				settled = true;
				clearTimeout(timeout);
				promptWaiters.delete(onPrompt);
				resolve(value);
			};
			const onPrompt = () => {
				void (currentPromptPromise ?? Promise.resolve()).then(() => {
					finish(true);
				});
			};
			const timeout = setTimeout(() => finish(false), timeoutMs);
			promptWaiters.add(onPrompt);
		});
	};

	const watcher: TerminalSecureInputWatcher = { waitForPromptResolution };
	watchedTerminals.set(watchKey, watcher);

	const onData = (data: string) => {
		recentOutput = `${recentOutput}${data}`.slice(-1000);
		if (securePromptPending) return;

		const detected = detectSecurePrompt(recentOutput);
		if (!detected) return;
		if (detected.prompt === suppressedPrompt) return;

		securePromptPending = true;
		const cacheKey = `terminal:${activeTerminal.command}\0${activeTerminal.args.join('\0')}\0${detected.prompt}`;
		lastSecureInputCacheKey = cacheKey;
		currentPromptPromise = requestSecureInput({
			projectRoot: args.ctx.projectRoot,
			sessionId: args.ctx.sessionId,
			messageId: args.ctx.messageId,
			callId: args.callId,
			prompt: detected.prompt,
			inputKind: detected.inputKind,
			allowEmpty: detected.allowEmpty,
			cacheKey,
			bypassCache: hasAuthenticationFailure(recentOutput),
		})
			.then(async (value) => {
				securePromptPending = false;
				recentOutput = '';

				const current = terminalManager?.get(args.terminalId);
				if (!current || current.status !== 'running') {
					await delay(250);
					return;
				}

				if (value === null) {
					suppressedPrompt = detected.prompt;
					if (suppressionTimeout) clearTimeout(suppressionTimeout);
					suppressionTimeout = setTimeout(() => {
						suppressedPrompt = null;
						suppressionTimeout = null;
					}, 2000);
					current.write('\x03');
					if (
						current.createdBy === 'llm' ||
						current.purpose.startsWith('git ')
					) {
						cancelKillTimeout = setTimeout(() => {
							if (current.status === 'running') current.kill('SIGTERM');
							cancelKillTimeout = null;
						}, 500);
					}
					await delay(250);
					return;
				}

				suppressedPrompt = null;
				current.write(`${value}\r`);
				await delay(250);
			})
			.finally(() => {
				currentPromptPromise = null;
			});
		notifyPromptWaiters();
	};

	const cleanup = () => {
		if (suppressionTimeout) clearTimeout(suppressionTimeout);
		if (cancelKillTimeout) clearTimeout(cancelKillTimeout);
		activeTerminal.removeDataListener(onData);
		activeTerminal.removeExitListener(onExit);
		watchedTerminals.delete(watchKey);
		notifyPromptWaiters();
	};

	function onExit() {
		if (
			lastSecureInputCacheKey &&
			hasAuthenticationFailure(activeTerminal.read().join(''))
		) {
			invalidateCachedSecureInput(
				args.ctx.projectRoot,
				lastSecureInputCacheKey,
			);
		}
		cleanup();
	}

	activeTerminal.onData(onData);
	activeTerminal.onExit(onExit);
	for (const chunk of activeTerminal.read()) {
		onData(chunk);
	}

	if (activeTerminal.status === 'exited') {
		cleanup();
	}

	return watcher;
}
