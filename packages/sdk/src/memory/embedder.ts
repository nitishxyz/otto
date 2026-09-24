import { createOpenAI } from '@ai-sdk/openai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { embedMany } from 'ai';
import { createOllama } from 'ai-sdk-ollama';
import { getAuth } from '../auth/src/index.ts';
import type { MemorySettings } from '../types/src/config.ts';
import {
	createLocalEmbedder,
	LOCAL_MODEL,
	localEmbeddingState,
	localModelReady,
} from './local-embedder.ts';

export interface Embedder {
	readonly model: string;
	readonly dims: number;
	embed(texts: string[]): Promise<Float32Array[]>;
}

export type EmbeddingConfig = NonNullable<MemorySettings['embeddings']>;
export type EmbeddingStatus = {
	configured: boolean;
	backend: 'local' | 'ollama' | 'provider' | 'none';
	model: string;
	dims: number;
	ready: boolean;
	state: 'not-loaded' | 'loading' | 'ready' | 'error';
};

async function ollamaAvailable(model: string): Promise<boolean> {
	if (process.env.NODE_ENV === 'test') return false;
	try {
		const response = await fetch('http://127.0.0.1:11434/api/tags', {
			signal: AbortSignal.timeout(350),
		});
		if (!response.ok) return false;
		const body = (await response.json()) as {
			models?: Array<{ name: string }>;
		};
		return Boolean(
			body.models?.some(
				(item) => item.name === model || item.name.startsWith(`${model}:`),
			),
		);
	} catch {
		return false;
	}
}

export async function memoryEmbeddingStatus(
	config?: EmbeddingConfig,
	projectRoot?: string,
): Promise<EmbeddingStatus> {
	const backend =
		config?.enabled === false
			? 'none'
			: (config?.backend ?? (config?.provider ? 'provider' : 'local'));
	if (backend === 'none')
		return {
			configured: false,
			backend,
			model: '',
			dims: 0,
			ready: false,
			state: 'not-loaded',
		};
	if (backend === 'local') {
		const model = config?.model || LOCAL_MODEL;
		if (
			!config?.backend &&
			!localModelReady(model) &&
			(await ollamaAvailable('nomic-embed-text'))
		)
			return {
				configured: true,
				backend: 'ollama',
				model: 'ollama:nomic-embed-text',
				dims: 768,
				ready: true,
				state: 'ready',
			};
		return {
			configured: true,
			backend,
			model: `local:${model}`,
			dims: 384,
			ready: localEmbeddingState(model) === 'ready',
			state: localEmbeddingState(model),
		};
	}
	if (backend === 'ollama') {
		const model = config?.model || 'nomic-embed-text';
		const ready = await ollamaAvailable(model);
		return {
			configured: ready,
			backend,
			model: `ollama:${model}`,
			dims: config?.dims ?? 768,
			ready,
			state: ready ? 'ready' : 'error',
		};
	}
	const provider = config?.provider;
	if (!provider)
		return {
			configured: false,
			backend,
			model: '',
			dims: 0,
			ready: false,
			state: 'error',
		};
	const auth = await getAuth(provider, projectRoot).catch(() => undefined);
	const apiKey =
		auth?.type === 'api'
			? auth.key
			: provider === 'openai'
				? process.env.OPENAI_API_KEY
				: (process.env.GOOGLE_GENERATIVE_AI_API_KEY ??
					process.env.GOOGLE_API_KEY);
	const model =
		config?.model ||
		(provider === 'openai' ? 'text-embedding-3-small' : 'gemini-embedding-001');
	return {
		configured: Boolean(apiKey),
		backend,
		model: `${provider}:${model}`,
		dims: config?.dims ?? (provider === 'openai' ? 1536 : 3072),
		ready: Boolean(apiKey),
		state: apiKey ? 'ready' : 'error',
	};
}

/** Resolve an embeddings model using existing Otto credentials, never a separate key path. */
export async function resolveMemoryEmbedder(
	config?: EmbeddingConfig,
	projectRoot?: string,
): Promise<Embedder | null> {
	if (config?.enabled === false || config?.backend === 'none') return null;
	const backend = config?.backend ?? (config?.provider ? 'provider' : 'local');
	if (backend === 'local') {
		if (
			!config?.backend &&
			!localModelReady(config?.model ?? LOCAL_MODEL) &&
			(await ollamaAvailable('nomic-embed-text'))
		)
			return resolveMemoryEmbedder(
				{ backend: 'ollama', model: 'nomic-embed-text' },
				projectRoot,
			);
		return createLocalEmbedder(config?.model ?? LOCAL_MODEL);
	}
	if (backend === 'ollama') {
		const model = config?.model ?? 'nomic-embed-text';
		if (!(await ollamaAvailable(model))) return null;
		const instance = createOllama({
			baseURL: 'http://127.0.0.1:11434/api',
		}).textEmbeddingModel(model);
		return {
			model: `ollama:${model}`,
			dims: config?.dims ?? 768,
			async embed(texts) {
				if (!texts.length) return [];
				const result = await embedMany({ model: instance, values: texts });
				return result.embeddings.map((vector) => Float32Array.from(vector));
			},
		};
	}
	if (!config?.provider) return null;
	const provider = config.provider;
	const auth = await getAuth(provider, projectRoot).catch(() => undefined);
	const envKey =
		provider === 'openai'
			? process.env.OPENAI_API_KEY
			: (process.env.GOOGLE_GENERATIVE_AI_API_KEY ??
				process.env.GOOGLE_API_KEY);
	const apiKey = auth?.type === 'api' ? auth.key : envKey;
	if (!apiKey) return null;
	const model =
		config.model?.trim() ||
		(provider === 'openai' ? 'text-embedding-3-small' : 'gemini-embedding-001');
	const dims = config.dims ?? (provider === 'openai' ? 1536 : 3072);
	const instance =
		provider === 'openai'
			? createOpenAI({ apiKey }).embeddingModel(model)
			: createGoogleGenerativeAI({ apiKey }).embeddingModel(model);
	return {
		model: `${provider}:${model}`,
		dims,
		async embed(texts) {
			if (!texts.length) return [];
			const result = await embedMany({ model: instance, values: texts });
			return result.embeddings.map((vector) => Float32Array.from(vector));
		},
	};
}
