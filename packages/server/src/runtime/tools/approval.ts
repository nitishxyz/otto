import { publish } from '../../events/bus.ts';
import type { PluginToolEffect } from '@ottocode/sdk';
import { scopedCallKey } from '../projects/scope.ts';
import {
	discardSessionAttention,
	requireSessionAttention,
	resolveSessionAttention,
} from '../session/attention.ts';
import { toolNamesWhere } from './definitions.ts';

export type ToolApprovalMode = 'auto' | 'dangerous' | 'all' | 'yolo';

export const DANGEROUS_TOOLS = toolNamesWhere(
	(definition) => definition.approval === 'dangerous',
);

export const SAFE_TOOLS = toolNamesWhere(
	(definition) => definition.approval === 'safe',
);

const APPROVAL_REQUIRED_EFFECTS = new Set<PluginToolEffect>([
	'workspace-write',
	'process',
	'network',
	'secrets',
	'external-write',
]);

const DANGEROUS_BROWSER_ACTIONS = new Set([
	'open',
	'navigate',
	'back',
	'forward',
	'reload',
	'click',
	'type',
	'press',
	'evaluate',
]);

export interface PendingApproval {
	projectRoot?: string;
	callId: string;
	toolName: string;
	args: unknown;
	sessionId: string;
	messageId: string;
	resolve: (approved: boolean) => void;
	createdAt: number;
	timeoutId?: ReturnType<typeof setTimeout>;
}

const pendingApprovals = new Map<string, PendingApproval>();

function isMCPToolName(toolName: string): boolean {
	return toolName.includes('__');
}

/** True when the tool's declared effects contain only reads. */
function isReadOnlyEffects(effects: PluginToolEffect[] | undefined): boolean {
	return (
		Array.isArray(effects) &&
		effects.length > 0 &&
		effects.every((effect) => effect === 'workspace-read')
	);
}

export function requiresApproval(
	toolName: string,
	mode: ToolApprovalMode,
	args?: unknown,
	effects?: PluginToolEffect[],
): boolean {
	if (SAFE_TOOLS.has(toolName)) return false;
	if (mode === 'auto' || mode === 'yolo') return false;
	if (mode === 'all') {
		// Classified read-only MCP tools skip the prompt even in `all` mode;
		// unclassified tools and built-ins keep asking.
		return !(isMCPToolName(toolName) && isReadOnlyEffects(effects));
	}
	if (mode === 'dangerous') {
		if (effects) {
			return effects.some((effect) => APPROVAL_REQUIRED_EFFECTS.has(effect));
		}
		if (toolName === 'forge') {
			const input =
				args && typeof args === 'object' && !Array.isArray(args)
					? (args as { action?: unknown; dryRun?: unknown })
					: {};
			return (
				input.dryRun !== true &&
				input.action !== 'docs' &&
				input.action !== 'capabilities' &&
				input.action !== 'inventory' &&
				input.action !== 'status' &&
				input.action !== 'validate' &&
				input.action !== 'plan'
			);
		}
		if (toolName === 'browser') {
			const action =
				args && typeof args === 'object' && !Array.isArray(args)
					? (args as { action?: unknown }).action
					: undefined;
			return (
				typeof action !== 'string' || DANGEROUS_BROWSER_ACTIONS.has(action)
			);
		}
		return DANGEROUS_TOOLS.has(toolName);
	}
	return false;
}

export function skipsGuardApproval(mode?: ToolApprovalMode): boolean {
	return mode === 'yolo';
}

export type ApprovalHandle = {
	promise: Promise<boolean>;
	/** Cancels the request: clears its timer and attention, resolves false. */
	abort: () => void;
};

/**
 * Starts one approval request and returns an abortable handle. The timeout
 * timer and session attention are cleared on every resolution path.
 */
