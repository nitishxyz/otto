import { Buffer } from 'node:buffer';
import type {
	LanguageModelV3Middleware,
	LanguageModelV3Prompt,
} from '@ai-sdk/provider';
import { createXai } from '@ai-sdk/xai';
import { wrapLanguageModel } from 'ai';
import { catalog } from './catalog-merged.ts';

const XAI_GROK_CLI_BASE_URL = 'https://cli-chat-proxy.grok.com/v1';
const XAI_DEFAULT_API_BASE_URL = 'https://api.x.ai/v1';
const XAI_GROK_CLI_CLIENT_VERSION = '0.2.22';
const XAI_FILE_ID_URL_SCHEME = 'xai-file-id:';
const XAI_MAX_INLINE_FILE_BYTES = 48 * 1024 * 1024;

export const XAI_GROK_CLI_MODEL_IDS = [
	'grok-build',
	'grok-composer-2.5-fast',
] as const;

export type XaiProviderConfig = {
	apiKey?: string;
	baseURL?: string;
	filesBaseURL?: string;
	useResponses?: boolean;
	useGrokCliProxy?: boolean;
	fetch?: typeof fetch;
};

type XaiResponsesContentPart = {
	type?: string;
	image_url?: unknown;
	file_url?: unknown;
	detail?: unknown;
	[key: string]: unknown;
};

type XaiResponsesMessage = {
	type?: string;
	content?: unknown;
	[key: string]: unknown;
};

export function isXaiGrokCliModel(model: string): boolean {
	const normalized = model.toLowerCase().split('/').pop() || model;
	return XAI_GROK_CLI_MODEL_IDS.some((id) => id === normalized);
}

function getGrokCliPlatform(): string {
	const platform = globalThis.process?.platform;
	if (platform === 'darwin') return 'macos';
	return platform || 'unknown';
}

function getGrokCliArch(): string {
	const arch = globalThis.process?.arch;
	if (arch === 'arm64') return 'aarch64';
	return arch || 'unknown';
}

export function getGrokCliHeaders(model: string): Record<string, string> {
	return {
		'x-xai-token-auth': 'xai-grok-cli',
		'x-authenticateresponse': 'authenticate-response',
		'x-grok-client-version': XAI_GROK_CLI_CLIENT_VERSION,
		'x-grok-client-identifier': 'grok-shell',
		'x-grok-model-override': model,
		'user-agent': `grok-shell/${XAI_GROK_CLI_CLIENT_VERSION} (${getGrokCliPlatform()}; ${getGrokCliArch()})`,
	};
}

function shouldUseXaiResponsesApi(model: string): boolean {
	const normalized = model.toLowerCase().split('/').pop() || model;
	return (
		isXaiGrokCliModel(normalized) ||
		normalized === 'grok-4.3' ||
		normalized === 'grok-4.5' ||
		normalized === 'grok-build-0.1' ||
		normalized.startsWith('grok-4.20-')
	);
}

function toXaiFileIdUrl(fileId: string): URL {
	return new URL(`${XAI_FILE_ID_URL_SCHEME}${encodeURIComponent(fileId)}`);
}

function getXaiFileIdFromUrl(value: unknown): string | undefined {
	if (typeof value !== 'string' || !value.startsWith(XAI_FILE_ID_URL_SCHEME)) {
		return undefined;
	}
	const encoded = value.slice(XAI_FILE_ID_URL_SCHEME.length);
	if (!encoded) return undefined;
	return decodeURIComponent(encoded);
}

function getXaiUploadUrl(baseURL?: string): string {
	const normalized = baseURL || XAI_DEFAULT_API_BASE_URL;
	return new URL(
		'files',
		normalized.endsWith('/') ? normalized : `${normalized}/`,
	).toString();
}

