import { z } from '@hono/zod-openapi';
import {
	loadGlobalConfig,
	resolveJudgeConfig,
	writeMemorySettings,
} from '@ottocode/sdk';
import type { Hono } from 'hono';
import { getMemoryPath } from '@ottocode/sdk/memory';
import { memoryEmbeddingStatus } from '@ottocode/sdk/memory/embedder';
import { zodOpenApiRoute } from '../../openapi/route.ts';
import { serializeError } from '../../runtime/errors/api-error.ts';

const embeddingsSchema = z.object({
	enabled: z.boolean().optional(),
	backend: z.enum(['local', 'ollama', 'provider', 'none']).optional(),
	provider: z.enum(['openai', 'google']).optional(),
	model: z.string().optional(),
	dims: z.number().int().positive().optional(),
});
const settingsSchema = z.object({
	enabled: z.boolean(),
	autoCapture: z.boolean(),
	recall: z.boolean(),
	recallInSubagents: z.boolean(),
	captureInSubagents: z.boolean(),
	embeddings: embeddingsSchema,
});
const responseSchema = z.object({
	settings: settingsSchema,
	typesafe: z.object({ configured: z.boolean() }),
	embeddings: z.object({
		configured: z.boolean(),
		backend: z.enum(['local', 'ollama', 'provider', 'none']),
		model: z.string(),
		dims: z.number(),
		ready: z.boolean(),
		state: z.enum(['not-loaded', 'loading', 'ready', 'error']),
	}),
	path: z.string(),
});
const updateSchema = settingsSchema
	.partial()
	.extend({ embeddings: embeddingsSchema.optional() });

async function response() {
	const config = await loadGlobalConfig();
	const judge = await resolveJudgeConfig(config.judge);
	const embeddings = await memoryEmbeddingStatus(config.memory?.embeddings);
	return {
		settings: {
			enabled: config.memory?.enabled ?? true,
			autoCapture: config.memory?.autoCapture ?? true,
			recall: config.memory?.recall ?? true,
			recallInSubagents: config.memory?.recallInSubagents ?? true,
			captureInSubagents: config.memory?.captureInSubagents ?? false,
			embeddings: config.memory?.embeddings ?? {},
		},
		typesafe: { configured: Boolean(judge.apiKey) },
		embeddings,
		path: getMemoryPath(),
	};
}

export function registerMemoryConfigRoutes(app: Hono) {
	zodOpenApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/config/memory',
			tags: ['config'],
			operationId: 'getMemoryConfig',
			summary: 'Get global memory settings and TypeSafe availability',
			responses: {
				'200': {
					description: 'Memory settings',
					content: { 'application/json': { schema: responseSchema } },
				},
			},
		},
		async (c) => {
			try {
				return c.json(await response());
			} catch (error) {
				const failure = serializeError(error);
				return c.json(failure, failure.error.status || 500);
			}
		},
	);
	zodOpenApiRoute(
		app,
		{
			method: 'put',
			path: '/v1/config/memory',
			tags: ['config'],
			operationId: 'updateMemoryConfig',
			summary: 'Update global user memory settings',
			request: {
				body: {
					required: true,
					content: { 'application/json': { schema: updateSchema } },
				},
			},
			responses: {
				'200': {
					description: 'Updated memory settings',
					content: { 'application/json': { schema: responseSchema } },
				},
			},
		},
		async (c) => {
			try {
				await writeMemorySettings(c.req.valid('json'));
				return c.json(await response());
			} catch (error) {
				const failure = serializeError(error);
				return c.json(failure, failure.error.status || 500);
			}
		},
	);
}
