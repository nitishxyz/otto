import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	addMCPServerToConfig,
	loadMCPConfig,
} from '../packages/sdk/src/core/src/mcp/lifecycle.ts';

const temporaryDirectories: string[] = [];
const originalXdgConfigHome = process.env.XDG_CONFIG_HOME;

afterEach(async () => {
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
});
