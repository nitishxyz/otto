import { type RefObject, useEffect, useRef, useState } from 'react';
import type { MainView } from '../lib/memories.ts';
import { pluralize } from '../lib/vocab.ts';

export const ONLY_GLOBAL = '__global__';

export interface ToolbarProps {
	/** '' = everything, ONLY_GLOBAL = about you, otherwise a project id. */
	scopeValue: string;
	projects: Array<{ projectId: string; name: string; count: number }>;
	globalCount: number | null;
	view: MainView;
	showViewSwitch: boolean;
	search: string;
	searchCount: number | null;
	searchRef: RefObject<HTMLInputElement | null>;
	showReplaced: boolean;
	replacedCount: number;
	onScope: (value: string) => void;
	onView: (view: MainView) => void;
	onSearch: (value: string) => void;
	onToggleReplaced: () => void;
}

export function Toolbar(props: ToolbarProps) {
	const { projects, search, searchCount, searchRef, view } = props;
	return (
		<div className="toolbar">
			<label className="toolbar-select">
				<span className="sr-only">Show memories from</span>
				<select
					value={props.scopeValue}
					onChange={(event) => props.onScope(event.target.value)}
					title={
						projects.find((p) => p.projectId === props.scopeValue)?.projectId
					}
				>
					<option value="">Everything</option>
					<option value={ONLY_GLOBAL}>
						About you
						{props.globalCount !== null ? ` (${props.globalCount})` : ''}
					</option>
					{projects.length > 0 ? (
						<optgroup label="Projects">
							{projects.map((project) => (
								<option key={project.projectId} value={project.projectId}>
									{project.name} ({project.count})
								</option>
							))}
						</optgroup>
					) : null}
				</select>
			</label>

			{props.showViewSwitch ? (
				<div className="segmented" role="tablist" aria-label="View">
					<button
						type="button"
						role="tab"
						aria-selected={view === 'list'}
						className={view === 'list' ? 'on' : undefined}
						onClick={() => props.onView('list')}
					>
						List
					</button>
					<button
						type="button"
						role="tab"
						aria-selected={view === 'graph'}
						className={view === 'graph' ? 'on' : undefined}
						onClick={() => props.onView('graph')}
					>
						Map
					</button>
				</div>
			) : null}

			<div className={`search${searchCount !== null ? ' has-count' : ''}`}>
				<input
					ref={searchRef}
					type="search"
					placeholder="Search memories"
					value={search}
					onChange={(event) => props.onSearch(event.target.value)}
					aria-label="Search memories"
				/>
				{searchCount !== null ? (
					<span className="search-count">
						{searchCount === 1 ? '1 match' : `${searchCount} matches`}
					</span>
				) : (
					<kbd className="search-key">/</kbd>
				)}
			</div>

			<MoreMenu
				showReplaced={props.showReplaced}
				replacedCount={props.replacedCount}
				onToggleReplaced={props.onToggleReplaced}
			/>
		</div>
	);
}

function MoreMenu({
	showReplaced,
	replacedCount,
	onToggleReplaced,
}: {
	showReplaced: boolean;
	replacedCount: number;
	onToggleReplaced: () => void;
}) {
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		if (!open) return;
		const close = (event: MouseEvent) => {
			if (!ref.current?.contains(event.target as Node)) setOpen(false);
		};
		const onKey = (event: KeyboardEvent) => {
			if (event.key === 'Escape') setOpen(false);
		};
		document.addEventListener('mousedown', close);
		document.addEventListener('keydown', onKey);
		return () => {
			document.removeEventListener('mousedown', close);
			document.removeEventListener('keydown', onKey);
		};
	}, [open]);

	return (
		<div className="more" ref={ref}>
			<button
				type="button"
				className={`ghost-button${showReplaced ? ' active' : ''}`}
				aria-expanded={open}
				aria-haspopup="true"
				onClick={() => setOpen((value) => !value)}
			>
				More
			</button>
			{open ? (
				<div className="more-menu">
					<label className="check">
						<input
							type="checkbox"
							checked={showReplaced}
							onChange={onToggleReplaced}
						/>
						<span>
							Show older versions
							<small>
								{replacedCount > 0
									? `${pluralize(replacedCount, 'memory was', 'memories were')} replaced by a newer version or forgotten`
									: 'Memories Otto replaced with newer ones or forgot'}
							</small>
						</span>
					</label>
				</div>
			) : null}
		</div>
	);
}
