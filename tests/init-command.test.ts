import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DB } from '@ottocode/database';
import { COMMANDS as TUI_COMMANDS } from '../apps/tui/src/commands.ts';
import { BUILTIN_AGENTS } from '../packages/server/src/presets.ts';
import { prepareBuiltinCommand } from '../packages/server/src/runtime/commands/builtins.ts';
import {
	COMMANDS as WEB_COMMANDS,
	findExactCommand,
	getCommandLabel,
	shouldSendSlashCommandAsMessage,
} from '../packages/web-sdk/src/lib/commands.ts';

let projectRoot = '';

beforeAll(async () => {
	projectRoot = await mkdtemp(join(tmpdir(), 'otto-init-command-'));
	await mkdir(join(projectRoot, '.agents'), { recursive: true });
	await mkdir(join(projectRoot, 'apps', 'mobile'), { recursive: true });
	await mkdir(join(projectRoot, 'apps', 'web'), { recursive: true });
	await mkdir(join(projectRoot, 'packages', 'server', 'src', 'routes'), {
		recursive: true,
	});
	await mkdir(join(projectRoot, 'packages', 'database', 'src', 'schema'), {
		recursive: true,
	});

	await writeFile(
		join(projectRoot, 'package.json'),
		JSON.stringify(
			{
				name: 'fixture-monorepo',
				private: true,
				workspaces: ['apps/*', 'packages/*'],
			},
			null,
			2,
		),
	);
	await writeFile(
		join(projectRoot, 'bunfig.toml'),
		'[install]\nexact = true\n',
	);
	await writeFile(join(projectRoot, 'biome.json'), '{}\n');
	await writeFile(join(projectRoot, 'AGENTS.md'), '# Old agents doc\n');
	await writeFile(join(projectRoot, '.agents', 'mobile.md'), '# Mobile\n');
	await writeFile(
		join(projectRoot, 'apps', 'mobile', 'package.json'),
		JSON.stringify({
			name: '@fixture/mobile',
			private: true,
			scripts: { dev: 'bun' },
		}),
	);
	await writeFile(
		join(projectRoot, 'apps', 'web', 'package.json'),
		JSON.stringify({
			name: '@fixture/web',
			private: true,
			scripts: { dev: 'bun' },
		}),
	);
	await writeFile(
		join(projectRoot, 'packages', 'server', 'package.json'),
		JSON.stringify({
			name: '@fixture/server',
			private: true,
			scripts: { dev: 'bun' },
		}),
	);
	await writeFile(
		join(projectRoot, 'packages', 'database', 'package.json'),
		JSON.stringify({ name: '@fixture/database', private: true }),
	);
	await writeFile(
		join(projectRoot, 'packages', 'server', 'src', 'routes', 'sessions.ts'),
		'export const sessionsRoute = true;\n',
	);
	await writeFile(
		join(projectRoot, 'packages', 'database', 'src', 'schema', 'sessions.ts'),
		'export const sessionsSchema = true;\n',
	);
});

afterAll(async () => {
	if (projectRoot) {
		await rm(projectRoot, { recursive: true, force: true });
	}
});

describe('/init command', () => {
	test('prepares /init through the autonomous built-in recipe', async () => {
		const stateDir = join(
			tmpdir(),
			'otto-home',
			'projects',
			'init-command-test',
		);

		const command = await prepareBuiltinCommand({
			cfg: {
				projectRoot,
				defaults: {
					agent: 'general',
					provider: 'openai',
					model: 'gpt-4o-mini',
					reasoningText: true,
					reasoningLevel: 'high',
				},
				providers: {
					openai: { enabled: true },
					anthropic: { enabled: true },
					google: { enabled: true },
					openrouter: { enabled: true },
					opencode: { enabled: true },
					copilot: { enabled: true },
					ottorouter: { enabled: true },
					xai: { enabled: true },
					zai: { enabled: true },
					'zai-coding': { enabled: true },
					kimi: { enabled: true },
					minimax: { enabled: true },
				},
				paths: {
					projectConfigDir: join(projectRoot, '.otto'),
					projectConfigPath: join(projectRoot, '.otto', 'config.json'),
					projectStateDir: stateDir,
					dataDir: stateDir,
					dbPath: join(stateDir, 'otto.sqlite'),
					attachmentsDir: join(stateDir, 'attachments'),
					debugDir: join(stateDir, 'debug'),
					debugDumpsDir: join(stateDir, 'debug-dumps'),
					logsDir: join(stateDir, 'logs'),
					tmpDir: join(stateDir, 'tmp'),
					cacheDir: join(stateDir, 'cache'),
					globalConfigPath: null,
				},
			},
			db: {} as DB,
			sessionId: 'session-init-test',
			provider: 'openai',
			model: 'gpt-4o-mini',
			content: '/init',
		});

		expect(command?.id).toBe('recipe:init');
		expect(command?.agent).toBe('build');
		expect('init' in BUILTIN_AGENTS).toBe(false);
		expect(command?.oneShot).toBe(true);
		expect(command?.omitHistory).toBe(true);
		expect(command?.additionalPromptMessages).toHaveLength(1);
		expect(command?.additionalPromptMessages?.[0]?.content).toContain(
			'Run the built-in recipe /init.',
		);
		expect(command?.additionalPromptMessages?.[0]?.content).toContain(
			'root `AGENTS.md`',
		);
		expect(command?.additionalPromptMessages?.[0]?.content).toContain(
			'configured for autonomous execution',
		);
	});

	test('exposes /init in web and TUI command palettes', () => {
		expect(WEB_COMMANDS.some((command) => command.id === 'init')).toBe(true);
		expect(TUI_COMMANDS.some((command) => command.name === 'init')).toBe(true);
		expect(findExactCommand('/init')?.id).toBe('init');
		expect(shouldSendSlashCommandAsMessage('init')).toBe(true);
		expect(shouldSendSlashCommandAsMessage('compact')).toBe(true);
		expect(shouldSendSlashCommandAsMessage('help')).toBe(false);
		expect(getCommandLabel('init')).toBe('/init');
		expect(WEB_COMMANDS.some((command) => command.id === 'follow')).toBe(true);
		expect(findExactCommand('/follow')?.id).toBe('follow');
		expect(shouldSendSlashCommandAsMessage('follow')).toBe(false);
	});
});
