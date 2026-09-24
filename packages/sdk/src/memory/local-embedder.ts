import { mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { getMemoryPath } from './index.ts';
import type { Embedder } from './embedder.ts';

export const LOCAL_MODEL = 'Xenova/all-MiniLM-L6-v2';
const ORT_VERSION = '1.22.0-dev.20250409-89f8206ba4';
const FILES = [
	'config.json',
	'tokenizer.json',
	'tokenizer_config.json',
	'onnx/model_quantized.onnx',
];
const WASM = ['ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm'];

export function modelDir(): string {
	return resolve(
		process.env.OTTO_MEMORY_MODEL_DIR ??
			join(dirname(getMemoryPath()), 'models'),
	);
}

export function localModelReady(model = LOCAL_MODEL): boolean {
	if (!/^[\w.-]+\/[\w.-]+$/.test(model)) return false;
	const root = modelDir();
	return (
		FILES.every((file) => existsSync(join(root, model, file))) &&
		WASM.every((file) => existsSync(join(root, 'wasm', file)))
	);
}

async function ensureAssets(model: string): Promise<void> {
	const root = modelDir();
	const list = [
		...FILES.map((file) => ({
			path: join(root, model, file),
			url: `https://huggingface.co/${model}/resolve/main/${file}`,
		})),
		...WASM.map((file) => ({
			path: join(root, 'wasm', file),
			url: `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/${file}`,
		})),
	];
	for (const item of list) {
		if (existsSync(item.path)) continue;
		if (
			process.env.NODE_ENV === 'test' ||
			process.env.OTTO_MEMORY_OFFLINE === '1'
		)
			throw new Error(
				'Local memory embedding model is not cached; downloads disabled',
			);
		console.error(
			`[memory] Downloading ${item.path.slice(root.length + 1)} (once)`,
		);
		mkdirSync(dirname(item.path), { recursive: true, mode: 0o700 });
		const response = await fetch(item.url);
		if (!response.ok)
			throw new Error(`Model download failed (${response.status})`);
		const partial = `${item.path}.${crypto.randomUUID()}.tmp`;
		try {
			await Bun.write(partial, response);
			const { rename } = await import('node:fs/promises');
			await rename(partial, item.path);
		} catch (error) {
			const { rm } = await import('node:fs/promises');
			await rm(partial, { force: true });
			throw error;
		}
	}
}

type Extractor = (
	text: string,
	options: { pooling: 'mean'; normalize: true },
) => Promise<{ data: Float32Array }>;
const warm = new Map<string, Promise<Extractor>>();
const states = new Map<string, 'loading' | 'ready' | 'error'>();

export function localEmbeddingState(
	model = LOCAL_MODEL,
): 'not-loaded' | 'loading' | 'ready' | 'error' {
	return states.get(`${modelDir()}:${model}`) ?? 'not-loaded';
}

async function load(model: string): Promise<Extractor> {
	await ensureAssets(model);
	const root = modelDir();
	const previousName = process.release.name;
	let transformers: typeof import('@huggingface/transformers');
	try {
		// The web distribution uses WASM; the Node distribution requires a native addon
		// whose dylib is unavailable inside a compiled Bun binary.
		process.release.name = 'web';
		transformers = await import(
			// @ts-expect-error Bundled browser distribution has no declaration file.
			'../../../../node_modules/@huggingface/transformers/dist/transformers.web.js'
		);
	} finally {
		process.release.name = previousName;
	}
	const { pipeline, env } = transformers;
	const server = Bun.serve({
		hostname: '127.0.0.1',
		port: 0,
		async fetch(request) {
			const url = new URL(request.url);
			const path = resolve(root, `.${decodeURIComponent(url.pathname)}`);
			if (!path.startsWith(root + sep))
				return new Response('Forbidden', { status: 403 });
			const file = Bun.file(path);
			return (await file.exists())
				? new Response(file)
				: new Response('Not found', { status: 404 });
		},
	});
	try {
		env.localModelPath = `http://127.0.0.1:${server.port}/`;
		env.allowRemoteModels = false;
		if (!env.backends.onnx.wasm)
			throw new Error('ONNX WASM backend unavailable');
		env.backends.onnx.wasm.wasmPaths = join(root, 'wasm') + sep;
		env.backends.onnx.wasm.numThreads = 1;
		const extractor = await pipeline('feature-extraction', model, {
			dtype: 'q8',
			device: 'wasm',
		});
		return extractor as unknown as Extractor;
	} finally {
		server.stop(true);
	}
}

/** Lazy, process-warm ONNX WASM embedder. Models and matching WASM live outside repos. */
export function createLocalEmbedder(model = LOCAL_MODEL): Embedder {
	if (!/^[\w.-]+\/[\w.-]+$/.test(model))
		throw new Error('Invalid local embedding model ID');
	return {
		model: `local:${model}`,
		dims: 384,
		async embed(texts) {
			if (!texts.length) return [];
			const cacheKey = `${modelDir()}:${model}`;
			let pending = warm.get(cacheKey);
			if (!pending) {
				states.set(cacheKey, 'loading');
				pending = load(model);
				warm.set(cacheKey, pending);
			}
			try {
				const extractor = await pending;
				states.set(cacheKey, 'ready');
				const output: Float32Array[] = [];
				for (const text of texts)
					output.push(
						Float32Array.from(
							(await extractor(text, { pooling: 'mean', normalize: true }))
								.data,
						),
					);
				return output;
			} catch (error) {
				states.set(cacheKey, 'error');
				warm.delete(cacheKey);
				throw error;
			}
		},
	};
}
