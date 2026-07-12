import { getTunnelStatus, startTunnel, stopTunnel } from '@ottocode/api';
import type { Command } from 'commander';
import { daemonAuthHeaders, ensureDaemon, readDaemonToken } from '../daemon.ts';

const TUNNEL_QUERY = {
	mode: 'managed' as const,
	scope: 'remote-control' as const,
};

interface TunnelOptions {
	project?: string;
}

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
	error?: string;
}

function errorMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	if (typeof error === 'string') return error;
	return JSON.stringify(error);
}

async function daemonConnection(version: string, projectRoot?: string) {
	const registration = await ensureDaemon({ version, projectRoot });
	const token = await readDaemonToken();
	return {
		baseURL: registration.url,
		headers: daemonAuthHeaders(token),
	};
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

async function enableTunnel(version: string, projectRoot?: string) {
	const connection = await daemonConnection(version, projectRoot);
	const response = await startTunnel({
		...connection,
		body: TUNNEL_QUERY,
	});
	const result = response.data as TunnelActionResult | undefined;
	if (response.error || !result?.ok) {
		throw new Error(
			result?.error ??
				`Failed to enable machine tunnel: ${errorMessage(response.error)}`,
		);
	}
	console.log(result.message ?? 'Managed machine tunnel enabled');
	if (result.url) console.log(`  url: ${result.url}`);
}

async function showTunnelStatus(version: string, projectRoot?: string) {
	const connection = await daemonConnection(version, projectRoot);
	const response = await getTunnelStatus({
		...connection,
		query: TUNNEL_QUERY,
	});
	if (response.error || !response.data) {
		throw new Error(
			`Failed to get machine tunnel status: ${errorMessage(response.error)}`,
		);
	}
	console.log(formatMachineTunnelStatus(response.data as MachineTunnelStatus));
}

async function disableTunnel(version: string, projectRoot?: string) {
	const connection = await daemonConnection(version, projectRoot);
	const response = await stopTunnel({
		...connection,
		query: TUNNEL_QUERY,
	});
	const result = response.data as TunnelActionResult | undefined;
	if (response.error || !result?.ok) {
		throw new Error(
			result?.error ??
				`Failed to disable machine tunnel: ${errorMessage(response.error)}`,
		);
	}
	console.log(result.message ?? 'Managed machine tunnel disabled');
}

/** Registers persistent machine-sharing tunnel controls. */
export function registerTunnelCommand(program: Command, version: string) {
	const tunnel = program
		.command('tunnel')
		.description('Manage global machine-sharing access');

	const withProject = (command: Command) =>
		command.option(
			'--project <path>',
			'Project used to start the daemon',
			process.cwd(),
		);

	withProject(
		tunnel
			.command('enable')
			.description('Enable persistent machine-sharing access'),
	).action(async (opts: TunnelOptions) => {
		await enableTunnel(version, opts.project);
	});

	withProject(
		tunnel.command('status').description('Show machine-sharing tunnel status'),
	).action(async (opts: TunnelOptions) => {
		await showTunnelStatus(version, opts.project);
	});

	withProject(
		tunnel
			.command('disable')
			.description('Disable persistent machine-sharing access'),
	).action(async (opts: TunnelOptions) => {
		await disableTunnel(version, opts.project);
	});
}
