import { eq } from 'drizzle-orm';
import { loadConfig } from '@ottocode/sdk';
import { getDb } from '@ottocode/database';
import {
	createSession,
	getLastSession,
	getSessionById,
} from '../session/manager.ts';
import {
	selectProviderAndModel,
	type ProviderSelection,
} from '../provider/selection.ts';
import { resolveAgentConfig, type AgentToolConfig } from '../agent/registry.ts';
import { dispatchAssistantMessage } from '../message/service.ts';
import {
	validateProviderModel,
	isProviderAuthorized,
	ensureProviderEnv,
	hasConfiguredProvider,
	providerEnvVar,
	type ProviderId,
	type ReasoningLevel,
} from '@ottocode/sdk';
import { sessions } from '@ottocode/database/schema';
import { time } from '../debug/index.ts';

export class AskServiceError extends Error {
	constructor(
		message: string,
		public status = 400,
		public code = 'ASK_SERVICE_ERROR',
	) {
		super(message);
		this.name = 'AskServiceError';
	}

	toJSON() {
		return {
			name: this.name,
			message: this.message,
			code: this.code,
			status: this.status,
		};
	}
}

export type InjectableConfig = {
	provider?: string;
	model?: string;
	apiKey?: string;
	agent?: string;
	reasoningText?: boolean;
	reasoningLevel?: ReasoningLevel;
};

export type InjectableCredentials = Partial<
	Record<ProviderId, { apiKey: string }>
>;

export type AskServerRequest = {
	projectRoot?: string;
	prompt: string;
	agent?: string;
	provider?: string;
	model?: string;
	allowUnknownModel?: boolean;
	reasoningText?: boolean;
	reasoningLevel?: ReasoningLevel;
	sessionId?: string;
	last?: boolean;
	jsonMode?: boolean;
	skipFileConfig?: boolean;
	config?: InjectableConfig;
	credentials?: InjectableCredentials;
	agentPrompt?: string;
	tools?: AgentToolConfig;
	images?: Array<{ data: string; mediaType: string }>;
};

export type AskServerResponse = {
	sessionId: string;
	header: {
		agent?: string;
		provider?: string;
		model?: string;
		sessionId: string;
	};
	provider: ProviderId;
	model: string;
	agent: string;
	assistantMessageId: string;
	message?: { kind: 'created' | 'last'; sessionId: string };
};

type SessionRow =
	typeof import('@ottocode/database/schema').sessions.$inferSelect;

export async function handleAskRequest(
	request: AskServerRequest,
): Promise<AskServerResponse> {
	try {
		return await processAskRequest(request);
	} catch (err) {
		throw normalizeAskServiceError(err);
	}
}

