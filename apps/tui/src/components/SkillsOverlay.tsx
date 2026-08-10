import { useKeyboard } from '@opentui/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
	getSkillsConfig,
	updateSkillsConfig as updateSkillsConfigApi,
} from '@ottocode/api';
import { getProjectQuery } from '../api.ts';
import { isListDownKey, isListUpKey } from '../lib/list-navigation.ts';
import { useTheme } from '../theme.ts';
import {
	ModalFrame,
	ModalListViewport,
	SelectRow,
	useListModalWindow,
} from './ModalFrame.tsx';

type SkillSummary = {
	name: string;
	description: string;
	scope: string;
	path: string;
	enabled?: boolean;
};

type SkillsConfigResponse = {
	enabled: boolean;
	totalCount: number;
	enabledCount: number;
	items: SkillSummary[];
};

interface SkillsOverlayProps {
	onClose: () => void;
}

const SCOPE_ORDER = ['cwd', 'parent', 'repo', 'user', 'system'] as const;
const SCOPE_LABELS: Record<string, string> = {
	cwd: 'PROJECT',
	parent: 'PARENT',
	repo: 'REPOSITORY',
	user: 'USER',
	system: 'SYSTEM',
};

async function fetchSkillsConfig(): Promise<SkillsConfigResponse> {
	const response = await getSkillsConfig({ query: getProjectQuery() } as never);
	if (response.error) {
		throw new Error(
			typeof response.error === 'object' &&
				response.error &&
				'error' in response.error
				? JSON.stringify(response.error)
				: 'Failed to load skills',
		);
	}
	return response.data as SkillsConfigResponse;
}

async function updateSkillsConfig(input: {
	enabled?: boolean;
	items?: Record<string, { enabled?: boolean }>;
}): Promise<SkillsConfigResponse> {
	const response = await updateSkillsConfigApi({
		query: getProjectQuery(),
		body: input,
	} as never);
	if (response.error) {
		throw new Error(
			typeof response.error === 'object' &&
				response.error &&
				'error' in response.error
				? JSON.stringify(response.error)
				: 'Failed to update skills',
		);
	}
	return response.data as SkillsConfigResponse;
}

