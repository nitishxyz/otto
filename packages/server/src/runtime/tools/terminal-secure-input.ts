import { getTerminalManager } from '@ottocode/sdk';
import type { ToolAdapterContext } from './context.ts';
import { requestSecureInput } from './secure-input.ts';
import { detectSecurePrompt } from './secure-prompt.ts';

const watchedTerminals = new Set<string>();

export function attachTerminalSecureInput(args: {
	ctx: ToolAdapterContext;
	terminalId: string;
	callId?: string;
}): void {
	const terminalManager = getTerminalManager();
	const terminal = terminalManager?.get(args.terminalId);
	if (!terminal) return;

	const watchKey = `${args.ctx.sessionId}:${args.terminalId}`;
	if (watchedTerminals.has(watchKey)) return;
	watchedTerminals.add(watchKey);

	let recentOutput = '';
	let securePromptPending = false;

	const onData = (data: string) => {
		recentOutput = `${recentOutput}${data}`.slice(-1000);
		if (securePromptPending) return;

		const prompt = detectSecurePrompt(recentOutput);
		if (!prompt) return;

		securePromptPending = true;
		void requestSecureInput({
			sessionId: args.ctx.sessionId,
			messageId: args.ctx.messageId,
			callId: args.callId,
			prompt,
		}).then((value) => {
			securePromptPending = false;
			recentOutput = '';

			const current = terminalManager?.get(args.terminalId);
			if (!current || current.status !== 'running') return;

			if (value === null) {
				current.write('\x03');
				return;
			}

			current.write(`${value}\r`);
		});
	};

	const cleanup = () => {
		terminal.removeDataListener(onData);
		terminal.removeExitListener(onExit);
		watchedTerminals.delete(watchKey);
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
}
