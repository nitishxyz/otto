import { useKeyboard } from '@opentui/react';
import type { TabSelectOption, TabSelectRenderable } from '@opentui/core';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useTheme } from '../../theme.ts';
import { moveActivityTab } from '../../lib/workspace-navigation.ts';
import type { ActivityData, ActivityDetail, ActivityTab } from './types.ts';

const TABS: Array<{ id: ActivityTab; label: string }> = [
	{ id: 'todos', label: 'Todos' },
	{ id: 'subagents', label: 'Agents' },
	{ id: 'shells', label: 'Shells' },
	{ id: 'terminals', label: 'Terminals' },
];
const TAB_IDS = TABS.map((tab) => tab.id);

function clip(value: string, max: number): string {
	const compact = value.replace(/\s+/g, ' ').trim();
	return compact.length > max ? `${compact.slice(0, max - 1)}…` : compact;
}

function durationSince(timestamp: number): string {
	const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
	if (seconds < 60) return `${seconds}s`;
	if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
	return `${Math.floor(seconds / 3600)}h`;
}

function statusIcon(status: string): string {
	if (status === 'running' || status === 'in_progress') return '●';
	if (status === 'completed' || status === 'exited') return '✓';
	if (status === 'failed' || status === 'cancelled') return '✗';
	return '○';
}

interface ActivityPanelProps {
	data: ActivityData;
	tab: ActivityTab;
	panelWidth: number;
	focused: boolean;
	onTabChange: (tab: ActivityTab) => void;
	onOpenDetail: (detail: ActivityDetail) => void;
	onFocusRequest: () => void;
}

