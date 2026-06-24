import type {
	Agent,
	AgentSideConnection,
	InitializeRequest,
	InitializeResponse,
	NewSessionRequest,
	NewSessionResponse,
	PromptRequest,
	PromptResponse,
	CancelNotification,
	AuthenticateRequest,
	AuthenticateResponse,
	ClientCapabilities,
	LoadSessionRequest,
	LoadSessionResponse,
	ListSessionsRequest,
	ListSessionsResponse,
	ResumeSessionRequest,
	ResumeSessionResponse,
	CloseSessionRequest,
	CloseSessionResponse,
	DeleteSessionRequest,
	DeleteSessionResponse,
	SetSessionModeRequest,
	SetSessionModeResponse,
	SetSessionConfigOptionRequest,
	SetSessionConfigOptionResponse,
} from '@agentclientprotocol/sdk';
import { handleAskRequest } from '@ottocode/server/runtime/ask/service';
import { resolveAgentConfig } from '@ottocode/server/runtime/agent-registry';
import { subscribe } from '@ottocode/server/events/bus';
import {
	abortMessage,
	getRunnerState,
} from '@ottocode/server/runtime/agent/runner';
import {
	createSession as apiCreateSession,
	deleteSession as apiDeleteSession,
	getSession as apiGetSession,
	listSessions as apiListSessions,
	updateSession as apiUpdateSession,
} from '@ottocode/api';
import {
	createToolError,
	loadConfig,
	shellExecutorContext,
	type ShellExecutor,
} from '@ottocode/sdk';
import { randomUUID } from 'node:crypto';
import { queueAvailableCommands } from './available-commands';
import { parseModelId } from './model';
import { handleOttoEvent } from './events';
import { replaySessionHistory } from './history';
import { buildSessionState, loadSessionDefaults } from './session-state';
import {
	handleMcpCommand,
	handleReasoningCommand,
	handleShareCommand,
	handleStageCommand,
} from './slash-commands';
import { ensureAcpServer } from './server';
import { ACP_VERSION, DEFAULT_MODE, type AcpSession } from './types';

export class OttoAcpAgent implements Agent {
	private client: AgentSideConnection;
	private sessions = new Map<string, AcpSession>();
	private clientCapabilities?: ClientCapabilities;

	constructor(client: AgentSideConnection) {
		this.client = client;
	}

	async initialize(request: InitializeRequest): Promise<InitializeResponse> {
		this.clientCapabilities = request.clientCapabilities;

		return {
			protocolVersion: 1,
			agentCapabilities: {
				loadSession: true,
				sessionCapabilities: {
					list: {},
					resume: {},
					close: {},
					delete: {},
					additionalDirectories: {},
				},
				mcpCapabilities: {
					http: true,
					sse: true,
				},
				promptCapabilities: {
					image: true,
					embeddedContext: true,
				},
			},
			agentInfo: {
				name: 'otto',
				title: 'Otto',
				version: ACP_VERSION,
			},
			authMethods: [],
		};
	}

	async authenticate(
		_params: AuthenticateRequest,
	): Promise<AuthenticateResponse | undefined> {
		return undefined;
	}

	async newSession(params: NewSessionRequest): Promise<NewSessionResponse> {
		const cwd = params.cwd || process.cwd();
		const defaults = await loadSessionDefaults(cwd);
		let sessionId: string = randomUUID();
		let ottoSessionId = '';

		try {
			const cfg = await loadConfig(cwd);
			await ensureAcpServer();
			const { data: row, error } = await apiCreateSession({
				query: { project: cfg.projectRoot },
				body: {
					agent: defaults.agent,
					provider: defaults.provider,
					model: defaults.model,
				},
			});
			if (error || !row) throw new Error('Failed to create session');
			sessionId = row.id;
			ottoSessionId = row.id;
		} catch (err) {
			console.error('[acp] Failed to create resumable session:', err);
		}

		const session: AcpSession = {
			sessionId,
			ottoSessionId,
			cwd,
			cancelled: false,
			assistantMessageId: null,
			resolvePrompt: null,
			unsubscribe: null,
			sessionInfoUnsubscribe: null,
			activeTerminals: new Map(),
			streamedToolCalls: new Set(),
			streamedToolContent: new Map(),
			mode: defaults.agent,
			provider: defaults.provider,
			model: defaults.model,
			mcpServers: params.mcpServers ?? [],
			additionalDirectories: normalizeAdditionalDirectories(params),
		};

		this.sessions.set(sessionId, session);
		this.subscribeSessionInfoUpdates(sessionId, session);
		const state = await buildSessionState(session);
		queueAvailableCommands(this.client, sessionId, cwd);

		return {
			sessionId,
			...state,
		};
	}

