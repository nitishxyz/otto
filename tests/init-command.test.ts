import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DB } from '@ottocode/database';
import { COMMANDS as TUI_COMMANDS } from '../apps/tui/src/commands.ts';
import { prepareBuiltinCommand } from '../packages/server/src/runtime/commands/builtins.ts';
import {
	buildInitProjectSnapshot,
	buildInitCommandUserPrompt,
	isInitCommand,
} from '../packages/server/src/runtime/commands/init.ts';
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
	test('detects the built-in slash command', () => {
		expect(isInitCommand('/init')).toBe(true);
		expect(isInitCommand('  /INIT  ')).toBe(true);
		expect(isInitCommand('/init now')).toBe(false);
		expect(isInitCommand('/compact')).toBe(false);
	});

	test('builds a filesystem-grounded project snapshot', async () => {
		const snapshot = await buildInitProjectSnapshot(projectRoot);
		expect(snapshot).toContain('Repo shape: monorepo/workspace');
		expect(snapshot).toContain('Workspace globs: apps/*, packages/*');
		expect(snapshot).toContain('apps/: mobile/, web/');
		expect(snapshot).toContain('packages/: database/, server/');
		expect(snapshot).toContain('packages/server/src/routes: sessions.ts');
		expect(snapshot).toContain('packages/database/src/schema: sessions.ts');
		expect(snapshot).toContain('Existing agent docs: AGENTS.md, mobile.md');
	});

	test('prepares an isolated /init built-in command spec', async () => {
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
					moonshot: { enabled: true },
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

		expect(command?.id).toBe('init');
		expect(command?.agent).toBe('init');
		expect(command?.oneShot).toBe(true);
		expect(command?.omitHistory).toBe(true);
		expect(command?.additionalPromptMessages?.length).toBe(2);
		const prompt = buildInitCommandUserPrompt(projectRoot, 'snapshot');
		expect(prompt).toContain('Root AGENTS.md');
		expect(command?.additionalPromptMessages?.[1]?.content).toContain(
			'Repository snapshot',
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
	});
});
