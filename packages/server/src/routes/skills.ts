import { z } from '@hono/zod-openapi';
import type { Hono } from 'hono';
import { zodOpenApiRoute } from '../openapi/route.ts';
import {
	getSkill,
	getSkillFile,
	getSkillsConfig,
	listSkillFiles,
	listSkills,
	updateSkillsConfig,
	validateSkill,
	validateSkillNameRoute,
} from './skills/service.ts';

const projectQuerySchema = z.object({
	project: z
		.string()
		.optional()
		.openapi({
			param: { name: 'project', in: 'query' },
			description:
				'Project root override (defaults to current working directory).',
		}),
});

const skillNameParamsSchema = z.object({
	name: z.string().openapi({
		param: { name: 'name', in: 'path' },
	}),
});

const skillFileParamsSchema = z.object({
	name: z.string().openapi({ param: { name: 'name', in: 'path' } }),
	filePath: z.string().openapi({
		param: { name: 'filePath', in: 'path' },
	}),
});

const skillListItemSchema = z.object({
	name: z.string(),
	description: z.string(),
	scope: z.string(),
	path: z.string(),
});

const skillConfigItemSchema = skillListItemSchema.extend({
	enabled: z.boolean(),
});

const skillsConfigSchema = z.object({
	enabled: z.boolean(),
	totalCount: z.number(),
	enabledCount: z.number(),
	items: z.array(skillConfigItemSchema),
});

const updateSkillsConfigBodySchema = z.object({
	enabled: z.boolean().optional(),
	items: z
		.record(z.string(), z.object({ enabled: z.boolean().optional() }))
		.optional(),
});

const skillDetailSchema = z.object({
	name: z.string(),
	description: z.string(),
	license: z.string().nullable().optional(),
	compatibility: z.string().nullable().optional(),
	metadata: z.record(z.string(), z.unknown()).nullable().optional(),
	allowedTools: z.array(z.string()).nullable().optional(),
	path: z.string(),
	scope: z.string(),
	content: z.string(),
});

const skillFileListSchema = z.object({
	files: z.array(
		z.object({
			relativePath: z.string(),
			size: z.number(),
		}),
	),
});

const skillFileSchema = z.object({
	content: z.string(),
	path: z.string(),
});

const validateSkillBodySchema = z.object({
	content: z.string(),
	path: z.string().optional(),
});

const validateSkillResponseSchema = z.object({
	valid: z.boolean(),
	name: z.string().optional(),
	description: z.string().optional(),
	license: z.string().nullable().optional(),
	error: z.string().optional(),
});

const errorResponseSchema = z.object({ error: z.string() });

export function registerSkillsRoutes(app: Hono) {
	zodOpenApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/skills',
			tags: ['config'],
			operationId: 'listSkills',
			summary: 'List discovered skills',
			request: { query: projectQuerySchema },
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': {
							schema: z.object({ skills: z.array(skillListItemSchema) }),
						},
					},
				},
				'500': {
					description: 'Bad Request',
					content: { 'application/json': { schema: errorResponseSchema } },
				},
			},
		},
		listSkills,
	);

	zodOpenApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/config/skills',
			tags: ['config'],
			operationId: 'getSkillsConfig',
			summary: 'Get skills enable/disable config and counts',
			request: { query: projectQuerySchema },
			responses: {
				'200': {
					description: 'OK',
					content: { 'application/json': { schema: skillsConfigSchema } },
				},
				'500': {
					description: 'Bad Request',
					content: { 'application/json': { schema: errorResponseSchema } },
				},
			},
		},
		getSkillsConfig,
	);

	zodOpenApiRoute(
		app,
		{
			method: 'put',
			path: '/v1/config/skills',
			tags: ['config'],
			operationId: 'updateSkillsConfig',
			summary: 'Update skills enable/disable config',
			request: {
				query: projectQuerySchema,
				body: {
					required: true,
					content: {
						'application/json': { schema: updateSkillsConfigBodySchema },
					},
				},
			},
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': {
							schema: skillsConfigSchema.extend({ success: z.boolean() }),
						},
					},
				},
				'500': {
					description: 'Bad Request',
					content: { 'application/json': { schema: errorResponseSchema } },
				},
			},
		},
		updateSkillsConfig,
	);

	zodOpenApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/skills/{name}',
			tags: ['config'],
			operationId: 'getSkill',
			summary: 'Get a skill by name',
			request: { params: skillNameParamsSchema, query: projectQuerySchema },
			responses: {
				'200': {
					description: 'OK',
					content: { 'application/json': { schema: skillDetailSchema } },
				},
				'404': {
					description: 'Bad Request',
					content: { 'application/json': { schema: errorResponseSchema } },
				},
				'500': {
					description: 'Bad Request',
					content: { 'application/json': { schema: errorResponseSchema } },
				},
			},
		},
		getSkill,
	);

	zodOpenApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/skills/{name}/files',
			tags: ['config'],
			operationId: 'listSkillFiles',
			summary: 'List files in a skill directory',
			request: { params: skillNameParamsSchema, query: projectQuerySchema },
			responses: {
				'200': {
					description: 'OK',
					content: { 'application/json': { schema: skillFileListSchema } },
				},
				'500': {
					description: 'Bad Request',
					content: { 'application/json': { schema: errorResponseSchema } },
				},
			},
		},
		listSkillFiles,
	);

	zodOpenApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/skills/{name}/files/{filePath}',
			tags: ['config'],
			operationId: 'getSkillFile',
			summary: 'Read a specific file from a skill directory',
			request: { params: skillFileParamsSchema, query: projectQuerySchema },
			responses: {
				'200': {
					description: 'OK',
					content: { 'application/json': { schema: skillFileSchema } },
				},
				'404': {
					description: 'Bad Request',
					content: { 'application/json': { schema: errorResponseSchema } },
				},
				'500': {
					description: 'Bad Request',
					content: { 'application/json': { schema: errorResponseSchema } },
				},
			},
		},
		getSkillFile,
	);

	zodOpenApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/skills/validate',
			tags: ['config'],
			operationId: 'validateSkill',
			summary: 'Validate a SKILL.md content',
			request: {
				body: {
					required: true,
					content: {
						'application/json': { schema: validateSkillBodySchema },
					},
				},
			},
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': { schema: validateSkillResponseSchema },
					},
				},
			},
		},
		validateSkill,
	);

	zodOpenApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/skills/validate-name/{name}',
			tags: ['config'],
			operationId: 'validateSkillName',
			summary: 'Check if a skill name is valid',
			request: { params: skillNameParamsSchema },
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': {
							schema: z.object({ valid: z.boolean() }),
						},
					},
				},
			},
		},
		validateSkillNameRoute,
	);
}
