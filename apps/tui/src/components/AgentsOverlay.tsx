import { useKeyboard } from '@opentui/react';
import { useCallback, useEffect, useState } from 'react';
import { getAgents } from '@ottocode/api';
import { isListDownKey, isListUpKey } from '../lib/list-navigation.ts';
import { useTheme } from '../theme.ts';
import {
	ModalFrame,
	ModalListViewport,
	SelectRow,
	useListModalWindow,
} from './ModalFrame.tsx';
import { getProjectQuery } from '../api.ts';

interface AgentsOverlayProps {
	currentAgent: string;
	onClose: () => void;
	onSelect: (agent: string) => void | Promise<void>;
}

export function AgentsOverlay({
	currentAgent,
	onClose,
	onSelect,
}: AgentsOverlayProps) {
	const { colors } = useTheme();
	const [agents, setAgents] = useState<string[]>([]);
	const [selectedIdx, setSelectedIdx] = useState(0);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		(async () => {
			try {
				const response = await getAgents({ query: getProjectQuery() } as never);
				if (cancelled) return;
				const list = response.data?.agents ?? [];
				setAgents(list);
				const idx = list.indexOf(currentAgent);
				setSelectedIdx(idx >= 0 ? idx : 0);
			} catch {
				if (!cancelled) setError('failed to load agents');
			} finally {
				if (!cancelled) setLoading(false);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [currentAgent]);

	const navigate = useCallback((next: number) => {
		setSelectedIdx(next);
	}, []);

	useKeyboard((key) => {
		if (agents.length === 0) {
			if (key.name === 'escape') onClose();
			return;
		}
		if (isListUpKey(key)) {
			navigate(selectedIdx <= 0 ? agents.length - 1 : selectedIdx - 1);
		} else if (isListDownKey(key)) {
			navigate(selectedIdx >= agents.length - 1 ? 0 : selectedIdx + 1);
		} else if (key.name === 'return') {
			const choice = agents[selectedIdx];
			if (choice) void Promise.resolve(onSelect(choice)).then(onClose);
		} else if (key.name === 'escape') {
			onClose();
		}
	});

	const visibleWindow = useListModalWindow(agents.length, selectedIdx);
	const visibleAgents = agents.slice(visibleWindow.start, visibleWindow.end);

	return (
		<ModalFrame
			title="Agents"
			size="md"
			footer="↑/k · ↓/j move · Enter select · Esc close"
		>
			{loading && <text fg={colors.fgDimmed}>loading…</text>}
			{error && <text fg={colors.red}>{error}</text>}
			{!loading && !error && agents.length === 0 && (
				<text fg={colors.fgDimmed}>no agents available</text>
			)}
			<ModalListViewport rowCount={visibleAgents.length}>
				{visibleAgents.map((agent, offset) => {
					const index = visibleWindow.start + offset;
					const isSelected = index === selectedIdx;
					const isCurrent = agent === currentAgent;
					return (
						<SelectRow
							key={agent}
							active={isSelected}
							current={isCurrent}
							title={agent}
						/>
					);
				})}
			</ModalListViewport>
		</ModalFrame>
	);
}
