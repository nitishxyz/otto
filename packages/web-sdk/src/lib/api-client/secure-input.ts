import {
	listPendingSecureInputs as apiListPendingSecureInputs,
	resolveSecureInput as apiResolveSecureInput,
} from '@ottocode/api';
import { allowsEmptySecureInput } from '../secure-input-prompt';

export type SecureInputKind = 'password' | 'text';

export interface PendingSecureInputResponse {
	promptId: string;
	messageId?: string;
	callId?: string;
	prompt: string;
	inputKind: SecureInputKind;
	allowRemember: boolean;
	allowEmpty: boolean;
	createdAt: number;
}

function normalizeInputKind(value: unknown): SecureInputKind {
	return value === 'text' ? 'text' : 'password';
}

export const secureInputMixin = {
	async submitSecureInput(
		sessionId: string,
		promptId: string,
		value: string,
		remember = false,
	): Promise<{ ok: boolean; promptId: string; cancelled: boolean }> {
		const response = await apiResolveSecureInput({
			path: { id: sessionId },
			// biome-ignore lint/suspicious/noExplicitAny: generated API types lag behind the remember field
			body: { promptId, value, remember } as any,
		});
		if (response.error) throw new Error('Failed to submit secure input');
		return response.data;
	},

	async cancelSecureInput(
		sessionId: string,
		promptId: string,
	): Promise<{ ok: boolean; promptId: string; cancelled: boolean }> {
		const response = await apiResolveSecureInput({
			path: { id: sessionId },
			body: { promptId, cancelled: true },
		});
		if (response.error) throw new Error('Failed to cancel secure input');
		return response.data;
	},

	async getPendingSecureInputs(sessionId: string): Promise<{
		ok: boolean;
		pending: PendingSecureInputResponse[];
	}> {
		const response = await apiListPendingSecureInputs({
			path: { id: sessionId },
		});
		if (response.error) throw new Error('Failed to get pending secure inputs');
		const data = response.data as {
			ok: boolean;
			pending?: Array<Record<string, unknown>>;
		};
		return {
			ok: data.ok,
			pending: (data.pending ?? []).map((item) => ({
				promptId: String(item.promptId),
				messageId:
					typeof item.messageId === 'string' ? item.messageId : undefined,
				callId: typeof item.callId === 'string' ? item.callId : undefined,
				prompt: typeof item.prompt === 'string' ? item.prompt : '',
				inputKind: normalizeInputKind(item.inputKind),
				allowRemember: item.allowRemember === true,
				allowEmpty: allowsEmptySecureInput(
					typeof item.prompt === 'string' ? item.prompt : '',
					item.allowEmpty === true,
				),
				createdAt:
					typeof item.createdAt === 'number' ? item.createdAt : Date.now(),
			})),
		};
	},
};
