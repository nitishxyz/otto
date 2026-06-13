import { useKeyboard } from '@opentui/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
	client,
	getSkillsConfig,
	updateSkillsConfig as updateSkillsConfigApi,
} from '@ottocode/api';
import { getBaseUrl } from '../api.ts';
import { useTheme } from '../theme.ts';
import { getVisibleWindow, ModalFrame, SelectRow } from './ModalFrame.tsx';

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
	client.setConfig({ baseURL: getBaseUrl() });
	const response = await getSkillsConfig();
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
	client.setConfig({ baseURL: getBaseUrl() });
	const response = await updateSkillsConfigApi({ body: input });
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
		if (key.name === 'up') {
			setSelectedIdx((current) => Math.max(0, current - 1));
			return;
		}
		if (key.name === 'down') {
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
		error ?? status ?? '↑↓ nav · space toggle · r refresh · esc close';

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
	const visibleWindow = getVisibleWindow(
		displayRows.length,
		selectedDisplayIndex,
		20,
	);
	const visibleRows = displayRows.slice(visibleWindow.start, visibleWindow.end);

	return (
		<ModalFrame
			title={`Skills ${enabledCount}/${totalCount}`}
			size="lg"
			fill
			footer={footerText}
		>
			<box flexDirection="column" flexGrow={1} overflow="hidden">
				{loading ? (
					<box flexGrow={1} alignItems="center" justifyContent="center">
						<text fg={colors.fgMuted}>Loading skills…</text>
					</box>
				) : error ? (
					<box
						flexGrow={1}
						alignItems="center"
						justifyContent="center"
						flexDirection="column"
					>
						<text fg={colors.red}>{error}</text>
					</box>
				) : totalCount === 0 ? (
					<box
						flexGrow={1}
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
					<box flexDirection="column" flexGrow={1}>
						{visibleWindow.start > 0 && (
							<text fg={colors.fgMuted}>↑ {visibleWindow.start} more</text>
						)}
						{visibleRows.map((row) => {
							if (row.type === 'header') {
								return (
									<box key={`h-${row.scope}`} height={1} paddingLeft={3}>
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
											saving && isSelected ? '…' : globalEnabled ? 'ON' : 'OFF'
										}
									/>
								);
							}

							const isSelected = selectedIdx === row.rowIndex;
							const enabled = row.skill.enabled !== false;
							const description = row.skill.description
								? row.skill.description.slice(0, 72)
								: undefined;
							return (
								<SelectRow
									key={`${row.skill.scope}-${row.skill.name}`}
									active={isSelected}
									title={row.skill.name}
									description={description}
									footer={saving && isSelected ? '…' : enabled ? 'ON' : 'OFF'}
								/>
							);
						})}
						{visibleWindow.end < displayRows.length && (
							<text fg={colors.fgMuted}>
								↓ {displayRows.length - visibleWindow.end} more
							</text>
						)}
					</box>
				)}
			</box>
		</ModalFrame>
	);
}
