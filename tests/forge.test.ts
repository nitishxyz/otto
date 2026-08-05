import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
	getForgeDocs,
	getForgeInventory,
	planForgeMutation,
	runForgeAction,
	runForgeMutation,
} from '../packages/server/src/runtime/forge/index.ts';
import { requiresApproval } from '../packages/server/src/runtime/tools/approval.ts';

describe('forge', () => {
	let projectRoot = '';

	beforeEach(async () => {
		projectRoot = await mkdtemp(join(tmpdir(), 'otto-forge-'));
	});

	afterEach(async () => {
		await rm(projectRoot, { recursive: true, force: true });
	});

	it('lists bounded documentation topics and returns an exact document', () => {
		const topics = getForgeDocs('skill');
		expect(topics).toMatchObject({
			kind: 'skill',
			topics: expect.arrayContaining([
				expect.objectContaining({ topic: 'getting-started' }),
				expect.objectContaining({ topic: 'manifest' }),
			]),
		});

		const document = getForgeDocs('plugin', 'manifest');
		expect(document).toMatchObject({
			kind: 'plugin',
			topic: 'manifest',
			title: 'Plugin manifest',
		});
		expect('content' in document ? document.content : '').toContain(
			'otto.plugin.json',
		);
	});

	it('searches bundled documentation without reading arbitrary files', () => {
		const result = getForgeDocs(undefined, undefined, 'otto.plugin.json');
		expect(result).toMatchObject({
			query: 'otto.plugin.json',
			matches: expect.arrayContaining([
				expect.objectContaining({ kind: 'plugin', topic: 'manifest' }),
			]),
			truncated: false,
		});
	});

	it('discovers documentation kinds and rejects unknown topics', () => {
		const docs = getForgeDocs();
		expect(docs.kinds).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ kind: 'recipe' }),
				expect.objectContaining({ kind: 'plugin' }),
				expect.objectContaining({ kind: 'app' }),
			]),
		);
		expect(() => getForgeDocs('skill', 'missing')).toThrow(
			'Available topics: getting-started, manifest',
		);
	});

	it('searches the live project tool catalog for agent configuration', async () => {
		const result = await runForgeAction(projectRoot, {
			action: 'capabilities',
			kind: 'agent',
			query: 'filesystem',
		});
		expect(result).toMatchObject({
			ok: true,
			capabilities: {
				kind: 'agent',
				query: 'filesystem',
				tools: expect.arrayContaining([
					expect.objectContaining({
						name: 'read',
						category: 'filesystem',
						available: true,
					}),
				]),
			},
		});
	});

	it('serves documentation through the Forge action', async () => {
		const result = await runForgeAction(projectRoot, {
			action: 'docs',
			kind: 'app',
			topic: 'permissions',
		});
		expect(result).toMatchObject({
			ok: true,
			docs: {
				kind: 'app',
				topic: 'permissions',
			},
		});
	});

	it('documents the shipped Mini App manifest and build workflow', () => {
		const manifest = getForgeDocs('app', 'manifest');
		const runtime = getForgeDocs('app', 'runtime');
		const building = getForgeDocs('app', 'building');

		expect('content' in manifest ? manifest.content : '').toContain(
			'otto://schemas/mini-app/v1',
		);
		expect('content' in runtime ? runtime.content : '').toContain(
			'motion/react',
		);
		expect('content' in building ? building.content : '').toContain(
			'load_tools({ tools: ["mini_app"] })',
		);
		expect('content' in building ? building.content : '').toContain(
			'action: "build"',
		);
	});

	it('documents that normal user app requests are not Forge or Artifact work', () => {
		const intent = getForgeDocs('app', 'intent-and-artifacts');
		const content = 'content' in intent ? intent.content : '';

		expect(content).toContain('Normal project work is the default');
		expect(content).toContain(
			'"Build an app for tracking expenses" → normal application in the current project.',
		);
		expect(content).toContain(
			'Never silently route a request through Forge or install an Otto extension.',
		);
	});

	it('previews a project recipe without writing it', async () => {
		const result = await runForgeMutation(projectRoot, {
			action: 'create',
			kind: 'recipe',
			scope: 'project',
			name: 'release-check',
			description: 'Check release readiness',
			content: 'Run the focused tests and summarize any blockers.',
			dryRun: true,
		});

		expect(result.applied).toBe(false);
		expect(result.plan.preview).toContain(
			'description: "Check release readiness"',
		);
		expect(result.plan.target.paths[0]).toBe(
			join(projectRoot, '.otto', 'recipes', 'release-check.md'),
		);
		expect(await Bun.file(result.plan.target.paths[0] as string).exists()).toBe(
			false,
		);
	});

	it('creates, inventories, updates, and removes a project recipe', async () => {
		const created = await runForgeMutation(projectRoot, {
			action: 'create',
			kind: 'recipe',
			name: 'release-check',
			description: 'Check release readiness',
			content: 'Run the focused tests.',
		});
		const recipePath = created.plan.target.paths[0] as string;
		expect(created.applied).toBe(true);
		expect(await readFile(recipePath, 'utf8')).toContain(
			'Run the focused tests.',
		);

		const inventory = await getForgeInventory(projectRoot);
		expect(inventory.recipes).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					name: 'release-check',
					scope: 'project',
				}),
			]),
		);

		await runForgeMutation(projectRoot, {
			action: 'update',
			kind: 'recipe',
			name: 'release-check',
			content: 'Run lint and focused tests.',
		});
		const updatedContent = await readFile(recipePath, 'utf8');
		expect(updatedContent).toContain('Run lint and focused tests.');
		expect(updatedContent).toContain('description: "Check release readiness"');

		await runForgeMutation(projectRoot, {
			action: 'remove',
			kind: 'recipe',
			name: 'release-check',
		});
		expect(await Bun.file(recipePath).exists()).toBe(false);
	});

	it('creates a validated project skill', async () => {
		const result = await runForgeMutation(projectRoot, {
			action: 'create',
			kind: 'skill',
			name: 'bun-testing',
			description: 'Write focused tests using Bun.',
			content: '# Bun testing\n\nUse `bun:test` and keep fixtures isolated.',
			allowedTools: ['read', 'shell'],
		});

		const skillPath = result.plan.target.paths[0] as string;
		const content = await readFile(skillPath, 'utf8');
		expect(content).toContain('name: "bun-testing"');
		expect(content).toContain('allowed-tools: "read shell"');
	});

	it('manages project MCP configuration through Forge', async () => {
		const created = await runForgeAction(projectRoot, {
			action: 'create',
			kind: 'mcp-server',
			scope: 'project',
			name: 'example',
			transport: 'stdio',
			command: 'echo',
			args: ['hello'],
		});
		expect(created).toMatchObject({
			ok: true,
			applied: true,
			server: {
				name: 'example',
				scope: 'project',
				command: 'echo',
			},
		});

		const inventory = await getForgeInventory(projectRoot);
		expect(inventory.mcpServers).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					name: 'example',
					scope: 'project',
				}),
			]),
		);

		const updated = await runForgeAction(projectRoot, {
			action: 'update',
			kind: 'mcp-server',
			name: 'example',
			args: ['updated'],
			dryRun: true,
		});
		expect(updated).toMatchObject({ ok: true, applied: false });
		expect(JSON.stringify(updated)).toContain('updated');

		const authStatus = await runForgeAction(projectRoot, {
			action: 'status',
			kind: 'mcp-server',
			name: 'example',
		});
		expect(authStatus).toMatchObject({
			ok: true,
			name: 'example',
			auth: { authenticated: false },
		});

		const reauthPreview = await runForgeAction(projectRoot, {
			action: 'reauthenticate',
			kind: 'mcp-server',
			name: 'example',
			dryRun: true,
		});
		expect(reauthPreview).toMatchObject({ ok: true, applied: false });

		await runForgeAction(projectRoot, {
			action: 'disable',
			kind: 'mcp-server',
			name: 'example',
		});
		expect(
			(await getForgeInventory(projectRoot)).mcpServers.find(
				(server) => server.name === 'example',
			)?.disabled,
		).toBe(true);

		await runForgeAction(projectRoot, {
			action: 'remove',
			kind: 'mcp-server',
			name: 'example',
		});
		expect(
			(await getForgeInventory(projectRoot)).mcpServers.some(
				(server) => server.name === 'example',
			),
		).toBe(false);
	});

	it('previews MCP creation with action plan', async () => {
		const result = await runForgeAction(projectRoot, {
			action: 'plan',
			targetAction: 'create',
			kind: 'mcp-server',
			name: 'remote',
			transport: 'http',
			url: 'https://example.com/mcp',
		});
		expect(result).toMatchObject({ ok: true, applied: false });
		expect(JSON.stringify(result)).toContain('https://example.com/mcp');
	});

	it('previews custom provider creation without exposing credentials', async () => {
		const result = await runForgeAction(projectRoot, {
			action: 'create',
			kind: 'provider',
			name: 'forge-test-provider',
			description: 'Forge test provider',
			compatibility: 'openai-compatible',
			baseURL: 'https://models.example.test/v1',
			models: ['test-model'],
			dryRun: true,
		});

		expect(result).toMatchObject({
			ok: true,
			applied: false,
			plan: {
				target: { kind: 'provider', scope: 'global' },
			},
		});
		expect(JSON.stringify(result)).toContain('test-model');
	});

	it('reports safe provider auth status and previews reauthentication', async () => {
		const status = await runForgeAction(projectRoot, {
			action: 'status',
			kind: 'auth',
			name: 'openai',
		});
		expect(status).toMatchObject({
			ok: true,
			auth: { provider: 'openai' },
		});
		expect(JSON.stringify(status)).not.toContain('refresh');
		expect(JSON.stringify(status)).not.toContain('access');

		const preview = await runForgeAction(projectRoot, {
			action: 'reauthenticate',
			kind: 'auth',
			name: 'openai',
			authMethod: 'oauth',
			dryRun: true,
		});
		expect(preview).toMatchObject({ ok: true, applied: false });
	});

	it('previews managed tunnel lifecycle operations', async () => {
		const result = await runForgeAction(projectRoot, {
			action: 'enable',
			kind: 'tunnel',
			tunnelMode: 'managed',
			tunnelScope: 'remote-control',
			dryRun: true,
		});

		expect(result).toMatchObject({
			ok: true,
			applied: false,
			plan: {
				action: 'start',
				target: { kind: 'tunnel', scope: 'global' },
			},
		});
	});

	it('rejects unknown agent tools during planning', async () => {
		expect(
			planForgeMutation(projectRoot, {
				action: 'create',
				kind: 'agent',
				name: 'invalid-tools',
				content: 'Use a tool that is not installed.',
				tools: { firstClass: ['not-a-real-tool'] },
			}),
		).rejects.toThrow(
			'Use Forge action=capabilities with kind=agent to inspect the live project tool catalog',
		);
	});

	it('creates and removes a project agent through agent config management', async () => {
		const result = await runForgeMutation(projectRoot, {
			action: 'create',
			kind: 'agent',
			name: 'security-reviewer',
			description: 'Review code without editing it.',
			content:
				'Review the requested code and report concrete security findings.',
			tools: {
				firstClass: ['read', 'search'],
				loadable: [],
			},
		});

		const [configPath, promptPath] = result.plan.target.paths;
		expect(await Bun.file(configPath as string).exists()).toBe(true);
		expect(await readFile(promptPath as string, 'utf8')).toContain(
			'Review the requested code',
		);

		await runForgeMutation(projectRoot, {
			action: 'remove',
			kind: 'agent',
			name: 'security-reviewer',
		});
		expect(await Bun.file(promptPath as string).exists()).toBe(false);
	});

	it('requires an explicit target action for plans', async () => {
		expect(
			planForgeMutation(projectRoot, {
				action: 'plan',
				kind: 'recipe',
				name: 'release-check',
				content: 'Run tests.',
			}),
		).rejects.toThrow('targetAction is required');
	});

	it('only requires dangerous-mode approval for mutations', () => {
		expect(
			requiresApproval('forge', 'dangerous', { action: 'inventory' }),
		).toBe(false);
		expect(requiresApproval('forge', 'dangerous', { action: 'status' })).toBe(
			false,
		);
		expect(requiresApproval('forge', 'dangerous', { action: 'docs' })).toBe(
			false,
		);
		expect(
			requiresApproval('forge', 'dangerous', { action: 'capabilities' }),
		).toBe(false);
		expect(requiresApproval('forge', 'dangerous', { action: 'plan' })).toBe(
			false,
		);
		expect(
			requiresApproval('forge', 'dangerous', {
				action: 'create',
				dryRun: true,
			}),
		).toBe(false);
		expect(requiresApproval('forge', 'dangerous', { action: 'create' })).toBe(
			true,
		);
		expect(requiresApproval('forge', 'auto', { action: 'create' })).toBe(false);
	});
});
