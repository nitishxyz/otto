import type { DB } from '@ottocode/database';
import type { OttoConfig } from '@ottocode/sdk';
import { z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { APIError } from '../runtime/errors/api-error.ts';
import {
	getProjectManager,
	type ProjectRuntime,
} from '../runtime/projects/manager.ts';
import { getDefaultProjectRoot } from '../state.ts';

export const projectQuerySchema = z.object({
	project: z
		.string()
		.optional()
		.openapi({
			param: { name: 'project', in: 'query' },
			description: 'Absolute project path. Kept for backwards compatibility.',
		}),
	projectId: z
		.string()
		.optional()
		.openapi({
			param: { name: 'projectId', in: 'query' },
			description: 'Stable otto project id returned by project routes.',
		}),
});

export interface RequestProjectContext {
	projectId: string;
	projectRoot: string;
	cfg: OttoConfig;
	db: DB;
	runtime: ProjectRuntime;
}

export async function resolveRequestProject(
	c: Context,
): Promise<RequestProjectContext> {
	const projectId =
		c.req.query('projectId') || c.req.header('X-Otto-Project-Id');
	const projectPath = c.req.query('project') || c.req.header('X-Otto-Project');
	const defaultProjectRoot = getDefaultProjectRoot();

	if (!projectId && !projectPath && !defaultProjectRoot) {
		throw new APIError(
			'Project context required: pass projectId (X-Otto-Project-Id) or project path (X-Otto-Project).',
			{ status: 400, code: 'project_context_required' },
		);
	}

	const runtime = projectId
		? await getProjectManager().getProject({
				id: projectId,
				path: projectPath || undefined,
			})
		: await getProjectManager().getProject({
				path: projectPath || defaultProjectRoot || undefined,
			});

	return {
		projectId: runtime.id,
		projectRoot: runtime.root,
		cfg: runtime.cfg,
		db: runtime.db,
		runtime,
	};
}

export async function resolveRequestProjectRoot(c: Context): Promise<string> {
	return (await resolveRequestProject(c)).projectRoot;
}
