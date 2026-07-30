import { randomBytes } from 'node:crypto';
import type { PtyOptions } from './bun-pty.ts';
import { spawn as spawnPty } from './bun-pty.ts';
import { Terminal } from './terminal.ts';
import { logger } from '../utils/logger.ts';
import { getAugmentedPath } from '../tools/bin-manager.ts';

const MAX_TERMINALS = 10;
const CLEANUP_DELAY_MS = 5 * 60 * 1000;

export interface CreateTerminalOptions {
	command: string;
	args?: string[];
	cwd: string;
	purpose: string;
	createdBy: 'user' | 'llm';
	title?: string;
	env?: Record<string, string>;
	inheritEnv?: boolean;
	augmentPath?: boolean;
}

/** Builds a portable PTY environment with widely available terminfo support. */
export function resolveTerminalEnvironment(
	options: Pick<CreateTerminalOptions, 'env' | 'inheritEnv' | 'augmentPath'>,
): Record<string, string> {
	return {
		...(options.inheritEnv === false ? {} : process.env),
		...options.env,
		// Keep this on a system entry; xterm-ghostty requires bundled terminfo.
		TERM: 'xterm-256color',
		COLORTERM: 'truecolor',
		TERM_PROGRAM: 'otto',
		PATH:
			options.augmentPath === false
				? (options.env?.PATH ?? process.env.PATH ?? '')
				: getAugmentedPath(),
		PROMPT_EOL_MARK: '',
	} as Record<string, string>;
}

export class TerminalManager {
	private terminals = new Map<string, Terminal>();
	private cleanupTimers = new Map<string, NodeJS.Timeout>();

	create(options: CreateTerminalOptions): Terminal {
		if (this.terminals.size >= MAX_TERMINALS) {
			throw new Error(`Maximum ${MAX_TERMINALS} terminals reached`);
		}

		const id = this.generateId();

		try {
			const ptyOptions: PtyOptions = {
				name: 'xterm-256color',
				cols: 80,
				rows: 30,
				cwd: options.cwd,
				env: resolveTerminalEnvironment(options),
			};

			const pty = spawnPty(options.command, options.args || [], ptyOptions);

			const terminal = new Terminal(id, pty, options);

			terminal.onExit((_exitCode) => {
				const timer = setTimeout(() => {
					this.delete(id);
				}, CLEANUP_DELAY_MS);

				this.cleanupTimers.set(id, timer);
			});

			this.terminals.set(id, terminal);

			return terminal;
		} catch (error) {
			logger.error('TerminalManager: failed to create terminal', error);
			throw error;
		}
	}

	get(id: string): Terminal | undefined {
		return this.terminals.get(id);
	}

	list(): Terminal[] {
		return Array.from(this.terminals.values());
	}

	async kill(id: string): Promise<void> {
		const terminal = this.terminals.get(id);
		if (!terminal) {
			throw new Error(`Terminal ${id} not found`);
		}

		terminal.kill();

		await new Promise<void>((resolve) => {
			if (terminal.status === 'exited') {
				resolve();
				return;
			}

			const exitHandler = () => {
				terminal.removeExitListener(exitHandler);
				resolve();
			};

			terminal.onExit(exitHandler);

			setTimeout(() => {
				terminal.removeExitListener(exitHandler);
				resolve();
			}, 5000);
		});

		this.delete(id);
	}

	async killAll(): Promise<void> {
		const killPromises = Array.from(this.terminals.keys()).map((id) =>
			this.kill(id).catch((err) =>
				logger.error(`Failed to kill terminal ${id}`, err),
			),
		);

		await Promise.all(killPromises);
	}

	delete(id: string): boolean {
		const timer = this.cleanupTimers.get(id);
		if (timer) {
			clearTimeout(timer);
			this.cleanupTimers.delete(id);
		}

		return this.terminals.delete(id);
	}

	private generateId(): string {
		return `term-${randomBytes(8).toString('hex')}`;
	}

	getContext(): string {
		const terminals = this.list();

		if (terminals.length === 0) {
			return '';
		}

		const summary = terminals
			.map(
				(t) =>
					`- [${t.id}] ${t.purpose} (${t.status}, ${t.createdBy}, pid: ${t.pid})`,
			)
			.join('\n');

		return `\n\n## Active Terminals (${terminals.length}):\n${summary}\n\nYou can read from any terminal using the 'terminal' tool with operation: 'read'.`;
	}
}
