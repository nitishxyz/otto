import { getAuth, logger, readEnvKey } from '@ottocode/sdk';
import type { Hono } from 'hono';
import { zodOpenApiRoute } from '../../../openapi/route.ts';
import { toErrorMessage } from '../../../runtime/errors/handling.ts';
import {
	detectOAuthOrgRestriction,
	fetchCopilotModels,
	getGhImportCapability,
} from '../service.ts';
import { copilotDiagnosticsSchema } from './schemas.ts';

type CopilotTokenSourceDiagnostic = {
	source: 'env' | 'stored';
	configured: boolean;
	modelCount?: number;
	hasGpt52Codex?: boolean;
	sampleModels?: string[];
	restrictedByOrgPolicy?: boolean;
	restrictedOrg?: string;
	restrictionMessage?: string;
	error?: string;
};

export function registerCopilotDiagnosticsRoute(app: Hono) {
	zodOpenApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/auth/copilot/diagnostics',
			tags: ['auth'],
			operationId: 'getCopilotDiagnostics',
			summary: 'Get Copilot token diagnostics and model visibility',
			responses: {
				'200': {
					description: 'OK',
					content: { 'application/json': { schema: copilotDiagnosticsSchema } },
				},
			},
		},
		async (c) => {
			try {
				const entries = await buildCopilotTokenDiagnostics();

				return c.json({
					tokenSources: entries,
					methods: {
						oauth: true,
						token: true,
						ghImport: getGhImportCapability(),
					},
				});
			} catch (error) {
				const message = toErrorMessage(error);
				logger.error('Failed to build Copilot diagnostics', error);
				return c.json({ error: message }, 500);
			}
		},
	);
}

async function buildCopilotTokenDiagnostics() {
	const projectRoot = process.cwd();
	const entries: CopilotTokenSourceDiagnostic[] = [];

	const envToken = readEnvKey('copilot');
	if (envToken) {
		entries.push(await inspectCopilotToken('env', envToken));
	} else {
		entries.push({ source: 'env', configured: false });
	}

	const storedAuth = await getAuth('copilot', projectRoot);
	if (storedAuth?.type === 'oauth') {
		entries.push(await inspectStoredCopilotToken(storedAuth.refresh));
	} else {
		entries.push({ source: 'stored', configured: false });
	}

	return entries;
}

async function inspectCopilotToken(
	source: 'env' | 'stored',
	token: string,
): Promise<CopilotTokenSourceDiagnostic> {
	const modelsResult = await fetchCopilotModels(token);
	if (modelsResult.ok) {
		const models = Array.from(modelsResult.models).sort();
		return {
			source,
			configured: true,
			modelCount: models.length,
			hasGpt52Codex: modelsResult.models.has('gpt-5.2-codex'),
			sampleModels: models.slice(0, 25),
		};
	}

	return {
		source,
		configured: true,
		error: modelsResult.message,
	};
}

async function inspectStoredCopilotToken(
	token: string,
): Promise<CopilotTokenSourceDiagnostic> {
	const [diagnostic, restriction] = await Promise.all([
		inspectCopilotToken('stored', token),
		detectOAuthOrgRestriction(token),
	]);

	return {
		...diagnostic,
		restrictedByOrgPolicy: restriction.restricted,
		restrictedOrg: restriction.org,
		restrictionMessage: restriction.message,
	};
}
