import { createXai } from '@ai-sdk/xai';
import { catalog } from './catalog-merged.ts';

const XAI_GROK_CLI_BASE_URL = 'https://cli-chat-proxy.grok.com/v1';
const XAI_GROK_CLI_CLIENT_VERSION = '0.2.22';

export const XAI_GROK_CLI_MODEL_IDS = [
	'grok-build',
	'grok-composer-2.5-fast',
] as const;

export type XaiProviderConfig = {
	apiKey?: string;
	baseURL?: string;
	useResponses?: boolean;
	useGrokCliProxy?: boolean;
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
		normalized === 'grok-build-0.1' ||
		normalized.startsWith('grok-4.20-')
	);
}

export function createXaiModel(model: string, config?: XaiProviderConfig) {
	const entry = catalog.xai;
	const apiKey = config?.apiKey || process.env.XAI_API_KEY || '';
	const baseURL =
		config?.baseURL ||
		(config?.useGrokCliProxy ? XAI_GROK_CLI_BASE_URL : entry?.api);
	const instance = createXai({
		apiKey,
		baseURL,
		headers: config?.useGrokCliProxy ? getGrokCliHeaders(model) : undefined,
	});
	if (
		config?.useGrokCliProxy ||
		(config?.useResponses ?? shouldUseXaiResponsesApi(model))
	) {
		return instance.responses(model);
	}
	return instance(model);
}
