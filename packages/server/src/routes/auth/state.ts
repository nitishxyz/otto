export const oauthVerifiers = new Map<
	string,
	{
		verifier: string;
		provider: string;
		createdAt: number;
		callbackUrl: string;
		close?: () => void;
	}
>();

export const copilotDeviceSessions = new Map<
	string,
	{ deviceCode: string; interval: number; provider: string; createdAt: number }
>();

export const openAIDeviceSessions = new Map<
	string,
	{
		deviceAuthId: string;
		userCode: string;
		interval: number;
		createdAt: number;
	}
>();

export const kimiDeviceSessions = new Map<
	string,
	{ deviceCode: string; interval: number; createdAt: number }
>();

export const ottorouterDeviceSessions = new Map<
	string,
	{ deviceCode: string; interval: number; createdAt: number }
>();

setInterval(() => {
	const now = Date.now();
	for (const [key, value] of oauthVerifiers.entries()) {
		if (now - value.createdAt > 10 * 60 * 1000) {
			try {
				value.close?.();
			} catch {}
			oauthVerifiers.delete(key);
		}
	}
	for (const [key, value] of copilotDeviceSessions.entries()) {
		if (now - value.createdAt > 10 * 60 * 1000) {
			copilotDeviceSessions.delete(key);
		}
	}
	for (const [key, value] of openAIDeviceSessions.entries()) {
		if (now - value.createdAt > 15 * 60 * 1000) {
			openAIDeviceSessions.delete(key);
		}
	}
	for (const [key, value] of kimiDeviceSessions.entries()) {
		if (now - value.createdAt > 15 * 60 * 1000) {
			kimiDeviceSessions.delete(key);
		}
	}
	for (const [key, value] of ottorouterDeviceSessions.entries()) {
		if (now - value.createdAt > 15 * 60 * 1000) {
			ottorouterDeviceSessions.delete(key);
		}
	}
}, 60 * 1000);
