export type NativeToolInput = Record<string, unknown>;

export type NativeToolProcessOptions = {
	command: string;
	args?: string[];
	cwd?: string;
	env?: Record<string, string>;
	allowNonZeroExit?: boolean;
};

export type NativeToolProcessResult = {
	exitCode: number;
	stdout: string;
	stderr: string;
};

export type NativeToolContext = {
	protocolVersion: 1;
	projectRoot: string;
	pluginDir: string;
	toolName: string;
	signal: AbortSignal;
	workspace: {
		readText(path: string): Promise<string>;
		writeText(path: string, content: string): Promise<void>;
		exists(path: string): Promise<boolean>;
	};
	process: {
		run(options: NativeToolProcessOptions): Promise<NativeToolProcessResult>;
	};
};

export type NativeToolHandler<
	Input extends NativeToolInput = NativeToolInput,
	Output = unknown,
> = (input: Input, context: NativeToolContext) => Output | Promise<Output>;

export type NativeToolModule =
	| NativeToolHandler
	| { execute: NativeToolHandler };