	async loadSession(params: LoadSessionRequest): Promise<LoadSessionResponse> {
		const response = await this.resumeExistingSession(
			params.sessionId,
			params.cwd,
			params.mcpServers,
		);
		const session = this.sessions.get(params.sessionId);
		if (!session) throw new Error('Session not found');
		await replaySessionHistory(this.client, params.sessionId, session);
		queueAvailableCommands(this.client, params.sessionId, session.cwd);
		return response;
	}

	async listSessions(
		params: ListSessionsRequest,
	): Promise<ListSessionsResponse> {
		const cwd = params.cwd || process.cwd();
		const cfg = await loadConfig(cwd);
		await ensureAcpServer();
		const { data, error } = await apiListSessions({
			query: { project: cfg.projectRoot, limit: 100 },
		});
		if (error || !data) throw new Error('Failed to list sessions');
		const rows = data.items;

		return {
			sessions: rows.map((row) => ({
				sessionId: row.id,
				cwd: row.projectPath,
				title: row.title ?? `${row.agent} · ${row.model}`,
				updatedAt: new Date(row.lastActiveAt ?? row.createdAt).toISOString(),
			})),
		};
	}

	async resumeSession(
		params: ResumeSessionRequest,
	): Promise<ResumeSessionResponse> {
		const response = await this.resumeExistingSession(
			params.sessionId,
			params.cwd,
			params.mcpServers ?? [],
		);
		const session = this.sessions.get(params.sessionId);
		queueAvailableCommands(
			this.client,
			params.sessionId,
			session?.cwd ?? params.cwd,
		);
		return response;
	}

	async closeSession(
		params: CloseSessionRequest,
	): Promise<CloseSessionResponse | undefined> {
		const session = this.sessions.get(params.sessionId);
		if (!session) return undefined;
		await this.cancel({ sessionId: params.sessionId });
		session.unsubscribe?.();
		session.sessionInfoUnsubscribe?.();
		for (const terminal of session.activeTerminals.values()) {
			await terminal.release().catch(() => undefined);
		}
		this.sessions.delete(params.sessionId);
		return undefined;
	}

	async deleteSession(
		params: DeleteSessionRequest,
	): Promise<DeleteSessionResponse | undefined> {
		const session = this.sessions.get(params.sessionId);
		if (session) await this.closeSession({ sessionId: params.sessionId });
		await ensureAcpServer();
		const { error } = await apiDeleteSession({
			path: { sessionId: params.sessionId },
			query: session?.cwd ? { project: session.cwd } : undefined,
		});
		if (error) throw new Error('Failed to delete session');
		return undefined;
	}

	async setSessionMode(
		params: SetSessionModeRequest,
	): Promise<SetSessionModeResponse | undefined> {
		const session = this.sessions.get(params.sessionId);
		if (!session) throw new Error('Session not found');
		session.mode = params.modeId;

		const modelChanged = await this.applyAgentModelPreference(
			session,
			params.modeId,
		);

		if (!modelChanged) {
			await this.persistSessionPreferences(session, { agent: params.modeId });
		}

		await this.client.sessionUpdate({
			sessionId: params.sessionId,
			update: {
				sessionUpdate: 'current_mode_update',
				currentModeId: params.modeId,
			},
		});

		if (modelChanged) {
			const state = await buildSessionState(session);
			await this.client.sessionUpdate({
				sessionId: params.sessionId,
				update: {
					sessionUpdate: 'config_option_update',
					configOptions: state.configOptions ?? [],
				},
			});
		}

		return undefined;
	}

	private async applyAgentModelPreference(
		session: AcpSession,
		modeId: string,
	): Promise<boolean> {
		try {
			const cfg = await loadConfig(session.cwd);
			const agentCfg = await resolveAgentConfig(cfg.projectRoot, modeId);
			if (!agentCfg.model) return false;
			const nextProvider = agentCfg.provider ?? session.provider;
			const nextModel = agentCfg.model;
			if (nextProvider === session.provider && nextModel === session.model) {
				await this.persistSessionPreferences(session, { agent: modeId });
				return false;
			}
			session.provider = nextProvider;
			session.model = nextModel;
			await this.persistSessionPreferences(session, {
				agent: modeId,
				...(nextProvider ? { provider: nextProvider } : {}),
				model: nextModel,
			});
			return true;
		} catch (err) {
			console.error('[acp] Failed to apply agent model preference:', err);
			return false;
		}
	}

