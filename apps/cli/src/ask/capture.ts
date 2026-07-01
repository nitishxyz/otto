import { ask, buildSessionStreamUrl } from '@ottocode/api';
import type { AskHandshake, AskOptions } from './types.ts';
import { getOrStartServerContext } from './server.ts';
import { safeJson, connectSSE } from './http.ts';
import { printToolCall, printToolResult, dim, logToolError } from './render.ts';
import { extractToolError, isToolError } from '@ottocode/sdk/tools/error';

const READ_ONLY_TOOLS = new Set([
	'read',
	'ls',
	'tree',
	'search',
	'git_diff',
	'git_status',
]);

const MUTATING_TOOLS = new Set([
	'write',
	'edit',
	'multiedit',
	'copy_into',
	'apply_patch',
]);

export async function runAskStreamCapture(
	prompt: string,
	opts: AskOptions = {},
) {
	const projectRoot = opts.project ?? process.cwd();
	const serverContext = await getOrStartServerContext(projectRoot);
	const baseUrl = serverContext.baseUrl;
	const handshakeResponse = await ask({
		query: { projectId: serverContext.projectId },
		body: {
			prompt,
			agent: opts.agent,
			provider: opts.provider,
			model: opts.model,
			sessionId: opts.sessionId,
			last: opts.last,
		},
	});
	if (handshakeResponse.error) {
		throw new Error(JSON.stringify(handshakeResponse.error));
	}
	const handshake = handshakeResponse.data as AskHandshake;

	const sse = await connectSSE(
		buildSessionStreamUrl({
			baseUrl,
			sessionId: handshake.sessionId,
			projectId: serverContext.projectId,
		}),
		serverContext.authHeaders,
	);
	const assistantMessageId = handshake.assistantMessageId;

	let output = '';
	const verbose = process.argv.includes('--verbose');
	const readVerbose = process.argv.includes('--read-verbose');
	const callStarts = new Map<string, number>();
	try {
		for await (const ev of sse) {
			if (ev.event === 'message.part.delta') {
				const data = safeJson(ev.data);
				if (
					data?.messageId === assistantMessageId &&
					typeof data?.delta === 'string'
				) {
					output += data.delta;
					Bun.write(Bun.stdout, data.delta);
				}
			} else if (ev.event === 'tool.call') {
				const data = safeJson(ev.data);
				const name = typeof data?.name === 'string' ? data.name : 'tool';
				const callId = data?.callId as string | undefined;
				const ts = Date.now();
				if (callId) callStarts.set(callId, ts);
				printToolCall(name, data?.args, { verbose });
			} else if (ev.event === 'tool.delta') {
				const data = safeJson(ev.data);
				const name = typeof data?.name === 'string' ? data.name : 'tool';
				const channel =
					typeof data?.channel === 'string' ? data.channel : 'output';
				const isReadOnly = READ_ONLY_TOOLS.has(name);
				if (channel === 'input' && !verbose) continue;
				if (isReadOnly && !verbose && !readVerbose) continue;
				const delta =
					typeof data?.delta === 'string'
						? data.delta
						: JSON.stringify(data?.delta);
				if (delta)
					Bun.write(
						Bun.stderr,
						`${dim(`[${channel}]`)} ${name} ${dim('›')} ${truncate(delta, 160)}\n`,
					);
			} else if (ev.event === 'tool.result') {
				const data = safeJson(ev.data);
				const name = typeof data?.name === 'string' ? data.name : 'tool';
				const callId = data?.callId as string | undefined;
				let durationMs: number | undefined;
				if (callId && callStarts.has(callId)) {
					durationMs = Math.max(
						0,
						Date.now() - (callStarts.get(callId) ?? Date.now()),
					);
				}
				const resultObj =
					data?.result &&
					typeof data.result === 'object' &&
					!Array.isArray(data.result)
						? (data.result as Record<string, unknown>)
						: null;
				const topLevelError =
					typeof data?.error === 'string' && data.error.trim().length
						? data.error
						: undefined;
				// For shell tool, only treat as error if exitCode is non-zero
				const isShellError =
					(name === 'shell' || name === 'bash') &&
					resultObj &&
					typeof Reflect.get(resultObj, 'exitCode') === 'number' &&
					Reflect.get(resultObj, 'exitCode') !== 0;

				const hasErrorResult =
					isToolError(resultObj) || Boolean(topLevelError) || isShellError;
				const isReadOnly = READ_ONLY_TOOLS.has(name ?? '');
				const shouldRenderResult =
					name === 'tree' ||
					MUTATING_TOOLS.has(name ?? '') ||
					name === 'shell' ||
					name === 'bash' ||
					hasErrorResult ||
					verbose ||
					readVerbose ||
					!isReadOnly;
				const errorMessage = hasErrorResult
					? (extractToolError(resultObj, topLevelError) ??
						'Tool reported an error')
					: undefined;
				const resultPayload =
					hasErrorResult && !data?.result
						? { error: errorMessage ?? 'Tool reported an error' }
						: data?.result;
				if (shouldRenderResult) {
					printToolResult(name, resultPayload, data?.artifact as never, {
						verbose,
						durationMs,
						error: errorMessage,
						args: data?.args,
					});
				} else if (errorMessage) {
					logToolError(name, errorMessage, { durationMs });
				}
			} else if (ev.event === 'message.completed') {
				const data = safeJson(ev.data);
				if (data?.id === assistantMessageId) break;
			}
		}
	} finally {
		await sse.close();
	}

	if (output.length) Bun.write(Bun.stdout, '\n');
	return { sessionId: handshake.sessionId, text: output };
}

function truncate(value: string, max: number) {
	if (value.length <= max) return value;
	return `${value.slice(0, max - 1)}…`;
}
