import { ExpiringSessionStore } from './expiring-session-store.ts';

const TEN_MINUTES = 10 * 60_000;
const FIFTEEN_MINUTES = 15 * 60_000;

export const oauthVerifiers = new ExpiringSessionStore<{
	verifier: string;
	provider: string;
	createdAt: number;
	callbackUrl: string;
	close?: () => void;
}>({
	ttlMs: TEN_MINUTES,
	onDelete: (value) => {
		try {
			value.close?.();
		} catch {}
	},
});

export const copilotDeviceSessions = new ExpiringSessionStore<{
	deviceCode: string;
	interval: number;
	provider: string;
	createdAt: number;
}>({ ttlMs: TEN_MINUTES });

export const xaiDeviceSessions = new ExpiringSessionStore<{
	status: 'pending' | 'complete' | 'error';
	error?: string;
	createdAt: number;
}>({ ttlMs: FIFTEEN_MINUTES });

export const openAIDeviceSessions = new ExpiringSessionStore<{
	deviceAuthId: string;
	userCode: string;
	interval: number;
	createdAt: number;
}>({ ttlMs: FIFTEEN_MINUTES });

export const kimiDeviceSessions = new ExpiringSessionStore<{
	deviceCode: string;
	interval: number;
	createdAt: number;
}>({ ttlMs: FIFTEEN_MINUTES });

export const githubDeviceSessions = new ExpiringSessionStore<{
	deviceCode: string;
	interval: number;
	createdAt: number;
}>({ ttlMs: FIFTEEN_MINUTES });

export const ottorouterDeviceSessions = new ExpiringSessionStore<{
	deviceCode: string;
	interval: number;
	createdAt: number;
}>({ ttlMs: FIFTEEN_MINUTES });

const stores = [
	oauthVerifiers,
	copilotDeviceSessions,
	xaiDeviceSessions,
	openAIDeviceSessions,
	kimiDeviceSessions,
	githubDeviceSessions,
	ottorouterDeviceSessions,
] as const;

const sweepTimer = setInterval(() => {
	for (const store of stores) store.sweep();
}, 60_000);
sweepTimer.unref?.();
