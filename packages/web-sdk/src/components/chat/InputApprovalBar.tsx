import { memo, useCallback, useState } from 'react';
import { Shield, Check, X, CheckCheck } from 'lucide-react';
import type { PendingToolApproval } from '../../stores/toolApprovalStore';
import { useToolApprovalStore } from '../../stores/toolApprovalStore';
import { apiClient } from '../../lib/api-client';
import {
	INPUT_BAR_ATTACHED_CARD_CLASS,
	INPUT_BAR_GROUP_CLASS,
	inputBarWrapperProps,
} from './input-bar-chrome';

interface InputApprovalBarProps {
	sessionId: string;
}

function formatArgs(args: unknown): string {
	if (!args) return '';
	if (typeof args === 'string') return args;
	try {
		const obj = args as Record<string, unknown>;
		const cmd = obj.cmd ?? obj.command;
		if (typeof cmd === 'string') return cmd;
		const path = obj.path ?? obj.pattern ?? obj.query;
		if (typeof path === 'string') return path;
		const str = JSON.stringify(args, null, 2);
		return str.length > 120 ? `${str.slice(0, 120)}...` : str;
	} catch {
		return String(args);
	}
}

function ApprovalItem({
	approval,
	sessionId,
	isProcessing,
	onProcess,
}: {
	approval: PendingToolApproval;
	sessionId: string;
	isProcessing: boolean;
	onProcess: (callId: string) => void;
}) {
	const { removePendingApproval } = useToolApprovalStore();
	const toolLabel = approval.toolName.replace(/_/g, ' ');
	const target = formatArgs(approval.args);

	const handleApprove = useCallback(async () => {
		onProcess(approval.callId);
		try {
			await apiClient.approveToolCall(sessionId, approval.callId, true);
			removePendingApproval(approval.callId);
		} catch (error) {
			console.error('Failed to approve:', error);
		}
	}, [sessionId, approval.callId, removePendingApproval, onProcess]);

	const handleReject = useCallback(async () => {
		onProcess(approval.callId);
		try {
			await apiClient.approveToolCall(sessionId, approval.callId, false);
			removePendingApproval(approval.callId);
		} catch (error) {
			console.error('Failed to reject:', error);
		}
	}, [sessionId, approval.callId, removePendingApproval, onProcess]);

	return (
		<div className="flex items-center gap-2 px-3 py-2 min-w-0">
			<Shield className="h-3.5 w-3.5 text-amber-500 flex-shrink-0" />
			<span className="text-xs font-medium text-foreground truncate">
				{toolLabel}
			</span>
			{target && (
				<code className="text-[11px] font-mono text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded truncate max-w-[200px]">
					{target}
				</code>
			)}
			<div className="flex items-center gap-1.5 ml-auto flex-shrink-0">
				<button
					type="button"
					onClick={handleReject}
					disabled={isProcessing}
					title="Reject (N)"
					className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded border border-border bg-background hover:bg-muted transition-colors disabled:opacity-50"
				>
					<X className="w-3 h-3" />
					<span className="hidden sm:inline">Reject</span>
					<kbd className="ml-0.5 text-[9px] text-muted-foreground opacity-70">
						N
					</kbd>
				</button>
				<button
					type="button"
					onClick={handleApprove}
					disabled={isProcessing}
					title="Approve (Y)"
					className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded bg-amber-600 text-white hover:bg-amber-700 transition-colors disabled:opacity-50"
				>
					<Check className="w-3 h-3" />
					{isProcessing ? '...' : 'Approve'}
					{!isProcessing && (
						<kbd className="ml-0.5 text-[9px] opacity-70">Y</kbd>
					)}
				</button>
			</div>
		</div>
	);
}

export const InputApprovalBar = memo(function InputApprovalBar({
	sessionId,
}: InputApprovalBarProps) {
	const { pendingApprovals, removePendingApproval } = useToolApprovalStore();
	const [processingId, setProcessingId] = useState<string | null>(null);

	const handleApproveAll = useCallback(async () => {
		try {
			await Promise.all(
				pendingApprovals.map((a) =>
					apiClient.approveToolCall(sessionId, a.callId, true),
				),
			);
			for (const a of pendingApprovals) {
				removePendingApproval(a.callId);
			}
		} catch (error) {
			console.error('Failed to approve all:', error);
		}
	}, [sessionId, pendingApprovals, removePendingApproval]);

	const hasApprovals = pendingApprovals.length > 0;

	return (
		<div
			className={`${INPUT_BAR_GROUP_CLASS} grid transition-[grid-template-rows,opacity] duration-200 ease-out`}
			{...inputBarWrapperProps(hasApprovals)}
			style={{
				gridTemplateRows: hasApprovals ? '1fr' : '0fr',
				opacity: hasApprovals ? 1 : 0,
			}}
		>
			<div className="overflow-hidden">
				<div
					className={`border border-amber-200 dark:border-amber-800 bg-amber-50/80 dark:bg-amber-950/30 overflow-hidden ${INPUT_BAR_ATTACHED_CARD_CLASS}`}
				>
					<div className="divide-y divide-amber-200/50 dark:divide-amber-800/50">
						{pendingApprovals.map((approval) => (
							<ApprovalItem
								key={approval.callId}
								approval={approval}
								sessionId={sessionId}
								isProcessing={processingId === approval.callId}
								onProcess={setProcessingId}
							/>
						))}
					</div>
					{pendingApprovals.length > 1 && (
						<div className="flex items-center justify-between gap-2 px-3 py-1.5 border-t border-amber-200 dark:border-amber-800 bg-amber-100/50 dark:bg-amber-900/20">
							<span className="text-[11px] text-amber-800 dark:text-amber-200">
								{pendingApprovals.length} tools waiting
							</span>
							<button
								type="button"
								onClick={handleApproveAll}
								title="Approve All (A)"
								className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded bg-amber-600 text-white hover:bg-amber-700 transition-colors"
							>
								<CheckCheck className="w-3 h-3" />
								Approve All
								<kbd className="ml-0.5 text-[9px] opacity-70">A</kbd>
							</button>
						</div>
					)}
				</div>
			</div>
		</div>
	);
});
