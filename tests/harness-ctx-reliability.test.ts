import { expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	discoverSkills,
	loadSkillFile,
} from '../packages/sdk/src/skills/loader.ts';
import {
	buildSkillTool,
	setSkillSettings,
} from '../packages/sdk/src/skills/tool.ts';
import { MemoryStore } from '@ottocode/sdk/memory';
import { loadConfig } from '../packages/sdk/src/config/src/index.ts';
import {
	getGlobalPluginsConfigPath,
	getProjectPluginsConfigPath,
} from '../packages/sdk/src/config/src/paths.ts';
import {
	getDebugState,
	isTraceEnabled,
	resetDebugState,
	setDebugEnabled,
	setTraceEnabled,
} from '../packages/server/src/runtime/debug/state.ts';

test('runtime debug accessors work without environment initialization', () => {
	resetDebugState();
	expect(isTraceEnabled()).toBe(false);
	setTraceEnabled(true);
	setDebugEnabled(true);
	expect(isTraceEnabled()).toBe(true);
	expect(getDebugState()).toMatchObject({ enabled: true, traceEnabled: true });
	resetDebugState();
});

test('project plugin disable hides only owned global skills and preserves local precedence', async () => {
	const dir = await mkdtemp(join(tmpdir(), 'harness-ctx-plugin-'));
	const previousHome = process.env.HOME;
	const previousXdg = process.env.XDG_CONFIG_HOME;
	process.env.HOME = join(dir, 'home');
	process.env.XDG_CONFIG_HOME = join(dir, 'xdg');
	try {
		const a = join(dir, 'a');
		const b = join(dir, 'b');
		const globalSkill = join(
			process.env.HOME,
			'.agents/skills/harness-fixture',
		);
		await mkdir(globalSkill, { recursive: true });
		await Bun.write(
			join(globalSkill, 'SKILL.md'),
			'---\nname: harness-fixture\ndescription: fixture\n---\nGlobal plugin',
		);
		await Bun.write(join(globalSkill, '.otto-plugin'), 'fixture-plugin');
		await Bun.write(
			getGlobalPluginsConfigPath(),
			JSON.stringify({
				version: 1,
				registries: [],
				plugins: { 'fixture-plugin': { enabled: true } },
			}),
		);
		await Bun.write(
			getProjectPluginsConfigPath(a),
			JSON.stringify({
				version: 1,
				registries: [],
				plugins: { 'fixture-plugin': { enabled: false } },
			}),
		);
		expect(
			(await discoverSkills(a)).some(
				(entry) => entry.name === 'harness-fixture',
			),
		).toBe(false);
		expect(
			(await discoverSkills(b)).some(
				(entry) => entry.name === 'harness-fixture',
			),
		).toBe(true);
		await skill(a, 'Local project');
		const discovered = await discoverSkills(a);
		expect(
			await buildSkillTool(discovered).tool.execute?.(
				{ name: 'harness-fixture' },
				{ toolCallId: 'fixture', messages: [] },
			),
		).toMatchObject({ ok: true, content: 'Local project', scope: 'cwd' });
	} finally {
		if (previousHome === undefined) delete process.env.HOME;
		else process.env.HOME = previousHome;
		if (previousXdg === undefined) delete process.env.XDG_CONFIG_HOME;
		else process.env.XDG_CONFIG_HOME = previousXdg;
		await rm(dir, { recursive: true, force: true });
	}
});

test('automatic embedding backfill only reads authorized current candidates', async () => {
	const dir = await mkdtemp(join(tmpdir(), 'harness-ctx-backfill-'));
	const path = join(dir, 'memory.sqlite');
	const seed = new MemoryStore(path);
	await seed.remember(
		{
			content: 'Foreign confidential telescope',
			source: 'user',
			origin: 'explicit',
			scope: 'project',
		},
		{ projectRoot: join(dir, 'foreign') },
	);
	await seed.remember(
		{
			content: 'Authorized telescope',
			source: 'user',
			origin: 'explicit',
			scope: 'project',
		},
		{ projectRoot: dir },
	);
	seed.close();
	const texts: string[] = [];
	const store = new MemoryStore(path, null, 'otto', {
		model: 'fixture',
		dims: 2,
		async embed(input) {
			texts.push(...input);
			return input.map(() => new Float32Array([1, 0]));
		},
	});
	try {
		await store.recall('telescope', { projectRoot: dir });
		expect(texts).toContain('Authorized telescope');
		expect(texts).not.toContain('Foreign confidential telescope');
	} finally {
		store.close();
		await rm(dir, { recursive: true, force: true });
	}
});

