import {
	getTunnelStatus,
	startTunnel,
	stopTunnel,
	type TunnelScope,
} from '../../routes/tunnel/service.ts';
import type { ForgeInput } from './types.ts';

function tunnelOptions(input: ForgeInput) {
	const scope: TunnelScope = input.tunnelScope ?? 'remote-control';
	const mode = input.tunnelMode ?? 'managed';
	const projectId = input.projectId?.trim();
	if (scope === 'project-share' && !projectId) {
		throw new Error('projectId is required for a project-share tunnel');
	}
	return {
		mode,
		scope,
		...(projectId ? { projectId } : {}),
	};
}

export async function runForgeTunnelAction(input: ForgeInput) {
	const options = tunnelOptions(input);
	if (input.action === 'status') {
		return { ok: true, tunnel: await getTunnelStatus(options) };
	}

	let operation: 'start' | 'stop' | 'restart';
	if (input.action === 'enable') operation = 'start';
	else if (input.action === 'disable') operation = 'stop';
	else if (input.action === 'execute' && input.operation) {
		operation = input.operation;
	} else {
		throw new Error(
			"Tunnel supports status, enable, disable, or execute with operation 'start', 'stop', or 'restart'",
		);
	}

	const plan = {
		action: operation,
		target: {
			kind: 'tunnel' as const,
			scope: 'global' as const,
			name: `${options.mode}-${options.scope}`,
			paths: [],
		},
		exists: (await getTunnelStatus(options)).isRunning,
		changes: [`${operation} ${options.mode} ${options.scope} tunnel`],
	};
	if (input.dryRun) return { ok: true, applied: false, plan };

	if (operation === 'stop') {
		const result = await stopTunnel(options);
		return { ...result, applied: result.ok, plan };
	}
	if (operation === 'restart') {
		const stopped = await stopTunnel(options);
		if (!stopped.ok) return { ...stopped, applied: false, plan };
	}
	const result = await startTunnel(input.port, options);
	return { ...result, applied: result.ok, plan };
}
