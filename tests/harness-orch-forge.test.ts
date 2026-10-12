import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { getProjectPluginsDir, type PluginCommand } from '@ottocode/sdk';
import {
	getForgeInventory,
	resolveForgePluginToolExecutionEffects,
	runForgeAction,
} from '../packages/server/src/runtime/forge/index.ts';
import { redactPluginCommand } from '../packages/server/src/runtime/forge/redact.ts';
import {
	executePreparedPluginCommand,
	renderPluginCommand,
	validatePluginCommandTypedArgs,
} from '../packages/server/src/runtime/plugins/commands/index.ts';
import type { PreparedPluginCommand } from '../packages/server/src/runtime/plugins/commands/index.ts';

let projectRoot = '';
const previousXdg = process.env.XDG_CONFIG_HOME;

beforeEach(async () => {
	projectRoot = await mkdtemp(join(tmpdir(), 'otto-harness-orch-forge-'));
	process.env.XDG_CONFIG_HOME = join(projectRoot, 'xdg');
});

afterEach(async () => {
	if (previousXdg === undefined) delete process.env.XDG_CONFIG_HOME;
	else process.env.XDG_CONFIG_HOME = previousXdg;
	await rm(projectRoot, { recursive: true, force: true });
});

async function createToolPlugin(marker: string) {
	await runForgeAction(projectRoot, {
		action: 'create',
		kind: 'plugin',
		name: 'side-effects',
		description: 'Side effects',
	});
	await runForgeAction(projectRoot, {
		action: 'create',
		kind: 'plugin-tool',
		plugin: 'side-effects',
		toolName: 'touch',
		description: 'Writes a marker',
		content: `import { writeFileSync } from 'node:fs';
export default (async () => { writeFileSync(${JSON.stringify(marker)}, 'ran'); return { ok: true }; });
`,
		inputSchema: { type: 'object', properties: {} },
		effects: ['workspace-write'],
	});
}

describe('forge plugin-tool execution safety', () => {
	it('dryRun previews without dispatching the tool', async () => {
		const marker = join(projectRoot, 'marker.txt');
		await createToolPlugin(marker);
		const result = await runForgeAction(projectRoot, {
			action: 'execute',
			kind: 'plugin-tool',
			plugin: 'side-effects',
			toolName: 'touch',
			dryRun: true,
		});
		expect(result).toMatchObject({
			ok: true,
			applied: false,
			execution: null,
			preview: { tool: 'side-effects__touch', effects: ['workspace-write'] },
		});
		expect(await Bun.file(marker).exists()).toBe(false);
	});

	it('rejects executing tools of a disabled plugin', async () => {
		const marker = join(projectRoot, 'marker.txt');
		await createToolPlugin(marker);
		await runForgeAction(projectRoot, {
			action: 'disable',
			kind: 'plugin',
			name: 'side-effects',
		});
		await expect(
			runForgeAction(projectRoot, {
				action: 'execute',
				kind: 'plugin-tool',
				plugin: 'side-effects',
				toolName: 'touch',
			}),
		).rejects.toThrow('disabled');
		expect(await Bun.file(marker).exists()).toBe(false);
	});

	it('resolves the real execution effects for approval', async () => {
		await createToolPlugin(join(projectRoot, 'marker.txt'));
		expect(
			await resolveForgePluginToolExecutionEffects(projectRoot, {
				action: 'execute',
				kind: 'plugin-tool',
				plugin: 'side-effects',
				toolName: 'touch',
			}),
		).toEqual(['workspace-write']);
	});
});

describe('forge secret redaction', () => {
	it('redacts MCP env and header values in previews', async () => {
		const result = await runForgeAction(projectRoot, {
			action: 'create',
			kind: 'mcp-server',
			name: 'secret-server',
			transport: 'http',
			url: 'https://user:pw@mcp.example.test/?token=abc123',
			headers: { Authorization: 'Bearer sk-live-secret' },
			env: { API_KEY: 'sk-env-secret' },
			dryRun: true,
		});
		const text = JSON.stringify(result);
		expect(text).not.toContain('sk-live-secret');
		expect(text).not.toContain('sk-env-secret');
		expect(text).not.toContain('abc123');
		expect(text).toContain('Authorization');
	});

	it('redacts env through the whole command fallback chain', () => {
		const command: PluginCommand = {
			command: 'run',
			env: { TOKEN: 'primary-secret' },
			fallback: {
				command: 'run-fallback',
				env: { TOKEN: 'fallback-secret' },
			},
		};
		const text = JSON.stringify(redactPluginCommand(command));
		expect(text).not.toContain('primary-secret');
		expect(text).not.toContain('fallback-secret');
	});
});