export function SkillsOverlay({ onClose }: SkillsOverlayProps) {
	const { colors } = useTheme();
	const [skills, setSkills] = useState<SkillSummary[]>([]);
	const [globalEnabled, setGlobalEnabled] = useState(true);
	const [totalCount, setTotalCount] = useState(0);
	const [enabledCount, setEnabledCount] = useState(0);
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [status, setStatus] = useState<string | null>(null);
	const [selectedIdx, setSelectedIdx] = useState(0);

	const selectedIdxRef = useRef(selectedIdx);
	selectedIdxRef.current = selectedIdx;
	const rowsRef = useRef<Array<{ type: 'global' | 'skill'; name?: string }>>(
		[],
	);

	const applyConfig = useCallback((config: SkillsConfigResponse) => {
		setSkills(config.items);
		setGlobalEnabled(config.enabled);
		setTotalCount(config.totalCount);
		setEnabledCount(config.enabledCount);
	}, []);

	const load = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const config = await fetchSkillsConfig();
			applyConfig(config);
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to load skills');
		} finally {
			setLoading(false);
		}
	}, [applyConfig]);

	useEffect(() => {
		void load();
	}, [load]);

	const grouped = useMemo(() => {
		const map = new Map<string, SkillSummary[]>();
		for (const skill of skills) {
			const arr = map.get(skill.scope) ?? [];
			arr.push(skill);
			map.set(skill.scope, arr);
		}
		for (const arr of map.values()) {
			arr.sort((a, b) => a.name.localeCompare(b.name));
		}
		return map;
	}, [skills]);

	const rows = useMemo(() => {
		const out: Array<{ type: 'global' | 'skill'; name?: string }> = [
			{ type: 'global' },
		];
		for (const scope of SCOPE_ORDER) {
			const scopeSkills = grouped.get(scope);
			if (!scopeSkills?.length) continue;
			for (const skill of scopeSkills) {
				out.push({ type: 'skill', name: skill.name });
			}
		}
		return out;
	}, [grouped]);
	rowsRef.current = rows;

	useEffect(() => {
		setSelectedIdx((current) =>
			Math.min(current, Math.max(rows.length - 1, 0)),
		);
	}, [rows.length]);

	useEffect(() => {
		if (!status) return;
		const timeout = setTimeout(() => setStatus(null), 1500);
		return () => clearTimeout(timeout);
	}, [status]);

	const mutate = useCallback(
		async (input: {
			enabled?: boolean;
			items?: Record<string, { enabled?: boolean }>;
		}) => {
			setSaving(true);
			setError(null);
			setStatus(null);
			try {
				const config = await updateSkillsConfig(input);
				applyConfig(config);
				setStatus('saved');
			} catch (err) {
				setError(err instanceof Error ? err.message : 'Failed to save skills');
			} finally {
				setSaving(false);
			}
		},
		[applyConfig],
	);

	const toggleSelected = useCallback(() => {
		const row = rowsRef.current[selectedIdxRef.current];
		if (!row || saving) return;
		if (row.type === 'global') {
			void mutate({ enabled: !globalEnabled });
			return;
		}
		const skill = skills.find((entry) => entry.name === row.name);
		if (!skill) return;
		void mutate({
			items: {
				[skill.name]: {
					enabled: skill.enabled === false,
				},
			},
		});
	}, [globalEnabled, mutate, saving, skills]);

	useKeyboard((key) => {
		if (key.name === 'escape') {
			onClose();
			return;
		}
		if (isListUpKey(key)) {
			setSelectedIdx((current) => Math.max(0, current - 1));
			return;
		}
		if (isListDownKey(key)) {
			setSelectedIdx((current) =>
				Math.min(rowsRef.current.length - 1, current + 1),
			);
			return;
		}
		if (key.name === 'return' || key.name === 'space') {
			toggleSelected();
			return;
		}
		if (key.name === 'r') {
			void load();
		}
	});

	const footerText =
		error ??
		status ??
		'↑/k · ↓/j navigate · Space toggle · R refresh · Esc close';

	type DisplayRow =
		| { type: 'global'; rowIndex: 0 }
		| { type: 'header'; scope: string; label: string }
		| { type: 'skill'; rowIndex: number; skill: SkillSummary };

	const displayRows = useMemo(() => {
		const out: DisplayRow[] = [{ type: 'global', rowIndex: 0 }];
		let rowIndex = 1;
		for (const scope of SCOPE_ORDER) {
			const scopeSkills = grouped.get(scope);
			if (!scopeSkills?.length) continue;
			out.push({
				type: 'header',
				scope,
				label: SCOPE_LABELS[scope] ?? scope,
			});
			for (const skill of scopeSkills) {
				out.push({ type: 'skill', rowIndex, skill });
				rowIndex += 1;
			}
		}
		return out;
	}, [grouped]);

	const selectedDisplayIndex = Math.max(
		0,
		displayRows.findIndex(
			(row) => row.type !== 'header' && row.rowIndex === selectedIdx,
		),
	);
	const visibleWindow = useListModalWindow(
		displayRows.length,
		selectedDisplayIndex,
	);
	const visibleRows = displayRows.slice(visibleWindow.start, visibleWindow.end);

	return (
		<ModalFrame
			title={`Skills ${enabledCount}/${totalCount}`}
			size="lg"
			footer={footerText}
		>
			<box flexDirection="column" overflow="hidden">
				{loading ? (
					<box height={3} alignItems="center" justifyContent="center">
						<text fg={colors.fgMuted}>Loading skills…</text>
					</box>
				) : error ? (
					<box
						height={3}
						alignItems="center"
						justifyContent="center"
						flexDirection="column"
					>
						<text fg={colors.red}>{error}</text>
					</box>
				) : totalCount === 0 ? (
					<box
						height={3}
						alignItems="center"
						justifyContent="center"
						flexDirection="column"
					>
						<text fg={colors.fgBright}>No skills found</text>
						<text fg={colors.fgMuted}>
							Create skills in .otto/skills or ~/.config/otto/skills
						</text>
					</box>
				) : (
					<ModalListViewport rowCount={visibleRows.length}>
						{visibleRows.map((row) => {
							if (row.type === 'header') {
								return (
									<box key={`h-${row.scope}`} height={1} paddingLeft={2}>
										<text fg={colors.fgMuted}>
											<b>{row.label}</b>
										</text>
									</box>
								);
							}
							if (row.type === 'global') {
								const isSelected = selectedIdx === 0;
								return (
									<SelectRow
										key="global"
										active={isSelected}
										title="All skills"
										footer={
											<text fg={globalEnabled ? colors.green : colors.fgDark}>
												{saving && isSelected
													? '…'
													: globalEnabled
														? 'ON'
														: 'OFF'}
											</text>
										}
									/>
								);
							}

							const isSelected = selectedIdx === row.rowIndex;
							const enabled = row.skill.enabled !== false;
							return (
								<SelectRow
									key={`${row.skill.scope}-${row.skill.name}`}
									active={isSelected}
									title={row.skill.name}
									footer={
										<text fg={enabled ? colors.green : colors.fgDark}>
											{saving && isSelected ? '…' : enabled ? 'ON' : 'OFF'}
										</text>
									}
								/>
							);
						})}
					</ModalListViewport>
				)}
			</box>
		</ModalFrame>
	);
}