	async setSessionConfigOption(
		params: SetSessionConfigOptionRequest,
	): Promise<SetSessionConfigOptionResponse> {
		const session = this.sessions.get(params.sessionId);
		if (!session) throw new Error('Session not found');

		if (params.configId === 'agent' && 'value' in params) {
			const mode = String(params.value);
			session.mode = mode;
			const modelChanged = await this.applyAgentModelPreference(session, mode);
			if (!modelChanged) {
				await this.persistSessionPreferences(session, { agent: mode });
			}
		} else if (params.configId === 'model' && 'value' in params) {
			const parsed = parseModelId(String(params.value));
			await this.persistSessionPreferences(session, {
				provider: parsed.provider,
				model: parsed.model,
			});
			session.provider = parsed.provider;
			session.model = parsed.model;
		}

		const state = await buildSessionState(session);
		return { configOptions: state.configOptions ?? [] };
	}

	async prompt(params: PromptRequest): Promise<PromptResponse> {
		const session = this.sessions.get(params.sessionId);
		if (!session) {
			throw new Error('Session not found');
		}

		session.cancelled = false;

		const textParts: string[] = [];
		const images: Array<{ data: string; mediaType: string }> = [];
		for (const chunk of params.prompt) {
			if (chunk.type === 'text') {
				textParts.push(chunk.text);
			} else if (chunk.type === 'image') {
				images.push({ data: chunk.data, mediaType: chunk.mimeType });
				if (chunk.uri) {
					textParts.push(
						`<image uri="${chunk.uri}" mimeType="${chunk.mimeType}" />`,
					);
				}
			} else if (chunk.type === 'resource' && 'text' in chunk.resource) {
				textParts.push(
					`<context uri="${chunk.resource.uri}">\n${chunk.resource.text}\n</context>`,
				);
			} else if (chunk.type === 'resource_link') {
				const context = await this.resolveResourceLink(
					chunk.uri,
					params.sessionId,
				);
				textParts.push(context ?? `@${chunk.uri}`);
			}
		}
		const prompt = textParts.join('\n');
		const trimmedPrompt = prompt.trim();
		if (trimmedPrompt === '/share') {
			return handleShareCommand(this.client, params.sessionId, session);
		}
		if (
			trimmedPrompt === '/reasoning' ||
			trimmedPrompt.startsWith('/reasoning ')
		) {
			return handleReasoningCommand(
				this.client,
				params.sessionId,
				session,
				trimmedPrompt,
			);
		}
		if (trimmedPrompt === '/stage' || trimmedPrompt.startsWith('/stage ')) {
			return handleStageCommand(
				this.client,
				params.sessionId,
				session,
				trimmedPrompt,
			);
		}
		if (trimmedPrompt === '/mcp' || trimmedPrompt.startsWith('/mcp ')) {
			return handleMcpCommand(
				this.client,
				params.sessionId,
				session,
				trimmedPrompt,
			);
		}

		let unsub: (() => void) | null = null;
		const subscribeToPromptEvents = (ottoSessionId: string) => {
			if (unsub) return;
			unsub = subscribe(ottoSessionId, (event) => {
				if (event.type === 'session.updated') return;
				const currentSession = this.sessions.get(params.sessionId);
				if (!currentSession) return;
				void handleOttoEvent(
					this.client,
					this.clientCapabilities,
					event,
					params.sessionId,
					currentSession,
				);
			});
			session.unsubscribe = unsub;
		};

		if (session.ottoSessionId) {
			subscribeToPromptEvents(session.ottoSessionId);
		}

		let response: Awaited<ReturnType<typeof handleAskRequest>>;
		try {
			const runAsk = () =>
				handleAskRequest({
					projectRoot: session.cwd,
					prompt,
					sessionId: session.ottoSessionId || undefined,
					agent: session.mode,
					provider: session.provider,
					model: session.model,
					images,
				});
			const shellExecutor = this.clientCapabilities?.terminal
				? createAcpShellExecutor(this.client, params.sessionId)
				: undefined;
			response = shellExecutor
				? await shellExecutorContext.run(shellExecutor, runAsk)
				: await runAsk();
		} catch (err) {
			session.unsubscribe?.();
			session.unsubscribe = null;
			const msg = err instanceof Error ? err.message : String(err);
			console.error('[acp] handleAskRequest failed:', msg);
			await this.client.sessionUpdate({
				sessionId: params.sessionId,
				update: {
					sessionUpdate: 'agent_message_chunk',
					content: {
						type: 'text',
						text: `Error: ${msg}\n\nMake sure you have a provider configured. Run \`otto auth\` to set up API keys.`,
					},
				},
			});
			return { stopReason: 'end_turn' };
		}

		session.ottoSessionId = response.sessionId;
		session.assistantMessageId = response.assistantMessageId;
		session.provider = response.provider;
		session.model = response.model;
		this.subscribeSessionInfoUpdates(params.sessionId, session);
		subscribeToPromptEvents(response.sessionId);

		return new Promise<PromptResponse>((resolve) => {
			const checkInterval = setInterval(() => {
				if (session.cancelled) {
					finishPrompt({ stopReason: 'cancelled' });
					return;
				}

				if (!session.assistantMessageId) return;

				const state = getRunnerState(session.ottoSessionId);
				const isRunning = state?.running ?? false;
				const hasQueued = (state?.queue.length ?? 0) > 0;

				if (!isRunning && !hasQueued && session.assistantMessageId) {
					finishPrompt({ stopReason: 'end_turn' });
				}
			}, 200);
			checkInterval.unref?.();

			const finishPrompt = (response: PromptResponse) => {
				clearInterval(checkInterval);
				session.unsubscribe?.();
				session.unsubscribe = null;
				session.resolvePrompt = null;
				resolve(response);
			};

			session.resolvePrompt = finishPrompt;
		});
	}

