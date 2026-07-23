import { describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { publish, subscribe } from '../packages/server/src/events/bus.ts';
import {
	listMCPServers,
	stopMCPServer,
} from '../packages/server/src/routes/mcp/service.ts';
import {
	abortActiveShellsForMessage,
	registerActiveShellProcess,
} from '../packages/server/src/runtime/tools/active-shells.ts';
import {
	getPendingApproval,
	requestApproval,
	resolveApproval,
} from '../packages/server/src/runtime/tools/approval.ts';
import {
	abortAndDeleteMessageController,
	setMessageAbortController,
} from '../packages/server/src/runtime/session/queue/state.ts';
import {
	getMCPManager,
	initializeMCP,
	shutdownMCP,
} from '../packages/sdk/src/core/src/mcp/lifecycle.ts';

describe('runtime project scoping', () => {
	it('delivers session events only to matching project subscriptions', () => {
		const seenA: string[] = [];
		const seenB: string[] = [];
		const unsubscribeA = subscribe(
			'same-session',
			(evt) => seenA.push(evt.type),
			'/tmp/project-a',
		);
		const unsubscribeB = subscribe(
			'same-session',
			(evt) => seenB.push(evt.type),
			'/tmp/project-b',
		);

		publish({
			type: 'queue.updated',
			sessionId: 'same-session',
			projectRoot: '/tmp/project-a',
			payload: {},
		});

		unsubscribeA();
		unsubscribeB();

		expect(seenA).toEqual(['queue.updated']);
		expect(seenB).toEqual([]);
	});

	it('scopes message abort controllers by project', () => {
		const aborted: string[] = [];
		const controllerA = new AbortController();
		const controllerB = new AbortController();
		controllerA.signal.addEventListener('abort', () => aborted.push('a'));
		controllerB.signal.addEventListener('abort', () => aborted.push('b'));

		setMessageAbortController('same-message', controllerA, '/tmp/project-a');
		setMessageAbortController('same-message', controllerB, '/tmp/project-b');

		expect(
			abortAndDeleteMessageController(
				'same-message',
				undefined,
				'/tmp/project-a',
			),
		).toBe(true);
		expect(aborted).toEqual(['a']);
		expect(controllerB.signal.aborted).toBe(false);

		expect(
			abortAndDeleteMessageController(
				'same-message',
				undefined,
				'/tmp/project-b',
			),
		).toBe(true);
		expect(aborted).toEqual(['a', 'b']);
	});

	it('scopes approvals by project for duplicate call ids', async () => {
		const approvalA = requestApproval(
			'same-session',
			'message-a',
			'same-call',
			'write',
			{},
			60_000,
			'/tmp/project-a',
		);
		const approvalB = requestApproval(
			'same-session',
			'message-b',
			'same-call',
			'write',
			{},
			60_000,
			'/tmp/project-b',
		);

		expect(getPendingApproval('same-call', '/tmp/project-a')?.messageId).toBe(
			'message-a',
		);
		expect(getPendingApproval('same-call', '/tmp/project-b')?.messageId).toBe(
			'message-b',
		);

		expect(resolveApproval('same-call', true, '/tmp/project-a')).toEqual({
			ok: true,
		});
		await expect(approvalA).resolves.toBe(true);
		expect(getPendingApproval('same-call', '/tmp/project-b')?.messageId).toBe(
			'message-b',
		);

		expect(resolveApproval('same-call', false, '/tmp/project-b')).toEqual({
			ok: true,
		});
		await expect(approvalB).resolves.toBe(false);
	});

	it('scopes active shell aborts by project', () => {
		const aborted: string[] = [];
		const shellA = registerActiveShellProcess({
			projectRoot: '/tmp/project-a',
			sessionId: 'same-session',
			messageId: 'same-message',
			callId: 'call-a',
			command: 'sleep 1',
			cwd: '/tmp/project-a',
			abort: () => aborted.push('a'),
			onDetach: () => {},
		});
		const shellB = registerActiveShellProcess({
			projectRoot: '/tmp/project-b',
			sessionId: 'same-session',
			messageId: 'same-message',
			callId: 'call-b',
			command: 'sleep 1',
			cwd: '/tmp/project-b',
			abort: () => aborted.push('b'),
			onDetach: () => {},
		});

		expect(
			abortActiveShellsForMessage(
				'same-session',
				'same-message',
				'/tmp/project-a',
			),
		).toBe(1);
		expect(aborted).toEqual(['a']);

		shellA.unregister();
		shellB.unregister();
	});

	it('scopes MCP managers by project root', async () => {
		const projectA = '/tmp/otto-mcp-project-a';
		const projectB = '/tmp/otto-mcp-project-b';

		await shutdownMCP();
		try {
			const managerA = await initializeMCP({ servers: [] }, projectA);
			const managerB = await initializeMCP({ servers: [] }, projectB);

			expect(managerA).not.toBe(managerB);
			expect(getMCPManager(projectA)).toBe(managerA);
			expect(getMCPManager(projectB)).toBe(managerB);
			expect(getMCPManager()).toBeNull();

			await shutdownMCP(projectA);
			expect(getMCPManager(projectA)).toBeNull();
			expect(getMCPManager(projectB)).toBe(managerB);
		} finally {
			await shutdownMCP();
		}
	});

	it('lists and stops MCP servers independently by project root', async () => {
		const projectA = await mkdtemp(join(tmpdir(), 'otto-mcp-project-a-'));
		const projectB = await mkdtemp(join(tmpdir(), 'otto-mcp-project-b-'));

		await writeMCPConfig(projectA);
		await writeMCPConfig(projectB);
		await shutdownMCP();
		try {
			let connectedA = true;
			let connectedB = true;
			const managerA = await initializeMCP({ servers: [] }, projectA);
			const managerB = await initializeMCP({ servers: [] }, projectB);
			managerA.getStatusAsync = async () => [
				{ name: 'shared', connected: connectedA, tools: ['tool-a'] },
			];
			managerB.getStatusAsync = async () => [
				{ name: 'shared', connected: connectedB, tools: ['tool-b'] },
			];
			managerA.stopServer = async (name: string) => {
				if (name === 'shared') connectedA = false;
			};
			managerB.stopServer = async (name: string) => {
				if (name === 'shared') connectedB = false;
			};

			expect(await getListedMCPServer(projectA)).toMatchObject({
				connected: true,
				tools: ['tool-a'],
			});
			expect(await getListedMCPServer(projectB)).toMatchObject({
				connected: true,
				tools: ['tool-b'],
			});

			await stopMCPServer('shared', projectA);

			expect(await getListedMCPServer(projectA)).toMatchObject({
				connected: false,
				tools: ['tool-a'],
			});
			expect(await getListedMCPServer(projectB)).toMatchObject({
				connected: true,
				tools: ['tool-b'],
			});
		} finally {
			await shutdownMCP();
			await rm(projectA, { recursive: true, force: true });
			await rm(projectB, { recursive: true, force: true });
		}
	});
});

async function writeMCPConfig(projectRoot: string): Promise<void> {
	await mkdir(join(projectRoot, '.otto'), { recursive: true });
	await writeFile(
		join(projectRoot, '.otto', 'config.json'),
		JSON.stringify({
			mcp: {
				servers: [
					{
						name: 'shared',
						command: 'echo',
						args: ['ok'],
					},
				],
			},
		}),
		'utf-8',
	);
}

async function getListedMCPServer(projectRoot: string) {
	const server = (await listMCPServers(projectRoot)).find(
		(item) => item.name === 'shared',
	);
	expect(server).toBeDefined();
	return server;
}
