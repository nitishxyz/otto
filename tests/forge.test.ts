import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
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