async function processAskRequest(
	request: AskServerRequest,
): Promise<AskServerResponse> {
	const projectRoot = request.projectRoot || process.cwd();
	const configTimer = time('ask:loadConfig+db');

	let cfg: import('@ottocode/sdk').OttoConfig;

	if (request.skipFileConfig || request.config) {
		const injectedProvider = (request.config?.provider ||
			request.provider ||
			'openai') as ProviderId;
		const injectedModel =
			request.config?.model || request.model || 'gpt-4o-mini';
		const injectedAgent = request.config?.agent || request.agent || 'general';

		cfg = {
			projectRoot,
			defaults: {
				provider: injectedProvider,
				model: injectedModel,
				agent: injectedAgent,
				reasoningText:
					request.config?.reasoningText ?? request.reasoningText ?? true,
				reasoningLevel:
					request.config?.reasoningLevel ?? request.reasoningLevel ?? 'high',
			},
			providers: {
				openai: { enabled: true },
				anthropic: { enabled: true },
				google: { enabled: true },
				'ollama-cloud': { enabled: true, baseURL: 'https://ollama.com' },
				openrouter: { enabled: true },
				opencode: { enabled: true },
				copilot: { enabled: true },
				ottorouter: { enabled: true },
				xai: { enabled: true },
				zai: { enabled: true },
				'zai-coding': { enabled: true },
				moonshot: { enabled: true },
				minimax: { enabled: true },
			},
			paths: {
				dataDir: `${projectRoot}/.otto`,
				dbPath: `${projectRoot}/.otto/otto.sqlite`,
				projectConfigPath: null,
				globalConfigPath: null,
			},
		};

		if (request.credentials) {
			for (const [provider, creds] of Object.entries(request.credentials)) {
				if (!creds) continue;
				const envKey =
					providerEnvVar(provider as ProviderId) ??
					`${provider.toUpperCase()}_API_KEY`;
				process.env[envKey] = creds.apiKey;
			}
		} else if (request.config?.apiKey) {
			const envKey =
				providerEnvVar(injectedProvider) ??
				`${injectedProvider.toUpperCase()}_API_KEY`;
			process.env[envKey] = request.config.apiKey;
		}
	} else {
		cfg = await loadConfig(projectRoot);
	}

	const db = await getDb(cfg.projectRoot);
	configTimer.end();

	let session: SessionRow | undefined;
	let messageIndicator: AskServerResponse['message'];

	if (request.sessionId) {
		session = await getSessionById({
			db,
			projectPath: cfg.projectRoot,
			sessionId: request.sessionId,
		});
		if (!session) {
			throw new AskServiceError(`Session not found: ${request.sessionId}`, 404);
		}
	} else if (request.last) {
		session = await getLastSession({ db, projectPath: cfg.projectRoot });
		if (session) {
			messageIndicator = { kind: 'last', sessionId: session.id };
		}
	} else {
		session = undefined;
	}

	const agentName = (() => {
		if (request.agent) return request.agent;
		if (session?.agent) return session.agent;
		return cfg.defaults.agent;
	})();

	const agentTimer = time('ask:resolveAgentConfig');
	const agentCfg = request.agentPrompt
		? await resolveAgentConfig(cfg.projectRoot, agentName, {
				prompt: request.agentPrompt,
				tools: request.tools ?? { firstClass: ['progress_update', 'finish'] },
				provider:
					typeof request.provider === 'string' &&
					hasConfiguredProvider(cfg, request.provider)
						? request.provider
						: undefined,
				model: request.model,
			})
		: await resolveAgentConfig(cfg.projectRoot, agentName);
	agentTimer.end({ agent: agentName });
	const agentProviderDefault = hasConfiguredProvider(cfg, agentCfg.provider)
		? agentCfg.provider
		: cfg.defaults.provider;
	const agentModelDefault = agentCfg.model ?? cfg.defaults.model;

	const explicitProvider = hasConfiguredProvider(cfg, request.provider)
		? request.provider
		: undefined;

	let providerSelection: ProviderSelection;
	const selectTimer = time('ask:selectProviderModel');
	try {
		providerSelection = await selectProviderAndModel({
			cfg,
			agentProviderDefault,
			agentModelDefault,
			explicitProvider,
			explicitModel: request.model,
			allowUnknownModel: request.allowUnknownModel,
			skipAuth: Boolean(
				request.skipFileConfig || request.config || request.credentials,
			),
		});
		selectTimer.end({ provider: providerSelection.provider });
	} catch (err) {
		selectTimer.end();
		throw normalizeAskServiceError(err);
	}

	if (!session) {
		const createTimer = time('ask:createSession');
		const newSession = await createSession({
			db,
			cfg,
			agent: agentName,
			provider: providerSelection.provider,
			model: providerSelection.model,
			title: null,
		});
		createTimer.end();
		session = newSession;
		messageIndicator = { kind: 'created', sessionId: newSession.id };
	}
	if (!session)
		throw new AskServiceError('Failed to resolve or create session.', 500);

	const overridesProvided = Boolean(request.provider || request.model);

	let providerForMessage: ProviderId;
	let modelForMessage: string;

	if (overridesProvided) {
		providerForMessage = providerSelection.provider;
		modelForMessage = providerSelection.model;
	} else if (session.provider && session.model) {
		const sessionProvider = hasConfiguredProvider(cfg, session.provider)
			? session.provider
			: agentProviderDefault;
		providerForMessage = sessionProvider;
		modelForMessage = session.model;
	} else {
		providerForMessage = providerSelection.provider;
		modelForMessage = providerSelection.model;
	}

	const providerAuthorized = await isProviderAuthorized(
		cfg,
		providerForMessage,
	);
	let fellBackToSelection = false;
	if (!providerAuthorized) {
		providerForMessage = providerSelection.provider;
		modelForMessage = providerSelection.model;
		fellBackToSelection = true;
	}
	if (
		session &&
		fellBackToSelection &&
		(session.provider !== providerForMessage ||
			session.model !== modelForMessage)
	) {
		await db
			.update(sessions)
			.set({ provider: providerForMessage, model: modelForMessage })
			.where(eq(sessions.id, session.id));
		session = {
			...session,
			provider: providerForMessage,
			model: modelForMessage,
		} as SessionRow;
	}

	validateProviderModel(providerForMessage, modelForMessage, cfg, {
		wantsVision: Boolean(request.images?.length),
		allowUnknownModel: request.allowUnknownModel === true,
	});

	if (!request.skipFileConfig && !request.config && !request.credentials) {
		await ensureProviderEnv(cfg, providerForMessage);
	}

	const reasoningText =
		request.reasoningText ?? cfg.defaults.reasoningText ?? false;
	const reasoningLevel =
		request.reasoningLevel ?? cfg.defaults.reasoningLevel ?? 'high';

	const assistantMessage = await dispatchAssistantMessage({
		cfg,
		db,
		session,
		agent: agentName,
		provider: providerForMessage,
		model: modelForMessage,
		content: request.prompt,
		oneShot: !request.sessionId && !request.last,
		reasoningText,
		reasoningLevel,
		images: request.images,
	});

	const headerAgent = session.agent ?? agentName;
	const headerProvider = providerForMessage;
	const headerModel = modelForMessage;

	return {
		sessionId: session.id,
		header: {
			agent: headerAgent,
			provider: headerProvider,
			model: headerModel,
			sessionId: session.id,
		},
		provider: providerForMessage,
		model: modelForMessage,
		agent: agentName,
		assistantMessageId: assistantMessage.assistantMessageId,
		message: messageIndicator,
	};
}

