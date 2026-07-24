import {
	createSessionHandoff,
	pushCommits,
	shareSession,
	stageFiles,
	syncShare,
} from '@ottocode/api';
import { openAuthUrl } from '@ottocode/sdk';
import { getProjectQuery } from '../api.ts';
import { buildWebSessionUrl, copyToClipboard } from '../lib/clipboard.ts';
import { resolveCommand } from './registry.ts';
import type { Overlay, Session } from '../types.ts';
import type { StatusIndicator } from '../stores/overlay.ts';

/** Everything a slash command may need to execute. */
export interface CommandContext {
	activeSession: Session | null;
	webUrl?: string;
	reasoningText: boolean;
	onQuit: () => void;
	setOverlay: (overlay: Overlay) => void;
	showStatus: (status: StatusIndicator, timeoutMs?: number) => void;
	loadSessions: () => Promise<Session[]>;
	createSession: (title?: string) => Promise<Session | null>;
	deleteSession: (id: string) => Promise<void>;
	switchSession: (session: Session) => void;
	updateSessionPrefs: (
		sessionId: string,
		changes: {
			agent?: string;
			provider?: string;
			model?: string;
		},
	) => Promise<void>;
	sendMessage: (sessionId: string, content: string) => Promise<void>;
	abortSession: (sessionId: string) => Promise<void>;
	updateDefaults: (changes: Record<string, unknown>) => Promise<void>;
	reload: () => void;
}

async function runPush(ctx: CommandContext): Promise<void> {
	ctx.showStatus({ type: 'loading', label: 'pushing…' });
	try {
		const pushResponse = await pushCommits({
			query: getProjectQuery(),
			body: {},
		} as never);
		if (pushResponse.error) {
			// biome-ignore lint/suspicious/noExplicitAny: SDK error type
			const err = pushResponse.error as any;
			ctx.showStatus(
				{ type: 'error', label: err?.error || 'push failed' },
				3000,
			);
		} else {
			// biome-ignore lint/suspicious/noExplicitAny: SDK response type
			const pushData = pushResponse.data as any;
			ctx.showStatus(
				{ type: 'success', label: pushData?.data?.output || 'pushed' },
				3000,
			);
		}
	} catch {
		ctx.showStatus({ type: 'error', label: 'push failed' }, 3000);
	}
}

async function runWeb(ctx: CommandContext): Promise<void> {
	const sessionWebUrl = buildWebSessionUrl(ctx.webUrl, ctx.activeSession?.id);
	let copied = false;
	try {
		await copyToClipboard(sessionWebUrl);
		copied = true;
	} catch {}
	const opened = await openAuthUrl(sessionWebUrl);
	if (opened && copied) {
		ctx.showStatus({ type: 'success', label: 'web opened & copied' }, 3000);
	} else if (opened) {
		ctx.showStatus({ type: 'success', label: 'web opened' }, 3000);
	} else if (copied) {
		ctx.showStatus({ type: 'success', label: 'web url copied' }, 3000);
	} else {
		ctx.showStatus({ type: 'error', label: 'could not open web' }, 3000);
	}
}

async function runStage(ctx: CommandContext): Promise<void> {
	try {
		await stageFiles({
			query: getProjectQuery(),
			body: { files: ['.'] },
		} as never);
		ctx.showStatus({ type: 'success', label: 'staged all' }, 3000);
	} catch {
		ctx.showStatus({ type: 'error', label: 'stage failed' }, 3000);
	}
}

async function runHandoff(ctx: CommandContext): Promise<void> {
	if (!ctx.activeSession) return;
	ctx.showStatus({ type: 'loading', label: 'creating handoff…' });
	try {
		const response = await createSessionHandoff({
			path: { sessionId: ctx.activeSession.id },
			query: getProjectQuery(),
		} as never);
		if (response.error || typeof response.data?.sessionId !== 'string') {
			throw new Error('handoff failed');
		}
		const updatedSessions = await ctx.loadSessions();
		const next = updatedSessions.find((s) => s.id === response.data?.sessionId);
		if (next) ctx.switchSession(next);
		ctx.showStatus({ type: 'success', label: 'handoff created' }, 3000);
	} catch {
		ctx.showStatus({ type: 'error', label: 'handoff failed' }, 3000);
	}
}

