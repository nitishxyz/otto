import { tool, type Tool } from 'ai';
import { z } from 'zod/v3';
import DESCRIPTION from './terminal.txt' with { type: 'text' };
import { createToolError } from '../error.ts';
import type { TerminalManager } from '../../terminals/index.ts';
import type { TerminalStatus } from '../../terminals/terminal.ts';
import { normalizeTerminalLine } from '../../utils/ansi.ts';
import { injectCoAuthorIntoGitCommit } from './git-identity.ts';

function shellQuote(segment: string): string {
	if (/^[a-zA-Z0-9._-]+$/.test(segment)) {
		return segment;
	}
	return `'${segment.replace(/'/g, `'\\''`)}'`;
}

function formatShellCommand(parts: string[]): string {
	return parts.map(shellQuote).join(' ');
}

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

export function buildTerminalTool(
	projectRoot: string,
	terminalManager: TerminalManager,
): {
	name: string;
	tool: Tool;
} {
	const terminal = tool({
		description: DESCRIPTION,
		inputSchema: z.object({
			operation: z
				.enum(['start', 'read', 'write', 'interrupt', 'list', 'kill'])
				.describe('Operation to perform'),

			command: z.string().optional().describe('For start: Command to run'),
			args: z
				.array(z.string())
				.optional()
				.describe('For start: Command arguments'),
			shell: z
				.boolean()
				.default(true)
				.describe(
					'For start: Launch inside interactive shell and optionally run command',
				),
			purpose: z
				.string()
				.optional()
				.describe('For start: Description of what this terminal is for'),
			title: z
				.string()
				.optional()
				.describe(
					'For start: Short name shown in the UI (defaults to purpose)',
				),
			cwd: z
				.string()
				.default('.')
				.describe('For start: Working directory relative to project root'),

			terminalId: z
				.string()
				.optional()
				.describe('For read/write/kill: Terminal ID'),

			lines: z
				.number()
				.default(100)
				.optional()
				.describe('For read: Number of lines to read from end'),
			raw: z
				.boolean()
				.optional()
				.describe(
					'For read: Include raw output with ANSI escape sequences (default false)',
				),

			input: z
				.string()
				.optional()
				.describe('For write: String to write to stdin'),
		}),
		execute: async (params) => {
			try {
				const { operation } = params;

				switch (operation) {
					case 'start': {
						const runInShell = params.shell;

						if (!params.command && !runInShell) {
							return createToolError('command is required for start operation');
						}
						if (!params.purpose) {
							return createToolError('purpose is required for start operation');
						}

						const cwd = resolveSafePath(projectRoot, params.cwd);

						const shellPath =
							process.platform === 'win32'
								? process.env.COMSPEC || 'cmd.exe'
								: process.env.SHELL || '/bin/sh';

						let command = params.command ?? shellPath;
						let args = params.args ?? [];
						let initialCommand: string | null = null;

						if (runInShell) {
							command = shellPath;
							args =
								process.platform === 'win32'
									? []
									: process.platform === 'darwin'
										? ['-il']
										: ['-i'];
							const providedCommand = params.command;
							const providedArgs = params.args ?? [];

							if (providedCommand || providedArgs.length > 0) {
								if (providedArgs.length === 0 && providedCommand) {
									// Command already contains spaces; treat as full shell snippet
									initialCommand = providedCommand;
								} else {
									const commandParts = [
										providedCommand,
										...providedArgs,
									].filter((part): part is string => Boolean(part));
									if (commandParts.length > 0) {
										initialCommand = formatShellCommand(commandParts);
									}
								}
							}
						}

						const term = terminalManager.create({
							command,
							args,
							cwd,
							purpose: params.purpose,
							title: params.title,
							createdBy: 'llm',
						});

						if (initialCommand) {
							queueMicrotask(() => {
								term.write(`${injectCoAuthorIntoGitCommit(initialCommand)}\n`);
							});
						}

						return {
							ok: true,
							terminalId: term.id,
							pid: term.pid,
							purpose: term.purpose,
							command: params.command ?? command,
							args: params.args || [],
							shell: runInShell,
							title: term.title,
						};
					}

					case 'read': {
						if (!params.terminalId) {
							return createToolError(
								'terminalId is required for read operation',
							);
						}

						const term = terminalManager.get(params.terminalId);
						if (!term) {
							return createToolError(`Terminal ${params.terminalId} not found`);
						}

						const output = term.read(params.lines);
						const normalized = output.map(normalizeTerminalLine);
						const joined = normalized.join('\n');
						const text = joined.split(String.fromCharCode(0)).join('');

						const response: {
							ok: true;
							terminalId: string;
							output: string[];
							status: TerminalStatus;
							exitCode: number | undefined;
							lines: number;
							text: string;
							rawOutput?: string[];
						} = {
							ok: true,
							terminalId: term.id,
							output: normalized,
							status: term.status,
							exitCode: term.exitCode,
							lines: normalized.length,
							text,
						};

						if (params.raw) {
							response.rawOutput = output;
						}

						return response;
					}

					case 'write': {
						if (!params.terminalId) {
							return createToolError(
								'terminalId is required for write operation',
							);
						}
						if (!params.input) {
							return createToolError('input is required for write operation');
						}

						const term = terminalManager.get(params.terminalId);
						if (!term) {
							return createToolError(`Terminal ${params.terminalId} not found`);
						}

						term.write(injectCoAuthorIntoGitCommit(params.input));

						return {
							ok: true,
							terminalId: term.id,
							charactersWritten: params.input.length,
						};
					}

					case 'interrupt': {
						if (!params.terminalId) {
							return createToolError(
								'terminalId is required for interrupt operation',
							);
						}

						const term = terminalManager.get(params.terminalId);
						if (!term) {
							return createToolError(`Terminal ${params.terminalId} not found`);
						}

						term.write('\u0003');

						return {
							ok: true,
							terminalId: term.id,
						};
					}

					case 'list': {
						const terminals = terminalManager.list();

						return {
							ok: true,
							terminals: terminals.map((t) => t.toJSON()),
							count: terminals.length,
						};
					}

					case 'kill': {
						if (!params.terminalId) {
							return createToolError(
								'terminalId is required for kill operation',
							);
						}

						await terminalManager.kill(params.terminalId);

						return {
							ok: true,
							terminalId: params.terminalId,
						};
					}

					default:
						return createToolError(`Unknown operation: ${operation}`);
				}
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return createToolError(`Terminal operation failed: ${message}`);
			}
		},
	});

	return { name: 'terminal', tool: terminal };
}