test('OAuth prompts honor overrides and reject conflicting modes', async () => {
	const { composeSystemPrompt } = await import(
		'../packages/server/src/runtime/prompt/builder.ts'
	);
	const dir = await mkdtemp(join(tmpdir(), 'harness-ctx-prompt-'));
	try {
		await mkdir(join(dir, '.otto/prompts/providers'), { recursive: true });
		await Bun.write(
			join(dir, '.otto/prompts/providers/openai.txt'),
			'Project provider override',
		);
		const options = {
			provider: 'openai',
			model: 'fixture',
			projectRoot: dir,
			agentPrompt: '',
			includeEnvironment: false,
			isOpenAIOAuth: true,
		};
		expect((await composeSystemPrompt(options)).prompt).toContain(
			'Project provider override',
		);
		await mkdir(join(dir, '.otto/prompts/models'), { recursive: true });
		await Bun.write(
			join(dir, '.otto/prompts/models/fixture.txt'),
			'Project model override',
		);
		expect((await composeSystemPrompt(options)).prompt).toContain(
			'Project model override',
		);
		expect(
			composeSystemPrompt({ ...options, oneShot: true, guidedMode: true }),
		).rejects.toThrow('mutually exclusive');
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test('turn dumps snapshot, redact, bound inputs and identify the message', async () => {
	const { TurnDumpCollector } = await import(
		'../packages/server/src/runtime/debug/turn-dump/collector.ts'
	);
	const dir = await mkdtemp(join(tmpdir(), 'harness-ctx-dump-'));
	try {
		const collector = new TurnDumpCollector({
			sessionId: 'session',
			messageId: 'message-unique',
			provider: 'openai',
			model: 'test',
			agent: 'build',
			continuationCount: 0,
		});
		const args = {
			apiKey: 'credential-secret',
			headers: { Authorization: 'Bearer secret' },
			content: 'x'.repeat(200000),
			original: 'before',
		};
		collector.recordToolCall(0, 'forge', 'call', args);
		args.original = 'after';
		const path = await collector.flush(dir);
		const dump = await Bun.file(path).json();
		expect(path).toContain('message-unique');
		expect(dump.stream.toolCalls[0].args.original).toBe('before');
		expect(dump.stream.toolCalls[0].args.apiKey).toBe('[REDACTED]');
		expect(dump.stream.toolCalls[0].args.headers.Authorization).toBe(
			'[REDACTED]',
		);
		expect(dump.stream.toolCalls[0].args.content.length).toBeLessThan(51000);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

async function skill(root: string, content: string) {
	const dir = join(root, '.otto/skills/harness-fixture');
	await mkdir(dir, { recursive: true });
	await Bun.write(
		join(dir, 'SKILL.md'),
		`---\nname: harness-fixture\ndescription: Regression fixture\n---\n${content}`,
	);
	return dir;
}

test('skill tools retain discovery scope and settings; cwd overrides repo; symlink files cannot escape', async () => {
	const dir = await mkdtemp(join(tmpdir(), 'harness-ctx-'));
	try {
		const a = join(dir, 'a');
		const b = join(dir, 'b');
		const skillDir = await skill(a, 'Project A');
		await skill(b, 'Project B');
		await skill(dir, 'Repo');
		await discoverSkills(a, dir);
		setSkillSettings(undefined);
		const toolA = buildSkillTool().tool;
		await discoverSkills(b);
		setSkillSettings({ enabled: false });
		const toolB = buildSkillTool().tool;
		const execute = (tool: typeof toolA) =>
			tool.execute?.(
				{ name: 'harness-fixture' },
				{ toolCallId: 'test', messages: [] },
			);
		expect(await execute(toolA)).toMatchObject({
			ok: true,
			content: 'Project A',
		});
		expect(await execute(toolB)).toMatchObject({ ok: false });
		await Bun.write(join(dir, 'secret.txt'), 'secret');
		await symlink(join(dir, 'secret.txt'), join(skillDir, 'escape.txt'));
		await discoverSkills(a);
		expect(await loadSkillFile('harness-fixture', 'escape.txt')).toBeNull();
	} finally {
		setSkillSettings(undefined);
		await rm(dir, { recursive: true, force: true });
	}
});

test('explicit skill expansion retains its discovery registry', async () => {
	const { buildExplicitSkillMentionContext } = await import(
		'../packages/server/src/runtime/prompt/skill-mentions.ts'
	);
	const dir = await mkdtemp(join(tmpdir(), 'harness-ctx-explicit-'));
	try {
		await skill(join(dir, 'a'), 'Project A');
		await skill(join(dir, 'b'), 'Project B');
		const skillsA = await discoverSkills(join(dir, 'a'));
		await discoverSkills(join(dir, 'b'));
		expect(
			await buildExplicitSkillMentionContext({
				content: '@harness-fixture',
				skills: skillsA,
			}),
		).toContain('Project A');
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test('recall never injects predecessors of excluded heads; duplicate saves validate links', async () => {
	const dir = await mkdtemp(join(tmpdir(), 'harness-ctx-memory-'));
	const store = new MemoryStore(join(dir, 'memory.sqlite'));
	const context = { projectRoot: dir };
	try {
		const old = await store.remember(
			{
				content: 'Use telescope old builds',
				source: 'user',
				origin: 'explicit',
				scope: 'project',
			},
			context,
		);
		expect(old.memory).toBeDefined();
		if (!old.memory) throw new Error('Expected predecessor');
		const head = await store.remember(
			{
				content: 'Use telescope new builds',
				source: 'user',
				origin: 'explicit',
				scope: 'project',
				replacesId: old.memory.id,
			},
			context,
		);
		if (!head.memory) throw new Error('Expected head');
		const recalled = await store.recall('telescope', context, {
			excludeIds: [head.memory.id],
		});
		expect(recalled.memories).toEqual([]);
		const duplicate = await store.remember(
			{
				content: 'Use telescope new builds',
				source: 'user',
				origin: 'explicit',
				scope: 'project',
				links: [{ type: 'about', id: 'inaccessible' }],
			},
			context,
		);
		expect(duplicate.status).toBe('rejected');
	} finally {
		store.close();
		await rm(dir, { recursive: true, force: true });
	}
});

test('loadConfig preserves debug flags from project configuration', async () => {
	const dir = await mkdtemp(join(tmpdir(), 'harness-ctx-config-'));
	try {
		await mkdir(join(dir, '.otto'));
		await Bun.write(
			join(dir, '.otto/config.json'),
			JSON.stringify({ debugEnabled: true, debugScopes: ['agent'] }),
		);
		const config = await loadConfig(dir);
		expect(config.debugEnabled).toBe(true);
		expect(config.debugScopes).toEqual(['agent']);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});
