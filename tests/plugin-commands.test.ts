import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'bun:test';
import {
	getProjectPluginsDir,
	pluginManifestSchema,
	writePluginsConfig,
} from '@ottocode/sdk';
import { TerminalManager } from '@ottocode/sdk';
import {
	createServerTerminalBridge,
	listPluginCommands,
	parsePluginCommandArgs,
	parsePluginCommandInvocation,
	renderPluginCommand,
	resolvePluginCommand,
	runPluginCommand,
} from '../packages/server/src/runtime/plugins/commands/index.ts';
describe('plugin commands runtime', () => {
	async function setupProject() {
		const projectRoot = await mkdtemp(join(tmpdir(), 'otto-plugin-commands-'));
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
		options: {
			name: string;
			enabled?: boolean;
			commands: Record<string, unknown>;
			previewUrl?: string;
		},
	) {
		const pluginDir = join(getProjectPluginsDir(projectRoot), options.name);
		await mkdir(pluginDir, { recursive: true });
		await writeFile(
			join(pluginDir, 'otto.plugin.json'),
			`${JSON.stringify(
				{
					name: options.name,
					version: '1.0.0',
					commands: options.commands,
					browser: options.previewUrl
						? { previewUrl: options.previewUrl }
						: undefined,
				},
				null,
				2,
			)}\n`,
		);
		await writePluginsConfig(
			'project',
			{
				version: 1,
				registries: [],
				plugins: {
					[options.name]: { enabled: options.enabled ?? true },
				},
			},
			projectRoot,
		);
		return pluginDir;
	}

	it('accepts extended plugin command schema fields', () => {
		const manifest = pluginManifestSchema.parse({
			name: 'serve-sim',
			version: '1.0.0',
			commands: {
				start: {
					label: 'Start serve-sim',
					description: 'Start the preview server.',
					command: 'bun',
					args: ['x', 'serve-sim@latest', '--port', '{port}'],
					parameters: {
						port: {
							type: 'string',
							default: '3200',
						},
					},
					allowExtraArgs: true,
					fallback: {
						command: 'npx',
						args: ['--yes', 'serve-sim@latest', '--port', '{port}'],
					},
				},
			},
		});

		expect(manifest.commands?.start?.parameters?.port?.default).toBe('3200');
		expect(manifest.commands?.start?.allowExtraArgs).toBe(true);
		expect(manifest.commands?.start?.fallback?.command).toBe('npx');
	});

	it('lists commands from enabled installed plugins only', async () => {
		const { projectRoot, cleanup } = await setupProject();
		try {
			await installPlugin(projectRoot, {
				name: 'serve-sim',
				previewUrl: 'http://localhost:3200',
				commands: {
					start: {
						label: 'Start serve-sim',
						description: 'Start the preview server.',
						command: 'bun',
						args: ['x', 'serve-sim@latest', '--port', '{port}'],
						parameters: {
							port: { type: 'string', default: '3200' },
						},
					},
					doctor: {
						label: 'Check simulator dependencies',
						command: 'xcrun',
						args: ['simctl', 'list', 'devices'],
					},
				},
			});
			await installPlugin(projectRoot, {
				name: 'hidden-plugin',
				enabled: false,
				commands: {
					start: { command: 'echo', args: ['hidden'] },
				},
			});

			const commands = await listPluginCommands(projectRoot);
			expect(commands).toEqual([
				expect.objectContaining({
					plugin: 'serve-sim',
					command: 'doctor',
					label: 'Check simulator dependencies',
					previewUrl: 'http://localhost:3200',
				}),
				expect.objectContaining({
					plugin: 'serve-sim',
					command: 'start',
					description: 'Start the preview server.',
					parameters: {
						port: { type: 'string', default: '3200' },
					},
				}),
			]);
		} finally {
			await cleanup();
		}
	});

	it('resolves plugin commands and preserves fallback metadata', async () => {
		const { projectRoot, cleanup } = await setupProject();
		try {
			await installPlugin(projectRoot, {
				name: 'serve-sim',
				commands: {
					start: {
						command: 'bun',
						args: ['x', 'serve-sim@latest', '--port', '{port}'],
						parameters: {
							port: { type: 'string', default: '3200' },
						},
						fallback: {
							command: 'npx',
							args: ['--yes', 'serve-sim@latest', '--port', '{port}'],
						},
					},
				},
			});

			const resolved = await resolvePluginCommand(
				projectRoot,
				'serve-sim',
				'start',
			);
			expect(resolved?.commandName).toBe('start');
			expect(resolved?.definition.fallback).toEqual({
				command: 'npx',
				args: ['--yes', 'serve-sim@latest', '--port', '{port}'],
			});
		} finally {
			await cleanup();
		}
	});

	it('returns null for disabled plugins', async () => {
		const { projectRoot, cleanup } = await setupProject();
		try {
			await installPlugin(projectRoot, {
				name: 'serve-sim',
				enabled: false,
				commands: {
					start: { command: 'bun', args: ['x', 'serve-sim@latest'] },
				},
			});

			expect(
				await resolvePluginCommand(projectRoot, 'serve-sim', 'start'),
			).toBeNull();
			expect(await listPluginCommands(projectRoot)).toEqual([]);
		} finally {
			await cleanup();
		}
	});

	it('parses slash plugin command invocations', () => {
		expect(
			parsePluginCommandInvocation('/serve-sim start --port 4000'),
		).toEqual({
			plugin: 'serve-sim',
			command: 'start',
			argsText: '--port 4000',
		});
		expect(parsePluginCommandInvocation('/serve-sim')).toBeNull();
		expect(parsePluginCommandInvocation('/serve-sim ')).toBeNull();
	});

	it('applies defaults and rejects unknown args unless allowExtraArgs is true', () => {
		const definition = {
			command: 'bun',
			args: ['x', 'serve-sim@latest', '--port', '{port}'],
			parameters: {
				port: { type: 'string', default: '3200' },
				mode: { type: 'string', required: true },
			},
		};

		expect(parsePluginCommandArgs('', definition)).toEqual({
			ok: false,
			error: 'Missing required argument: mode',
		});

		expect(
			parsePluginCommandArgs('--port 4000 --mode live', definition),
		).toEqual({
			ok: true,
			values: { port: '4000', mode: 'live' },
			extraArgs: [],
		});

		expect(parsePluginCommandArgs('--mode live --verbose', definition)).toEqual(
			{
				ok: false,
				error: 'Unknown argument: verbose',
			},
		);

		expect(
			parsePluginCommandArgs('--mode live --verbose', {
				...definition,
				allowExtraArgs: true,
			}),
		).toEqual({
			ok: true,
			values: { port: '3200', mode: 'live' },
			extraArgs: ['--verbose'],
		});
	});

	it('renders command args/env/cwd templates and fallback output', async () => {
		const { projectRoot, cleanup } = await setupProject();
		try {
			const pluginDir = await installPlugin(projectRoot, {
				name: 'serve-sim',
				commands: {
					start: {
						command: 'bun',
						args: ['x', 'serve-sim@latest', '--port', '{port}'],
						env: { PORT: '{port}' },
						cwd: 'scripts',
						parameters: {
							port: { type: 'string', default: '3200' },
						},
						allowExtraArgs: true,
						fallback: {
							command: 'npx',
							args: ['--yes', 'serve-sim@latest', '--port', '{port}'],
						},
					},
				},
			});
			await mkdir(join(pluginDir, 'scripts'), { recursive: true });

			const resolved = await resolvePluginCommand(
				projectRoot,
				'serve-sim',
				'start',
			);
			expect(resolved).not.toBeNull();
			if (!resolved) return;

			const parsed = parsePluginCommandArgs(
				'--port 4000 --watch',
				resolved.definition,
			);
			expect(parsed.ok).toBe(true);
			if (!parsed.ok) return;

			const rendered = renderPluginCommand(resolved.definition, parsed.values, {
				pluginDir,
				extraArgs: parsed.extraArgs,
			});
			expect(rendered).toEqual({
				ok: true,
				primary: {
					command: 'bun',
					args: ['x', 'serve-sim@latest', '--port', '4000', '--watch'],
					env: { PORT: '4000' },
					cwd: join(pluginDir, 'scripts'),
				},
				fallback: {
					command: 'npx',
					args: ['--yes', 'serve-sim@latest', '--port', '4000', '--watch'],
					env: undefined,
					cwd: undefined,
				},
			});
		} finally {
			await cleanup();
		}
	});

	it('rejects template placeholders in executable command and unsafe cwd', async () => {
		const { projectRoot, cleanup } = await setupProject();
		try {
			const pluginDir = await installPlugin(projectRoot, {
				name: 'unsafe-plugin',
				commands: {
					start: {
						command: '{tool}',
						args: [],
						parameters: {
							tool: { type: 'string', default: 'bun' },
						},
					},
				},
			});

			const resolved = await resolvePluginCommand(
				projectRoot,
				'unsafe-plugin',
				'start',
			);
			expect(resolved).not.toBeNull();
			if (!resolved) return;

			expect(
				renderPluginCommand(
					resolved.definition,
					{ tool: 'bun' },
					{ pluginDir },
				),
			).toEqual({
				ok: false,
				error: 'Plugin command executable cannot use template placeholders',
			});

			expect(
				renderPluginCommand(
					{
						command: 'bun',
						args: [],
						cwd: '../outside',
					},
					{},
					{ pluginDir },
				),
			).toEqual({
				ok: false,
				error: 'Plugin command cwd must stay inside the plugin directory',
			});
		} finally {
			await cleanup();
		}
	});

	it('reports unavailable terminal bridge with explicit API error', async () => {
		const { projectRoot, cleanup } = await setupProject();
		try {
			await installPlugin(projectRoot, {
				name: 'serve-sim',
				commands: {
					doctor: {
						command: 'echo',
						args: ['ok'],
					},
				},
			});

			await expect(
				runPluginCommand(
					{
						projectRoot,
						plugin: 'serve-sim',
						command: 'doctor',
					},
					createServerTerminalBridge(undefined),
				),
			).rejects.toMatchObject({
				message: 'Plugin command terminal execution is unavailable',
				status: 503,
				code: 'plugin_command_terminal_unavailable',
			});
		} finally {
			await cleanup();
		}
	});

	it('starts a visible terminal through the server bridge', async () => {
		const { projectRoot, cleanup } = await setupProject();
		try {
			await installPlugin(projectRoot, {
				name: 'serve-sim',
				previewUrl: 'http://localhost:3200',
				commands: {
					doctor: {
						label: 'Check simulator dependencies',
						command: 'echo',
						args: ['plugin-command-ok'],
					},
				},
			});

			const manager = new TerminalManager();
			const result = await runPluginCommand(
				{
					projectRoot,
					plugin: 'serve-sim',
					command: 'doctor',
				},
				createServerTerminalBridge(manager),
			);

			expect(result).toEqual({
				command: 'echo plugin-command-ok',
				terminalId: expect.stringMatching(/^term-/),
				title: 'Check simulator dependencies',
				previewUrl: 'http://localhost:3200',
				execution: 'started',
			});
			expect(manager.get(result.terminalId)?.purpose).toBe(
				'Check simulator dependencies',
			);
		} finally {
			await cleanup();
		}
	});
});
