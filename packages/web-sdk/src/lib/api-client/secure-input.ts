import { getBaseUrl } from './utils';

export const secureInputMixin = {
	async submitSecureInput(
		sessionId: string,
		promptId: string,
		value: string,
	): Promise<{ ok: boolean; promptId: string; cancelled: boolean }> {
		const response = await fetch(
			`${getBaseUrl()}/v1/sessions/${encodeURIComponent(sessionId)}/secure-input`,
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ promptId, value }),
			},
		);
		if (!response.ok) throw new Error('Failed to submit secure input');
		return response.json();
	},

	async cancelSecureInput(
		sessionId: string,
		promptId: string,
	): Promise<{ ok: boolean; promptId: string; cancelled: boolean }> {
		const response = await fetch(
			`${getBaseUrl()}/v1/sessions/${encodeURIComponent(sessionId)}/secure-input`,
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ promptId, cancelled: true }),
			},
		);
		if (!response.ok) throw new Error('Failed to cancel secure input');
		return response.json();
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
		const response = await fetch(
			`${getBaseUrl()}/v1/sessions/${encodeURIComponent(sessionId)}/secure-input/pending`,
		);
		if (!response.ok) throw new Error('Failed to get pending secure inputs');
		return response.json();
	},
};
