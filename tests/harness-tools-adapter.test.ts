import { afterEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { tool, type Tool } from 'ai';
import { z } from 'zod/v3';
import { setToolMetadata } from '@ottocode/sdk';
import { ToolResultDurabilityError } from '@ottocode/sdk/tools/error';
import { subscribe } from '../packages/server/src/events/bus.ts';
import { adaptTools } from '../packages/server/src/tools/adapter.ts';
import type { ToolAdapterContext } from '../packages/server/src/tools/adapter.ts';
import {
	getPendingApproval,
	resolveApproval,
} from '../packages/server/src/runtime/tools/approval.ts';
import { setCwd } from '../packages/server/src/runtime/utils/cwd.ts';
import {
	requestSecureInput,
	resolveSecureInput,
	getPendingSecureInputsForSession,
} from '../packages/server/src/runtime/tools/secure-input.ts';

type Row = Record<string, unknown>;

function createFakeDb(
	options: {
		failInserts?: boolean;
		failuresRemaining?: number;
		failAfterCommit?: boolean;
	} = {},
) {
	const rows: Row[] = [];
	const attempts: Row[] = [];
	const db = {
		insert: () => ({
			values: (value: Row) => {
				const save = async () => {
					attempts.push(value);
					if (options.failInserts || (options.failuresRemaining ?? 0) > 0) {
						if (options.failuresRemaining) options.failuresRemaining--;
						throw new Error('disk full');
					}
					if (!rows.some((row) => row.id === value.id)) rows.push(value);
					if (options.failAfterCommit) {
						options.failAfterCommit = false;
						throw new Error('commit acknowledgement lost');
					}
				};
				return value.type === 'tool_result'
					? { onConflictDoNothing: save }
					: save();
			},
		}),
		select: () => ({ from: () => ({ where: async () => [] }) }),
		update: () => ({ set: () => ({ where: async () => undefined }) }),
	};
	return { db: db as unknown as ToolAdapterContext['db'], rows, attempts };
}

let counter = 0;
function createContext(
	overrides: Partial<ToolAdapterContext> & { db: ToolAdapterContext['db'] },
): ToolAdapterContext {
	counter += 1;
	let index = 0;
	return {
		sessionId: `harness-tools-session-${counter}`,
		messageId: `harness-tools-message-${counter}`,
		assistantPartId: 'assistant-part',
		agent: 'build',
		provider: 'openai',
		model: 'test-model',
		projectRoot: '/tmp/harness-tools-project',
		nextIndex: () => index++,
		stepIndex: 0,
		...overrides,
	};
}

type Adapted = Record<string, Tool>;

async function inputStart(tools: Adapted, name: string, toolCallId: string) {
	await tools[name]?.onInputStart?.({ toolCallId, messages: [] } as never);
}

async function inputDelta(
	tools: Adapted,
	name: string,
	toolCallId: string,
	inputTextDelta: string,
) {
	await tools[name]?.onInputDelta?.({
		toolCallId,
		inputTextDelta,
		messages: [],
	} as never);
}

async function inputAvailable(
	tools: Adapted,
	name: string,
	toolCallId: string,
	input: unknown,
) {
	await tools[name]?.onInputAvailable?.({
		toolCallId,
		input,
		messages: [],
	} as never);
}

function execute(
	tools: Adapted,
	name: string,
	toolCallId: string,
	input: unknown,
	abortSignal?: AbortSignal,
): Promise<unknown> {
	return Promise.resolve(
		tools[name]?.execute?.(
			input as never,
			{
				toolCallId,
				messages: [],
				abortSignal,
			} as never,
		),
	);
}

const tempDirs: string[] = [];
afterEach(async () => {
	for (const dir of tempDirs.splice(0)) {
		await rm(dir, { recursive: true, force: true });
	}
});

async function waitFor(check: () => boolean, timeoutMs = 2000) {
	const start = Date.now();
	while (!check()) {
		if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
}

describe('tool adapter call identity', () => {
	it('keeps args and approvals with their own call id when same-tool calls interleave', async () => {
		const { db, rows } = createFakeDb();
		const ctx = createContext({ db, toolApprovalMode: 'all' });
		const executed: Array<{ callId: string; value: string }> = [];
		const echo = tool({
			description: 'echo',
			inputSchema: z.object({ value: z.string() }),
			execute: async ({ value }, options) => {
				executed.push({ callId: options.toolCallId, value });
				return { ok: true, value };
			},
		});
		const approvals: Array<{ callId: string; args: unknown }> = [];
		const unsubscribe = subscribe(
			ctx.sessionId,
			(event) => {
				if (event.type === 'tool.approval.required') {
					const payload = event.payload as { callId: string; args: unknown };
					approvals.push({ callId: payload.callId, args: payload.args });
				}
			},
			ctx.projectRoot,
		);
		try {
			const tools = adaptTools([{ name: 'echo', tool: echo }], ctx);
			await inputStart(tools, 'echo', 'call-a');
			await inputStart(tools, 'echo', 'call-b');
			await inputDelta(tools, 'echo', 'call-a', '{"value":"a"}');
			await inputAvailable(tools, 'echo', 'call-a', { value: 'a' });
			await inputAvailable(tools, 'echo', 'call-b', { value: 'b' });

			const resultB = execute(tools, 'echo', 'call-b', { value: 'b' });
			const resultA = execute(tools, 'echo', 'call-a', { value: 'a' });

			await waitFor(() => approvals.length === 1);
			expect(approvals[0]).toEqual({ callId: 'call-b', args: { value: 'b' } });
			resolveApproval('call-b', true, ctx.projectRoot);
			await waitFor(() => approvals.length === 2);
			expect(approvals[1]).toEqual({ callId: 'call-a', args: { value: 'a' } });
			resolveApproval('call-a', false, ctx.projectRoot);

			expect(await resultB).toEqual({ ok: true, value: 'b' });
			expect(await resultA).toMatchObject({
				ok: false,
				details: { reason: 'user_rejected' },
			});
			expect(executed).toEqual([{ callId: 'call-b', value: 'b' }]);

			const calls = rows
				.filter((row) => row.type === 'tool_call')
				.map((row) => ({
					callId: row.toolCallId,
					args: JSON.parse(String(row.content)).args,
				}));
			expect(calls).toEqual([
				{ callId: 'call-a', args: { value: 'a' } },
				{ callId: 'call-b', args: { value: 'b' } },
			]);
			const results = rows
				.filter((row) => row.type === 'tool_result')
				.map((row) => ({
					callId: row.toolCallId,
					args: JSON.parse(String(row.content)).args,
				}));
			expect(results).toEqual([
				{ callId: 'call-b', args: { value: 'b' } },
				{ callId: 'call-a', args: { value: 'a' } },
			]);
		} finally {
			unsubscribe();
		}
	});
});

describe('tool adapter policy ordering', () => {
	it('blocks guarded calls without requesting approval', async () => {
		const { db } = createFakeDb();
		const ctx = createContext({ db, toolApprovalMode: 'all' });
		let ran = false;
		const shell = tool({
			description: 'shell',
			inputSchema: z.object({ cmd: z.string() }),
			execute: async () => {
				ran = true;
				return { ok: true };
			},
		});
		let approvalRequests = 0;
		const unsubscribe = subscribe(
			ctx.sessionId,
			(event) => {
				if (event.type === 'tool.approval.required') approvalRequests++;
			},
			ctx.projectRoot,
		);
		try {
			const tools = adaptTools([{ name: 'shell', tool: shell }], ctx);
			await inputAvailable(tools, 'shell', 'call-1', { cmd: 'rm -rf /' });
			const result = await execute(tools, 'shell', 'call-1', {
				cmd: 'rm -rf /',
			});
			expect(result).toMatchObject({
				ok: false,
				details: { reason: 'safety_guard' },
			});
			expect(approvalRequests).toBe(0);
			expect(ran).toBe(false);
		} finally {
			unsubscribe();
		}
	});

	it('requests a single approval when both mode and guard require one', async () => {
		const { db } = createFakeDb();
		const ctx = createContext({ db, toolApprovalMode: 'dangerous' });
		const shell = tool({
			description: 'shell',
			inputSchema: z.object({ cmd: z.string() }),
			execute: async () => ({ ok: true }),
		});
		let approvalRequests = 0;
		const unsubscribe = subscribe(
			ctx.sessionId,
			(event) => {
				if (event.type === 'tool.approval.required') approvalRequests++;
			},
			ctx.projectRoot,
		);
		try {
			const tools = adaptTools([{ name: 'shell', tool: shell }], ctx);
			const pending = execute(tools, 'shell', 'call-sudo', {
				cmd: 'sudo ls',
			});
			await waitFor(() => approvalRequests > 0);
			resolveApproval('call-sudo', true, ctx.projectRoot);
			expect(await pending).toEqual({ ok: true });
			expect(approvalRequests).toBe(1);
		} finally {
			unsubscribe();
		}
	});

	it('aborting a pending approval clears it and reports an aborted outcome', async () => {
		const { db } = createFakeDb();
		const ctx = createContext({ db, toolApprovalMode: 'all' });
		const echo = tool({
			description: 'echo',
			inputSchema: z.object({}),
			execute: async () => ({ ok: true }),
		});
		const tools = adaptTools([{ name: 'echo', tool: echo }], ctx);
		const controller = new AbortController();
		const pending = execute(tools, 'echo', 'call-abort', {}, controller.signal);
		await waitFor(() =>
			Boolean(getPendingApproval('call-abort', ctx.projectRoot)),
		);
		controller.abort();
		expect(await pending).toMatchObject({
			ok: false,
			details: { reason: 'aborted' },
		});
		expect(getPendingApproval('call-abort', ctx.projectRoot)).toBeUndefined();
	});
});

describe('tool adapter canonical paths', () => {
	it('guards the symlink target and executes with the resolved path', async () => {
		const root = await mkdtemp(join(tmpdir(), 'harness-tools-'));
		tempDirs.push(root);
		const project = join(root, 'project');
		const outside = join(root, 'outside');
		await mkdir(join(project, 'src'), { recursive: true });
		await mkdir(outside, { recursive: true });
		await writeFile(join(outside, 'secret.txt'), 'secret');
		await writeFile(join(project, 'src', 'a.ts'), 'a');
		await symlink(outside, join(project, 'link'));

		const { db } = createFakeDb();
		const ctx = createContext({ db, projectRoot: project });
		const seen: string[] = [];
		const read = tool({
			description: 'read',
			inputSchema: z.object({ path: z.string() }),
			execute: async ({ path }) => {
				seen.push(path);
				return { ok: true, path };
			},
		});
		let approvalRequests = 0;
		const unsubscribe = subscribe(
			ctx.sessionId,
			(event) => {
				if (event.type === 'tool.approval.required') approvalRequests++;
			},
			ctx.projectRoot,
		);
		try {
			const tools = adaptTools([{ name: 'read', tool: read }], ctx);

			setCwd(ctx.sessionId, 'src');
			expect(await execute(tools, 'read', 'call-in', { path: 'a.ts' })).toEqual(
				{ ok: true, path: 'src/a.ts' },
			);
			expect(approvalRequests).toBe(0);

			setCwd(ctx.sessionId, '.');
			const pending = execute(tools, 'read', 'call-link', {
				path: 'link/secret.txt',
			});
			await waitFor(() => approvalRequests === 1);
			resolveApproval('call-link', true, ctx.projectRoot);
			const result = (await pending) as { path: string };
			expect(result.path.endsWith(join('outside', 'secret.txt'))).toBe(true);
			expect(result.path.includes(`${join('project', 'link')}`)).toBe(false);
		} finally {
			unsubscribe();
		}
	});

	it('rejects cd into a missing directory and outside the project', async () => {
		const root = await mkdtemp(join(tmpdir(), 'harness-tools-cd-'));
		tempDirs.push(root);
		await mkdir(join(root, 'pkg'), { recursive: true });
		const { db } = createFakeDb();
		const ctx = createContext({ db, projectRoot: root });
		const cd = tool({
			description: 'cd',
			inputSchema: z.object({ path: z.string() }),
			execute: async ({ path }) => ({ cwd: path }),
		});
		const tools = adaptTools([{ name: 'cd', tool: cd }], ctx);
		expect(await execute(tools, 'cd', 'cd-1', { path: 'pkg' })).toEqual({
			cwd: 'pkg',
		});
		expect(
			await execute(tools, 'cd', 'cd-2', { path: 'missing' }),
		).toMatchObject({ ok: false });
		expect(
			await execute(tools, 'cd', 'cd-3', { path: tmpdir() }),
		).toMatchObject({ ok: false });
	});
});

describe('tool adapter sensitive inputs', () => {
	it('redacts declared secrets from persistence, events, and deltas', async () => {
		const { db, rows } = createFakeDb();
		const ctx = createContext({ db });
		let received: unknown;
		const secretTool = tool({
			description: 'auth',
			inputSchema: z.object({
				apiKey: z.string(),
				env: z.record(z.string()).optional(),
			}),
			execute: async (input) => {
				received = input;
				return { ok: true };
			},
		});
		setToolMetadata(secretTool, {
			source: 'builtin',
			sensitiveInputs: [{ path: 'apiKey' }, { path: 'env.*' }],
		});
		const published: string[] = [];
		const unsubscribe = subscribe(
			ctx.sessionId,
			(event) => published.push(JSON.stringify(event)),
			ctx.projectRoot,
		);
		try {
			const tools = adaptTools([{ name: 'auth', tool: secretTool }], ctx);
			const input = { apiKey: 'sk-live-123', env: { TOKEN: 'tok-456' } };
			await inputStart(tools, 'auth', 'secret-call');
			await inputDelta(tools, 'auth', 'secret-call', JSON.stringify(input));
			await inputAvailable(tools, 'auth', 'secret-call', input);
			await execute(tools, 'auth', 'secret-call', input);

			expect(received).toEqual(input);
			const serialized = JSON.stringify(rows) + published.join('\n');
			expect(serialized).not.toContain('sk-live-123');
			expect(serialized).not.toContain('tok-456');
			expect(published.some((event) => event.includes('tool.delta'))).toBe(
				false,
			);
		} finally {
			unsubscribe();
		}
	});
});

describe('tool adapter outcomes and finalization', () => {
	it('consumes a promised async iterable before finalization', async () => {
		const { db, rows } = createFakeDb();
		const ctx = createContext({ db });
		const streaming = tool({
			description: 'promised stream',
			inputSchema: z.object({}),
			execute: async () =>
				(async function* () {
					yield { delta: 'working' };
					yield { result: { ok: true, value: 42 } };
				})(),
		} as never) as Tool;
		const tools = adaptTools([{ name: 'streamer', tool: streaming }], ctx);
		expect(await execute(tools, 'streamer', 'promised', {})).toEqual({
			ok: true,
			value: 42,
		});
		const resultRow = rows.find((row) => row.type === 'tool_result');
		expect(JSON.parse(String(resultRow?.content)).result).toEqual({
			ok: true,
			value: 42,
		});
	});

	it('disposes secure input resolved synchronously by its required event', async () => {
		const { db } = createFakeDb();
		const ctx = createContext({ db });
		const controller = new AbortController();
		let resolutions = 0;
		const unsubscribe = subscribe(
			ctx.sessionId,
			(event) => {
				if (event.type === 'shell.secure_input.required') {
					resolveSecureInput(
						(event.payload as { promptId: string }).promptId,
						'secret',
						ctx.projectRoot,
					);
				}
				if (event.type === 'shell.secure_input.resolved') resolutions++;
			},
			ctx.projectRoot,
		);
		try {
			expect(
				await requestSecureInput({
					projectRoot: ctx.projectRoot,
					sessionId: ctx.sessionId,
					messageId: ctx.messageId,
					prompt: 'Secret',
					allowRemember: false,
					signal: controller.signal,
				}),
			).toBe('secret');
			controller.abort();
			expect(
				getPendingSecureInputsForSession(ctx.sessionId, ctx.projectRoot),
			).toHaveLength(0);
			expect(resolutions).toBe(1);
		} finally {
			unsubscribe();
		}
	});

	it('retries transient result persistence without repeating the side effect', async () => {
		const { db, rows, attempts } = createFakeDb({ failuresRemaining: 1 });
		const ctx = createContext({ db });
		let executions = 0;
		const echo = tool({
			description: 'echo',
			inputSchema: z.object({}),
			execute: async () => ({ ok: true, value: ++executions }),
		});
		const tools = adaptTools([{ name: 'echo', tool: echo }], ctx);
		let events = 0;
		const unsubscribe = subscribe(
			ctx.sessionId,
			(event) => {
				if (event.type === 'tool.result') {
					expect(rows.filter((row) => row.type === 'tool_result')).toHaveLength(
						1,
					);
					events++;
				}
			},
			ctx.projectRoot,
		);
		try {
			expect(await execute(tools, 'echo', 'persist-call', {})).toEqual({
				ok: true,
				value: 1,
			});
			expect(executions).toBe(1);
			expect(attempts).toHaveLength(2);
			expect(attempts[0]).toEqual(attempts[1]);
			expect(events).toBe(1);
		} finally {
			unsubscribe();
		}
	});

	it('propagates permanent durability failure and retries only finalization on recovery', async () => {
		const options = { failInserts: true };
		const { db, rows, attempts } = createFakeDb(options);
		const ctx = createContext({ db });
		let executions = 0;
		const echo = tool({
			description: 'mutate',
			inputSchema: z.object({}),
			execute: async () => ({ ok: true, value: ++executions }),
		});
		const tools = adaptTools([{ name: 'echo', tool: echo }], ctx);
		let events = 0;
		const unsubscribe = subscribe(
			ctx.sessionId,
			(event) => {
				if (event.type === 'tool.result') events++;
			},
			ctx.projectRoot,
		);
		try {
			const failure = await execute(tools, 'echo', 'permanent', {}).catch(
				(error: unknown) => error,
			);
			expect(failure).toBeInstanceOf(ToolResultDurabilityError);
			expect(failure).toMatchObject({
				code: 'TOOL_RESULT_DURABILITY_FAILED',
				toolCallId: 'permanent',
				outcome: { status: 'success', result: { ok: true, value: 1 } },
			});
			expect(executions).toBe(1);
			expect(rows).toHaveLength(0);
			expect(events).toBe(0);
			expect(attempts).toHaveLength(3);
			options.failInserts = false;
			expect(await execute(tools, 'echo', 'permanent', {})).toEqual({
				ok: true,
				value: 1,
			});
			expect(executions).toBe(1);
			expect(attempts).toHaveLength(4);
			expect(new Set(attempts.map((row) => row.id)).size).toBe(1);
			expect(new Set(attempts.map((row) => row.index)).size).toBe(1);
			expect(rows).toHaveLength(1);
			expect(events).toBe(1);
		} finally {
			unsubscribe();
		}
	});

	it('retries an uncertain commit using the same result identity', async () => {
		const { db, rows, attempts } = createFakeDb({ failAfterCommit: true });
		const ctx = createContext({ db });
		let executions = 0;
		const echo = tool({
			description: 'mutate',
			inputSchema: z.object({}),
			execute: async () => ({ ok: true, value: ++executions }),
		});
		const tools = adaptTools([{ name: 'echo', tool: echo }], ctx);
		expect(await execute(tools, 'echo', 'uncertain', {})).toEqual({
			ok: true,
			value: 1,
		});
		expect(rows).toHaveLength(1);
		expect(attempts).toHaveLength(2);
		expect(attempts[0]).toEqual(attempts[1]);
		expect(executions).toBe(1);
	});

	it('treats { ok: true, error } as success', async () => {
		const { db, rows } = createFakeDb();
		const ctx = createContext({ db });
		const warn = tool({
			description: 'warn',
			inputSchema: z.object({}),
			execute: async () => ({ ok: true, error: 'non-fatal warning' }),
		});
		const tools = adaptTools([{ name: 'warn', tool: warn }], ctx);
		await execute(tools, 'warn', 'warn-call', {});
		expect(ctx.stepExecution?.states.get(0)?.failed).toBe(false);
		expect(rows.filter((row) => row.type === 'tool_result')).toHaveLength(1);
	});

	it('fails a stream that ends without a terminal result', async () => {
		const { db } = createFakeDb();
		const ctx = createContext({ db });
		const streaming = tool({
			description: 'stream',
			inputSchema: z.object({}),
			execute: async function* () {
				yield { channel: 'output', delta: 'partial' };
			},
		} as never) as Tool;
		const tools = adaptTools([{ name: 'streamer', tool: streaming }], ctx);
		const result = await execute(tools, 'streamer', 'stream-call', {});
		expect(result).toMatchObject({ ok: false });
		expect(ctx.stepExecution?.states.get(0)?.failed).toBe(true);
	});

	it('finalizes each call id once', async () => {
		const { db, rows } = createFakeDb();
		const ctx = createContext({ db });
		const echo = tool({
			description: 'echo',
			inputSchema: z.object({}),
			execute: async () => ({ ok: true }),
		});
		const tools = adaptTools([{ name: 'echo', tool: echo }], ctx);
		await Promise.all([
			execute(tools, 'echo', 'once-a', {}),
			execute(tools, 'echo', 'once-b', {}),
		]);
		const ids = rows
			.filter((row) => row.type === 'tool_result')
			.map((row) => row.toolCallId);
		expect(ids).toEqual(['once-a', 'once-b']);
	});

	it('deduplicates concurrent and repeated execution of the same call id', async () => {
		const { db, rows } = createFakeDb();
		const ctx = createContext({ db });
		let executions = 0;
		const echo = tool({
			description: 'echo',
			inputSchema: z.object({}),
			execute: async () => ({ ok: true, executions: ++executions }),
		});
		const tools = adaptTools([{ name: 'echo', tool: echo }], ctx);
		await inputAvailable(tools, 'echo', 'repeat', {});
		await inputAvailable(tools, 'echo', 'repeat', {});
		const results = await Promise.all([
			execute(tools, 'echo', 'repeat', {}),
			execute(tools, 'echo', 'repeat', {}),
		]);
		expect(results).toEqual([
			{ ok: true, executions: 1 },
			{ ok: true, executions: 1 },
		]);
		expect(await execute(tools, 'echo', 'repeat', {})).toEqual(results[0]);
		expect(rows.filter((row) => row.type === 'tool_call')).toHaveLength(1);
		expect(rows.filter((row) => row.type === 'tool_result')).toHaveLength(1);
	});

	it('rejects streams with conflicting terminal results', async () => {
		const { db } = createFakeDb();
		const ctx = createContext({ db });
		const streaming = tool({
			description: 'stream',
			inputSchema: z.object({}),
			execute: async function* () {
				yield { result: { ok: true } };
				yield { result: { ok: false, error: 'later failure' } };
			},
		} as never) as Tool;
		const tools = adaptTools([{ name: 'streamer', tool: streaming }], ctx);
		expect(await execute(tools, 'streamer', 'multiple', {})).toMatchObject({
			ok: false,
			details: { reason: 'multiple_terminal_results' },
		});
	});

	it('scrubs secret echoes and suppresses split output deltas', async () => {
		const { db, rows } = createFakeDb();
		const ctx = createContext({ db });
		const streaming = tool({
			description: 'auth',
			inputSchema: z.object({ apiKey: z.string() }),
			execute: async function* () {
				yield { delta: 'sk-live-' };
				yield { delta: 'secret' };
				yield { result: { ok: false, error: 'Rejected sk-live-secret' } };
			},
		} as never) as Tool;
		setToolMetadata(streaming, {
			source: 'builtin',
			sensitiveInputs: [{ path: 'apiKey' }],
		});
		const published: string[] = [];
		const unsubscribe = subscribe(
			ctx.sessionId,
			(event) => published.push(JSON.stringify(event)),
			ctx.projectRoot,
		);
		try {
			const tools = adaptTools([{ name: 'auth', tool: streaming }], ctx);
			const result = await execute(tools, 'auth', 'secret-echo', {
				apiKey: 'sk-live-secret',
			});
			expect(result).toMatchObject({ ok: false, error: 'Rejected [redacted]' });
			expect(JSON.stringify(rows) + published.join('')).not.toContain(
				'sk-live-secret',
			);
			expect(published.some((event) => event.includes('tool.delta'))).toBe(
				false,
			);
		} finally {
			unsubscribe();
		}
	});
});
