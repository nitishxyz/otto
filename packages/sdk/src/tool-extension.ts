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

export type NativeToolProgress = {
	message: string;
	channel?: string;
};

export type NativeToolContentPart =
	| { type: 'text'; text: string }
	| { type: 'json'; value: unknown }
	| { type: 'image'; data: string; mediaType: string };

export type NativeToolRichResult = {
	content: NativeToolContentPart[];
	structuredContent?: unknown;
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
	progress(update: string | NativeToolProgress): void;
	secrets: {
		get(name: string): string | null;
	};
	storage: {
		get<T = unknown>(key: string): Promise<T | null>;
		set(key: string, value: unknown): Promise<void>;
		delete(key: string): Promise<boolean>;
	};
	output: {
		image(path: string, mediaType?: string): Promise<NativeToolContentPart>;
	};
};

export type NativeToolHandler<
	Input extends NativeToolInput = NativeToolInput,
	Output = unknown,
> = (input: Input, context: NativeToolContext) => Output | Promise<Output>;

export type NativeToolModule =
	| NativeToolHandler
	| { execute: NativeToolHandler };
