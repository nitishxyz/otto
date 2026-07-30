import { useKeyboard, useRenderer } from '@opentui/react';
import { useState, useEffect, useRef } from 'react';
import { useTheme } from '../theme.ts';
import type { Session } from '../types.ts';
import { ModalFrame, SelectRow } from './ModalFrame.tsx';

interface SessionsOverlayProps {
	sessions: Session[];
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

const ITEM_HEIGHT = 1;
const LOAD_MORE_THRESHOLD = 5;

export function SessionsOverlay({
	sessions,
	hasMore,
	loadingMore,
	onLoadMore,
	onSelect,
	onClose,
}: SessionsOverlayProps) {
	const { colors } = useTheme();
	const [selectedIdx, setSelectedIdx] = useState(0);
	const renderer = useRenderer();
	const scrollboxIdRef = useRef(`sessions-scrollbox-${Date.now()}`);

	useKeyboard((key) => {
		if (key.name === 'up') {
			setSelectedIdx((prev) => (prev <= 0 ? sessions.length - 1 : prev - 1));
		} else if (key.name === 'down') {
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

	useEffect(() => {
		const scrollbox = renderer.root.findDescendantById(scrollboxIdRef.current);
		if (scrollbox && 'scrollTo' in scrollbox) {
			(scrollbox as { scrollTo: (pos: number) => void }).scrollTo(
				selectedIdx * ITEM_HEIGHT,
			);
		}
	}, [selectedIdx, renderer]);

	return (
		<ModalFrame
			title="Sessions"
			size="lg"
			fill
			footer="Up/Down navigate · Enter select · Esc close"
		>
			{sessions.length === 0 ? (
				<box style={{ padding: 1, flexGrow: 1, alignItems: 'center' }}>
					<text fg={colors.fgDark}>
						No sessions yet. Type /new to create one.
					</text>
				</box>
			) : (
				<box style={{ flexGrow: 1, flexShrink: 1, overflow: 'hidden' }}>
					<scrollbox
						id={scrollboxIdRef.current}
						style={{
							width: '100%',
							height: '100%',
						}}
						stickyScroll
						stickyStart="top"
						viewportCulling
					>
						{sessions.map((s, i) => {
							const isSelected = i === selectedIdx;
							const title = s.title || 'untitled';
							const meta = `${s.provider || 'unknown'}/${s.model || ''} · ${timeAgo(s.lastActiveAt)}`;
							return (
								<SelectRow
									key={s.id}
									active={isSelected}
									title={title}
									footer={meta}
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
								<text fg={colors.fgDark}>↓ scroll for more</text>
							</box>
						)}
					</scrollbox>
				</box>
			)}
		</ModalFrame>
	);
}
