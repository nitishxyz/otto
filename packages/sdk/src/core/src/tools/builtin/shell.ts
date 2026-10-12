import { tool, type Tool } from 'ai';
import { AsyncLocalStorage } from 'node:async_hooks';
import { z } from 'zod/v3';
export { ShellOutputCollector, retainUtf8Tail } from '../shell/output.ts';
import { ShellExecution } from '../shell/engine.ts';
import { createPipeShellProcess } from '../shell/transport.ts';
import {
	formatShellResult,
	type ShellExecutionResult as ShellResult,
} from '../shell/result.ts';
export { ShellExecution, type ShellOutcome } from '../shell/engine.ts';
export {
	createPipeShellProcess,
	type ShellProcess,
} from '../shell/transport.ts';
export {
	formatShellResult,
	type ShellExecutionResult,
} from '../shell/result.ts';
import DESCRIPTION from './shell.txt' with { type: 'text' };
import {
	getShellExecutionConfigAsync,
	type ShellEnvMode,
} from '../bin-manager.ts';
export { ShellExecutionState } from '../shell/lifecycle.ts';
import { createToolError } from '../error.ts';
import {
	injectCoAuthorIntoGitCommit,
	shouldCoAuthorCommits,
} from './git-identity.ts';

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

function isPathInRoot(path: string, root: string): boolean {
	return path === root || path.startsWith(`${root}/`);
}

function isReadOnlyProbe(command: string): boolean {
	if (/(^|[^<])>(?!>)|>>|\btee\b/.test(command)) return false;
	const segments = command
		.split(/&&|\|\||(?<!\|)\|(?!\|)|;|\n/)
		.map((segment) => segment.trim())
		.filter(Boolean);
	return segments.every((segment) => {
		const executable = segment.match(
			/^(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)*(\S+)/,
		)?.[1];
		if (!executable) return false;
		const name = executable.split('/').pop();
		if (name === 'git') {
			return /\bgit\b(?:\s+-C\s+\S+)?\s+(status|log|show|diff|branch|rev-parse|ls-files)\b/.test(
				segment,
			);
		}
		return new Set([
			'ls',
			'pwd',
			'cat',
			'head',
			'tail',
			'grep',
			'rg',
			'tree',
			'file',
			'stat',
			'wc',
			'du',
			'jq',
		]).has(name ?? '');
	});
}

function resolveSafePath(
	projectRoot: string,
	p: string,
	command: string,
	readOnlyRoots: string[],
) {
	const root = normalizePath(projectRoot);
	const requested = p || '.';
	const abs = normalizePath(
		requested.startsWith('/') || /^[A-Za-z]:[\\/]/.test(requested)
			? requested
			: `${root}/${requested}`,
	);
	if (isPathInRoot(abs, root)) return abs;
	if (
		readOnlyRoots.some((allowedRoot) =>
			isPathInRoot(abs, normalizePath(allowedRoot)),
		) &&
		isReadOnlyProbe(command)
	) {
		return abs;
	}
	throw new Error(`cwd escapes project root or is not read-only: ${p}`);
}

const REDIRECTED_SEARCH_COMMANDS = new Set(['grep', 'egrep', 'fgrep', 'rg']);
const REDIRECTED_FILE_SEARCH_COMMANDS = new Set(['find', 'fd']);

/**
 * Detect commands that start with a standalone grep-style search binary.
 * Pipelines like `ps aux | grep x` are allowed; only segments that begin
 * with grep/rg are redirected to the dedicated `search` tool.
 */
export function findRedirectedSearchCommand(cmd: string): string | null {
	return findRepositoryDiscoveryCommand(cmd, 'content')?.command ?? null;
}

function commandTokens(segment: string): string[] {
	const tokens = segment.trim().split(/\s+/).filter(Boolean);
	let index = 0;
	while (
		index < tokens.length &&
		/^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[index] ?? '')
	) {
		index++;
	}
	if (tokens[index] === 'command') index++;
	return tokens.slice(index);
}

function findRepositoryDiscoveryCommand(
	cmd: string,
	kind?: 'content' | 'files',
): { command: string; mode: 'content' | 'files' } | null {
	const segments = cmd.split(/&&|\|\||;|\n/);
	for (const segment of segments) {
		const tokens = commandTokens(segment);
		const bin = tokens[0]?.split('/').pop() ?? '';
		const second = tokens[1] ?? '';
		if ((!kind || kind === 'content') && bin === 'git' && second === 'grep') {
			return { command: 'git grep', mode: 'content' };
		}
		if ((!kind || kind === 'content') && REDIRECTED_SEARCH_COMMANDS.has(bin)) {
			return { command: bin, mode: 'content' };
		}
		if (
			(!kind || kind === 'files') &&
			REDIRECTED_FILE_SEARCH_COMMANDS.has(bin)
		) {
			return { command: bin, mode: 'files' };
		}
		if ((!kind || kind === 'files') && bin === 'ls' && segment.includes('**')) {
			return { command: 'ls **', mode: 'files' };
		}
	}
	return null;
}

function repositoryDiscoveryHint(cmd: string): string | undefined {
	const discovery = findRepositoryDiscoveryCommand(cmd);
	if (!discovery) return undefined;
	return discovery.mode === 'content'
		? `Tip: For repository content search, prefer the search tool instead of shelling out to ${discovery.command}. It is indexed, faster, and returns structured file:line matches.`
		: `Tip: For repository file discovery, prefer search with mode="files" instead of shelling out to ${discovery.command}. It returns structured paths and skips common build/cache folders.`;
}

