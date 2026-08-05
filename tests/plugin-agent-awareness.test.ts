import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'bun:test';
import {
	TerminalManager,
	getLazyToolDefinitions,
	getProjectPluginsDir,
	setTerminalManager,
	unsetTerminalManager,
	writePluginsConfig,
} from '@ottocode/sdk';
import {
	buildPluginCommandLines,
	buildPluginCommandsPrompt,
	MAX_PLUGIN_COMMAND_LINES,
} from '../packages/server/src/runtime/prompt/plugin-commands.ts';
import { requiresApproval } from '../packages/server/src/runtime/tools/approval.ts';
import { buildForgeTool } from '../packages/server/src/tools/forge.ts';
import {
	buildConfiguredServerTools,
	getServerLazyToolDefinitions,
} from '../packages/server/src/tools/lazy.ts';
import { defaultToolConfigForAgent } from '../packages/server/src/runtime/agent/registry.ts';

describe('plugin command agent awareness', () => {
	async function setupProject() {
		const projectRoot = await mkdtemp(join(tmpdir(), 'otto-plugin-agent-'));
		process.env.XDG_CONFIG_HOME = join(projectRoot, 'xdg-config');
		return {
			projectRoot,
			cleanup: async () => {
				await rm(projectRoot, { recursive: true, force: true });
			},
		};
	}

	async function installPlugin(
		projectRoot: string,
		name: string,
		commands: Record<string, unknown>,
		enabled = true,
	) {
		const pluginDir = join(getProjectPluginsDir(projectRoot), name);
		await mkdir(pluginDir, { recursive: true });
		await writeFile(
			join(pluginDir, 'otto.plugin.json'),
			`${JSON.stringify({ name, version: '1.0.0', commands }, null, 2)}\n`,
		);
		await writePluginsConfig(
			'project',
			{
				version: 1,
				registries: [],
				plugins: { [name]: { enabled } },
			},
			projectRoot,
		);
	}

	it('formats plugin command lines with descriptions and arg hints', async () => {
		const lines = buildPluginCommandLines([
			{
				plugin: 'serve-sim',
				command: 'start',
				description: 'Start the serve-sim preview server.',
				parameters: {
					port: { type: 'string', default: '3200' },
				},
				scope: 'project',
			},
		]);

		expect(lines[0]).toBe(
			'- /serve-sim start --port: Start the serve-sim preview server. Opens a visible terminal.',
		);
	});

	it('limits plugin command metadata and reports overflow', () => {
		const entries = Array.from(
			{ length: MAX_PLUGIN_COMMAND_LINES + 3 },
			(_, index) => ({
				plugin: `plugin-${index}`,
				command: 'run',
				scope: 'project' as const,
			}),
		);
		const lines = buildPluginCommandLines(entries);
		expect(lines).toHaveLength(MAX_PLUGIN_COMMAND_LINES + 1);
		expect(lines[MAX_PLUGIN_COMMAND_LINES]).toContain('3 more plugin command');
	});

	it('includes enabled plugin commands in prompt context', async () => {
		const { projectRoot, cleanup } = await setupProject();
		try {
			await installPlugin(projectRoot, 'serve-sim', {
				start: {
					description: 'Start the serve-sim preview server.',
					command: 'echo',
					args: ['ok'],
					parameters: {
						port: { type: 'string', default: '3200' },
					},
				},
			});

			const result = await buildPluginCommandsPrompt(projectRoot);
			expect(result.prompt).toContain('Available plugin commands:');
			expect(result.prompt).toContain('/serve-sim start --port');
			expect(result.prompt).toContain('`forge`');
			expect(result.prompt).toContain('`plugin-command`');
			expect(result.components).toEqual(['plugin-commands']);
		} finally {
			await cleanup();
		}
	});

	it('omits disabled plugin commands from prompt context', async () => {
		const { projectRoot, cleanup } = await setupProject();
		try {
			await installPlugin(
				projectRoot,
				'hidden',
				{ run: { command: 'echo', args: ['hidden'] } },
				false,
			);

			const result = await buildPluginCommandsPrompt(projectRoot);
			expect(result.prompt).toBe('');
		} finally {
			await cleanup();
		}
	});

	it('removes legacy MCP and plugin command tools from the lazy registry', () => {
		const names = getLazyToolDefinitions().map(({ name }) => name);
		const serverNames = getServerLazyToolDefinitions().map(({ name }) => name);
		const buildTools = defaultToolConfigForAgent('build');
		expect(names).not.toContain('mcp_manager');
		expect(names).not.toContain('run_plugin_command');
		expect(serverNames).toEqual(['forge']);
		expect(buildTools.loadable).toContain('forge');
		expect(buildTools.loadable).toContain('mini_app');
		expect(buildTools.firstClass).not.toContain('forge');
		expect(requiresApproval('forge', 'dangerous', { action: 'execute' })).toBe(
			true,
		);
	});

	it('allows an orchestrator to promote Forge to first class explicitly', () => {
		const loadable = buildConfiguredServerTools({
			projectRoot: '/tmp/otto-forge-loadable',
			firstClassNames: [],
			loadableNames: ['forge'],
		});
		expect(loadable.firstClass).toHaveLength(0);
		expect(loadable.loadable.map(({ name }) => name)).toEqual(['forge']);

		const orchestrator = buildConfiguredServerTools({
			projectRoot: '/tmp/otto-forge-orchestrator',
			firstClassNames: ['forge'],
			loadableNames: ['forge'],
		});
		expect(orchestrator.firstClass.map(({ name }) => name)).toEqual(['forge']);
		expect(orchestrator.loadable).toHaveLength(0);
	});

	it('runs enabled plugin commands through the shared terminal bridge', async () => {
		const { projectRoot, cleanup } = await setupProject();
		const manager = new TerminalManager();
		setTerminalManager(manager, projectRoot);
		try {
			await installPlugin(projectRoot, 'serve-sim', {
				doctor: {
					label: 'Check simulator dependencies',
					command: 'echo',
					args: ['agent-tool-ok'],
				},
			});

			const { tool } = buildForgeTool(projectRoot);
			const result = await tool.execute?.({
				action: 'execute',
				kind: 'plugin-command',
				plugin: 'serve-sim',
				commandName: 'doctor',
			});

			expect(result).toEqual({
				ok: true,
				renderedCommand: 'echo agent-tool-ok',
				terminalId: expect.stringMatching(/^term-/),
				title: 'Check simulator dependencies',
				execution: 'started',
			});
			expect(manager.list()).toHaveLength(1);
		} finally {
			unsetTerminalManager(projectRoot);
			await cleanup();
		}
	});

	it('rejects disabled plugin commands in the tool', async () => {
		const { projectRoot, cleanup } = await setupProject();
		try {
			await installPlugin(
				projectRoot,
				'hidden',
				{ run: { command: 'echo', args: ['hidden'] } },
				false,
			);

			const { tool } = buildForgeTool(projectRoot);
			const result = await tool.execute?.({
				action: 'execute',
				kind: 'plugin-command',
				plugin: 'hidden',
				commandName: 'run',
			});

			expect(result).toMatchObject({
				ok: false,
				code: 'plugin_command_not_found',
			});
		} finally {
			await cleanup();
		}
	});
});
