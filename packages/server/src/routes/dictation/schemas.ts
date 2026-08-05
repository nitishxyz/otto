import { z } from '@hono/zod-openapi';

export const errorResponseSchema = z.object({
	error: z.string(),
	code: z.string().optional(),
});

export const audioFormatSchema = z.object({
	encoding: z.string(),
	sampleRate: z.number(),
	channels: z.number(),
});

export const dictationModelSchema = z
	.object({
		id: z.string(),
		label: z.string(),
		language: z.enum(['en', 'multi']),
		sizeBytes: z.number(),
		url: z.string(),
		sha256: z.string(),
		recommended: z.boolean().optional(),
		installed: z.boolean(),
		installing: z.boolean(),
		installedSizeBytes: z.number(),
		installStatus: z.enum([
			'idle',
			'installing',
			'verifying',
			'installed',
			'error',
		]),
		progressBytes: z.number(),
		totalBytes: z.number(),
		error: z.string().optional(),
		errorCode: z.string().optional(),
	})
	.passthrough();

export const dictationSessionSchema = z
	.object({
		id: z.string(),
		status: z.enum([
			'created',
			'recording',
			'transcribing',
			'completed',
			'cancelled',
			'error',
		]),
		model: z.string(),
		language: z.string(),
		format: audioFormatSchema,
		createdAt: z.string(),
		updatedAt: z.string(),
		receivedBytes: z.number(),
		receivedMs: z.number(),
		pcmPath: z.string(),
		wavPath: z.string(),
		text: z.string().optional(),
		error: z.string().optional(),
	})
	.passthrough();

export const modelParamsSchema = z.object({
	model: z.string().openapi({ param: { name: 'model', in: 'path' } }),
});

export const sessionParamsSchema = z.object({
	id: z.string().openapi({ param: { name: 'id', in: 'path' } }),
});

export const installModelBodySchema = z.object({
	force: z.boolean().optional(),
});

export const createSessionBodySchema = z.object({
	model: z.string().optional(),
	language: z.string().optional(),
	prompt: z.string().optional(),
});

export const dictationStatusResponseSchema = z.object({
	available: z.boolean(),
	engine: z.string(),
	engineInstalled: z.boolean(),
	defaultModel: z.string(),
	format: audioFormatSchema.optional(),
	projectKeywords: z.array(z.string()),
	models: z.array(dictationModelSchema),
});

export const dictationModelsResponseSchema = z.object({
	models: z.array(dictationModelSchema),
});

export const dictationModelResponseSchema = z.object({
	model: dictationModelSchema,
});

export const removeDictationModelResponseSchema = z.object({
	removed: z.boolean(),
	model: dictationModelSchema,
});

export const createDictationSessionResponseSchema = z.object({
	id: z.string(),
	wsUrl: z.string(),
	model: z.string(),
	modelInstalled: z.boolean(),
	format: audioFormatSchema,
});

export const getDictationSessionResponseSchema = z.object({
	session: dictationSessionSchema,
});

export const deleteDictationSessionResponseSchema = z.object({
	deleted: z.boolean(),
});
