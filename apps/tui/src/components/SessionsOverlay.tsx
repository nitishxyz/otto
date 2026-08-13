import { useKeyboard } from '@opentui/react';
import { useEffect, useState } from 'react';
import { isListDownKey, isListUpKey } from '../lib/list-navigation.ts';
import { useTheme } from '../theme.ts';
import type { Session } from '../types.ts';
import {
	ModalFrame,
	ModalListViewport,
	SelectRow,
	useListModalWindow,
} from './ModalFrame.tsx';
import { TinySpinner } from './TinySpinner.tsx';

interface SessionsOverlayProps {
	sessions: Session[];
	currentSessionId?: string | null;
	hasMore?: boolean;
	loadingMore?: boolean;
	onLoadMore?: () => void;
	onSelect: (session: Session) => void;
	onClose: () => void;
}

function timeAgo(ts: number | null): string {
	if (!ts) return '';
	const diff = Date.now() - ts;
	const mins = Math.floor(diff / 60000);
	if (mins < 1) return 'just now';
	if (mins < 60) return `${mins}m ago`;
	const hours = Math.floor(mins / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.floor(hours / 24);
	return `${days}d ago`;
}

const LOAD_MORE_THRESHOLD = 5;

export function SessionsOverlay({
	sessions,
	currentSessionId,
	hasMore,
	loadingMore,
	onLoadMore,
	onSelect,
	onClose,
}: SessionsOverlayProps) {
	const { colors } = useTheme();
	const [selectedIdx, setSelectedIdx] = useState(() => {
		const currentIndex = sessions.findIndex((s) => s.id === currentSessionId);
		return currentIndex >= 0 ? currentIndex : 0;
	});

	useEffect(() => {
		setSelectedIdx((selected) => {
			const currentIndex = sessions.findIndex((s) => s.id === currentSessionId);
			if (currentIndex >= 0) return currentIndex;
			return Math.max(0, Math.min(selected, sessions.length - 1));
		});
	}, [sessions, currentSessionId]);

	useKeyboard((key) => {
		if (isListUpKey(key)) {
			setSelectedIdx((prev) => (prev <= 0 ? sessions.length - 1 : prev - 1));
		} else if (isListDownKey(key)) {
			setSelectedIdx((prev) => {
				const next = prev >= sessions.length - 1 ? 0 : prev + 1;
				if (
					hasMore &&
					onLoadMore &&
					sessions.length - next <= LOAD_MORE_THRESHOLD
				) {
					onLoadMore();
				}
				return next;
			});
		} else if (key.name === 'return') {
			if (
				sessions.length > 0 &&
				selectedIdx >= 0 &&
				selectedIdx < sessions.length
			) {
				onSelect(sessions[selectedIdx]);
			}
		} else if (key.name === 'escape') {
			onClose();
		}
	});

	const statusRows = loadingMore || hasMore ? 1 : 0;
	const visibleWindow = useListModalWindow(
		sessions.length,
		selectedIdx,
		statusRows,
	);
	const visibleSessions = sessions.slice(
		visibleWindow.start,
		visibleWindow.end,
	);

	return (
		<ModalFrame
			title="Sessions"
			size="lg"
			footer="↑/k · ↓/j navigate · Enter select · Esc close"
		>
			{sessions.length === 0 ? (
				<box style={{ padding: 1, flexGrow: 1, alignItems: 'center' }}>
					<text fg={colors.fgDark}>
						No sessions yet. Type /new to create one.
					</text>
				</box>
			) : (
				<ModalListViewport rowCount={visibleSessions.length + statusRows}>
					{visibleSessions.map((s, offset) => {
						const i = visibleWindow.start + offset;
						const isSelected = i === selectedIdx;
						const isCurrent = s.id === currentSessionId;
						const title = s.title || 'untitled';
						const meta = `${s.provider || 'unknown'}/${s.model || ''} · ${timeAgo(s.lastActiveAt)}`;
						return (
							<SelectRow
								key={s.id}
								active={isSelected}
								current={isCurrent}
								title={title}
								footer={meta}
								gutter={
									s.isRunning ? <TinySpinner fg={colors.blue} /> : undefined
								}
							/>
						);
					})}
					{loadingMore && (
						<box style={{ height: 1, paddingLeft: 1 }}>
							<text fg={colors.fgDimmed}>loading more…</text>
						</box>
					)}
					{hasMore && !loadingMore && (
						<box style={{ height: 1, paddingLeft: 1 }}>
							<text fg={colors.fgDark}>↓ more sessions load as you move</text>
						</box>
					)}
				</ModalListViewport>
			)}
		</ModalFrame>
	);
}
