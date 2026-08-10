import { useKeyboard } from '@opentui/react';
import type { TextareaOptions, TextareaRenderable } from '@opentui/core';
import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import Fuse from 'fuse.js';
import { getAllModels } from '@ottocode/api';
import { useTheme } from '../theme.ts';
import {
	ModalFrame,
	ModalListViewport,
	SelectRow,
	useListModalWindow,
} from './ModalFrame.tsx';
import { getProjectQuery } from '../api.ts';

interface ModelItem {
	id: string;
	label: string;
	toolCall?: boolean;
	reasoningText?: boolean;
	available?: boolean;
	unavailableReason?: string;
}

interface ProviderModels {
	label: string;
	models: ModelItem[];
}

type AllModels = Record<string, ProviderModels>;

const SEARCH_KEY_BINDINGS: NonNullable<TextareaOptions['keyBindings']> = [
	{ name: 'return', action: 'submit' },
];

interface FlatItem {
	providerKey: string;
	providerLabel: string;
	modelId: string;
	modelLabel: string;
	toolCall?: boolean;
	reasoningText?: boolean;
	available?: boolean;
	unavailableReason?: string;
}

interface ModelsOverlayProps {
	currentProvider: string;
	currentModel: string;
	onClose: () => void;
	onSelect: (provider: string, model: string) => void;
}

