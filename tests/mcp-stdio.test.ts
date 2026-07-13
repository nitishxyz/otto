import { afterEach, describe, expect, test } from 'bun:test';
import { chmod, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { MCPClientWrapper } from '../packages/sdk/src/core/src/mcp/client.ts';
import { MCPServerManager } from '../packages/sdk/src/core/src/mcp/server-manager.ts';
import { getShellEnvironment } from '../packages/sdk/src/core/src/tools/bin-manager.ts';
import { buildMCPServerConfig } from '../packages/server/src/routes/mcp/service/servers.ts';

const temporaryDirectories: string[] = [];
const originalPath = process.env.PATH;
const originalShell = process.env.SHELL;
const originalFixturePath = process.env.OTTO_TEST_LOGIN_PATH;

afterEach(async () => {
	if (originalPath === undefined) delete process.env.PATH;
	else process.env.PATH = originalPath;
	if (originalShell === undefined) delete process.env.SHELL;
	else process.env.SHELL = originalShell;
	if (originalFixturePath === undefined)
		delete process.env.OTTO_TEST_LOGIN_PATH;
	else process.env.OTTO_TEST_LOGIN_PATH = originalFixturePath;
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

async function createTemporaryDirectory(): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), 'otto-mcp-stdio-'));
	temporaryDirectories.push(directory);
	return directory;
}

describe('MCP stdio transport', () => {
	test('uses executables added by the user shell', async () => {
		if (process.platform === 'win32') return;

		const root = await createTemporaryDirectory();
		const loginBin = join(root, 'login-bin');
		const shell = join(root, 'fixture-shell');
		await mkdir(loginBin);
		await writeFile(
			shell,
			'#!/bin/sh\nexport PATH="$OTTO_TEST_LOGIN_PATH:$PATH"\nexec /bin/sh "$@"\n',
		);
		await chmod(shell, 0o755);

		process.env.PATH = '/usr/bin:/bin';
		process.env.SHELL = shell;
		process.env.OTTO_TEST_LOGIN_PATH = loginBin;

		const env = getShellEnvironment({ envMode: 'login-fresh' });
		expect(env.PATH.split(delimiter)).toContain(loginBin);
	});

	test('includes server stderr when startup fails', async () => {
		if (process.platform === 'win32') return;

		const root = await createTemporaryDirectory();
		const command = join(root, 'failing-mcp');
		await writeFile(
			command,
			'#!/bin/sh\necho "invalid MCP argument" >&2\nexit 1\n',
		);
		await chmod(command, 0o755);

		const client = new MCPClientWrapper({ name: 'failing', command });
		await expect(client.connect()).rejects.toThrow('invalid MCP argument');
		await client.disconnect();
	});

	test('reports stdio startup errors in server status', async () => {
		const root = await createTemporaryDirectory();
		const manager = new MCPServerManager();
		await manager.restartServer({
			name: 'missing',
			command: join(root, 'missing-mcp'),
		});

		const status = (await manager.getStatusAsync()).find(
			(server) => server.name === 'missing',
		);
		expect(status?.connected).toBe(false);
		expect(status?.error).toContain('missing-mcp');
		await manager.stopAll();
	});

	test('rejects smart punctuation in command arguments', () => {
		const result = buildMCPServerConfig({
			name: 'chrome',
			command: 'npx',
			args: ['—yes', 'chrome-devtools-mcp@latest'],
		});

		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toContain('--yes');
	});
});
