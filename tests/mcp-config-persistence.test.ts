import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	addMCPServerToConfig,
	getMCPManager,
	ensureMCPManager,
	loadMCPConfig,
	shutdownMCP,
} from '../packages/sdk/src/core/src/mcp/lifecycle.ts';
import { addMCPServer } from '../packages/server/src/routes/mcp/service/servers.ts';
import {
	startMCPServer,
	stopMCPServer,
} from '../packages/server/src/routes/mcp/service/lifecycle.ts';
import { OAuthCredentialStore } from '../packages/sdk/src/core/src/mcp/oauth/store.ts';

const temporaryDirectories: string[] = [];
const originalXdgConfigHome = process.env.XDG_CONFIG_HOME;

afterEach(async () => {
	await shutdownMCP();
	if (originalXdgConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
	else process.env.XDG_CONFIG_HOME = originalXdgConfigHome;
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

async function createTemporaryDirectory(): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), 'otto-mcp-config-'));
	temporaryDirectories.push(directory);
	return directory;
}

describe('MCP config persistence', () => {
	test('uses the global config by default across projects', async () => {
		const root = await createTemporaryDirectory();
		const projectA = join(root, 'project-a');
		const projectB = join(root, 'project-b');
		process.env.XDG_CONFIG_HOME = join(root, 'config');

		await addMCPServerToConfig(projectA, {
			name: 'shared',
			command: 'shared-mcp',
			scope: 'global',
		});

		const config = await loadMCPConfig(projectB);
		expect(config.servers.map((server) => server.name)).toContain('shared');
		expect(
			await Bun.file(join(projectA, '.otto', 'config.json')).exists(),
		).toBe(false);
	});

	test('does not overwrite malformed existing config', async () => {
		const root = await createTemporaryDirectory();
		const globalConfigDir = join(root, 'config', 'otto');
		const configPath = join(globalConfigDir, 'config.json');
		await mkdir(globalConfigDir, { recursive: true });
		await writeFile(configPath, '{ malformed', 'utf-8');

		await expect(
			addMCPServerToConfig(
				join(root, 'project'),
				{ name: 'shared', command: 'shared-mcp', scope: 'global' },
				globalConfigDir,
			),
		).rejects.toBeInstanceOf(SyntaxError);
		expect(await readFile(configPath, 'utf-8')).toBe('{ malformed');
	});

	test('keeps project overrides ahead of a shared global server', async () => {
		const root = await createTemporaryDirectory();
		const projectA = join(root, 'project-a');
		const projectB = join(root, 'project-b');
		process.env.XDG_CONFIG_HOME = join(root, 'config');

		await addMCPServerToConfig(projectA, {
			name: 'shared',
			command: 'global-mcp',
			scope: 'global',
		});
		await addMCPServerToConfig(projectA, {
			name: 'shared',
			command: 'project-mcp',
			scope: 'project',
		});

		expect((await loadMCPConfig(projectA)).servers[0]?.command).toBe(
			'project-mcp',
		);
		expect((await loadMCPConfig(projectB)).servers[0]?.command).toBe(
			'global-mcp',
		);
	});

	test('propagates global enablement to every active project manager', async () => {
		const root = await createTemporaryDirectory();
		const projectA = join(root, 'project-a');
		const projectB = join(root, 'project-b');
		const projectC = join(root, 'project-c');
		process.env.XDG_CONFIG_HOME = join(root, 'config');
		await ensureMCPManager(projectA);
		await ensureMCPManager(projectB);

		const added = await addMCPServer(
			{
				name: 'shared',
				command: join(root, 'missing-global-mcp'),
				scope: 'global',
			},
			projectA,
		);
		const second = await addMCPServer(
			{
				name: 'secondary',
				command: join(root, 'missing-secondary-mcp'),
				scope: 'global',
			},
			projectA,
		);

		expect(added.ok).toBe(true);
		expect(second.ok).toBe(true);
		expect(
			(await loadMCPConfig(projectA)).servers.every(
				(server) => server.disabled === true,
			),
		).toBe(true);
		for (const projectRoot of [projectA, projectB]) {
			expect(await getMCPManager(projectRoot)?.getStatusAsync()).toHaveLength(
				0,
			);
		}

		const started = await startMCPServer({
			name: 'shared',
			projectRoot: projectB,
			oAuthStore: new OAuthCredentialStore(),
			sessions: new Map(),
		});
		expect(started.ok).toBe(true);
		expect((await loadMCPConfig(projectA)).servers).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ name: 'shared', disabled: false }),
				expect.objectContaining({ name: 'secondary', disabled: true }),
			]),
		);
		for (const projectRoot of [projectA, projectB]) {
			expect(
				(await getMCPManager(projectRoot)?.getStatusAsync())?.map(
					(server) => server.name,
				),
			).toEqual(['shared']);
		}
		await ensureMCPManager(projectC);
		expect(
			(await getMCPManager(projectC)?.getStatusAsync())?.map(
				(server) => server.name,
			),
		).toEqual(['shared']);

		const stopped = await stopMCPServer('shared', projectA);
		expect(stopped.ok).toBe(true);
		expect(
			(await loadMCPConfig(projectB)).servers.find(
				(server) => server.name === 'shared',
			)?.disabled,
		).toBe(true);
		for (const projectRoot of [projectA, projectB, projectC]) {
			expect(
				(await getMCPManager(projectRoot)?.getStatusAsync())?.some(
					(server) => server.name === 'shared',
				),
			).toBe(false);
		}

		const restarted = await startMCPServer({
			name: 'shared',
			projectRoot: projectB,
			oAuthStore: new OAuthCredentialStore(),
			sessions: new Map(),
		});
		expect(restarted.ok).toBe(true);
		expect(
			(await loadMCPConfig(projectA)).servers.find(
				(server) => server.name === 'shared',
			)?.disabled,
		).toBe(false);
		for (const projectRoot of [projectA, projectB, projectC]) {
			expect(
				(await getMCPManager(projectRoot)?.getStatusAsync())?.some(
					(server) => server.name === 'shared',
				),
			).toBe(true);
		}

		const secondaryStarted = await startMCPServer({
			name: 'secondary',
			projectRoot: projectA,
			oAuthStore: new OAuthCredentialStore(),
			sessions: new Map(),
		});
		expect(secondaryStarted.ok).toBe(true);
		expect((await stopMCPServer('shared', projectB)).ok).toBe(true);
		for (const projectRoot of [projectA, projectB, projectC]) {
			expect(
				(await getMCPManager(projectRoot)?.getStatusAsync())?.map(
					(server) => server.name,
				),
			).toEqual(['secondary']);
		}
	});
});
