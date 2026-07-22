export interface PtyOptions {
	name?: string;
	cols?: number;
	rows?: number;
	cwd?: string;
	env?: Record<string, string>;
}

export interface IExitEvent {
	exitCode: number;
}

export interface IPty {
	pid: number;
	write(data: string): void;
	resize(cols: number, rows: number): void;
	kill(signal?: string): void;
	onData(callback: (data: string) => void): void;
	onExit(callback: (event: IExitEvent) => void): void;
}

/** Spawns a process attached to Bun's built-in cross-platform terminal. */
export function spawn(
	command: string,
	args: string[],
	options: PtyOptions,
): IPty {
	const dataListeners = new Set<(data: string) => void>();
	const exitListeners = new Set<(event: IExitEvent) => void>();
	const decoder = new TextDecoder();
	const pendingData: string[] = [];
	let exitEvent: IExitEvent | undefined;
	const emitData = (data: string) => {
		if (!data) return;
		if (dataListeners.size === 0) {
			pendingData.push(data);
			return;
		}
		for (const listener of dataListeners) listener(data);
	};

	const proc = Bun.spawn([command, ...args], {
		cwd: options.cwd,
		env: options.env,
		terminal: {
			name: options.name,
			cols: options.cols,
			rows: options.rows,
			data: (_terminal, data) => {
				emitData(decoder.decode(data, { stream: true }));
			},
		},
	});
	const terminal = proc.terminal;
	if (!terminal) throw new Error('Bun did not create a terminal');

	void proc.exited.then((exitCode) => {
		emitData(decoder.decode());
		exitEvent = { exitCode };
		for (const listener of exitListeners) listener(exitEvent);
	});

	return {
		pid: proc.pid,
		write: (data) => {
			terminal.write(data);
		},
		resize: (cols, rows) => {
			terminal.resize(cols, rows);
		},
		kill: (signal) => {
			proc.kill(signal as NodeJS.Signals | undefined);
		},
		onData: (callback) => {
			dataListeners.add(callback);
			for (const data of pendingData.splice(0)) callback(data);
		},
		onExit: (callback) => {
			if (exitEvent) {
				queueMicrotask(() => callback(exitEvent as IExitEvent));
				return;
			}
			exitListeners.add(callback);
		},
	};
}