export function createApprovalRequest(args: {
	sessionId: string;
	messageId: string;
	callId: string;
	toolName: string;
	args: unknown;
	timeoutMs?: number;
	projectRoot?: string;
	signal?: AbortSignal;
}): ApprovalHandle {
	const { sessionId, messageId, callId, toolName, projectRoot } = args;
	const key = scopedCallKey(projectRoot, callId);
	let settle: (approved: boolean) => void = () => {};
	const promise = new Promise<boolean>((resolve) => {
		settle = resolve;
	});
	let onAbort: (() => void) | undefined;
	const cleanup = () => {
		if (onAbort) args.signal?.removeEventListener('abort', onAbort);
	};
	const approval: PendingApproval = {
		projectRoot,
		callId,
		toolName,
		args: args.args,
		sessionId,
		messageId,
		resolve: (approved) => {
			if (approval.timeoutId) clearTimeout(approval.timeoutId);
			cleanup();
			settle(approved);
		},
		createdAt: Date.now(),
	};

	const finishWithoutUser = (reason: 'timeout' | 'aborted') => {
		if (pendingApprovals.get(key) !== approval) return;
		pendingApprovals.delete(key);
		resolveSessionAttention({
			key: `tool-approval:${callId}`,
			sessionId,
			messageId,
			projectRoot,
		});
		approval.resolve(false);
		publish({
			type: 'tool.approval.resolved',
			sessionId,
			projectRoot,
			payload: {
				callId,
				toolName,
				approved: false,
				// The event protocol has no 'aborted' reason yet; an aborted
				// request is reported as a rejection so clients dismiss it.
				reason: reason === 'timeout' ? 'timeout' : 'user_rejected',
			},
		});
	};

	if (args.signal?.aborted) {
		settle(false);
		return { promise, abort: () => {} };
	}

	pendingApprovals.set(key, approval);
	approval.timeoutId = setTimeout(
		() => finishWithoutUser('timeout'),
		args.timeoutMs ?? 120000,
	);
	const abort = () => finishWithoutUser('aborted');
	if (args.signal) {
		onAbort = abort;
		args.signal.addEventListener('abort', onAbort, { once: true });
	}
	requireSessionAttention({
		key: `tool-approval:${callId}`,
		sessionId,
		messageId,
		projectRoot,
		title: 'Permission required',
		body: `The agent wants to use ${toolName.replaceAll('_', ' ')}.`,
	});

	publish({
		type: 'tool.approval.required',
		sessionId,
		projectRoot,
		payload: {
			callId,
			toolName,
			args: args.args,
			messageId,
		},
	});

	if (args.signal?.aborted) abort();
	return { promise, abort };
}

export async function requestApproval(
	sessionId: string,
	messageId: string,
	callId: string,
	toolName: string,
	args: unknown,
	timeoutMs = 120000,
	projectRoot?: string,
): Promise<boolean> {
	return createApprovalRequest({
		sessionId,
		messageId,
		callId,
		toolName,
		args,
		timeoutMs,
		projectRoot,
	}).promise;
}

export function resolveApproval(
	callId: string,
	approved: boolean,
	projectRoot?: string,
): { ok: boolean; error?: string } {
	const key = scopedCallKey(projectRoot, callId);
	const approval = pendingApprovals.get(key);
	if (!approval) {
		return { ok: false, error: 'No pending approval found for this callId' };
	}

	pendingApprovals.delete(key);
	resolveSessionAttention({
		key: `tool-approval:${callId}`,
		sessionId: approval.sessionId,
		messageId: approval.messageId,
		projectRoot: approval.projectRoot,
	});
	approval.resolve(approved);

	publish({
		type: 'tool.approval.resolved',
		sessionId: approval.sessionId,
		projectRoot: approval.projectRoot,
		payload: {
			callId,
			toolName: approval.toolName,
			approved,
			reason: approved ? 'user_approved' : 'user_rejected',
		},
	});

	return { ok: true };
}

export function getPendingApproval(
	callId: string,
	projectRoot?: string,
): PendingApproval | undefined {
	return pendingApprovals.get(scopedCallKey(projectRoot, callId));
}

export function updateApprovalArgs(
	callId: string,
	args: unknown,
	projectRoot?: string,
): boolean {
	const approval = pendingApprovals.get(scopedCallKey(projectRoot, callId));
	if (!approval) return false;

	approval.args = args;

	publish({
		type: 'tool.approval.updated',
		sessionId: approval.sessionId,
		projectRoot: approval.projectRoot,
		payload: {
			callId,
			toolName: approval.toolName,
			args,
			messageId: approval.messageId,
		},
	});

	return true;
}

export function getPendingApprovalsForSession(
	sessionId: string,
	projectRoot?: string,
): PendingApproval[] {
	return Array.from(pendingApprovals.values()).filter(
		(a) => a.sessionId === sessionId && a.projectRoot === projectRoot,
	);
}

export function clearPendingApprovalsForSession(
	sessionId: string,
	projectRoot?: string,
): void {
	for (const [callId, approval] of pendingApprovals) {
		if (
			approval.sessionId === sessionId &&
			approval.projectRoot === projectRoot
		) {
			approval.resolve(false);
			pendingApprovals.delete(callId);
			discardSessionAttention({
				key: `tool-approval:${approval.callId}`,
				sessionId: approval.sessionId,
				projectRoot: approval.projectRoot,
			});
		}
	}
}
