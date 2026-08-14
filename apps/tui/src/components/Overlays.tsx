import { memo, useCallback } from 'react';
import { useOverlayStore } from '../stores/overlay.ts';
import { SessionsOverlay } from './SessionsOverlay.tsx';
import { ModelsOverlay } from './ModelsOverlay.tsx';
import { CommitOverlay } from './CommitOverlay.tsx';
import { HelpOverlay } from './HelpOverlay.tsx';
import { ThemeOverlay } from './ThemeOverlay.tsx';
import { ApprovalsOverlay } from './ApprovalsOverlay.tsx';
import { MCPOverlay } from './MCPOverlay.tsx';
import { SkillsOverlay } from './SkillsOverlay.tsx';
import { UsageOverlay } from './UsageOverlay.tsx';
import { AgentsOverlay } from './AgentsOverlay.tsx';
import { DictationInstallOverlay } from './DictationInstallOverlay.tsx';
import { QueueOverlay } from './QueueOverlay.tsx';
import { SubagentsOverlay } from './SubagentsOverlay.tsx';
import type { Session } from '../types.ts';
import type { QueuedMessageItem } from '../lib/queue.ts';
import type { ActivitySubagent } from './activity/types.ts';

interface OverlaysProps {
	sessions: Session[];
	currentSessionId?: string | null;
	queuedMessages: QueuedMessageItem[];
	subagents: ActivitySubagent[];
	hasMore: boolean;
	loadingMore: boolean;
	onLoadMore: () => void;
	onSessionSelect: (session: Session) => void;
	provider: string;
	model: string;
	onModelSelect: (provider: string, model: string) => void;
	onThemeSave: (name: string) => void;
	approvalMode: 'auto' | 'dangerous' | 'all' | 'yolo';
	onApprovalModeSave: (
		mode: 'auto' | 'dangerous' | 'all' | 'yolo',
	) => void | Promise<void>;
	currentAgent: string;
	onAgentSelect: (agent: string) => void | Promise<void>;
	onSendQueuedMessage: (assistantMessageId: string) => Promise<boolean>;
	onRemoveQueuedMessage: (assistantMessageId: string) => Promise<boolean>;
	onRestoreQueuedMessage: (item: QueuedMessageItem) => Promise<boolean>;
	onSubagentSelect: (subagent: ActivitySubagent) => void;
}

export const Overlays = memo(function Overlays({
	sessions,
	currentSessionId,
	queuedMessages,
	subagents,
	hasMore,
	loadingMore,
	onLoadMore,
	onSessionSelect,
	provider,
	model,
	onModelSelect,
	onThemeSave,
	approvalMode,
	onApprovalModeSave,
	currentAgent,
	onAgentSelect,
	onSendQueuedMessage,
	onRemoveQueuedMessage,
	onRestoreQueuedMessage,
	onSubagentSelect,
}: OverlaysProps) {
	const overlay = useOverlayStore((s) => s.overlay);
	const setOverlay = useOverlayStore((s) => s.setOverlay);
	const showStatus = useOverlayStore((s) => s.showStatus);
	const completeDictationInstall = useOverlayStore(
		(s) => s.completeDictationInstall,
	);

	const handleClose = useCallback(() => setOverlay('none'), [setOverlay]);

	if (overlay === 'none') return null;

	switch (overlay) {
		case 'sessions':
			return (
				<SessionsOverlay
					sessions={sessions}
					currentSessionId={currentSessionId}
					hasMore={hasMore}
					loadingMore={loadingMore}
					onLoadMore={onLoadMore}
					onSelect={onSessionSelect}
					onClose={handleClose}
				/>
			);
		case 'commit':
			return (
				<CommitOverlay
					onClose={handleClose}
					onCommitted={() =>
						showStatus({ type: 'success', label: 'committed' }, 3000)
					}
				/>
			);
		case 'models':
			return (
				<ModelsOverlay
					currentProvider={provider}
					currentModel={model}
					onClose={handleClose}
					onSelect={(p, m) => {
						onModelSelect(p, m);
						setOverlay('none');
					}}
				/>
			);
		case 'help':
			return <HelpOverlay onClose={handleClose} />;
		case 'theme':
			return <ThemeOverlay onClose={handleClose} onSave={onThemeSave} />;
		case 'approvals':
			return (
				<ApprovalsOverlay
					currentMode={approvalMode}
					onClose={handleClose}
					onSave={onApprovalModeSave}
				/>
			);
		case 'mcp':
			return <MCPOverlay onClose={handleClose} />;
		case 'skills':
			return <SkillsOverlay onClose={handleClose} />;
		case 'agents':
			return (
				<AgentsOverlay
					currentAgent={currentAgent}
					onClose={handleClose}
					onSelect={onAgentSelect}
				/>
			);
		case 'usage':
			return <UsageOverlay currentProvider={provider} onClose={handleClose} />;
		case 'queue':
			return (
				<QueueOverlay
					items={queuedMessages}
					onSend={onSendQueuedMessage}
					onRemove={onRemoveQueuedMessage}
					onRestore={onRestoreQueuedMessage}
					onClose={handleClose}
				/>
			);
		case 'subagents':
			return (
				<SubagentsOverlay
					items={subagents}
					onSelect={onSubagentSelect}
					onClose={handleClose}
				/>
			);
		case 'dictation':
			return (
				<DictationInstallOverlay
					onClose={handleClose}
					onReady={completeDictationInstall}
				/>
			);
		default:
			return null;
	}
});