const SHELL_ENV_HINT =
	'This command may require environment from your login/interactive shell. If appropriate, retry with envMode: "login-cache" (or "login-fresh" after changing shell config).';

export function detectShellEnvHint(args: {
	stdout: string;
	stderr: string;
	exitCode: number;
	envMode?: ShellEnvMode;
}): string | undefined {
	if (args.envMode && args.envMode !== 'minimal') return undefined;
	if (args.exitCode === 0) return undefined;
	const text = `${args.stderr}\n${args.stdout}`;
	const patterns = [
		/\b[A-Z][A-Z0-9_]{2,}\b[^\n]*(?:not set|not defined|required|missing|must be set)/i,
		/(?:missing|required|could not find)[^\n]*(?:api key|token|credential|credentials|secret|environment variable|env var)/i,
		/(?:no credentials|credentials[^\n]*not found|not authenticated|authentication required|please log in|please login)/i,
		/(?:asdf|nvm|mise|direnv|op|doppler)[^\n]*(?:not found|not loaded|command not found)/i,
	];
	return patterns.some((pattern) => pattern.test(text))
		? SHELL_ENV_HINT
		: undefined;
}

export type ShellOutputMode = 'auto' | 'full' | 'tail';

const DEFAULT_TAIL_LINES = 100;
const DEFAULT_MAX_OUTPUT_BYTES = 128_000;

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
		cmd: z.string().describe('Command to run with the user shell'),
		cwd: z.string().default('.').describe('Project-relative working directory'),
		allowNonZeroExit: z
			.boolean()
			.optional()
			.default(false)
			.describe('If true, do not throw on non-zero exit'),
		timeout: z
			.number()
			.optional()
			.default(300000)
			.describe('Timeout in milliseconds'),
		envMode: z
			.enum(['minimal', 'login-cache', 'login-fresh'])
			.optional()
			.default('login-cache')
			.describe('Shell environment mode'),
		outputMode: z
			.enum(['auto', 'full', 'tail'])
			.optional()
			.default('auto')
			.describe('Output capture mode'),
		tailLines: z
			.number()
			.int()
			.min(1)
			.max(5000)
			.optional()
			.default(DEFAULT_TAIL_LINES)
			.describe('Lines retained in tail mode'),
		maxOutputBytes: z
			.number()
			.int()
			.min(0)
			.max(10_000_000)
			.optional()
			.default(DEFAULT_MAX_OUTPUT_BYTES)
			.describe('Maximum bytes retained per output stream; 0 disables the cap'),
		detached: z
			.boolean()
			.optional()
			.default(false)
			.describe('Run as a background job and report completion later'),
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

export function buildShellTool(
	projectRoot: string,
	readOnlyRoots: string[] = [],
): {
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
				envMode = 'login-cache',
				outputMode = 'auto',
				tailLines = DEFAULT_TAIL_LINES,
				maxOutputBytes = DEFAULT_MAX_OUTPUT_BYTES,
				detached = false,
			}: ShellInput,
			options?: { abortSignal?: AbortSignal },
		): AsyncIterable<ShellStreamChunk> | ShellResult {
			const abortSignal = options?.abortSignal;

			if (abortSignal?.aborted) {
				return createToolError('Command aborted before execution', 'abort', {
					cmd,
				});
			}

			const absCwd = resolveSafePath(
				projectRoot,
				cwd || '.',
				cmd,
				readOnlyRoots,
			);
			const finalCmd = injectCoAuthorIntoGitCommit(
				cmd,
				shouldCoAuthorCommits(projectRoot),
			);
			const shellExecutor = shellExecutorContext.getStore();
			if (shellExecutor) {
				return shellExecutor(
					{
						cmd: finalCmd,
						cwd: absCwd,
						allowNonZeroExit,
						timeout,
						envMode,
						outputMode,
						tailLines,
						maxOutputBytes,
						detached,
					},
					options,
				) as AsyncIterable<ShellStreamChunk> | ShellResult;
			}

			return (async function* (): AsyncGenerator<ShellStreamChunk> {
				const shellConfig = await getShellExecutionConfigAsync(finalCmd, {
					envMode,
				});
				if (abortSignal?.aborted) {
					yield {
						result: createToolError(
							'Command aborted before execution',
							'abort',
							{ cmd },
						),
					};
					return;
				}
				const execution = new ShellExecution<ShellResult>({
					spawn: () => {
						const proc = createPipeShellProcess({
							...shellConfig,
							cwd: absCwd,
						});
						proc.destroyInput();
						return proc;
					},
					timeout,
					abortSignal,
					outputMode,
					tailLines,
					maxOutputBytes,
					format: (outcome) =>
						formatShellResult(outcome, {
							cmd,
							timeout,
							allowNonZeroExit,
							envMode,
							envHint: detectShellEnvHint({
								...outcome,
								exitCode: outcome.exitCode ?? 1,
								envMode,
							}),
							discoveryHint: repositoryDiscoveryHint(finalCmd),
						}),
				});
				execution.start();
				yield* execution.stream();
			})();
		},
	}) as unknown as Tool;
	return { name: 'shell', tool: shell };
}

export const buildBashTool = buildShellTool;
