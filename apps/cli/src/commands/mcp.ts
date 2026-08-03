import type { Command } from 'commander';
import {
	listMcpServers,
	testMcpServer,
	addMcpServer,
	removeMcpServer,
	initiateMcpAuth,
	revokeMcpAuth,
	getMcpAuthStatus,
	completeMcpAuth,
	startOAuthCallbackProxy,
} from '@ottocode/api';
import { exec } from 'node:child_process';
import { readDaemonRegistration, readDaemonToken } from '../daemon.ts';

export function registerMCPCommand(program: Command) {
	const mcp = program
		.command('mcp')
		.description('Manage MCP (Model Context Protocol) servers');

	mcp
		.command('list', { isDefault: true })
		.description('List configured MCP servers')
		.option('--project <path>', 'Use project at <path>', process.cwd())
		.action(async () => {
			await runMCPList();
		});

	mcp
		.command('status')
		.description('Show running MCP servers and their tools')
		.option('--project <path>', 'Use project at <path>', process.cwd())
		.action(async () => {
			await runMCPStatus();
		});

	mcp
		.command('test <name>')
		.description('Test connection to an MCP server')
		.option('--project <path>', 'Use project at <path>', process.cwd())
		.action(async (name) => {
			await runMCPTest(name);
		});

	mcp
		.command('add <name>')
		.description('Add an MCP server to project config')
		.option('--command <cmd>', 'Command to run (for stdio)')
		.option('--args <args...>', 'Command arguments')
		.option('--transport <type>', 'Transport type: stdio, http, sse', 'stdio')
		.option('--url <url>', 'Server URL (for http/sse)')
		.option('--header <headers...>', 'Headers (Key: Value)')
		.option('--project <path>', 'Use project at <path>', process.cwd())
		.option('--global', 'Add to global config instead of project', false)
		.action(async (name, opts) => {
			await runMCPAdd(name, {
				transport: opts.transport,
				command: opts.command,
				args: opts.args,
				url: opts.url,
				headers: opts.header,
				global: opts.global,
			});
		});

	mcp
		.command('remove <name>')
		.description('Remove an MCP server from config')
		.option('--project <path>', 'Use project at <path>', process.cwd())
		.option('--global', 'Remove from global config', false)
		.action(async (name) => {
			await runMCPRemove(name);
		});

	mcp
		.command('auth <name>')
		.description('Authenticate with an OAuth MCP server')
		.option('--revoke', 'Revoke stored credentials', false)
		.option('--status', 'Show auth status', false)
		.option('--project <path>', 'Use project at <path>', process.cwd())
		.action(async (name, opts) => {
			await runMCPAuth(name, {
				revoke: opts.revoke,
				status: opts.status,
			});
		});
}

type ServerInfo = {
	name: string;
	transport: string;
	command?: string;
	args?: string[];
	url?: string;
	disabled?: boolean;
	connected?: boolean;
	tools?: string[];
	authRequired?: boolean;
	authenticated?: boolean;
	scope?: string;
	env?: Record<string, string>;
};

async function runMCPList() {
	const { data, error } = await listMcpServers();

	if (error || !data) {
		console.error('Failed to list MCP servers');
		return;
	}

	const servers = (data as { servers: ServerInfo[] }).servers ?? [];

	if (servers.length === 0) {
		console.log('No MCP servers configured.');
		return;
	}

	console.log(`\nMCP Servers (${servers.length}):\n`);
	for (const server of servers) {
		const transport = server.transport ?? 'stdio';
		const status = server.disabled ? ' (disabled)' : '';
		console.log(`  ${server.name} [${transport}]${status}`);
		if (transport === 'stdio') {
			const args = server.args?.length ? ` ${server.args.join(' ')}` : '';
			console.log(`    command: ${server.command}${args}`);
		} else {
			console.log(`    url: ${server.url}`);
		}
		console.log();
	}
}