	async cancel(params: CancelNotification): Promise<void> {
		const session = this.sessions.get(params.sessionId);
		if (!session) return;

		session.cancelled = true;

		if (session.ottoSessionId && session.assistantMessageId) {
			abortMessage(session.ottoSessionId, session.assistantMessageId);
		}
	}

	private async resumeExistingSession(
		sessionId: string,
		cwd: string,
		mcpServers: NewSessionRequest['mcpServers'] = [],
	): Promise<ResumeSessionResponse> {
		await ensureAcpServer();
		const { data: row, error } = await apiGetSession({
			path: { sessionId },
			query: { project: cwd },
		});
		if (error || !row) {
			console.error('[acp] Session not found while resuming:', sessionId);
			throw new Error('Session not found');
		}

		const session: AcpSession = {
			sessionId,
			ottoSessionId: sessionId,
			cwd: row.projectPath || cwd,
			cancelled: false,
			assistantMessageId: null,
			resolvePrompt: null,
			unsubscribe: null,
			sessionInfoUnsubscribe: null,
			activeTerminals: new Map(),
			streamedToolCalls: new Set(),
			streamedToolContent: new Map(),
			mode: row.agent || DEFAULT_MODE,
			provider: row.provider,
			model: row.model,
			mcpServers,
			additionalDirectories: [],
		};
		this.sessions.set(sessionId, session);
		this.subscribeSessionInfoUpdates(sessionId, session);

		return buildSessionState(session);
	}

	private subscribeSessionInfoUpdates(
		acpSessionId: string,
		session: AcpSession,
	) {
		if (!session.ottoSessionId || session.sessionInfoUnsubscribe) return;

		session.sessionInfoUnsubscribe = subscribe(
			session.ottoSessionId,
			(event) => {
				if (event.type !== 'session.updated') return;
				const currentSession = this.sessions.get(acpSessionId);
				if (!currentSession) return;
				void handleOttoEvent(
					this.client,
					this.clientCapabilities,
					event,
					acpSessionId,
					currentSession,
				);
			},
		);
	}

	private async persistSessionPreferences(
		session: AcpSession,
		preferences: { agent?: string; provider?: string; model?: string },
	) {
		if (!session.ottoSessionId) return;
		const cfg = await loadConfig(session.cwd);
		await ensureAcpServer();
		const { error } = await apiUpdateSession({
			path: { sessionId: session.ottoSessionId },
			query: { project: cfg.projectRoot },
			body: {
				...(preferences.agent ? { agent: preferences.agent } : {}),
				...(preferences.provider ? { provider: preferences.provider } : {}),
				...(preferences.model ? { model: preferences.model } : {}),
			},
		});
		if (error) throw new Error('Failed to update session preferences');
	}

