export const NATIVE_EXTENSION_PROTOCOL_VERSION = 1 as const;

export type NativeExtensionCallRequest = {
	protocolVersion: typeof NATIVE_EXTENSION_PROTOCOL_VERSION;
	entryPath: string;
	pluginDir: string;
	projectRoot: string;
	storagePath: string;
	toolName: string;
	input: Record<string, unknown>;
	secrets: Record<string, string>;
};

export type NativeExtensionRequestFrame = {
	type: 'call';
	id: string;
	request: NativeExtensionCallRequest;
};

export type NativeExtensionCancelFrame = {
	type: 'cancel';
	id: string;
};

export type NativeExtensionInputFrame =
	| NativeExtensionRequestFrame
	| NativeExtensionCancelFrame;

export type NativeExtensionEventFrame = {
	type: 'event';
	id: string;
	event: {
		channel: string;
		delta: string;
	};
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

export type NativeExtensionResultFrame = {
	type: 'result';
	id: string;
	response: NativeExtensionResponse;
};

export type NativeExtensionOutputFrame =
	| NativeExtensionEventFrame
	| NativeExtensionResultFrame;