export const ActivityPanel = memo(function ActivityPanel({
	data,
	tab,
	panelWidth,
	focused,
	onTabChange,
	onOpenDetail,
	onFocusRequest,
}: ActivityPanelProps) {
	const { colors } = useTheme();
	const tabsRef = useRef<TabSelectRenderable | null>(null);
	const [focusRegion, setFocusRegion] = useState<'tabs' | 'list'>('tabs');
	const [selectedByTab, setSelectedByTab] = useState<
		Record<ActivityTab, number>
	>({
		todos: 0,
		subagents: 0,
		shells: 0,
		terminals: 0,
	});

	const itemCount =
		tab === 'todos'
			? (data.todos?.todos.length ?? 0)
			: tab === 'subagents'
				? data.subagents.length
				: tab === 'shells'
					? data.shells.length
					: data.terminals.length;
	const selected = Math.min(selectedByTab[tab], Math.max(0, itemCount - 1));
	const tabOptions = useMemo<TabSelectOption[]>(
		() =>
			TABS.map((candidate) => ({
				name: candidate.label,
				description: '',
				value: candidate.id,
			})),
		[],
	);

	useEffect(() => {
		if (selectedByTab[tab] !== selected) {
			setSelectedByTab((current) => ({ ...current, [tab]: selected }));
		}
	}, [selected, selectedByTab, tab]);

	useEffect(() => {
		const index = TABS.findIndex((candidate) => candidate.id === tab);
		if (index >= 0 && tabsRef.current?.getSelectedIndex() !== index) {
			tabsRef.current?.setSelectedIndex(index);
		}
	}, [tab]);

	useEffect(() => {
		if (focused) setFocusRegion('tabs');
	}, [focused]);

	const openSelected = () => {
		if (tab === 'subagents') {
			const item = data.subagents[selected];
			if (item) onOpenDetail({ kind: 'subagent', id: item.id });
		} else if (tab === 'shells') {
			const item = data.shells[selected];
			if (item) onOpenDetail({ kind: 'shell', id: item.id });
		} else if (tab === 'terminals') {
			const item = data.terminals[selected];
			if (item) onOpenDetail({ kind: 'terminal', id: item.id });
		}
	};

	useKeyboard((key) => {
		if (!focused) return;
		if (!key.ctrl && (key.name === 'h' || key.name === 'l')) {
			key.preventDefault();
			const nextTab = moveActivityTab(
				TAB_IDS,
				tab,
				key.name === 'h' ? 'left' : 'right',
			);
			onTabChange(nextTab);
			tabsRef.current?.setSelectedIndex(TAB_IDS.indexOf(nextTab));
			return;
		}
		if (focusRegion === 'tabs') {
			if (key.name === 'down' || key.raw === 'j' || key.name === 'tab') {
				setFocusRegion('list');
			} else if (key.raw === 'r') data.refresh();
			return;
		}
		if (key.name === 'tab') {
			setFocusRegion('tabs');
			return;
		}
		if (key.name === 'up' || key.raw === 'k') {
			if (selected === 0) {
				setFocusRegion('tabs');
				return;
			}
			setSelectedByTab((current) => ({
				...current,
				[tab]: Math.max(0, selected - 1),
			}));
			return;
		}
		if (key.name === 'down' || key.raw === 'j') {
			setSelectedByTab((current) => ({
				...current,
				[tab]: Math.min(Math.max(0, itemCount - 1), selected + 1),
			}));
			return;
		}
		if (key.name === 'return') openSelected();
		else if (key.raw === 'r') data.refresh();
	});

	const emptyLabel = useMemo(() => {
		if (data.loading) return 'Loading activity…';
		if (tab === 'todos') return 'No todo list yet';
		if (tab === 'subagents') return 'No sub-agents';
		if (tab === 'shells') return 'No shell jobs';
		return 'No terminals';
	}, [data.loading, tab]);

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: OpenTUI panes use mouse focus without DOM roles
		<box
			focusable
			focused={focused}
			onMouseDown={onFocusRequest}
			style={{
				width: '100%',
				height: '100%',
				flexDirection: 'column',
				backgroundColor: focused ? colors.bg : colors.bgDark,
			}}
		>
			<tab-select
				ref={tabsRef}
				focused={focused && focusRegion === 'tabs'}
				options={tabOptions}
				tabWidth={Math.floor(panelWidth / TABS.length)}
				showDescription={false}
				showUnderline
				showScrollArrows={false}
				wrapSelection
				backgroundColor={focused ? colors.bg : colors.bgDark}
				textColor={focused ? colors.fgDark : colors.fgDimmed}
				focusedBackgroundColor={focused ? colors.bg : colors.bgDark}
				focusedTextColor={colors.fgMuted}
				selectedBackgroundColor={focused ? colors.bgHighlight : colors.bgDark}
				selectedTextColor={focused ? colors.fgBright : colors.fgMuted}
				selectedDescriptionColor={colors.fgDimmed}
				onChange={(_index, option) => {
					if (option?.value) onTabChange(option.value as ActivityTab);
				}}
				onSelect={(_index, option) => {
					if (option?.value) onTabChange(option.value as ActivityTab);
					setFocusRegion('list');
				}}
				style={{ width: '100%', height: 2 }}
			/>

			{data.error ? (
				<text fg={colors.yellow} style={{ paddingLeft: 1, paddingTop: 1 }}>
					{data.error}
				</text>
			) : null}

			<scrollbox
				style={{
					width: '100%',
					flexGrow: 1,
					paddingLeft: 1,
					paddingRight: 1,
					paddingTop: 1,
					paddingBottom: 1,
				}}
			>
				{itemCount === 0 ? (
					<text fg={colors.fgDimmed} style={{ paddingLeft: 2 }}>
						{emptyLabel}
					</text>
				) : tab === 'todos' ? (
					data.todos?.todos.map((todo, index) => {
						const active = focused && index === selected;
						return (
							<box
								key={`${index}-${todo.step}`}
								style={{
									flexDirection: 'row',
									gap: 1,
									paddingLeft: 1,
									paddingRight: 1,
									backgroundColor: active ? colors.bgSubtle : undefined,
								}}
							>
								<text
									fg={
										todo.status === 'completed'
											? colors.green
											: todo.status === 'in_progress'
												? colors.blue
												: colors.fgDimmed
									}
								>
									{statusIcon(todo.status)}
								</text>
								<text
									fg={active ? colors.fgBright : colors.fgMuted}
									wrapMode="word"
								>
									{clip(todo.step, 72)}
								</text>
							</box>
						);
					})
				) : tab === 'subagents' ? (
					data.subagents.map((item, index) => (
						<ActivityRow
							key={item.id}
							active={focused && index === selected}
							status={item.status}
							title={item.agent}
							detail={item.task}
							meta={
								item.status === 'running'
									? durationSince(item.createdAt)
									: item.status
							}
						/>
					))
				) : tab === 'shells' ? (
					data.shells.map((item, index) => (
						<ActivityRow
							key={item.id}
							active={focused && index === selected}
							status={item.status}
							title={clip(item.command, 44)}
							detail={item.cwd}
							meta={
								item.status === 'running'
									? durationSince(item.createdAt)
									: item.exitCode === null
										? item.status
										: `exit ${item.exitCode}`
							}
						/>
					))
				) : (
					data.terminals.map((item, index) => (
						<ActivityRow
							key={item.id}
							active={focused && index === selected}
							status={item.status}
							title={item.title || item.purpose || item.command}
							detail={item.purpose || item.command}
							meta={
								item.status === 'running'
									? `pid ${item.pid}`
									: item.exitCode === undefined
										? 'exited'
										: `exit ${item.exitCode}`
							}
						/>
					))
				)}
				{tab === 'todos' && data.todos?.note ? (
					<text
						fg={colors.fgDark}
						wrapMode="word"
						style={{ paddingLeft: 2, paddingTop: 1 }}
					>
						{data.todos.note}
					</text>
				) : null}
			</scrollbox>
		</box>
	);
});

function ActivityRow({
	active,
	status,
	title,
	detail,
	meta,
}: {
	active: boolean;
	status: string;
	title: string;
	detail: string;
	meta: string;
}) {
	const { colors } = useTheme();
	const failed = status === 'failed' || status === 'cancelled';
	const running = status === 'running';
	return (
		<box
			style={{
				flexDirection: 'column',
				paddingLeft: 1,
				paddingRight: 1,
				paddingBottom: 1,
				backgroundColor: active ? colors.bgSubtle : undefined,
			}}
		>
			<box style={{ flexDirection: 'row', gap: 1, width: '100%' }}>
				<text fg={failed ? colors.red : running ? colors.blue : colors.green}>
					{statusIcon(status)}
				</text>
				<text
					fg={active ? colors.fgBright : colors.fgMuted}
					style={{ flexGrow: 1 }}
				>
					{clip(title, 48)}
				</text>
				<text fg={colors.fgDimmed}>{meta}</text>
			</box>
			{detail && detail !== title ? (
				<text fg={colors.fgDark} wrapMode="word" style={{ paddingLeft: 2 }}>
					{clip(detail, 72)}
				</text>
			) : null}
		</box>
	);
}