async function runShare(ctx: CommandContext): Promise<void> {
	if (!ctx.activeSession) return;
	ctx.showStatus({ type: 'loading', label: 'sharing…' });
	try {
		const shareResponse = await shareSession({
			path: { sessionId: ctx.activeSession.id },
			query: getProjectQuery(),
		} as never);
		// biome-ignore lint/suspicious/noExplicitAny: SDK response structure
		const shareData = shareResponse.data as any;
		const shareUrl = shareData?.url;
		if (shareUrl) {
			await copyToClipboard(shareUrl);
			ctx.showStatus({ type: 'success', label: 'url copied' }, 3000);
		} else {
			ctx.showStatus({ type: 'error', label: 'share failed' }, 3000);
		}
	} catch {
		ctx.showStatus({ type: 'error', label: 'share failed' }, 3000);
	}
}

async function runSync(ctx: CommandContext): Promise<void> {
	if (!ctx.activeSession) return;
	ctx.showStatus({ type: 'loading', label: 'syncing…' });
	try {
		const syncResponse = await syncShare({
			path: { sessionId: ctx.activeSession.id },
			query: getProjectQuery(),
		} as never);
		// biome-ignore lint/suspicious/noExplicitAny: SDK response structure
		const syncData = syncResponse.data as any;
		const syncUrl = syncData?.url;
		if (syncUrl) {
			await copyToClipboard(syncUrl);
			ctx.showStatus({ type: 'success', label: 'synced & copied' }, 3000);
		} else {
			ctx.showStatus({ type: 'error', label: 'sync failed' }, 3000);
		}
	} catch {
		ctx.showStatus({ type: 'error', label: 'sync failed' }, 3000);
	}
}

const OVERLAY_COMMANDS: Partial<Record<string, Overlay>> = {
	mcp: 'mcp',
	skills: 'skills',
	models: 'models',
	agents: 'agents',
	commit: 'commit',
	help: 'help',
	theme: 'theme',
	approvals: 'approvals',
	usage: 'usage',
};

/**
 * Executes a slash command. Unknown commands are forwarded to the active
 * session as a `/name args` message (server-side commands).
 */
export async function executeCommand(
	name: string,
	args: string,
	ctx: CommandContext,
): Promise<void> {
	const cmd = resolveCommand(name);

	const overlay = OVERLAY_COMMANDS[cmd];
	if (overlay) {
		if (cmd === 'sessions') await ctx.loadSessions();
		ctx.setOverlay(overlay);
		return;
	}

	switch (cmd) {
		case 'exit':
			ctx.onQuit();
			break;
		case 'sessions':
			await ctx.loadSessions();
			ctx.setOverlay('sessions');
			break;
		case 'new': {
			const session = await ctx.createSession(args || undefined);
			if (session) ctx.setOverlay('none');
			break;
		}
		case 'delete':
			if (ctx.activeSession) {
				await ctx.deleteSession(ctx.activeSession.id);
			}
			break;
		case 'push':
			await runPush(ctx);
			break;
		case 'web':
			await runWeb(ctx);
			break;
		case 'stage':
			await runStage(ctx);
			break;
		case 'clear':
			ctx.reload();
			break;
		case 'provider':
			if (args) {
				if (ctx.activeSession) {
					await ctx.updateSessionPrefs(ctx.activeSession.id, {
						provider: args,
					});
				} else {
					const s = await ctx.createSession();
					if (s) await ctx.updateSessionPrefs(s.id, { provider: args });
				}
			}
			break;
		case 'compact':
		case 'init':
			if (ctx.activeSession) {
				await ctx.sendMessage(ctx.activeSession.id, `/${cmd}`);
			}
			break;
		case 'handoff':
			await runHandoff(ctx);
			break;
		case 'stop':
			if (ctx.activeSession) {
				await ctx.abortSession(ctx.activeSession.id);
			}
			break;
		case 'reasoning':
			await ctx.updateDefaults({ reasoningText: !ctx.reasoningText });
			break;
		case 'share':
			await runShare(ctx);
			break;
		case 'sync':
			await runSync(ctx);
			break;
		default:
			if (ctx.activeSession) {
				await ctx.sendMessage(
					ctx.activeSession.id,
					`/${cmd}${args ? ` ${args}` : ''}`,
				);
			}
			break;
	}
}
