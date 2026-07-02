import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'bun:test';
import {
	TerminalManager,
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
import { buildRunPluginCommandTool } from '../packages/server/src/tools/plugins/run-plugin-command.ts';

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
			expect(result.prompt).toContain('run_plugin_command');
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

	it('requires approval for run_plugin_command in dangerous mode', () => {
		expect(requiresApproval('run_plugin_command', 'dangerous')).toBe(true);
		expect(requiresApproval('run_plugin_command', 'auto')).toBe(false);
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

			const { tool } = buildRunPluginCommandTool(projectRoot);
			const result = await tool.execute?.({
				plugin: 'serve-sim',
				command: 'doctor',
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

			const { tool } = buildRunPluginCommandTool(projectRoot);
			const result = await tool.execute?.({
				plugin: 'hidden',
				command: 'run',
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
