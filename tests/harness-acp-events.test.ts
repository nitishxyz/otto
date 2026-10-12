test('scoped ACP tool updates precede completion', async () => {
	const state = session();
	const updates: string[] = [];
	const client = {
		sessionUpdate: async (notification: {
			update: { sessionUpdate: string };
		}) => {
			updates.push(notification.update.sessionUpdate);
		},
	} as unknown as AgentSideConnection;
	const completed = new Promise<void>((resolve) => {
		state.resolvePrompt = () => {
			updates.push('completed');
			resolve();
		};
	});
	state.unsubscribe = subscribe(
		'otto',
		(event) => {
			void handleOttoEvent(client, event, 'acp', state);
		},
		state.cwd,
	);
	try {
		publish({
			type: 'tool.call',
			sessionId: 'otto',
			projectRoot: state.cwd,
			payload: {
				callId: 'read-call',
				name: 'read',
				args: { path: 'file.txt' },
			},
		});
		publish({
			type: 'tool.result',
			sessionId: 'otto',
			projectRoot: state.cwd,
			payload: {
				callId: 'read-call',
				name: 'read',
				result: { content: 'contents' },
			},
		});
		publish({
			type: 'message.completed',
			sessionId: 'otto',
			projectRoot: state.cwd,
			payload: { id: 'message' },
		});
		await completed;
		expect(updates).toEqual(['tool_call', 'tool_call_update', 'completed']);
	} finally {
		state.unsubscribe?.();
	}
});
import { expect, test } from 'bun:test';
import type { AgentSideConnection } from '@agentclientprotocol/sdk';
import { handleOttoEvent } from '../packages/acp/src/events';
import { ensureAcpServer } from '../packages/acp/src/server';
import type { AcpSession } from '../packages/acp/src/types';
import { publish, subscribe } from '../packages/server/src/events/bus';
import { requestApproval } from '../packages/server/src/runtime/tools/approval';

function session(): AcpSession {
	return {
		sessionId: 'acp',
		ottoSessionId: 'otto',
		cwd: '/tmp/acp-scope',
		cancelled: false,
		assistantMessageId: 'message',
		resolvePrompt: null,
		unsubscribe: null,
		sessionInfoUnsubscribe: null,
		activeTerminals: new Map(),
		streamedToolCalls: new Set(),
		streamedToolContent: new Map(),
		terminalToolCalls: new Map(),
		mode: 'general',
		mcpServers: [],
		additionalDirectories: [],
	};
}

test('ACP rejects remote execution before configuring a server', async () => {
	const previous = process.env.OTTO_SERVER_URL;
	process.env.OTTO_SERVER_URL = 'http://localhost:9999';
	try {
		await expect(ensureAcpServer()).rejects.toThrow('remote');
	} finally {
		if (previous === undefined) delete process.env.OTTO_SERVER_URL;
		else process.env.OTTO_SERVER_URL = previous;
	}
});

for (const approved of [true, false]) {
	test(`ACP resolves project-scoped permission ${approved ? 'accept' : 'reject'}`, async () => {
		const state = session();
		const client = {
			requestPermission: async () => ({
				outcome: {
					outcome: 'selected',
					optionId: approved ? 'allow' : 'reject',
				},
			}),
			sessionUpdate: async () => {},
		} as unknown as AgentSideConnection;
		const unsubscribe = subscribe(
			'otto',
			(event) => {
				void handleOttoEvent(client, event, 'acp', state);
			},
			state.cwd,
		);
		try {
			expect(
				await requestApproval(
					'otto',
					'message',
					crypto.randomUUID(),
					'shell',
					{},
					100,
					state.cwd,
				),
			).toBe(approved);
		} finally {
			unsubscribe();
		}
	});
}

test('ACP reports expired approvals and serializes scoped text updates', async () => {
	const state = session();
	const updates: Array<{ update: { content?: { text?: string } } }> = [];
	const client = {
		requestPermission: async () => ({
			outcome: { outcome: 'selected', optionId: 'allow' },
		}),
		sessionUpdate: async (update: {
			update: { content?: { text?: string } };
		}) => {
			await Bun.sleep(update.update.content?.text === 'one' ? 20 : 0);
			updates.push(update);
		},
	} as unknown as AgentSideConnection;
	await handleOttoEvent(
		client,
		{
			type: 'tool.approval.required',
			sessionId: 'otto',
			projectRoot: state.cwd,
			payload: { callId: 'expired', toolName: 'shell', args: {} },
		},
		'acp',
		state,
	);
	expect(updates.length).toBe(1);
	const pending: Promise<void>[] = [];
	const unsubscribe = subscribe(
		'otto',
		(event) => {
			pending.push(handleOttoEvent(client, event, 'acp', state));
		},
		state.cwd,
	);
	publish({
		type: 'message.part.delta',
		sessionId: 'otto',
		projectRoot: '/tmp/other',
		payload: { messageId: 'message', delta: 'wrong' },
	});
	for (const delta of ['one', 'two'])
		publish({
			type: 'message.part.delta',
			sessionId: 'otto',
			projectRoot: state.cwd,
			payload: { messageId: 'message', delta },
		});
	await Promise.all(pending);
	unsubscribe();
	expect(updates.length).toBe(3);
	expect(updates.slice(1).map((entry) => entry.update.content?.text)).toEqual([
		'one',
		'two',
	]);
});