function normalizeAskServiceError(err: unknown): AskServiceError {
	if (err instanceof AskServiceError) return err;
	if (err instanceof Error) {
		const status = inferStatus(err);
		const message = err.message || 'Unknown error';
		return new AskServiceError(message, status);
	}
	return new AskServiceError(String(err ?? 'Unknown error'));
}

export function inferStatus(err: Error): number {
	const anyErr = err as { status?: unknown; code?: unknown };
	if (typeof anyErr.status === 'number') {
		const s = anyErr.status;
		if (Number.isFinite(s) && s >= 400 && s < 600) return s;
	}
	if (typeof anyErr.code === 'number') {
		const s = anyErr.code;
		if (Number.isFinite(s) && s >= 400 && s < 600) return s;
	}
	const derived = deriveStatusFromMessage(err.message || '');
	return derived ?? 400;
}

const STATUS_PATTERNS: Array<{ regex: RegExp; status: number }> = [
	{ regex: /not found/i, status: 404 },
	{ regex: /missing credentials/i, status: 401 },
	{ regex: /unauthorized/i, status: 401 },
	{ regex: /not configured/i, status: 401 },
	{ regex: /authorized providers/i, status: 401 },
	{ regex: /forbidden/i, status: 403 },
	{ regex: /timeout/i, status: 504 },
];

export function deriveStatusFromMessage(message: string): number | undefined {
	const trimmed = message.trim();
	if (!trimmed) return undefined;
	for (const { regex, status } of STATUS_PATTERNS) {
		if (regex.test(trimmed)) return status;
	}
	return undefined;
}
