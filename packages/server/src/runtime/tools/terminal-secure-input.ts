import { getTerminalManager } from '@ottocode/sdk';
import type { ToolAdapterContext } from './context.ts';
import { requestSecureInput } from './secure-input.ts';
import { detectSecurePrompt } from './secure-prompt.ts';

interface TerminalSecureInputWatcher {
	waitForPromptResolution: (timeoutMs?: number) => Promise<boolean>;
}

const watchedTerminals = new Map<string, TerminalSecureInputWatcher>();

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export function attachTerminalSecureInput(args: {
	ctx: ToolAdapterContext;
	terminalId: string;
	callId?: string;
}): TerminalSecureInputWatcher | null {
	const terminalManager = getTerminalManager();
	const terminal = terminalManager?.get(args.terminalId);
	if (!terminal) return null;

	const watchKey = `${args.ctx.sessionId}:${args.terminalId}`;
	const existing = watchedTerminals.get(watchKey);
	if (existing) return existing;

	let recentOutput = '';
	let securePromptPending = false;
	let currentPromptPromise: Promise<void> | null = null;
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

		const prompt = detectSecurePrompt(recentOutput);
		if (!prompt) return;

		securePromptPending = true;
		currentPromptPromise = requestSecureInput({
			sessionId: args.ctx.sessionId,
			messageId: args.ctx.messageId,
			callId: args.callId,
			prompt,
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
					current.write('\x03');
					await delay(250);
					return;
				}

				current.write(`${value}\r`);
				await delay(250);
			})
			.finally(() => {
				currentPromptPromise = null;
			});
		notifyPromptWaiters();
	};

	const cleanup = () => {
		terminal.removeDataListener(onData);
		terminal.removeExitListener(onExit);
		watchedTerminals.delete(watchKey);
		notifyPromptWaiters();
	};

	function onExit() {
		cleanup();
	}

	terminal.onData(onData);
	terminal.onExit(onExit);
	for (const chunk of terminal.read()) {
		onData(chunk);
	}

	if (terminal.status === 'exited') {
		cleanup();
	}

	return watcher;
}
