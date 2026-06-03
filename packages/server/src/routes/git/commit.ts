import { z } from '@hono/zod-openapi';
import type { Hono } from 'hono';
import { zodOpenApiRoute } from '../../openapi/route.ts';
import {
	handleCommitChanges,
	handleGenerateCommitMessage,
} from './commit-service.ts';

const gitCommitBodySchema = z.object({
	project: z.string().optional(),
	message: z.string().min(1),
});

const gitGenerateCommitMessageBodySchema = z.object({
	project: z.string().optional(),
	sessionId: z.string().optional().openapi({
		description: 'Session ID to use session provider',
	}),
});

const gitCommitResponseSchema = z.object({
	status: z.literal('ok'),
	data: z.object({
		message: z.string(),
	}),
});

const gitGeneratedMessageResponseSchema = z.object({
	status: z.literal('ok'),
	data: z.object({
		message: z.string(),
	}),
});

const gitErrorResponseSchema = z.object({
	status: z.literal('error'),
	error: z.string(),
	code: z.string().optional(),
});

export function registerCommitRoutes(app: Hono) {
	zodOpenApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/git/commit',
			tags: ['git'],
			operationId: 'commitChanges',
			summary: 'Commit staged changes',
			request: {
				body: {
					required: true,
					content: {
						'application/json': { schema: gitCommitBodySchema },
					},
				},
			},
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': { schema: gitCommitResponseSchema },
					},
				},
				'400': {
					description: 'Error',
					content: {
						'application/json': { schema: gitErrorResponseSchema },
					},
				},
				'500': {
					description: 'Error',
					content: {
						'application/json': { schema: gitErrorResponseSchema },
					},
				},
			},
		},
		handleCommitChanges,
	);

	zodOpenApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/git/generate-commit-message',
			tags: ['git'],
			operationId: 'generateCommitMessage',
			summary: 'Generate AI-powered commit message',
			description:
				'Uses AI to generate a commit message based on staged changes',
			request: {
				body: {
					required: false,
					content: {
						'application/json': { schema: gitGenerateCommitMessageBodySchema },
					},
				},
			},
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': { schema: gitGeneratedMessageResponseSchema },
					},
				},
				'400': {
					description: 'Error',
					content: {
						'application/json': { schema: gitErrorResponseSchema },
					},
				},
				'500': {
					description: 'Error',
					content: {
						'application/json': { schema: gitErrorResponseSchema },
					},
				},
			},
		},
		handleGenerateCommitMessage,
	);
}
