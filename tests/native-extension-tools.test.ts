import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	discoverProjectTools,
	disposeNativeExtensionHosts,
	getToolMetadata,
	pluginManifestSchema,
	validateNativePlugin,
} from '@ottocode/sdk';

const temporaryRoots: string[] = [];

async function collectToolStream(value: unknown): Promise<{
	result: unknown;
	events: Array<{ delta: string; channel: string }>;
}> {
	const events: Array<{ delta: string; channel: string }> = [];
	let result: unknown;
	for await (const chunk of value as AsyncIterable<
		{ delta: string; channel: string } | { result: unknown }
	>) {
		if ('result' in chunk) result = chunk.result;
		else events.push(chunk);
	}
	return { result, events };
}

const previousEnvironment = {
	HOME: process.env.HOME,
	USERPROFILE: process.env.USERPROFILE,
	XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
	OTTO_NATIVE_EXTENSION_HOST_ENTRY:
		process.env.OTTO_NATIVE_EXTENSION_HOST_ENTRY,
	OTTO_TEST_EXTENSION_SECRET: process.env.OTTO_TEST_EXTENSION_SECRET,
};

afterEach(async () => {
	disposeNativeExtensionHosts();
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
		await writeFile(
			join(projectRoot, 'pixel.png'),
			Buffer.from(
				'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
				'base64',
			),
		);

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
					outputSchema: {
						type: 'object',
						properties: { text: { type: 'string' } },
						required: ['text'],
					},
					effects: ['workspace-read', 'process', 'secrets'],
					secrets: [
						{
							name: 'test-token',
							env: 'OTTO_TEST_EXTENSION_SECRET',
						},
					],
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
				{
					name: 'image',
					entry: 'tool.ts',
					description: 'Return an image to the model',
					inputSchema: { type: 'object', additionalProperties: false },
					effects: ['workspace-read'],
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
	if (context.toolName.endsWith('__image')) {
	  return { content: [await context.output.image('pixel.png')] };
	}
	context.progress({ message: 'reading fixture', channel: 'progress' });
	const count = (await context.storage.get('calls') ?? 0) + 1;
	await context.storage.set('calls', count);
  const fixture = await context.workspace.readText('fixture.txt');
  const child = await context.process.run({
    command: process.execPath,
    args: ['--version'],
  });
  return {
  text: input.text === 'invalid-output' ? 42 : (input.text ?? ''),
    fixture,
    child: child.stdout.trim(),
    hostPid: process.pid,
    bunVersion: Bun.version,
    leakedSecret: process.env.OTTO_TEST_EXTENSION_SECRET ?? null,
  secret: context.secrets.get('test-token'),
  count,
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
		expect(await validateNativePlugin(pluginDir)).toMatchObject({
			ok: true,
			manifest: { name: 'native-test' },
			errors: [],
		});

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
			'secrets',
		]);
		if (!echo?.execute)
			throw new Error('native extension tool is not executable');
		const first = await collectToolStream(
			echo.execute({ text: 'hello' }, {} as never),
		);
		const result = first.result as {
			text: string;
			fixture: string;
			child: string;
			hostPid: number;
			bunVersion: string;
			leakedSecret: string | null;
			secret: string;
			count: number;
		};
		expect(result).toMatchObject({
			text: 'hello',
			fixture: 'workspace data',
			bunVersion: Bun.version,
			leakedSecret: null,
			secret: 'must-not-leak',
			count: 1,
		});
		expect(first.events).toEqual([
			{ channel: 'progress', delta: 'reading fixture' },
		]);
		expect(result.child.length).toBeGreaterThan(0);
		expect(result.hostPid).not.toBe(process.pid);
		const second = await collectToolStream(
			echo.execute({ text: 'again' }, {} as never),
		);
		expect(second.result).toMatchObject({ hostPid: result.hostPid, count: 2 });
		await expect(
			collectToolStream(echo.execute({ text: 'invalid-output' }, {} as never)),
		).rejects.toThrow('failed outputSchema');

		const image = discovered.lazyToolsRecord['native-test__image'];
		if (!image?.execute || !image.toModelOutput)
			throw new Error('image native extension is unavailable');
		const imageResult = await collectToolStream(image.execute({}, {} as never));
		const modelOutput = image.toModelOutput({
			output: imageResult.result,
		} as never);
		expect(modelOutput).toMatchObject({
			type: 'content',
			value: [{ type: 'image-data', mediaType: 'image/png' }],
		});

		const slow = discovered.lazyToolsRecord['native-test__slow'];
		if (!slow?.execute) throw new Error('slow native extension is unavailable');
		await expect(
			collectToolStream(slow.execute({}, {} as never)),
		).rejects.toThrow('Native extension timed out after 100ms');
		const afterTimeout = await collectToolStream(
			echo.execute({ text: 'restarted' }, {} as never),
		);
		expect(afterTimeout.result).toMatchObject({ count: 4 });
		expect((afterTimeout.result as { hostPid: number }).hostPid).not.toBe(
			result.hostPid,
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

	test('requires the secrets effect for declared secrets', () => {
		const result = pluginManifestSchema.safeParse({
			name: 'unsafe-secrets',
			version: '1.0.0',
			tools: [
				{
					name: 'lookup',
					entry: 'tool.ts',
					description: 'Read a secret',
					inputSchema: { type: 'object' },
					secrets: [{ name: 'token', env: 'SERVICE_TOKEN' }],
				},
			],
		});
		expect(result.success).toBe(false);
	});
});