async function runMCPStatus() {
	const { data, error } = await listMcpServers();

	if (error || !data) {
		console.error('Failed to get MCP status');
		return;
	}

	const servers = (data as { servers: ServerInfo[] }).servers ?? [];

	if (servers.length === 0) {
		console.log('No MCP servers configured.');
		return;
	}

	console.log('\nMCP Server Status:\n');
	for (const server of servers) {
		const icon = server.connected ? '●' : '○';
		console.log(
			`  ${icon} ${server.name} (${server.connected ? 'connected' : 'disconnected'})`,
		);
		if (server.tools?.length) {
			console.log(`    tools: ${server.tools.join(', ')}`);
		}
	}
}

async function runMCPTest(name: string) {
	console.log(`Testing connection to "${name}"...`);

	const { data, error } = await testMcpServer({
		path: { name },
	});

	if (error || !data) {
		console.error(`  status: failed ✗`);
		console.error(
			`  error: ${(error as { error?: string })?.error ?? 'Unknown error'}`,
		);
		process.exit(1);
	}

	const result = data as {
		ok: boolean;
		tools?: Array<{ name: string; description?: string }>;
		error?: string;
	};

	if (!result.ok) {
		console.error('  status: failed ✗');
		console.error(`  error: ${result.error}`);
		process.exit(1);
	}

	console.log('  status: connected ✓');
	const tools = result.tools ?? [];
	console.log(`  tools (${tools.length}):`);
	for (const t of tools) {
		console.log(`    - ${t.name}: ${t.description ?? '(no description)'}`);
	}
	console.log('\nServer test passed ✓');
}

async function runMCPAdd(
	name: string,
	opts: {
		transport: string;
		command?: string;
		args?: string[];
		url?: string;
		headers?: string[];
		global: boolean;
	},
) {
	const t: 'stdio' | 'http' | 'sse' =
		opts.transport === 'http' || opts.transport === 'sse'
			? opts.transport
			: 'stdio';

	if (t === 'stdio' && !opts.command) {
		console.error('--command is required for stdio transport');
		process.exit(1);
	}
	if ((t === 'http' || t === 'sse') && !opts.url) {
		console.error('--url is required for http/sse transport');
		process.exit(1);
	}

	let headers: Record<string, string> | undefined;
	if (opts.headers?.length) {
		headers = {};
		for (const h of opts.headers) {
			const colon = h.indexOf(':');
			if (colon > 0) {
				headers[h.slice(0, colon).trim()] = h.slice(colon + 1).trim();
			}
		}
	}

	const { data, error } = await addMcpServer({
		body: {
			name,
			transport: t,
			...(opts.command ? { command: opts.command } : {}),
			...(opts.args?.length ? { args: opts.args } : {}),
			...(opts.url ? { url: opts.url } : {}),
			...(headers ? { headers } : {}),
			scope: opts.global ? 'global' : 'project',
		},
	});

	if (error || !(data as { ok: boolean })?.ok) {
		console.error(`Failed to add MCP server "${name}"`);
		process.exit(1);
	}

	console.log(`Added MCP server "${name}"`);
}

async function runMCPRemove(name: string) {
	const { data, error } = await removeMcpServer({
		path: { name },
	});

	if (error || !(data as { ok: boolean })?.ok) {
		console.error(`Failed to remove MCP server "${name}"`);
		process.exit(1);
	}

	console.log(`Removed MCP server "${name}"`);
}

