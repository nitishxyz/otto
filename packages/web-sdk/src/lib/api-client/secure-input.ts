import {
	listPendingSecureInputs as apiListPendingSecureInputs,
	resolveSecureInput as apiResolveSecureInput,
} from '@ottocode/api';

export const secureInputMixin = {
	async submitSecureInput(
		sessionId: string,
		promptId: string,
		value: string,
	): Promise<{ ok: boolean; promptId: string; cancelled: boolean }> {
		const response = await apiResolveSecureInput({
			path: { id: sessionId },
			body: { promptId, value },
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
		pending: Array<{
			promptId: string;
			messageId?: string;
			callId?: string;
			prompt: string;
			inputKind: 'password';
			createdAt: number;
		}>;
	}> {
		const response = await apiListPendingSecureInputs({
			path: { id: sessionId },
		});
		if (response.error) throw new Error('Failed to get pending secure inputs');
		return response.data;
	},
};