describe('forge plugin capability updates and inventory', () => {
	it('preserves existing agent metadata on partial update', async () => {
		await runForgeAction(projectRoot, {
			action: 'create',
			kind: 'plugin',
			name: 'agents-plugin',
		});
		await runForgeAction(projectRoot, {
			action: 'create',
			kind: 'agent',
			plugin: 'agents-plugin',
			name: 'reviewer',
			description: 'Reviews',
			provider: 'openai',
			model: 'gpt-4o-mini',
			content: 'Review things.',
		});
		await runForgeAction(projectRoot, {
			action: 'update',
			kind: 'agent',
			plugin: 'agents-plugin',
			name: 'reviewer',
			content: 'Review things carefully.',
		});
		const manifest = JSON.parse(
			await readFile(
				join(
					getProjectPluginsDir(projectRoot),
					'agents-plugin',
					'otto.plugin.json',
				),
				'utf8',
			),
		);
		expect(manifest.agents[0]).toMatchObject({
			name: 'reviewer',
			description: 'Reviews',
			provider: 'openai',
			model: 'gpt-4o-mini',
		});
	});

	it('attributes skills by source path, not by name', async () => {
		const pluginDir = join(getProjectPluginsDir(projectRoot), 'owner');
		await mkdir(join(pluginDir, 'skills', 'dup'), { recursive: true });
		await writeFile(
			join(pluginDir, 'otto.plugin.json'),
			JSON.stringify({
				name: 'owner',
				version: '1.0.0',
				skills: [{ name: 'dup', path: 'skills/dup/SKILL.md' }],
			}),
		);
		await writeFile(
			join(pluginDir, 'skills', 'dup', 'SKILL.md'),
			'---\nname: dup\ndescription: plugin copy\n---\n\nPlugin.\n',
		);
		await runForgeAction(projectRoot, {
			action: 'create',
			kind: 'skill',
			name: 'dup',
			description: 'standalone copy',
			content: 'Standalone.',
		});
		const inventory = await getForgeInventory(projectRoot);
		const skill = inventory.skills.find(
			(item) => item.name === 'dup' && item.path.includes('.otto/skills'),
		);
		expect(skill).toMatchObject({ source: 'standalone', mutable: true });
		expect(skill?.plugin).toBeUndefined();
	});
});

describe('plugin command preparation', () => {
	const definition: PluginCommand = {
		command: 'echo',
		args: ['{message}', '--count={count}'],
		parameters: {
			message: { type: 'string', required: true },
			count: { type: 'number', default: 1 },
			loud: { type: 'boolean' },
		},
	};

	it('validates typed args directly, preserving whitespace and quotes', () => {
		const parsed = validatePluginCommandTypedArgs(definition, {
			message: 'two  words "quoted"',
			count: 3,
			loud: false,
		});
		expect(parsed).toEqual({
			ok: true,
			values: { message: 'two  words "quoted"', count: 3, loud: false },
			extraArgs: [],
		});
		expect(
			validatePluginCommandTypedArgs(definition, {
				message: 'x',
				count: true,
			}).ok,
		).toBe(false);
	});

	it('rejects executable placeholders consistently across calls', () => {
		const unsafe: PluginCommand = { command: '{bin}', args: [] };
		for (let index = 0; index < 3; index++) {
			const rendered = renderPluginCommand(
				unsafe,
				{ bin: 'rm' },
				{ pluginDir: projectRoot },
			);
			expect(rendered.ok).toBe(false);
		}
	});

	it('executes the prepared spec without mutating it', () => {
		const prepared: PreparedPluginCommand = Object.freeze({
			projectRoot,
			plugin: 'p',
			commandName: 'c',
			title: 'p c',
			purpose: 'p c',
			primary: Object.freeze({
				command: 'echo',
				args: Object.freeze(['hi']) as string[],
			}),
			command: 'echo hi',
		});
		const result = executePreparedPluginCommand(prepared, {
			isAvailable: () => true,
			start: ({ spec, title }) => {
				spec.args.push('mutated');
				return { terminalId: 't', command: spec.command, title };
			},
		});
		expect(result.execution).toBe('started');
		expect(prepared.primary.args).toEqual(['hi']);
	});
});
