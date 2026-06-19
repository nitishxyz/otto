import { logger, setAuth } from '@ottocode/sdk';
import { execFileSync } from 'node:child_process';
import type { Hono } from 'hono';
import { zodOpenApiRoute } from '../../../openapi/route.ts';
import { toErrorMessage } from '../../../runtime/errors/handling.ts';
import { fetchCopilotModels, getGhImportCapability } from '../service.ts';
import { copilotSaveResponseSchema, errorResponseSchema } from './schemas.ts';

export function registerCopilotGhImportRoute(app: Hono) {
	zodOpenApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/auth/copilot/gh/import',
			tags: ['auth'],
			operationId: 'importCopilotTokenFromGh',
			summary: 'Import Copilot token from GitHub CLI (gh)',
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': { schema: copilotSaveResponseSchema },
					},
				},
				'400': {
					description: 'Bad Request',
					content: { 'application/json': { schema: errorResponseSchema } },
				},
			},
		},
		async (c) => {
			try {
				const ghImport = getGhImportCapability();
				if (!ghImport.available) {
					return c.json(
						{
							error: ghImport.reason || 'GitHub CLI is not available',
						},
						400,
					);
				}
				if (!ghImport.authenticated) {
					return c.json(
						{
							error: ghImport.reason || 'GitHub CLI is not authenticated',
						},
						400,
					);
				}

				const ghToken = execFileSync('gh', ['auth', 'token'], {
					encoding: 'utf8',
					stdio: ['ignore', 'pipe', 'pipe'],
				}).trim();
				if (!ghToken) {
					return c.json({ error: 'GitHub CLI returned an empty token' }, 400);
				}

				const modelsResult = await fetchCopilotModels(ghToken);
				if (!modelsResult.ok) {
					return c.json(
						{
							error: `Imported gh token is not valid for Copilot: ${modelsResult.message}`,
						},
						400,
					);
				}

				await setAuth(
					'copilot',
					{
						type: 'oauth',
						refresh: ghToken,
						access: ghToken,
						expires: 0,
					},
					undefined,
					'global',
				);

				const models = Array.from(modelsResult.models).sort();
				return c.json({
					success: true,
					provider: 'copilot',
					source: 'gh',
					modelCount: models.length,
					hasGpt52Codex: modelsResult.models.has('gpt-5.2-codex'),
					sampleModels: models.slice(0, 25),
				});
			} catch (error) {
				const message = toErrorMessage(error);
				logger.error('Failed to import Copilot token from GitHub CLI', error);
				return c.json({ error: message }, 500);
			}
		},
	);
}
