import type { IPty } from './bun-pty.ts';
import { EventEmitter } from 'node:events';
import { CircularBuffer } from './circular-buffer.ts';

const TERMINAL_HISTORY_MAX_CHUNKS = 50_000;
const TERMINAL_HISTORY_MAX_BYTES = 16 * 1024 * 1024;

export type TerminalStatus = 'running' | 'exited';
export type TerminalCreator = 'user' | 'llm';

export interface TerminalOptions {
	command: string;
	args?: string[];
	cwd: string;
	purpose: string;
	createdBy: TerminalCreator;
	title?: string;
}

export class Terminal {
	readonly id: string;
	readonly pty: IPty;
	readonly command: string;
	readonly args: string[];
	readonly cwd: string;
	readonly purpose: string;
	readonly createdBy: TerminalCreator;
	readonly createdAt: Date;

	private buffer: CircularBuffer;
	private _status: TerminalStatus = 'running';
	private _exitCode?: number;
	private _title?: string;
	private dataEmitter = new EventEmitter();
	private exitEmitter = new EventEmitter();

	constructor(id: string, pty: IPty, options: TerminalOptions) {
		this.id = id;
		this.pty = pty;
		this.command = options.command;
		this.args = options.args || [];
		this.cwd = options.cwd;
		this.purpose = options.purpose;
		this.createdBy = options.createdBy;
		this._title = options.title;
		this.createdAt = new Date();
		this.buffer = new CircularBuffer(
			TERMINAL_HISTORY_MAX_CHUNKS,
			TERMINAL_HISTORY_MAX_BYTES,
		);

		this.pty.onData((data) => {
			// Store in buffer for history
			this.buffer.push(data);
			// Emit raw data - terminals need control chars, ANSI codes, etc.
			this.dataEmitter.emit('data', data);
		});

		this.pty.onExit(({ exitCode }) => {
			this._status = 'exited';
			this._exitCode = exitCode;
			this.exitEmitter.emit('exit', exitCode);
		});
	}

	get pid(): number {
		return this.pty.pid;
	}

	get status(): TerminalStatus {
		return this._status;
	}

	get exitCode(): number | undefined {
		return this._exitCode;
	}

	get title(): string {
		return this._title || this.purpose;
	}

	set title(value: string) {
		this._title = value;
	}

	read(lines?: number): string[] {
		return this.buffer.read(lines);
	}

	clearBuffer(): void {
		this.buffer.clear();
	}

	write(input: string): void {
		this.pty.write(input);
	}

	kill(signal?: string): void {
		this.pty.kill(signal);
	}

	resize(cols: number, rows: number): void {
		this.pty.resize(cols, rows);
	}

	onData(callback: (line: string) => void): void {
		this.dataEmitter.on('data', callback);
	}

	onExit(callback: (exitCode: number) => void): void {
		this.exitEmitter.on('exit', callback);
	}

	removeDataListener(callback: (line: string) => void): void {
		this.dataEmitter.off('data', callback);
	}

	removeExitListener(callback: (exitCode: number) => void): void {
		this.exitEmitter.off('exit', callback);
	}

	toJSON() {
		return {
			id: this.id,
			pid: this.pid,
			command: this.command,
			args: this.args,
			cwd: this.cwd,
			purpose: this.purpose,
			createdBy: this.createdBy,
			title: this.title,
			status: this.status,
			exitCode: this.exitCode,
			createdAt: this.createdAt,
			uptime: Date.now() - this.createdAt.getTime(),
		};
	}
}
