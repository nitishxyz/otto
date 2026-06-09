import { tool, type Tool } from 'ai';
import { AsyncLocalStorage } from 'node:async_hooks';
import { spawn } from 'node:child_process';
import { z } from 'zod/v3';
import DESCRIPTION from './shell.txt' with { type: 'text' };
import { getAugmentedPath } from '../bin-manager.ts';
import { createToolError, type ToolResponse } from '../error.ts';
import { injectCoAuthorIntoGitCommit } from './git-identity.ts';

function normalizePath(p: string) {
	const normalized = p.replace(/\\/g, '/');
	const driveMatch = normalized.match(/^([A-Za-z]):\//);
	const drivePrefix = driveMatch ? `${driveMatch[1]}:` : '';
	const rest = driveMatch ? normalized.slice(2) : normalized;
	const parts = rest.split('/');
	const stack: string[] = [];
	for (const part of parts) {
		if (!part || part === '.') continue;
		if (part === '..') stack.pop();
		else stack.push(part);
	}
	if (drivePrefix) return `${drivePrefix}/${stack.join('/')}`;
	return `/${stack.join('/')}`;
}

function resolveSafePath(projectRoot: string, p: string) {
	const root = normalizePath(projectRoot);
	const abs = normalizePath(`${root}/${p || '.'}`);
	if (!(abs === root || abs.startsWith(`${root}/`))) {
		throw new Error(`cwd escapes project root: ${p}`);
	}
	return abs;
}

function killProcessTree(pid: number) {
	try {
		process.kill(-pid, 'SIGTERM');
	} catch {
		try {
			process.kill(pid, 'SIGTERM');
		} catch {}
	}
}

export type ShellOutputMode = 'auto' | 'full' | 'tail';

const DEFAULT_TAIL_LINES = 100;
const DEFAULT_MAX_OUTPUT_BYTES = 128_000;

function looksLikeRepositorySearchCommand(cmd: string): boolean {
	const normalized = cmd.replace(/\s+/g, ' ').trim();
	return (
		/(^|[;&|()]\s*)(rg|ripgrep)(\s|$)/.test(normalized) ||
		/(^|[;&|()]\s*)grep\s+.*\s(-R|-r|--recursive)(\s|$)/.test(normalized) ||
		/(^|[;&|()]\s*)find\s+(\.|\.\/|\$PWD|\S*\/).*(-name|-iname|-path|-type)/.test(
			normalized,
		)
	);
}

type CompactTextResult = {
	text: string;
	truncated: boolean;
	originalBytes: number;
	shownBytes: number;
};

function compactTextByBytes(
	text: string,
	maxBytes: number,
	label: string,
): CompactTextResult {
	const originalBytes = Buffer.byteLength(text, 'utf8');
	if (maxBytes <= 0 || originalBytes <= maxBytes) {
		return { text, truncated: false, originalBytes, shownBytes: originalBytes };
	}

	const marker = `\n… omitted ${originalBytes - maxBytes} bytes from ${label} …\n`;
	const markerBytes = Buffer.byteLength(marker, 'utf8');
	const budget = Math.max(0, maxBytes - markerBytes);
	const headBytes = Math.floor(budget / 2);
	const tailBytes = budget - headBytes;
	const buffer = Buffer.from(text, 'utf8');
	const compacted = `${buffer.subarray(0, headBytes).toString('utf8')}${marker}${buffer
		.subarray(buffer.byteLength - tailBytes)
		.toString('utf8')}`;
	return {
		text: compacted,
		truncated: true,
		originalBytes,
		shownBytes: Buffer.byteLength(compacted, 'utf8'),
	};
}

export function appendTailLines(
	current: string,
	text: string,
	tailLines: number,
): string {
	if (!text) return current;
	const linesToKeep = Math.max(1, Math.floor(tailLines));
	const combined = `${current}${text}`;
	const lines = combined.split('\n');
	const entriesToKeep = combined.endsWith('\n') ? linesToKeep + 1 : linesToKeep;
	if (lines.length <= entriesToKeep) return combined;
	return lines.slice(-entriesToKeep).join('\n');
}

type ShellResult = ToolResponse<{
	exitCode: number;
	stdout: string;
	stderr: string;
	outputMode?: ShellOutputMode;
	tailLines?: number;
	maxOutputBytes?: number;
	stdoutTruncated?: boolean;
	stdoutOriginalBytes?: number;
	stdoutShownBytes?: number;
	stderrTruncated?: boolean;
	stderrOriginalBytes?: number;
	stderrShownBytes?: number;
}>;

type ShellStreamChunk =
	| {
			channel: 'output';
			delta: string;
	  }
	| {
			channel: 'terminal';
			terminalId: string;
	  }
	| {
			result: ShellResult;
	  };

export type ShellExecutorInput = ShellInput & { cwd: string };

export type ShellExecutor = (
	input: ShellExecutorInput,
	options?: { abortSignal?: AbortSignal },
) => AsyncIterable<ShellStreamChunk> | ShellResult | Promise<ShellResult>;

export const shellExecutorContext = new AsyncLocalStorage<ShellExecutor>();

const shellInputSchema = z
	.object({
		cmd: z
			.string()
			.describe('Non-interactive shell command to run (bash -c <cmd>)'),
		cwd: z
			.string()
			.default('.')
			.describe('Working directory relative to project root'),
		allowNonZeroExit: z
			.boolean()
			.optional()
			.default(false)
			.describe('If true, do not throw on non-zero exit'),
		timeout: z
			.number()
			.optional()
			.default(300000)
			.describe('Timeout in milliseconds (default: 300000 = 5 minutes)'),
		outputMode: z
			.enum(['auto', 'full', 'tail'])
			.optional()
			.default('auto')
			.describe(
				'Output capture mode. Use "auto" for bounded output, "full" for full output up to maxOutputBytes, or "tail" to keep only the last tailLines lines.',
			),
		tailLines: z
			.number()
			.int()
			.min(1)
			.max(5000)
			.optional()
			.default(DEFAULT_TAIL_LINES)
			.describe(
				'Number of trailing stdout/stderr lines to keep when outputMode is "tail"',
			),
		maxOutputBytes: z
			.number()
			.int()
			.min(0)
			.max(10_000_000)
			.optional()
			.default(DEFAULT_MAX_OUTPUT_BYTES)
			.describe(
				'Maximum bytes to keep per stdout/stderr in the final tool result. Use 0 to disable byte capping.',
			),
	})
	.strict();

type ShellInput = z.infer<typeof shellInputSchema>;

type ShellToolFactory = (definition: {
	description: string;
	inputSchema: typeof shellInputSchema;
	execute(
		input: ShellInput,
		options?: { abortSignal?: AbortSignal },
	): AsyncIterable<ShellStreamChunk> | ShellResult;
}) => Tool;

export function buildShellTool(projectRoot: string): {
	name: string;
	tool: Tool;
} {
	const createTool = tool as unknown as ShellToolFactory;
	const shell = createTool({
		description: DESCRIPTION,
		inputSchema: shellInputSchema,
		execute(
			{
				cmd,
				cwd,
				allowNonZeroExit,
				timeout = 300000,
				outputMode = 'auto',
				tailLines = DEFAULT_TAIL_LINES,
				maxOutputBytes = DEFAULT_MAX_OUTPUT_BYTES,
			}: ShellInput,
			options?: { abortSignal?: AbortSignal },
		): AsyncIterable<ShellStreamChunk> | ShellResult {
			const abortSignal = options?.abortSignal;

			if (abortSignal?.aborted) {
				return createToolError('Command aborted before execution', 'abort', {
					cmd,
				});
			}

			if (looksLikeRepositorySearchCommand(cmd)) {
				return createToolError(
					'This looks like repository discovery. Use the search tool for content/code search or glob for filename/path discovery.',
					'validation',
					{
						cmd,
						suggestion:
							'Use search for file contents, or glob for file and path discovery.',
					},
				);
			}

			const absCwd = resolveSafePath(projectRoot, cwd || '.');
			const finalCmd = injectCoAuthorIntoGitCommit(cmd);
			const shellExecutor = shellExecutorContext.getStore();
			if (shellExecutor) {
				return shellExecutor(
					{
						cmd: finalCmd,
						cwd: absCwd,
						allowNonZeroExit,
						timeout,
						outputMode,
						tailLines,
						maxOutputBytes,
					},
					options,
				) as AsyncIterable<ShellStreamChunk> | ShellResult;
			}

			const proc = spawn(finalCmd, {
				cwd: absCwd,
				shell: true,
				stdio: ['ignore', 'pipe', 'pipe'],
				env: { ...process.env, PATH: getAugmentedPath() },
				detached: true,
			});

			let stdout = '';
			let stderr = '';
			let didTimeout = false;
			let didAbort = false;
			let settled = false;
			let done = false;
			let timeoutId: ReturnType<typeof setTimeout> | null = null;
			const queue: ShellStreamChunk[] = [];
			let notify: (() => void) | null = null;

			const wake = () => {
				if (!notify) return;
				notify();
				notify = null;
			};

			const pushDelta = (text: string) => {
				if (!text) return;
				queue.push({ channel: 'output', delta: text });
				wake();
			};

			const settle = (result: ShellResult) => {
				if (settled) return;
				settled = true;
				if ('stdout' in result && 'stderr' in result) {
					const stdoutCompact = compactTextByBytes(
						result.stdout,
						maxOutputBytes,
						'shell stdout',
					);
					const stderrCompact = compactTextByBytes(
						result.stderr,
						maxOutputBytes,
						'shell stderr',
					);
					result.stdout = stdoutCompact.text;
					result.stderr = stderrCompact.text;
					result.maxOutputBytes = maxOutputBytes;
					if (stdoutCompact.truncated) {
						result.stdoutTruncated = true;
						result.stdoutOriginalBytes = stdoutCompact.originalBytes;
						result.stdoutShownBytes = stdoutCompact.shownBytes;
					}
					if (stderrCompact.truncated) {
						result.stderrTruncated = true;
						result.stderrOriginalBytes = stderrCompact.originalBytes;
						result.stderrShownBytes = stderrCompact.shownBytes;
					}
				} else if ('details' in result && result.details) {
					const details = result.details;
					for (const field of ['stdout', 'stderr'] as const) {
						const value = details[field];
						if (typeof value !== 'string') continue;
						const compact = compactTextByBytes(
							value,
							maxOutputBytes,
							`shell ${field}`,
						);
						details[field] = compact.text;
						if (compact.truncated) {
							details[`${field}Truncated`] = true;
							details[`${field}OriginalBytes`] = compact.originalBytes;
							details[`${field}ShownBytes`] = compact.shownBytes;
						}
					}
					details.maxOutputBytes = maxOutputBytes;
				}
				if (timeoutId) clearTimeout(timeoutId);
				if (abortSignal) {
					abortSignal.removeEventListener('abort', onAbort);
				}
				queue.push({ result });
				done = true;
				wake();
			};

			const onAbort = () => {
				if (settled) return;
				didAbort = true;
				if (proc.pid) killProcessTree(proc.pid);
				else proc.kill('SIGTERM');
			};

			if (abortSignal) {
				abortSignal.addEventListener('abort', onAbort, { once: true });
			}

			if (timeout > 0) {
				timeoutId = setTimeout(() => {
					didTimeout = true;
					if (proc.pid) killProcessTree(proc.pid);
					else proc.kill();
				}, timeout);
			}

			proc.stdout?.on('data', (chunk) => {
				const text = chunk.toString();
				stdout =
					outputMode === 'tail' || outputMode === 'auto'
						? appendTailLines(stdout, text, tailLines)
						: `${stdout}${text}`;
				pushDelta(text);
			});

			proc.stderr?.on('data', (chunk) => {
				const text = chunk.toString();
				stderr =
					outputMode === 'tail' || outputMode === 'auto'
						? appendTailLines(stderr, text, tailLines)
						: `${stderr}${text}`;
				pushDelta(text);
			});

			proc.on('close', (exitCode) => {
				if (didAbort) {
					settle(
						createToolError(`Command aborted by user: ${cmd}`, 'abort', {
							cmd,
							stdout,
							stderr,
							...(outputMode === 'tail' || outputMode === 'auto'
								? { outputMode, tailLines, maxOutputBytes }
								: { outputMode, maxOutputBytes }),
						}),
					);
					return;
				}

				if (didTimeout) {
					settle(
						createToolError(
							`Command timed out after ${timeout}ms: ${cmd}`,
							'timeout',
							{
								parameter: 'timeout',
								value: timeout,
								stdout,
								stderr,
								...(outputMode === 'tail' || outputMode === 'auto'
									? { outputMode, tailLines, maxOutputBytes }
									: { outputMode, maxOutputBytes }),
								suggestion: 'Increase timeout or optimize the command',
							},
						),
					);
					return;
				}

				if (exitCode !== 0 && !allowNonZeroExit) {
					const errorDetail = stderr.trim() || stdout.trim() || '';
					const errorMsg = `Command failed with exit code ${exitCode}${errorDetail ? `\n\n${errorDetail}` : ''}`;
					settle(
						createToolError(errorMsg, 'execution', {
							exitCode,
							stdout,
							stderr,
							cmd,
							...(outputMode === 'tail' || outputMode === 'auto'
								? { outputMode, tailLines, maxOutputBytes }
								: { outputMode, maxOutputBytes }),
							suggestion: 'Check command syntax or use allowNonZeroExit: true',
						}),
					);
					return;
				}

				settle({
					ok: true,
					exitCode: exitCode ?? 0,
					stdout,
					stderr,
					...(outputMode === 'tail' || outputMode === 'auto'
						? { outputMode, tailLines, maxOutputBytes }
						: { outputMode, maxOutputBytes }),
				});
			});

			proc.on('error', (err) => {
				settle(
					createToolError(
						`Command execution failed: ${err.message}`,
						'execution',
						{
							cmd,
							originalError: err.message,
						},
					),
				);
			});

			const stream = async function* (): AsyncGenerator<ShellStreamChunk> {
				while (!done || queue.length > 0) {
					if (queue.length === 0) {
						await new Promise<void>((resolve) => {
							notify = resolve;
						});
					}
					while (queue.length > 0) {
						const chunk = queue.shift();
						if (chunk) yield chunk;
					}
				}
			};

			return stream();
		},
	}) as unknown as Tool;
	return { name: 'shell', tool: shell };
}

export const buildBashTool = buildShellTool;
