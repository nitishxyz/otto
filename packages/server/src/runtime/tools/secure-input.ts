import { publish } from '../../events/bus.ts';
import { scopedCallKey } from '../projects/scope.ts';

export interface PendingSecureInput {
	projectRoot?: string;
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
	projectRoot?: string;
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
			projectRoot: args.projectRoot,
			promptId,
			sessionId: args.sessionId,
			messageId: args.messageId,
			callId: args.callId,
			prompt: args.prompt,
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
				inputKind: 'password',
			},
		});

		setTimeout(() => {
			if (!pendingSecureInputs.has(key)) return;
			pendingSecureInputs.delete(key);
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
			pending.resolve(null);
			pendingSecureInputs.delete(promptId);
		}
	}
}
