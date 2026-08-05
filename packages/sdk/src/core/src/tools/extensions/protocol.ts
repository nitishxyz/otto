export const NATIVE_EXTENSION_PROTOCOL_VERSION = 1 as const;

export type NativeExtensionRequest = {
	protocolVersion: typeof NATIVE_EXTENSION_PROTOCOL_VERSION;
	entryPath: string;
	pluginDir: string;
	projectRoot: string;
	toolName: string;
	input: Record<string, unknown>;
};

export type NativeExtensionSuccessResponse = {
	protocolVersion: typeof NATIVE_EXTENSION_PROTOCOL_VERSION;
	ok: true;
	result: unknown;
};

export type NativeExtensionErrorResponse = {
	protocolVersion: typeof NATIVE_EXTENSION_PROTOCOL_VERSION;
	ok: false;
	error: {
		name: string;
		message: string;
		stack?: string;
	};
};

export type NativeExtensionResponse =
	| NativeExtensionSuccessResponse
	| NativeExtensionErrorResponse;
