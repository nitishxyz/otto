import { z } from '@hono/zod-openapi';

export const errorResponseSchema = z.object({ error: z.string() });

export const copilotStartResponseSchema = z.object({
	sessionId: z.string(),
	userCode: z.string(),
	verificationUri: z.string(),
	interval: z.number().int(),
});

export const copilotPollBodySchema = z.object({
	sessionId: z.string(),
});

export const copilotPollResponseSchema = z.object({
	status: z.enum(['complete', 'pending', 'error']),
	error: z.string().optional(),
});

export const ghImportCapabilitySchema = z.object({
	available: z.boolean(),
	authenticated: z.boolean(),
	reason: z.string().optional(),
});

export const copilotMethodsSchema = z.object({
	oauth: z.boolean(),
	token: z.boolean(),
	ghImport: ghImportCapabilitySchema,
});

export const copilotTokenBodySchema = z.object({
	token: z.string(),
});

export const copilotSaveResponseSchema = z.object({
	success: z.boolean(),
	provider: z.string(),
	source: z.enum(['token', 'gh']),
	modelCount: z.number().int(),
	hasGpt52Codex: z.boolean(),
	sampleModels: z.array(z.string()),
});

export const copilotDiagnosticsSchema = z.object({
	tokenSources: z.array(
		z.object({
			source: z.enum(['env', 'stored']),
			configured: z.boolean(),
			modelCount: z.number().int().optional(),
			hasGpt52Codex: z.boolean().optional(),
			sampleModels: z.array(z.string()).optional(),
			restrictedByOrgPolicy: z.boolean().optional(),
			restrictedOrg: z.string().optional(),
			restrictionMessage: z.string().optional(),
			error: z.string().optional(),
		}),
	),
	methods: copilotMethodsSchema,
});