export function ModelsOverlay({
	currentProvider,
	currentModel,
	onClose,
	onSelect,
}: ModelsOverlayProps) {
	const { colors } = useTheme();
	const [allModels, setAllModels] = useState<AllModels | null>(null);
	const [searchQuery, setSearchQuery] = useState('');
	const [selectedIdx, setSelectedIdx] = useState(0);
	const selectedIdxRef = useRef(selectedIdx);
	selectedIdxRef.current = selectedIdx;
	const textareaRef = useRef<TextareaRenderable | null>(null);

	useEffect(() => {
		getAllModels({ query: getProjectQuery() } as never).then((res) => {
			// biome-ignore lint/suspicious/noExplicitAny: SDK response type
			const data = res.data as any;
			if (data) setAllModels(data);
		});
	}, []);

	const flattenedModels = useMemo(() => {
		if (!allModels) return [];
		const items: FlatItem[] = [];
		for (const [providerKey, providerData] of Object.entries(allModels)) {
			for (const m of providerData.models) {
				items.push({
					providerKey,
					providerLabel: providerData.label,
					modelId: m.id,
					modelLabel: m.label,
					toolCall: m.toolCall,
					reasoningText: m.reasoningText,
					available: m.available,
					unavailableReason: m.unavailableReason,
				});
			}
		}
		return items;
	}, [allModels]);

	const fuse = useMemo(
		() =>
			new Fuse(flattenedModels, {
				keys: [
					{ name: 'modelLabel', weight: 2 },
					{ name: 'modelId', weight: 1 },
					{ name: 'providerLabel', weight: 0.5 },
				],
				threshold: 0.3,
				ignoreLocation: true,
				includeScore: true,
				distance: 100,
				minMatchCharLength: 1,
			}),
		[flattenedModels],
	);

	const filteredModels = useMemo((): AllModels => {
		if (!allModels) return {};
		if (!searchQuery.trim()) return allModels;

		const results = fuse.search(searchQuery);
		const filtered: AllModels = {};

		for (const result of results) {
			const item = result.item;
			if (!filtered[item.providerKey]) {
				filtered[item.providerKey] = {
					label: item.providerLabel,
					models: [],
				};
			}
			const exists = filtered[item.providerKey].models.find(
				(m) => m.id === item.modelId,
			);
			if (!exists) {
				filtered[item.providerKey].models.push({
					id: item.modelId,
					label: item.modelLabel,
					toolCall: item.toolCall,
					reasoningText: item.reasoningText,
					available: item.available,
					unavailableReason: item.unavailableReason,
				});
			}
		}
		return filtered;
	}, [allModels, searchQuery, fuse]);

	const flatList = useMemo(() => {
		const list: FlatItem[] = [];
		for (const [providerKey, providerData] of Object.entries(filteredModels)) {
			for (const m of providerData.models) {
				list.push({
					providerKey,
					providerLabel: providerData.label,
					modelId: m.id,
					modelLabel: m.label,
					toolCall: m.toolCall,
					reasoningText: m.reasoningText,
					available: m.available,
					unavailableReason: m.unavailableReason,
				});
			}
		}
		return list;
	}, [filteredModels]);

	const flatListRef = useRef(flatList);
	flatListRef.current = flatList;

	useEffect(() => {
		void searchQuery;
		setSelectedIdx(0);
	}, [searchQuery]);

	const handleContentChange = useCallback(() => {
		if (!textareaRef.current) return;
		setSearchQuery(textareaRef.current.plainText);
	}, []);

	useKeyboard((key) => {
		const list = flatListRef.current;
		if (list.length === 0) return;

		if (key.name === 'up' || (key.ctrl && key.name === 'k')) {
			key.preventDefault();
			const next =
				selectedIdxRef.current <= 0
					? list.length - 1
					: selectedIdxRef.current - 1;
			setSelectedIdx(next);
		} else if (key.name === 'down' || (key.ctrl && key.name === 'j')) {
			key.preventDefault();
			const next =
				selectedIdxRef.current >= list.length - 1
					? 0
					: selectedIdxRef.current + 1;
			setSelectedIdx(next);
		} else if (key.name === 'return') {
			const item = list[selectedIdxRef.current];
			if (item && item.available !== false) {
				onSelect(item.providerKey, item.modelId);
			}
		} else if (key.name === 'escape') {
			onClose();
		}
	});

	type DisplayRow =
		| { type: 'header'; providerKey: string; label: string }
		| { type: 'model'; flatIndex: number; item: FlatItem };

	const displayRows = useMemo(() => {
		const rows: DisplayRow[] = [];
		let lastProvider = '';
		for (let i = 0; i < flatList.length; i++) {
			const item = flatList[i];
			if (item.providerKey !== lastProvider) {
				rows.push({
					type: 'header',
					providerKey: item.providerKey,
					label: item.providerLabel,
				});
				lastProvider = item.providerKey;
			}
			rows.push({ type: 'model', flatIndex: i, item });
		}
		return rows;
	}, [flatList]);

	const selectedDisplayRow = displayRows.findIndex(
		(row) => row.type === 'model' && row.flatIndex === selectedIdx,
	);
	const visibleWindow = useListModalWindow(
		displayRows.length,
		Math.max(0, selectedDisplayRow),
		4,
	);
	const visibleDisplayRows = displayRows.slice(
		visibleWindow.start,
		visibleWindow.end,
	);

	return (
		<ModalFrame
			title="Models"
			size="lg"
			footer="↑/Ctrl+k · ↓/Ctrl+j navigate · Enter select · Esc close"
		>
			<box
				style={{
					width: '100%',
					height: 3,
					flexShrink: 0,
					border: true,
					borderStyle: 'rounded',
					borderColor: colors.border,
					marginBottom: 1,
					paddingLeft: 1,
					paddingRight: 1,
				}}
			>
				<box style={{ flexDirection: 'row', width: '100%', height: 1 }}>
					<text fg={colors.fgDark}>/ </text>
					<textarea
						ref={textareaRef}
						focused
						placeholder="Search models…"
						placeholderColor={colors.fgDark}
						textColor={colors.fgBright}
						focusedTextColor={colors.fgBright}
						backgroundColor={colors.bg}
						focusedBackgroundColor={colors.bg}
						cursorColor={colors.blue}
						wrapMode="word"
						keyBindings={SEARCH_KEY_BINDINGS}
						onContentChange={handleContentChange}
						style={{ flexGrow: 1, height: 1 }}
					/>
				</box>
			</box>

			{!allModels && <text fg={colors.fgDark}>Loading models…</text>}

			{allModels && flatList.length === 0 && searchQuery && (
				<text fg={colors.fgDark}>No models found</text>
			)}

			{flatList.length > 0 && (
				<ModalListViewport rowCount={visibleDisplayRows.length}>
					{visibleDisplayRows.map((row) => {
						if (row.type === 'header') {
							return (
								<box
									key={`h-${row.providerKey}`}
									style={{ height: 1, width: '100%' }}
								>
									<text fg={colors.fgDimmed}>
										<b>{row.label.toUpperCase()}</b>
									</text>
								</box>
							);
						}
						const isSelected = row.flatIndex === selectedIdx;
						const isCurrent =
							row.item.providerKey === currentProvider &&
							row.item.modelId === currentModel;
						const badges: string[] = [];
						if (row.item.available === false) badges.push('unavailable');
						if (row.item.toolCall) badges.push('tools');
						if (row.item.reasoningText) badges.push('reasoning');
						return (
							<SelectRow
								key={`m-${row.item.providerKey}-${row.item.modelId}`}
								active={isSelected}
								current={isCurrent}
								title={row.item.modelLabel}
								footer={badges.length > 0 ? badges.join(' ') : undefined}
							/>
						);
					})}
				</ModalListViewport>
			)}
		</ModalFrame>
	);
}
