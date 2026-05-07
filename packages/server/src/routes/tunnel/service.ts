import type { Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import {
	generateQRCode,
	isTunnelBinaryInstalled,
	killStaleTunnels,
	logger,
	OttoTunnel,
} from '@ottocode/sdk';
import { getServerPort } from '../../state.ts';

type TunnelStatus = 'idle' | 'starting' | 'connected' | 'error';

let activeTunnel: OttoTunnel | null = null;
let tunnelUrl: string | null = null;
let tunnelStatus: TunnelStatus = 'idle';
let tunnelError: string | null = null;
let progressMessage: string | null = null;

export async function getTunnelStatus() {
	const binaryInstalled = await isTunnelBinaryInstalled();

	return {
		status: tunnelStatus,
		url: tunnelUrl,
		error: tunnelError,
		binaryInstalled,
		isRunning: activeTunnel?.isRunning ?? false,
	};
}

export async function startTunnel(requestedPort?: number) {
	if (activeTunnel?.isRunning) {
		return {
			ok: true,
			url: tunnelUrl,
			message: 'Tunnel already running',
		};
	}

	try {
		const port = requestedPort || getServerPort() || 9100;

		await killStaleTunnels();

		tunnelStatus = 'starting';
		tunnelError = null;
		progressMessage = 'Initializing...';

		activeTunnel = new OttoTunnel();

		const url = await activeTunnel.start(port, (msg) => {
			progressMessage = msg;
		});

		tunnelUrl = url;
		tunnelStatus = 'connected';
		progressMessage = null;

		activeTunnel.on('error', (err) => {
			logger.error('Tunnel error:', err);
			tunnelError = err.message;
			tunnelStatus = 'error';
		});

		activeTunnel.on('exit', () => {
			tunnelStatus = 'idle';
			tunnelUrl = null;
			activeTunnel = null;
		});

		return {
			ok: true,
			url: tunnelUrl,
			message: 'Tunnel started',
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		tunnelStatus = 'error';
		tunnelError = message;
		progressMessage = null;

		logger.error('Failed to start tunnel:', error);
		return { ok: false, error: message };
	}
}

export function registerExternalTunnel(url?: string) {
	if (!url) {
		return { ok: false, error: 'URL is required' };
	}

	tunnelUrl = url;
	tunnelStatus = 'connected';
	tunnelError = null;
	progressMessage = null;

	return {
		ok: true,
		url: tunnelUrl,
		message: 'External tunnel registered',
	};
}

export function stopTunnel() {
	if (!activeTunnel) {
		return { ok: true, message: 'No tunnel running' };
	}

	try {
		activeTunnel.stop();
		activeTunnel = null;
		tunnelUrl = null;
		tunnelStatus = 'idle';
		tunnelError = null;

		return { ok: true, message: 'Tunnel stopped' };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { ok: false, error: message };
	}
}

export async function getTunnelQRCode() {
	if (!tunnelUrl) {
		return { ok: false, error: 'No tunnel URL available' };
	}

	try {
		const qrCode = await generateQRCode(tunnelUrl);
		return {
			ok: true,
			url: tunnelUrl,
			qrCode,
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { ok: false, error: message };
	}
}

export async function handleTunnelStream(c: Context) {
	return streamSSE(c as Context, async (stream) => {
		const sendEvent = async (data: Record<string, unknown>) => {
			try {
				await stream.write(`data: ${JSON.stringify(data)}\n\n`);
			} catch (error) {
				logger.error('SSE error writing event', error);
			}
		};

		await sendEvent({
			type: 'status',
			status: tunnelStatus,
			url: tunnelUrl,
			error: tunnelError,
			progress: progressMessage,
		});

		const interval = setInterval(async () => {
			await sendEvent({
				type: 'status',
				status: tunnelStatus,
				url: tunnelUrl,
				error: tunnelError,
				progress: progressMessage,
			});
		}, 1000);

		const onAbort = () => {
			clearInterval(interval);
			stream.close();
		};

		c.req.raw.signal.addEventListener('abort', onAbort, { once: true });

		await new Promise<void>((resolve) => {
			c.req.raw.signal.addEventListener('abort', () => resolve(), {
				once: true,
			});
		});

		clearInterval(interval);
	});
}

export function stopActiveTunnel() {
	if (activeTunnel) {
		activeTunnel.stop();
		activeTunnel = null;
		tunnelUrl = null;
		tunnelStatus = 'idle';
	}
}

export function setExternalTunnel(tunnel: OttoTunnel, url: string) {
	activeTunnel = tunnel;
	tunnelUrl = url;
	tunnelStatus = 'connected';
	tunnelError = null;
	progressMessage = null;

	tunnel.on('error', (err) => {
		tunnelError = err.message;
		tunnelStatus = 'error';
	});

	tunnel.on('exit', () => {
		tunnelStatus = 'idle';
		tunnelUrl = null;
		activeTunnel = null;
	});
}

export function getActiveTunnelUrl(): string | null {
	return tunnelUrl;
}
