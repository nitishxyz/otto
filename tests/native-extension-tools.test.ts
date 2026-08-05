import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	discoverProjectTools,
	getToolMetadata,
	pluginManifestSchema,
} from '@ottocode/sdk';

const temporaryRoots: string[] = [];

const previousEnvironment = {
	HOME: process.env.HOME,
	USERPROFILE: process.env.USERPROFILE,
	XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
	OTTO_NATIVE_EXTENSION_HOST_ENTRY:
		process.env.OTTO_NATIVE_EXTENSION_HOST_ENTRY,
	OTTO_TEST_EXTENSION_SECRET: process.env.OTTO_TEST_EXTENSION_SECRET,
};

afterEach(async () => {
	for (const root of temporaryRoots.splice(0)) {
		await rm(root, { recursive: true, force: true });
	}
	for (const [key, value] of Object.entries(previousEnvironment)) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
});

describe('native extension tools', () => {
	test('discovers manifest tools and executes them in an isolated Bun host', async () => {
		const root = await mkdtemp(join(tmpdir(), 'otto-native-extension-'));
		temporaryRoots.push(root);
		const projectRoot = join(root, 'project');
		const home = join(root, 'home');
		const pluginDir = join(projectRoot, '.otto', 'plugins', 'native-test');
		await mkdir(pluginDir, { recursive: true });
		await mkdir(home, { recursive: true });
		await writeFile(join(projectRoot, 'fixture.txt'), 'workspace data', 'utf8');

		const manifest = pluginManifestSchema.parse({
			name: 'native-test',
			version: '1.0.0',
			tools: [
				{
					name: 'echo',
					entry: 'tool.ts',
					description: 'Echo input from an isolated extension host',
					inputSchema: {
						type: 'object',
						properties: { text: { type: 'string' } },
						required: ['text'],
						additionalProperties: false,
					},
					effects: ['workspace-read', 'process'],
				},
				{
					name: 'inspect',
					entry: 'tool.ts',
					description: 'Another loadable native extension tool',
					inputSchema: { type: 'object', additionalProperties: false },
					effects: ['workspace-read'],
				},
				{
					name: 'slow',
					entry: 'tool.ts',
					description: 'Tool used to verify host timeout enforcement',
					inputSchema: { type: 'object', additionalProperties: false },
					effects: ['workspace-read'],
					timeoutMs: 100,
				},
			],
		});
		await writeFile(
			join(pluginDir, 'otto.plugin.json'),
			`${JSON.stringify(manifest, null, 2)}\n`,
			'utf8',
		);
		await writeFile(
			join(pluginDir, 'tool.ts'),
			`export default async (input, context) => {
  console.log('extension diagnostic');
	if (context.toolName.endsWith('__slow')) await Bun.sleep(1_000);
  const fixture = await context.workspace.readText('fixture.txt');
  const child = await context.process.run({
    command: process.execPath,
    args: ['--version'],
  });
  return {
    text: input.text ?? null,
    fixture,
    child: child.stdout.trim(),
    hostPid: process.pid,
    bunVersion: Bun.version,
    leakedSecret: process.env.OTTO_TEST_EXTENSION_SECRET ?? null,
  };
};\n`,
			'utf8',
		);

		process.env.HOME = home;
		process.env.USERPROFILE = home;
		process.env.XDG_CONFIG_HOME = join(home, '.config');
		process.env.OTTO_TEST_EXTENSION_SECRET = 'must-not-leak';
		process.env.OTTO_NATIVE_EXTENSION_HOST_ENTRY = join(
			import.meta.dir,
			'../packages/sdk/src/core/src/tools/extensions/host-entry.ts',
		);

		const discovered = await discoverProjectTools(projectRoot);
		const inspect = discovered.lazyToolsRecord['native-test__inspect'];
		expect(inspect).toBeDefined();
		expect(getToolMetadata(inspect)).toEqual({
			source: 'extension',
			plugin: 'native-test',
			version: '1.0.0',
			activation: 'loadable',
			effects: ['workspace-read'],
		});
		expect(
			discovered.tools.some((item) => item.name === 'native-test__inspect'),
		).toBe(false);

		const echo = discovered.lazyToolsRecord['native-test__echo'];
		expect(echo).toBeDefined();
		expect(
			discovered.tools.some((item) => item.name === 'native-test__echo'),
		).toBe(false);
		expect(getToolMetadata(echo)?.effects).toEqual([
			'workspace-read',
			'process',
		]);
		if (!echo?.execute)
			throw new Error('native extension tool is not executable');
		const result = (await echo.execute({ text: 'hello' }, {} as never)) as {
			text: string;
			fixture: string;
			child: string;
			hostPid: number;
			bunVersion: string;
			leakedSecret: string | null;
		};
		expect(result).toMatchObject({
			text: 'hello',
			fixture: 'workspace data',
			bunVersion: Bun.version,
			leakedSecret: null,
		});
		expect(result.child.length).toBeGreaterThan(0);
		expect(result.hostPid).not.toBe(process.pid);

		const slow = discovered.lazyToolsRecord['native-test__slow'];
		if (!slow?.execute) throw new Error('slow native extension is unavailable');
		await expect(slow.execute({}, {} as never)).rejects.toThrow(
			'Native extension timed out after 100ms',
		);
	});

	test('rejects tool entries that escape the plugin directory', () => {
		const result = pluginManifestSchema.safeParse({
			name: 'unsafe',
			version: '1.0.0',
			tools: [
				{
					name: 'escape',
					entry: '../tool.ts',
					description: 'Unsafe entry',
					inputSchema: { type: 'object' },
				},
			],
		});
		expect(result.success).toBe(false);
	});
});
