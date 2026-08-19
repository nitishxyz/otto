import { z } from '@hono/zod-openapi';
import type { Hono } from 'hono';
import { zodOpenApiRoute } from '../openapi/route.ts';
import { sessionRepository } from '../runtime/session/repository.ts';
import {
	getPendingApproval,
	getPendingApprovalsForSession,
	resolveApproval,
} from '../runtime/tools/approval.ts';
import { resolveRequestProject } from './project-context.ts';

const sessionIdParamsSchema = z.object({
	id: z.string().openapi({
		param: { name: 'id', in: 'path' },
	}),
});

const resolveApprovalBodySchema = z.object({
	callId: z.string(),
	approved: z.boolean(),
});

const resolveApprovalResponseSchema = z.object({
	ok: z.boolean(),
	callId: z.string(),
	approved: z.boolean(),
});

const approvalErrorSchema = z.object({
	ok: z.literal(false).optional(),
	error: z.string(),
});

const pendingApprovalSchema = z.object({
	callId: z.string(),
	toolName: z.string(),
	args: z.record(z.string(), z.unknown()).optional(),
	messageId: z.string().optional(),
	createdAt: z.number().int(),
});

const pendingApprovalsResponseSchema = z.object({
	ok: z.boolean(),
	pending: z.array(pendingApprovalSchema),
});

export function registerSessionApprovalRoute(app: Hono) {
	zodOpenApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/sessions/{id}/approval',
			tags: ['sessions'],
			operationId: 'resolveApproval',
			summary: 'Approve or deny a tool execution',
			request: {
				params: sessionIdParamsSchema,
				body: {
					required: true,
					content: {
						'application/json': { schema: resolveApprovalBodySchema },
					},
				},
			},
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': { schema: resolveApprovalResponseSchema },
					},
				},
				'400': {
					description: 'Bad Request',
					content: {
						'application/json': { schema: approvalErrorSchema },
					},
				},
				'403': {
					description: 'Forbidden',
					content: {
						'application/json': { schema: approvalErrorSchema },
					},
				},
				'404': {
					description: 'Not Found',
					content: {
						'application/json': { schema: approvalErrorSchema },
					},
				},
			},
		},
		async (c) => {
			const project = await resolveRequestProject(c);
			const { id: sessionId } = c.req.valid('param');
			await sessionRepository(project.db, project.projectRoot).require(
				sessionId,
			);
			const body = c.req.valid('json');

			if (!body.callId) {
				return c.json({ ok: false, error: 'callId is required' }, 400);
			}

			if (typeof body.approved !== 'boolean') {
				return c.json({ ok: false, error: 'approved must be a boolean' }, 400);
			}

			const pending = getPendingApproval(body.callId, project.runtime.root);
			if (!pending) {
				return c.json(
					{ ok: false, error: 'No pending approval found for this callId' },
					404,
				);
			}

			if (pending.sessionId !== sessionId) {
				return c.json(
					{ ok: false, error: 'Approval does not belong to this session' },
					403,
				);
			}

			const result = resolveApproval(
				body.callId,
				body.approved,
				project.runtime.root,
			);

			if (!result.ok) {
				return c.json(result, 404);
			}

			return c.json({ ok: true, callId: body.callId, approved: body.approved });
		},
	);

	zodOpenApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/sessions/{id}/approval/pending',
			tags: ['sessions'],
			operationId: 'getPendingApprovals',
			summary: 'Get pending approvals for a session',
			request: {
				params: sessionIdParamsSchema,
			},
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': { schema: pendingApprovalsResponseSchema },
					},
				},
			},
		},
		async (c) => {
			const project = await resolveRequestProject(c);
			const { id: sessionId } = c.req.valid('param');
			await sessionRepository(project.db, project.projectRoot).require(
				sessionId,
			);
			const pending = getPendingApprovalsForSession(
				sessionId,
				project.runtime.root,
			);

			return c.json({
				ok: true,
				pending: pending.map((p) => ({
					callId: p.callId,
					toolName: p.toolName,
					args: p.args,
					messageId: p.messageId,
					createdAt: p.createdAt,
				})),
			});
		},
	);
}
