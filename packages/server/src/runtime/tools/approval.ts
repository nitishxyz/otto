import { publish } from '../../events/bus.ts';
import { scopedCallKey } from '../projects/scope.ts';
import {
	discardSessionAttention,
	requireSessionAttention,
	resolveSessionAttention,
} from '../session/attention.ts';

export type ToolApprovalMode = 'auto' | 'dangerous' | 'all' | 'yolo';

export const DANGEROUS_TOOLS = new Set([
	'shell',
	'bash',
	'edit',
	'multiedit',
	'write',
	'copy_into',
	'apply_patch',
	'terminal',
	'run_plugin_command',
	'git_commit',
	'git_push',
]);

export const SAFE_TOOLS = new Set(['progress_update', 'update_todos']);

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
}

const pendingApprovals = new Map<string, PendingApproval>();

export function requiresApproval(
	toolName: string,
	mode: ToolApprovalMode,
	args?: unknown,
): boolean {
	if (SAFE_TOOLS.has(toolName)) return false;
	if (mode === 'auto' || mode === 'yolo') return false;
	if (mode === 'all') return true;
	if (mode === 'dangerous') {
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

export async function requestApproval(
	sessionId: string,
	messageId: string,
	callId: string,
	toolName: string,
	args: unknown,
	timeoutMs = 120000,
	projectRoot?: string,
): Promise<boolean> {
	return new Promise((resolve) => {
		const approval: PendingApproval = {
			projectRoot,
			callId,
			toolName,
			args,
			sessionId,
			messageId,
			resolve,
			createdAt: Date.now(),
		};

		const key = scopedCallKey(projectRoot, callId);
		pendingApprovals.set(key, approval);
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
				args,
				messageId,
			},
		});

		setTimeout(() => {
			if (pendingApprovals.has(key)) {
				pendingApprovals.delete(key);
				resolveSessionAttention({
					key: `tool-approval:${callId}`,
					sessionId,
					messageId,
					projectRoot,
				});
				resolve(false);
				publish({
					type: 'tool.approval.resolved',
					sessionId,
					projectRoot,
					payload: {
						callId,
						toolName,
						approved: false,
						reason: 'timeout',
					},
				});
			}
		}, timeoutMs);
	});
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
