import { publish } from '../../events/bus.ts';

export interface PendingSecureInput {
	promptId: string;
	sessionId: string;
	messageId: string;
	callId?: string;
	prompt: string;
	resolve: (value: string | null) => void;
	createdAt: number;
}

const pendingSecureInputs = new Map<string, PendingSecureInput>();

export function requestSecureInput(args: {
	sessionId: string;
	messageId: string;
	callId?: string;
	prompt: string;
	timeoutMs?: number;
}): Promise<string | null> {
	const promptId = crypto.randomUUID();
	const timeoutMs = args.timeoutMs ?? 120000;

	return new Promise((resolve) => {
		const pending: PendingSecureInput = {
			promptId,
			sessionId: args.sessionId,
			messageId: args.messageId,
			callId: args.callId,
			prompt: args.prompt,
			resolve,
			createdAt: Date.now(),
		};

		pendingSecureInputs.set(promptId, pending);

		publish({
			type: 'shell.secure_input.required',
			sessionId: args.sessionId,
			payload: {
				promptId,
				messageId: args.messageId,
				callId: args.callId,
				prompt: args.prompt,
				inputKind: 'password',
			},
		});

		setTimeout(() => {
			if (!pendingSecureInputs.has(promptId)) return;
			pendingSecureInputs.delete(promptId);
			resolve(null);
			publish({
				type: 'shell.secure_input.resolved',
				sessionId: args.sessionId,
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
): { ok: boolean; error?: string } {
	const pending = pendingSecureInputs.get(promptId);
	if (!pending) {
		return {
			ok: false,
			error: 'No pending secure input found for this promptId',
		};
	}

	pendingSecureInputs.delete(promptId);
	pending.resolve(value);

	publish({
		type: 'shell.secure_input.resolved',
		sessionId: pending.sessionId,
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
): PendingSecureInput | undefined {
	return pendingSecureInputs.get(promptId);
}

export function getPendingSecureInputsForSession(
	sessionId: string,
): PendingSecureInput[] {
	return Array.from(pendingSecureInputs.values()).filter(
		(input) => input.sessionId === sessionId,
	);
}

export function clearPendingSecureInputsForSession(sessionId: string): void {
	for (const [promptId, pending] of pendingSecureInputs) {
		if (pending.sessionId === sessionId) {
			pending.resolve(null);
			pendingSecureInputs.delete(promptId);
		}
	}
}