async function runMCPAuth(
	name: string,
	opts: { revoke: boolean; status: boolean },
) {
	if (opts.status) {
		const { data } = await getMcpAuthStatus({
			path: { name },
		});

		const status = data as {
			authenticated: boolean;
			authType?: string;
			expiresAt?: number;
		};

		console.log(`\nAuth status for "${name}":`);
		console.log(`  authenticated: ${status?.authenticated ? 'yes' : 'no'}`);
		if (status?.authType) console.log(`  type: ${status.authType}`);
		if (status?.expiresAt) {
			const expiresIn = status.expiresAt - Math.floor(Date.now() / 1000);
			if (expiresIn > 0) {
				console.log(`  expires in: ${Math.floor(expiresIn / 60)} minutes`);
			} else {
				console.log('  token: expired');
			}
		}
		return;
	}

	if (opts.revoke) {
		const { error } = await revokeMcpAuth({
			path: { name },
		});

		if (error) {
			console.error(`Failed to revoke credentials for "${name}"`);
			process.exit(1);
		}

		console.log(`Revoked credentials for "${name}".`);
		return;
	}

	console.log(`\nAuthenticating "${name}"...`);

	const { data, error } = await initiateMcpAuth({
		path: { name },
	});

	if (error) {
		console.error(`Failed to initiate auth for "${name}"`);
		process.exit(1);
	}

	const result = data as {
		ok: boolean;
		authUrl?: string;
		authType?: string;
		sessionId?: string;
		userCode?: string;
		verificationUri?: string;
		interval?: number;
		authenticated?: boolean;
		flowId?: string;
		callbackUrl?: string;
		callbackMode?: 'daemon-loopback' | 'client-relay';
		error?: string;
	};

	if (result.authenticated) {
		console.log('Already authenticated ✓');
		return;
	}

	if (result.authType === 'copilot-device') {
		console.log(`\nOpen: ${result.verificationUri}`);
		console.log(`Enter code: ${result.userCode}\n`);

		if (result.verificationUri) {
			openBrowser(result.verificationUri);
		}

		console.log('⏳ Waiting for authorization...');

		const interval = (result.interval || 5) * 1000 + 1000;
		const maxAttempts = 60;

		for (let i = 0; i < maxAttempts; i++) {
			await new Promise((r) => setTimeout(r, interval));

			const { data: pollData } = await completeMcpAuth({
				path: { name },
				body: { sessionId: result.sessionId },
			});

			const pollResult = pollData as {
				ok: boolean;
				status: string;
				connected?: boolean;
				tools?: string[];
				error?: string;
			};

			if (pollResult?.status === 'complete') {
				console.log(
					`✅ Authenticated! ${pollResult.tools?.length ?? 0} tools available.`,
				);
				return;
			}
			if (pollResult?.status === 'error') {
				console.error(`\n✗ Auth failed: ${pollResult.error}`);
				process.exit(1);
			}
		}

		console.error('\n✗ Auth timed out');
		process.exit(1);
	}

	if (result.authUrl) {
		console.log(`\n🔐 Opening browser for authorization...`);
		console.log(`   ${result.authUrl}`);
		const proxied = await startCliOAuthCallbackProxy(result);
		if (!proxied) openBrowser(result.authUrl);
		console.log('Complete the authorization in your browser.');
	} else {
		console.log('Already authenticated or no auth required.');
	}
}

async function startCliOAuthCallbackProxy(flow: {
	authUrl?: string;
	flowId?: string;
	callbackUrl?: string;
	callbackMode?: 'daemon-loopback' | 'client-relay';
}): Promise<boolean> {
	if (flow.callbackMode === 'daemon-loopback') return false;
	if (!flow.authUrl || !flow.flowId || !flow.callbackUrl) return false;
	const callback = new URL(flow.callbackUrl);
	if (
		callback.protocol !== 'http:' ||
		!['localhost', '127.0.0.1', '[::1]'].includes(callback.hostname)
	) {
		return false;
	}
	const registration = await readDaemonRegistration();
	const token = await readDaemonToken();
	if (!registration || !token) {
		throw new Error('Local daemon is unavailable for the OAuth callback');
	}
	const response = await startOAuthCallbackProxy({
		baseURL: registration.url,
		headers: { 'X-Otto-Server-Token': token },
		body: {
			authorizationUrl: flow.authUrl,
			callbackUrl: flow.callbackUrl,
			remoteBaseUrl: registration.url,
			remoteFlowId: flow.flowId,
			remoteToken: token,
		},
	});
	if (response.error) {
		const error = response.error as { error?: string };
		throw new Error(error.error ?? 'Failed to start OAuth callback proxy');
	}
	return Boolean(response.data?.opened);
}

function openBrowser(url: string) {
	const platform = process.platform;
	const cmd =
		platform === 'darwin'
			? `open "${url}"`
			: platform === 'win32'
				? `start "${url}"`
				: `xdg-open "${url}"`;

	exec(cmd, (err) => {
		if (err) {
			console.log(`  Please open manually: ${url}`);
		}
	});
}
