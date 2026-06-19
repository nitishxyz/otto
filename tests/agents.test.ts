import { describe, expect, it } from 'bun:test';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
	createApp,
	getAgentDetail,
	resolveAgentConfig,
	validateAgentName,
} from '@ottocode/server';
import {
	abortSession,
	getRunnerState,
} from '../packages/server/src/runtime/session/queue.ts';

describe('agent config merging', () => {
	it('combines default and appended tools from global and local configs', async () => {
		const workspaceRoot = await mkdtemp(join(tmpdir(), 'otto-agents-'));
		const projectRoot = join(workspaceRoot, 'project');
		const homeDir = join(workspaceRoot, 'home');
		await mkdir(projectRoot, { recursive: true });
		await mkdir(homeDir, { recursive: true });
		const prevHome = process.env.HOME;
		const prevProfile = process.env.USERPROFILE;
		const prevXdg = process.env.XDG_CONFIG_HOME;
		process.env.HOME = homeDir;
		process.env.USERPROFILE = homeDir;
		process.env.XDG_CONFIG_HOME = join(homeDir, '.config');

		try {
			await mkdir(join(homeDir, '.config', 'otto'), { recursive: true });
			await writeFile(
				join(homeDir, '.config', 'otto', 'agents.json'),
				JSON.stringify({
					build: { appendTools: { firstClass: ['search'] } },
				}),
			);
			await mkdir(join(projectRoot, '.otto'), { recursive: true });
			await writeFile(
				join(projectRoot, '.otto', 'agents.json'),
				JSON.stringify({
					build: { prompt: '.otto/agents/build.md' },
				}),
			);

			const cfg = await resolveAgentConfig(projectRoot, 'build');
			expect(cfg.toolConfig.firstClass).toContain('search');
			expect(cfg.toolConfig.firstClass).toContain('read');
		} finally {
			if (prevHome === undefined) delete process.env.HOME;
			else process.env.HOME = prevHome;
			if (prevProfile === undefined) delete process.env.USERPROFILE;
			else process.env.USERPROFILE = prevProfile;
			if (prevXdg === undefined) delete process.env.XDG_CONFIG_HOME;
			else process.env.XDG_CONFIG_HOME = prevXdg;
			await rm(workspaceRoot, { recursive: true, force: true });
		}
	});

	it('resolves provider and model from configuration layers', async () => {
		const workspaceRoot = await mkdtemp(join(tmpdir(), 'otto-agents-'));
		const projectRoot = join(workspaceRoot, 'project');
		const homeDir = join(workspaceRoot, 'home');
		await mkdir(projectRoot, { recursive: true });
		await mkdir(homeDir, { recursive: true });
		const prevHome = process.env.HOME;
		const prevProfile = process.env.USERPROFILE;
		const prevXdg = process.env.XDG_CONFIG_HOME;
		process.env.HOME = homeDir;
		process.env.USERPROFILE = homeDir;
		process.env.XDG_CONFIG_HOME = join(homeDir, '.config');
		try {
			const globalOttoDir = join(homeDir, '.config', 'otto');
			await mkdir(globalOttoDir, { recursive: true });
			await writeFile(
				join(globalOttoDir, 'agents.json'),
				JSON.stringify({
					coder: {
						provider: 'anthropic',
						model: 'claude-3-sonnet-20240229',
					},
				}),
			);
			await mkdir(join(projectRoot, '.otto'), { recursive: true });
			await writeFile(
				join(projectRoot, '.otto', 'agents.json'),
				JSON.stringify({
					coder: {
						model: 'claude-3-5-sonnet-20241022',
					},
				}),
			);
			const cfg = await resolveAgentConfig(projectRoot, 'coder');
			expect(cfg.provider).toBe('anthropic');
			expect(cfg.model).toBe('claude-3-5-sonnet-20241022');
		} finally {
			if (prevHome === undefined) delete process.env.HOME;
			else process.env.HOME = prevHome;
			if (prevProfile === undefined) delete process.env.USERPROFILE;
			else process.env.USERPROFILE = prevProfile;
			if (prevXdg === undefined) delete process.env.XDG_CONFIG_HOME;
			else process.env.XDG_CONFIG_HOME = prevXdg;
			await rm(workspaceRoot, { recursive: true, force: true });
		}
	});

	it('returns built-in, global, and inline prompt metadata', async () => {
		const workspaceRoot = await mkdtemp(join(tmpdir(), 'otto-agents-meta-'));
		const projectRoot = join(workspaceRoot, 'project');
		const homeDir = join(workspaceRoot, 'home');
		await mkdir(projectRoot, { recursive: true });
		await mkdir(homeDir, { recursive: true });
		const prevHome = process.env.HOME;
		const prevProfile = process.env.USERPROFILE;
		const prevXdg = process.env.XDG_CONFIG_HOME;
		process.env.HOME = homeDir;
		process.env.USERPROFILE = homeDir;
		process.env.XDG_CONFIG_HOME = join(homeDir, '.config');

		try {
			const builtin = await getAgentDetail(projectRoot, 'plan');
			expect(builtin.builtin).toBe(true);
			expect(builtin.source).toBe('embedded');
			expect(builtin.promptSource).toContain('fallback:embedded:plan.txt');

			await mkdir(join(homeDir, '.config', 'otto'), { recursive: true });
			await writeFile(
				join(homeDir, '.config', 'otto', 'agents.json'),
				JSON.stringify({
					global_reviewer: {
						prompt: 'Global inline reviewer prompt',
						tools: { firstClass: ['read'] },
					},
				}),
			);

			const global = await getAgentDetail(projectRoot, 'global_reviewer');
			expect(global.custom).toBe(true);
			expect(global.source).toBe('global');
			expect(global.prompt).toBe('Global inline reviewer prompt');
			expect(global.promptSource).toBe('agents.json:inline');
		} finally {
			if (prevHome === undefined) delete process.env.HOME;
			else process.env.HOME = prevHome;
			if (prevProfile === undefined) delete process.env.USERPROFILE;
			else process.env.USERPROFILE = prevProfile;
			if (prevXdg === undefined) delete process.env.XDG_CONFIG_HOME;
			else process.env.XDG_CONFIG_HOME = prevXdg;
			await rm(workspaceRoot, { recursive: true, force: true });
		}
	});

	it('rejects invalid agent names', () => {
		expect(() => validateAgentName('')).toThrow('Agent name is required');
		expect(() => validateAgentName(' reviewer')).toThrow(
			'leading or trailing whitespace',
		);
		expect(() => validateAgentName('bad/name')).toThrow(
			'letters, numbers, underscores, and dashes',
		);
		expect(() => validateAgentName('bad..name')).toThrow(
			'letters, numbers, underscores, and dashes',
		);
	});

	it('returns resolved agent detail metadata', async () => {
		const workspaceRoot = await mkdtemp(join(tmpdir(), 'otto-agents-'));
		const projectRoot = join(workspaceRoot, 'project');
		const homeDir = join(workspaceRoot, 'home');
		await mkdir(join(projectRoot, '.otto', 'agents', 'build'), {
			recursive: true,
		});
		await mkdir(homeDir, { recursive: true });
		const prevHome = process.env.HOME;
		const prevProfile = process.env.USERPROFILE;
		const prevXdg = process.env.XDG_CONFIG_HOME;
		process.env.HOME = homeDir;
		process.env.USERPROFILE = homeDir;
		process.env.XDG_CONFIG_HOME = join(homeDir, '.config');

		try {
			await writeFile(
				join(projectRoot, '.otto', 'agents', 'build', 'agent.md'),
				'Local build prompt',
			);
			await writeFile(
				join(projectRoot, '.otto', 'agents.json'),
				JSON.stringify({
					build: {
						prompt: '.otto/agents/build/agent.md',
						tools: { firstClass: ['read'] },
						appendTools: { firstClass: ['search'] },
					},
				}),
			);

			const detail = await getAgentDetail(projectRoot, 'build');
			expect(detail.name).toBe('build');
			expect(detail.builtin).toBe(true);
			expect(detail.source).toBe('local');
			expect(detail.prompt).toBe('Local build prompt');
			expect(detail.promptSource).toContain('.otto/agents/build/agent.md');
			expect(detail.toolConfig.firstClass).toContain('read');
			expect(detail.toolConfig.firstClass).toContain('progress_update');
			expect(detail.appendToolConfig.firstClass).toContain('search');
			expect(detail.hasLocalOverride).toBe(true);
		} finally {
			if (prevHome === undefined) delete process.env.HOME;
			else process.env.HOME = prevHome;
			if (prevProfile === undefined) delete process.env.USERPROFILE;
			else process.env.USERPROFILE = prevProfile;
			if (prevXdg === undefined) delete process.env.XDG_CONFIG_HOME;
			else process.env.XDG_CONFIG_HOME = prevXdg;
			await rm(workspaceRoot, { recursive: true, force: true });
		}
	});

	it('creates, lists, and deletes local agents through config routes', async () => {
		const workspaceRoot = await mkdtemp(join(tmpdir(), 'otto-agents-route-'));
		const projectRoot = join(workspaceRoot, 'project');
		await mkdir(projectRoot, { recursive: true });
		const app = createApp();
		const projectQuery = `project=${encodeURIComponent(projectRoot)}`;

		try {
			const putResponse = await app.request(
				`http://localhost/v1/config/agents/reviewer?${projectQuery}`,
				{
					method: 'PUT',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({
						prompt: 'Review code carefully.',
						tools: {
							firstClass: ['read', 'search'],
							loadable: ['read_image'],
						},
						promptStorage: 'file',
					}),
				},
			);

			expect(putResponse.status).toBe(200);
			const putPayload = await putResponse.json();
			expect(putPayload.agent.name).toBe('reviewer');
			expect(putPayload.agent.custom).toBe(true);
			expect(putPayload.agent.toolConfig.firstClass).toContain(
				'progress_update',
			);
			expect(putPayload.agent.toolConfig.firstClass).toContain('load_tools');
			expect(putPayload.agent.toolConfig.loadable).toContain('read_image');
			expect(putPayload.agent.promptSource).toContain(
				'.otto/agents/reviewer/agent.md',
			);

			const promptFile = await readFile(
				join(projectRoot, '.otto', 'agents', 'reviewer', 'agent.md'),
				'utf8',
			);
			expect(promptFile).toBe('Review code carefully.');

			const agentsJson = JSON.parse(
				await readFile(join(projectRoot, '.otto', 'agents.json'), 'utf8'),
			);
			expect(agentsJson.reviewer.prompt).toBe('.otto/agents/reviewer/agent.md');
			expect(agentsJson.reviewer.tools.firstClass).toEqual([
				'read',
				'search',
				'progress_update',
				'load_tools',
			]);
			expect(agentsJson.reviewer.tools.loadable).toEqual(['read_image']);

			const detailsResponse = await app.request(
				`http://localhost/v1/config/agents/details?${projectQuery}`,
			);
			expect(detailsResponse.status).toBe(200);
			const detailsPayload = await detailsResponse.json();
			expect(
				detailsPayload.agents.some(
					(agent: { name: string }) => agent.name === 'reviewer',
				),
			).toBe(true);

			const deleteResponse = await app.request(
				`http://localhost/v1/config/agents/reviewer?${projectQuery}`,
				{ method: 'DELETE' },
			);
			expect(deleteResponse.status).toBe(200);
			const deletePayload = await deleteResponse.json();
			expect(deletePayload.deleted).toBe(true);
			expect(deletePayload.builtin).toBe(false);
		} finally {
			await rm(workspaceRoot, { recursive: true, force: true });
		}
	});

	it('resets built-in agent overrides through config routes', async () => {
		const workspaceRoot = await mkdtemp(join(tmpdir(), 'otto-agents-reset-'));
		const projectRoot = join(workspaceRoot, 'project');
		await mkdir(projectRoot, { recursive: true });
		const app = createApp();
		const projectQuery = `project=${encodeURIComponent(projectRoot)}`;

		try {
			const putResponse = await app.request(
				`http://localhost/v1/config/agents/build?${projectQuery}`,
				{
					method: 'PUT',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ tools: { firstClass: ['read'] } }),
				},
			);
			expect(putResponse.status).toBe(200);

			const deleteResponse = await app.request(
				`http://localhost/v1/config/agents/build?${projectQuery}`,
				{ method: 'DELETE' },
			);
			expect(deleteResponse.status).toBe(200);
			const deletePayload = await deleteResponse.json();
			expect(deletePayload.deleted).toBe(true);
			expect(deletePayload.builtin).toBe(true);
			expect(deletePayload.agent.name).toBe('build');
			expect(deletePayload.agent.hasLocalOverride).toBe(false);
			expect(deletePayload.agent.toolConfig.firstClass).toContain('shell');
		} finally {
			await rm(workspaceRoot, { recursive: true, force: true });
		}
	});

	it('lists tools for agent configuration through config routes', async () => {
		const workspaceRoot = await mkdtemp(join(tmpdir(), 'otto-tools-route-'));
		const projectRoot = join(workspaceRoot, 'project');
		await mkdir(projectRoot, { recursive: true });
		const app = createApp();

		try {
			const response = await app.request(
				`http://localhost/v1/config/tools?project=${encodeURIComponent(projectRoot)}`,
			);
			expect(response.status).toBe(200);
			const payload = await response.json();
			const progressUpdate = payload.tools.find(
				(tool: { name: string }) => tool.name === 'progress_update',
			);
			const shell = payload.tools.find(
				(tool: { name: string }) => tool.name === 'shell',
			);
			const loadTools = payload.tools.find(
				(tool: { name: string }) => tool.name === 'load_tools',
			);
			const simulator = payload.tools.find(
				(tool: { name: string }) => tool.name === 'simulator',
			);
			const querySessions = payload.tools.find(
				(tool: { name: string }) => tool.name === 'query_sessions',
			);
			expect(progressUpdate).toMatchObject({
				category: 'core',
				source: 'builtin',
				activation: 'first_class',
				required: true,
				available: true,
			});
			expect(loadTools).toMatchObject({
				category: 'first_class',
				source: 'builtin',
				activation: 'first_class',
				required: true,
				available: true,
			});
			expect(shell).toMatchObject({
				category: 'shell',
				activation: 'first_class',
				risky: true,
				available: true,
			});
			expect(simulator).toMatchObject({
				category: 'loadable',
				source: 'builtin',
				activation: 'loadable',
				available: true,
			});
			expect(querySessions).toMatchObject({
				category: 'research',
				source: 'builtin',
				activation: 'first_class',
				available: true,
			});
		} finally {
			await rm(workspaceRoot, { recursive: true, force: true });
		}
	});

	it('uses agent provider and model overrides for new sessions', async () => {
		const workspaceRoot = await mkdtemp(join(tmpdir(), 'otto-agents-session-'));
		const projectRoot = join(workspaceRoot, 'project');
		await mkdir(join(projectRoot, '.otto'), { recursive: true });
		await writeFile(
			join(projectRoot, '.otto', 'agents.json'),
			JSON.stringify({
				reviewer: {
					prompt: 'Review carefully.',
					provider: 'anthropic',
					model: 'claude-3-5-sonnet-20241022',
				},
			}),
		);
		const app = createApp();

		try {
			const response = await app.request(
				`http://localhost/v1/sessions?project=${encodeURIComponent(projectRoot)}`,
				{
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ agent: 'reviewer' }),
				},
			);

			expect(response.status).toBe(201);
			const session = await response.json();
			expect(session.agent).toBe('reviewer');
			expect(session.provider).toBe('anthropic');
			expect(session.model).toBe('claude-3-5-sonnet-20241022');
		} finally {
			await rm(workspaceRoot, { recursive: true, force: true });
		}
	});

	it('uses switched agent provider and model overrides for messages', async () => {
		const workspaceRoot = await mkdtemp(join(tmpdir(), 'otto-agents-message-'));
		const projectRoot = join(workspaceRoot, 'project');
		await mkdir(join(projectRoot, '.otto'), { recursive: true });
		await writeFile(
			join(projectRoot, '.otto', 'agents.json'),
			JSON.stringify({
				reviewer: {
					prompt: 'Review carefully.',
					provider: 'anthropic',
					model: 'claude-3-5-sonnet-20241022',
				},
			}),
		);
		const prevAnthropicApiKey = process.env.ANTHROPIC_API_KEY;
		process.env.ANTHROPIC_API_KEY = 'test-key';
		const app = createApp();
		let sessionId = '';

		try {
			const createResponse = await app.request(
				`http://localhost/v1/sessions?project=${encodeURIComponent(projectRoot)}`,
				{
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({
						agent: 'general',
						provider: 'anthropic',
						model: 'claude-3-sonnet-20240229',
					}),
				},
			);
			expect(createResponse.status).toBe(201);
			const session = await createResponse.json();
			sessionId = session.id;

			const messageResponse = await app.request(
				`http://localhost/v1/sessions/${sessionId}/messages?project=${encodeURIComponent(projectRoot)}`,
				{
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({
						content: 'Review this session.',
						agent: 'reviewer',
						oneShot: true,
					}),
				},
			);
			expect(messageResponse.status).toBe(202);
			abortSession(sessionId, true);

			const messagesResponse = await app.request(
				`http://localhost/v1/sessions/${sessionId}/messages?without=parts&project=${encodeURIComponent(projectRoot)}`,
			);
			expect(messagesResponse.status).toBe(200);
			const rows = await messagesResponse.json();
			expect(rows.at(-1).agent).toBe('reviewer');
			expect(rows.at(-1).provider).toBe('anthropic');
			expect(rows.at(-1).model).toBe('claude-3-5-sonnet-20241022');
		} finally {
			if (sessionId) {
				abortSession(sessionId, true);
				for (let i = 0; i < 50; i++) {
					const state = getRunnerState(sessionId);
					if (!state?.running) break;
					await new Promise((resolve) => setTimeout(resolve, 10));
				}
			}
			if (prevAnthropicApiKey === undefined)
				delete process.env.ANTHROPIC_API_KEY;
			else process.env.ANTHROPIC_API_KEY = prevAnthropicApiKey;
			await rm(workspaceRoot, { recursive: true, force: true });
		}
	});
});