async function getXaiUploadErrorMessage(response: Response): Promise<string> {
	const text = await response.text();
	const contentType = response.headers.get('content-type') || '';
	if (contentType.includes('application/json')) {
		try {
			const payload = JSON.parse(text) as {
				error?: { message?: unknown };
				message?: unknown;
			};
			const message = payload.error?.message ?? payload.message;
			if (typeof message === 'string' && message) return message;
		} catch {}
	}
	if (response.status === 413) {
		return 'request body too large for the xAI file upload gateway';
	}
	return text
		.replace(/<[^>]*>/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function filePartDataToBytes(data: string | Uint8Array): Uint8Array {
	if (data instanceof Uint8Array) return data;
	const base64 = data.startsWith('data:')
		? (data.split(',', 2)[1] ?? '')
		: data;
	return new Uint8Array(Buffer.from(base64, 'base64'));
}

async function uploadXaiInlineFile(args: {
	apiKey: string;
	baseURL?: string;
	fetch?: typeof fetch;
	headers?: Record<string, string>;
	data: string | Uint8Array;
	mediaType: string;
	filename?: string;
}): Promise<string> {
	const bytes = filePartDataToBytes(args.data);
	if (bytes.byteLength > XAI_MAX_INLINE_FILE_BYTES) {
		throw new Error(
			`xAI Files API supports files up to 48 MB; ${args.filename || 'attachment'} is ${(
				bytes.byteLength / 1024 / 1024
			).toFixed(1)} MB.`,
		);
	}

	const form = new FormData();
	form.append('purpose', 'assistants');
	form.append(
		'file',
		new Blob([bytes], { type: args.mediaType }),
		args.filename || 'attachment',
	);

	const uploadFetch = args.fetch ?? fetch;
	const response = await uploadFetch(getXaiUploadUrl(args.baseURL), {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${args.apiKey}`,
			...args.headers,
		},
		body: form,
	});

	if (!response.ok) {
		const message = await getXaiUploadErrorMessage(response);
		throw new Error(
			`xAI file upload failed: ${response.status}${message ? ` ${message}` : ''}`,
		);
	}

	const payload = (await response.json()) as { id?: unknown };
	if (typeof payload.id !== 'string' || !payload.id) {
		throw new Error('xAI file upload did not return a file id.');
	}
	return payload.id;
}

export async function prepareXaiResponsesPromptFiles(
	prompt: LanguageModelV3Prompt,
	args: {
		apiKey: string;
		baseURL?: string;
		fetch?: typeof fetch;
		headers?: Record<string, string>;
	},
): Promise<LanguageModelV3Prompt> {
	let promptChanged = false;
	const nextPrompt = await Promise.all(
		prompt.map(async (message) => {
			if (message.role !== 'user' && message.role !== 'assistant') {
				return message;
			}
			let messageChanged = false;
			const nextContent = await Promise.all(
				message.content.map(async (part) => {
					if (
						part.type !== 'file' ||
						part.mediaType.startsWith('image/') ||
						part.data instanceof URL
					) {
						return part;
					}
					const fileId = await uploadXaiInlineFile({
						apiKey: args.apiKey,
						baseURL: args.baseURL,
						fetch: args.fetch,
						headers: args.headers,
						data: part.data,
						mediaType: part.mediaType,
						filename: part.filename,
					});
					messageChanged = true;
					promptChanged = true;
					return { ...part, data: toXaiFileIdUrl(fileId) };
				}),
			);
			return messageChanged
				? ({ ...message, content: nextContent } as typeof message)
				: message;
		}),
	);
	return promptChanged ? nextPrompt : prompt;
}

function createXaiResponsesFileUploadMiddleware(args: {
	apiKey: string;
	baseURL?: string;
	fetch?: typeof fetch;
	headers?: Record<string, string>;
}): LanguageModelV3Middleware {
	return {
		specificationVersion: 'v3',
		async transformParams({ params }) {
			return {
				...params,
				prompt: await prepareXaiResponsesPromptFiles(params.prompt, args),
			};
		},
	};
}

/** Normalize inputs to the shape accepted by xAI Responses endpoints. */
export function normalizeXaiResponsesPayload(body: unknown): unknown {
	if (!(body && typeof body === 'object')) return body;
	const candidate = body as { input?: unknown };
	if (!Array.isArray(candidate.input)) return body;
	return {
		...candidate,
		input: candidate.input.map((item) => {
			if (!(item && typeof item === 'object')) return item;
			const message = item as XaiResponsesMessage;
			const content = message.content;
			if (!Array.isArray(content)) return item;
			return {
				...message,
				type: message.type ?? 'message',
				content: content.map((part) => {
					if (!(part && typeof part === 'object')) return part;
					const contentPart = part as XaiResponsesContentPart;
					if (contentPart.type === 'input_image') {
						return {
							...contentPart,
							detail: contentPart.detail ?? 'auto',
						};
					}
					if (contentPart.type === 'input_file') {
						const fileId = getXaiFileIdFromUrl(contentPart.file_url);
						if (fileId) {
							const { file_url: _fileUrl, ...rest } = contentPart;
							return { ...rest, file_id: fileId };
						}
					}
					return part;
				}),
			};
		}),
	};
}

/** Normalize image inputs to the shape accepted by xAI Responses endpoints. */
export function normalizeXaiResponsesImagePayload(body: unknown): unknown {
	return normalizeXaiResponsesPayload(body);
}

function createXaiResponsesFetch(
	baseFetch: typeof fetch = fetch,
): typeof fetch {
	const responsesFetch = async (
		input: Parameters<typeof fetch>[0],
		init?: Parameters<typeof fetch>[1],
	): Promise<Response> => {
		if (init?.body && typeof init.body === 'string') {
			try {
				const body = JSON.parse(init.body);
				const normalized = normalizeXaiResponsesPayload(body);
				return baseFetch(input, {
					...init,
					body: JSON.stringify(normalized),
				});
			} catch {}
		}
		return baseFetch(input, init);
	};

	return Object.assign(responsesFetch, { preconnect: baseFetch.preconnect });
}

export function createXaiModel(model: string, config?: XaiProviderConfig) {
	const entry = catalog.xai;
	const apiKey = config?.apiKey || process.env.XAI_API_KEY || '';
	const baseURL =
		config?.baseURL ||
		(config?.useGrokCliProxy ? XAI_GROK_CLI_BASE_URL : entry?.api);
	const grokCliHeaders = config?.useGrokCliProxy
		? getGrokCliHeaders(model)
		: undefined;
	const useResponses =
		config?.useGrokCliProxy ||
		(config?.useResponses ?? shouldUseXaiResponsesApi(model));
	const instance = createXai({
		apiKey,
		baseURL,
		headers: grokCliHeaders,
		fetch: useResponses
			? createXaiResponsesFetch(config?.fetch)
			: config?.fetch,
	});
	if (useResponses) {
		return wrapLanguageModel({
			model: instance.responses(model) as never,
			middleware: createXaiResponsesFileUploadMiddleware({
				apiKey,
				baseURL: config?.filesBaseURL,
				fetch: config?.fetch,
			}),
		});
	}
	return instance(model);
}
