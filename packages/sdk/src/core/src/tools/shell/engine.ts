import { ShellExecutionState } from './lifecycle.ts';
import { ShellOutputCollector, retainUtf8Tail } from './output.ts';
import type { ShellProcess } from './transport.ts';

export type ShellOutcome = {
	stdout: string;
	stderr: string;
	metadata: Record<string, number | boolean | string>;
	exitCode: number | null;
	signal?: NodeJS.Signals | null;
	reason?: 'abort' | 'timeout' | 'execution';
	error?: Error;
};

type ShellEvent<T> = { channel: 'output'; delta: string } | { result: T };

/** Owns process lifetime; transport and host-specific result/persistence stay outside. */
export class ShellExecution<T> {
	private readonly state = new ShellExecutionState();
	private readonly stdout: ShellOutputCollector;
	private readonly stderr: ShellOutputCollector;
	private proc?: ShellProcess;
	private reason?: ShellOutcome['reason'];
	private error?: Error;
	private timeoutId?: ReturnType<typeof setTimeout>;
	private escalationId?: ReturnType<typeof setTimeout>;
	private fallbackId?: ReturnType<typeof setTimeout>;
	private pendingDelta = '';
	private pendingResult?: T;
	private streamDone = false;
	private notify?: () => void;

	constructor(
		private readonly options: {
			spawn: () => ShellProcess;
			timeout: number;
			abortSignal?: AbortSignal;
			outputMode: 'auto' | 'full' | 'tail';
			tailLines: number;
			maxOutputBytes: number;
			format: (outcome: ShellOutcome) => T;
			onOutput?: (text: string) => void;
			onComplete?: (result: T, outcome: ShellOutcome) => void;
		},
	) {
		this.stdout = new ShellOutputCollector(
			options.outputMode,
			options.tailLines,
			options.maxOutputBytes,
		);
		this.stderr = new ShellOutputCollector(
			options.outputMode,
			options.tailLines,
			options.maxOutputBytes,
		);
	}

	get settled(): boolean {
		return this.state.processSettled;
	}
	get terminating(): boolean {
		return this.reason !== undefined;
	}
	get usesPty(): boolean {
		return this.proc?.usesPty ?? false;
	}
	write(value: string): void {
		if (!this.settled && !this.terminating) this.proc?.write(value);
	}

	start(): void {
		if (this.options.abortSignal?.aborted) {
			this.reason = 'abort';
			this.complete(null);
			return;
		}
		try {
			this.proc = this.options.spawn();
		} catch (error) {
			this.reason = 'execution';
			this.error = error instanceof Error ? error : new Error(String(error));
			this.complete(null);
			return;
		}
		this.proc.onStdout((text) => this.capture(text, this.stdout));
		this.proc.onStderr((text) => this.capture(text, this.stderr));
		this.proc.onClose((code, signal) => this.complete(code, signal));
		this.proc.onError((error) => {
			this.reason ??= 'execution';
			this.error = error;
			this.complete(null);
		});
		// PTY adapters may replay an exit while listeners are attached.
		if (this.settled) return;
		this.options.abortSignal?.addEventListener('abort', this.onAbort, {
			once: true,
		});
		if (this.options.timeout > 0) {
			this.timeoutId = setTimeout(
				() => this.cancel('timeout'),
				this.options.timeout,
			);
		}
		if (this.options.abortSignal?.aborted) this.onAbort();
	}

	private snapshot(
		exitCode: number | null = null,
		signal?: NodeJS.Signals | null,
	): ShellOutcome {
		return {
			stdout: this.stdout.value,
			stderr: this.stderr.value,
			exitCode,
			signal,
			reason: this.reason,
			error: this.error,
			metadata: {
				outputMode: this.options.outputMode,
				tailLines: this.options.tailLines,
				maxOutputBytes: this.options.maxOutputBytes,
				...this.stdout.metadata('stdout'),
				...this.stderr.metadata('stderr'),
			},
		};
	}

	/** Transfers cancellation ownership to the job host, retaining its deadline. */
	detach(format: (outcome: ShellOutcome) => T): boolean {
		if (!this.state.transferToJob()) return false;
		this.options.abortSignal?.removeEventListener('abort', this.onAbort);
		this.pendingResult = format(this.snapshot());
		this.streamDone = true;
		this.wake();
		return true;
	}

	cancel(
		reason: NonNullable<ShellOutcome['reason']> = 'abort',
		error?: Error,
	): void {
		if (this.settled || this.terminating) return;
		this.reason = reason;
		this.error = error;
		const proc = this.proc;
		if (!proc) {
			this.complete(null);
			return;
		}
		if (proc.usesPty) {
			proc.write('\x03');
			this.escalationId = setTimeout(() => {
				proc.kill('SIGTERM');
				this.escalationId = setTimeout(() => proc.kill('SIGKILL'), 1000);
			}, 250);
		} else {
			proc.kill('SIGTERM');
			this.escalationId = setTimeout(() => proc.kill('SIGKILL'), 1000);
		}
		proc.destroyInput();
		this.fallbackId = setTimeout(() => this.complete(null), 2000);
	}

	private readonly onAbort = () => {
		if (this.state.consumerOwnsProcess) this.cancel();
	};

	private capture(text: string, collector: ShellOutputCollector): void {
		if (this.settled) return;
		collector.append(text);
		if (!this.streamDone) {
			this.pendingDelta = retainUtf8Tail(this.pendingDelta + text, 64 * 1024);
			this.wake();
		}
		this.options.onOutput?.(text);
	}

	private complete(code: number | null, signal?: NodeJS.Signals | null): void {
		if (!this.state.complete()) return;
		if (this.terminating) this.proc?.kill('SIGKILL');
		clearTimeout(this.timeoutId);
		clearTimeout(this.escalationId);
		clearTimeout(this.fallbackId);
		this.options.abortSignal?.removeEventListener('abort', this.onAbort);
		const outcome = this.snapshot(code, signal);
		const result = this.options.format(outcome);
		this.proc?.cleanup();
		this.options.onComplete?.(result, outcome);
		if (!this.streamDone) {
			this.pendingResult = result;
			this.streamDone = true;
			this.wake();
		}
	}

	private wake(): void {
		const notify = this.notify;
		this.notify = undefined;
		notify?.();
	}

	async *stream(): AsyncGenerator<ShellEvent<T>> {
		try {
			while (
				!this.streamDone ||
				this.pendingDelta ||
				this.pendingResult !== undefined
			) {
				if (!this.pendingDelta && this.pendingResult === undefined) {
					await new Promise<void>((resolve) => {
						this.notify = resolve;
					});
				}
				if (this.pendingDelta) {
					const delta = this.pendingDelta;
					this.pendingDelta = '';
					yield { channel: 'output', delta };
				} else if (this.pendingResult !== undefined) {
					const result = this.pendingResult;
					this.pendingResult = undefined;
					yield { result };
				}
			}
		} finally {
			if (this.state.consumerOwnsProcess) {
				this.cancel();
				this.proc?.kill('SIGKILL');
			}
		}
	}
}
