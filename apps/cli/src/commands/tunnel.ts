import { confirm, isCancel } from '@clack/prompts';
import { connectDaemonApi } from '../daemon.ts';

const TUNNEL_QUERY = {
	mode: 'managed' as const,
	scope: 'remote-control' as const,
};

export interface MachineTunnelStatus {
	status: 'idle' | 'starting' | 'connected' | 'error';
	url: string | null;
	error: string | null;
	isRunning: boolean;
	hostname: string | null;
	ottorouterConnected: boolean;
}

interface TunnelActionResult {
	ok: boolean;
	url?: string | null;
	message?: string;
	code?: string;
	error?: string;
}

/** Formats global machine tunnel status for terminal output. */
export function formatMachineTunnelStatus(status: MachineTunnelStatus): string {
	const lines = [
		`Machine tunnel: ${status.status}`,
		`  running: ${status.isRunning ? 'yes' : 'no'}`,
		`  OttoRouter: ${status.ottorouterConnected ? 'connected' : 'not connected'}`,
	];
	if (status.url) lines.push(`  url: ${status.url}`);
	if (status.hostname) lines.push(`  hostname: ${status.hostname}`);
	if (status.error) lines.push(`  error: ${status.error}`);
	return lines.join('\n');
}

/** Returns whether a managed tunnel failure requires OttoRouter login. */
export function requiresOttoRouterLogin(
	result: TunnelActionResult | undefined,
): boolean {
	return (
		result?.code === 'ottorouter_not_connected' ||
		result?.error?.includes('Connect OttoRouter') === true
	);
}

async function offerOttoRouterLogin(): Promise<boolean> {
	if (process.env.OTTO_CI_MODE === '1' || process.env.CI) {
		throw new Error(
			'OttoRouter login required. Run `otto ottorouter --login`, then retry `otto tunnel enable`.',
		);
	}
	const shouldLogin = await confirm({
		message: 'OttoRouter is not linked. Log in now?',
		initialValue: true,
	});
	if (isCancel(shouldLogin) || !shouldLogin) {
		console.log('Run `otto ottorouter --login` when you are ready.');
		return false;
	}
	const { runAuth } = await import('../auth.ts');
	return Boolean(await runAuth(['login', 'ottorouter']));
}

export async function enableTunnel(
	version: string,
	projectRoot?: string,
	loginOffered = false,
) {
	console.log('Enabling managed machine tunnel...');
	const api = await connectDaemonApi({ version, projectRoot });
	const result = await api.startTunnel(TUNNEL_QUERY);
	if (!result.ok) {
		if (!loginOffered && requiresOttoRouterLogin(result)) {
			const loggedIn = await offerOttoRouterLogin();
			if (loggedIn) await enableTunnel(version, projectRoot, true);
			return;
		}
		throw new Error(result.error ?? 'Failed to enable machine tunnel');
	}
	console.log(result.message ?? 'Managed machine tunnel enabled');
	if (result.url) console.log(`  url: ${result.url}`);
}

export async function showTunnelStatus(version: string, projectRoot?: string) {
	const api = await connectDaemonApi({ version, projectRoot });
	console.log(
		formatMachineTunnelStatus(await api.getTunnelStatus(TUNNEL_QUERY)),
	);
}

export async function disableTunnel(version: string, projectRoot?: string) {
	const api = await connectDaemonApi({ version, projectRoot });
	const result = await api.stopTunnel(TUNNEL_QUERY);
	if (!result.ok) {
		throw new Error(result.error ?? 'Failed to disable machine tunnel');
	}
	console.log(result.message ?? 'Managed machine tunnel disabled');
}