	private async resolveResourceLink(
		uri: string,
		sessionId: string,
	): Promise<string | undefined> {
		if (!this.clientCapabilities?.fs?.readTextFile) return undefined;
		if (!uri.startsWith('file://')) return undefined;

		try {
			const filePath = decodeURIComponent(new URL(uri).pathname);
			const response = await this.client.readTextFile({
				sessionId,
				path: filePath,
			});
			return `<context uri="${uri}">\n${response.content}\n</context>`;
		} catch (err) {
			console.error('[acp] Failed to read resource link:', uri, err);
			return undefined;
		}
	}
}

function createAcpShellExecutor(
	client: AgentSideConnection,
	acpSessionId: string,
): ShellExecutor {
	return async function* acpShellExecutor(input, options) {
		let terminal: Awaited<
			ReturnType<AgentSideConnection['createTerminal']>
		> | null = null;
		let timeoutId: ReturnType<typeof setTimeout> | null = null;
		let stopReason: 'abort' | 'timeout' | null = null;

		try {
			const command =
				process.platform === 'win32'
					? process.env.COMSPEC || 'cmd.exe'
					: process.env.SHELL || '/bin/bash';
			const args =
				process.platform === 'win32'
					? ['/d', '/s', '/c', input.cmd]
					: ['-lc', input.cmd];

			terminal = await client.createTerminal({
				sessionId: acpSessionId,
				command,
				args,
				cwd: input.cwd,
				outputByteLimit: 1024 * 1024,
			});
			yield { channel: 'terminal', terminalId: terminal.id };

			const abort = () => {
				if (stopReason) return;
				stopReason = 'abort';
				void terminal?.kill().catch(() => undefined);
			};
			options?.abortSignal?.addEventListener('abort', abort, { once: true });

			if (input.timeout > 0) {
				timeoutId = setTimeout(() => {
					if (stopReason) return;
					stopReason = 'timeout';
					void terminal?.kill().catch(() => undefined);
				}, input.timeout);
			}

			const exit = await terminal.waitForExit();
			const output = await terminal.currentOutput();
			const stdout = output.output ?? '';
			const exitCode = exit.exitCode ?? output.exitStatus?.exitCode ?? 0;

			if (stopReason === 'abort') {
				yield {
					result: createToolError(
						`Command aborted by user: ${input.cmd}`,
						'abort',
						{
							cmd: input.cmd,
							stdout,
							stderr: '',
						},
					),
				};
				return;
			}

			if (stopReason === 'timeout') {
				yield {
					result: createToolError(
						`Command timed out after ${input.timeout}ms: ${input.cmd}`,
						'timeout',
						{
							parameter: 'timeout',
							value: input.timeout,
							stdout,
							stderr: '',
							suggestion: 'Increase timeout or optimize the command',
						},
					),
				};
				return;
			}

			if (exitCode !== 0 && !input.allowNonZeroExit) {
				const errorDetail = stdout.trim();
				const errorMsg = `Command failed with exit code ${exitCode}${errorDetail ? `\n\n${errorDetail}` : ''}`;
				yield {
					result: createToolError(errorMsg, 'execution', {
						exitCode,
						stdout,
						stderr: '',
						cmd: input.cmd,
						suggestion: 'Check command syntax or use allowNonZeroExit: true',
					}),
				};
				return;
			}

			yield { result: { ok: true, exitCode, stdout, stderr: '' } };
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			yield {
				result: createToolError(
					`Command execution failed: ${message}`,
					'execution',
					{
						cmd: input.cmd,
						originalError: message,
					},
				),
			};
		} finally {
			if (timeoutId) clearTimeout(timeoutId);
			await terminal?.release().catch(() => undefined);
		}
	};
}

function normalizeAdditionalDirectories(
	params: NewSessionRequest | ResumeSessionRequest | LoadSessionRequest,
): string[] {
	const dirs =
		'additionalDirectories' in params ? params.additionalDirectories : [];
	return Array.isArray(dirs)
		? dirs.filter((dir) => typeof dir === 'string')
		: [];
}
