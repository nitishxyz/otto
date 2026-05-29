import type { Hono } from 'hono';
import {
	setConfig,
	loadConfig,
	hasConfiguredProvider,
	type ProviderId,
	type ReasoningLevel,
} from '@ottocode/sdk';
import { logger } from '@ottocode/sdk';
import { serializeError } from '../../runtime/errors/api-error.ts';
import { openApiRoute } from '../../openapi/route.ts';

export function registerDefaultsRoute(app: Hono) {
	openApiRoute(
		app,
		{
			method: 'patch',
			path: '/v1/config/defaults',
			tags: ['config'],
			operationId: 'updateDefaults',
			summary: 'Update default configuration',
			description: 'Update the default agent, provider, and/or model',
			parameters: [
				{
					in: 'query',
					name: 'project',
					required: false,
					schema: {
						type: 'string',
					},
					description:
						'Project root override (defaults to current working directory).',
				},
			],
			requestBody: {
				required: true,
				content: {
					'application/json': {
						schema: {
							type: 'object',
							properties: {
								agent: {
									type: 'string',
								},
								provider: {
									type: 'string',
								},
								model: {
									type: 'string',
								},
								theme: {
									type: 'string',
									enum: ['light', 'dark'],
								},
								vimMode: {
									type: 'boolean',
								},
								compactThread: {
									type: 'boolean',
								},
								fontFamily: {
									type: 'string',
								},
								smartEdges: {
									type: 'boolean',
								},
								releaseToSend: {
									type: 'boolean',
								},
								fullWidthContent: {
									type: 'boolean',
								},
								autoCompactThresholdTokens: {
									type: 'integer',
									nullable: true,
								},
								reasoningText: {
									type: 'boolean',
								},
								reasoningLevel: {
									type: 'string',
									enum: ['minimal', 'low', 'medium', 'high', 'max', 'xhigh'],
								},
								scope: {
									type: 'string',
									enum: ['global', 'local'],
									default: 'local',
								},
							},
						},
					},
				},
			},
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': {
							schema: {
								type: 'object',
								properties: {
									success: {
										type: 'boolean',
									},
									defaults: {
										type: 'object',
										properties: {
											agent: {
												type: 'string',
											},
											provider: {
												type: 'string',
											},
											model: {
												type: 'string',
											},
											theme: {
												type: 'string',
												enum: ['light', 'dark'],
											},
											vimMode: {
												type: 'boolean',
											},
											compactThread: {
												type: 'boolean',
											},
											fontFamily: {
												type: 'string',
											},
											smartEdges: {
												type: 'boolean',
											},
											releaseToSend: {
												type: 'boolean',
											},
											fullWidthContent: {
												type: 'boolean',
											},
											autoCompactThresholdTokens: {
												type: 'integer',
												nullable: true,
											},
											reasoningText: {
												type: 'boolean',
											},
											reasoningLevel: {
												type: 'string',
												enum: [
													'minimal',
													'low',
													'medium',
													'high',
													'max',
													'xhigh',
												],
											},
										},
										required: ['agent', 'provider', 'model'],
									},
								},
								required: ['success', 'defaults'],
							},
						},
					},
				},
			},
		},
		async (c) => {
			try {
				const projectRoot = c.req.query('project') || process.cwd();
				const cfg = await loadConfig(projectRoot);
				const body = await c.req.json<{
					agent?: string;
					provider?: string;
					model?: string;
					toolApproval?: 'auto' | 'dangerous' | 'all' | 'yolo';
					guidedMode?: boolean;
					reasoningText?: boolean;
					reasoningLevel?: ReasoningLevel;
					theme?: 'light' | 'dark';
					vimMode?: boolean;
					compactThread?: boolean;
					fontFamily?: string;
					smartEdges?: boolean;
					releaseToSend?: boolean;
					fullWidthContent?: boolean;
					autoCompactThresholdTokens?: number | null;
					scope?: 'global' | 'local';
				}>();

				const scope = body.scope || 'global';
				const updates: Partial<{
					agent: string;
					provider: ProviderId;
					model: string;
					toolApproval: 'auto' | 'dangerous' | 'all' | 'yolo';
					guidedMode: boolean;
					reasoningText: boolean;
					reasoningLevel: ReasoningLevel;
					theme: 'light' | 'dark';
					vimMode: boolean;
					compactThread: boolean;
					fontFamily: string;
					smartEdges: boolean;
					releaseToSend: boolean;
					fullWidthContent: boolean;
					autoCompactThresholdTokens: number | null;
				}> = {};

				if (body.agent) updates.agent = body.agent;
				if (body.provider) {
					if (!hasConfiguredProvider(cfg, body.provider)) {
						return c.json({ error: `Invalid provider: ${body.provider}` }, 400);
					}
					updates.provider = body.provider as ProviderId;
				}
				if (body.model) updates.model = body.model;
				if (body.toolApproval) updates.toolApproval = body.toolApproval;
				if (body.guidedMode !== undefined) updates.guidedMode = body.guidedMode;
				if (body.reasoningText !== undefined)
					updates.reasoningText = body.reasoningText;
				if (body.reasoningLevel) updates.reasoningLevel = body.reasoningLevel;
				if (body.theme === 'light' || body.theme === 'dark') {
					updates.theme = body.theme;
				}
				if (body.vimMode !== undefined) updates.vimMode = body.vimMode;
				if (body.compactThread !== undefined)
					updates.compactThread = body.compactThread;
				if (body.fontFamily !== undefined) {
					const fontFamily = body.fontFamily.trim();
					if (fontFamily) updates.fontFamily = fontFamily;
				}
				if (body.smartEdges !== undefined) updates.smartEdges = body.smartEdges;
				if (body.releaseToSend !== undefined)
					updates.releaseToSend = body.releaseToSend;
				if (body.fullWidthContent !== undefined)
					updates.fullWidthContent = body.fullWidthContent;
				if (body.autoCompactThresholdTokens !== undefined) {
					const threshold = body.autoCompactThresholdTokens;
					if (threshold === null) {
						updates.autoCompactThresholdTokens = null;
					} else if (Number.isFinite(threshold) && threshold > 0) {
						updates.autoCompactThresholdTokens = Math.floor(threshold);
					}
				}

				await setConfig(scope, updates, projectRoot);

				const nextCfg = await loadConfig(projectRoot);

				return c.json({
					success: true,
					defaults: nextCfg.defaults,
				});
			} catch (error) {
				logger.error('Failed to update defaults', error);
				const errorResponse = serializeError(error);
				return c.json(errorResponse, errorResponse.error.status || 500);
			}
		},
	);
}
