import { memo, useState } from 'react';
import { BookMarked, ChevronDown, ChevronRight } from 'lucide-react';
import {
	formatMemorySummaryLabel,
	isPersistedWrite,
	type MemoryRecallEntry,
	type MemoryScope,
	type MemoryTurnSummary,
	type MemoryWriteEntry,
	type MemoryWriteStatus,
} from './memoryTurnModel';
import { useIsCompactThread } from './threadDensity';

const SCOPE_CLASS: Record<MemoryScope, string> = {
	global: 'border-violet-500/30 text-violet-700 dark:text-violet-300',
	project: 'border-cyan-500/30 text-cyan-700 dark:text-cyan-300',
	session: 'border-border text-muted-foreground',
};

const STATUS_LABEL: Record<MemoryWriteStatus, string> = {
	created: 'saved',
	updated: 'updated',
	duplicate: 'duplicate',
	rejected: 'rejected',
	unavailable: 'unavailable',
	skipped: 'skipped',
	forgotten: 'forgotten',
	not_found: 'not found',
};

function statusClass(status: MemoryWriteStatus): string {
	if (isPersistedWrite(status) || status === 'forgotten') {
		return 'border-emerald-500/30 text-emerald-700 dark:text-emerald-300';
	}
	if (
		status === 'rejected' ||
		status === 'unavailable' ||
		status === 'not_found'
	) {
		return 'border-amber-500/30 text-amber-700 dark:text-amber-300';
	}
	return 'border-border text-muted-foreground';
}

function Badge({
	children,
	className = '',
	title,
}: {
	children: string;
	className?: string;
	title?: string;
}) {
	return (
		<span
			title={title}
			className={`inline-flex shrink-0 items-center rounded border px-1 py-px font-mono text-[10px] leading-4 ${className}`}
		>
			{children}
		</span>
	);
}

const RecallRow = memo(function RecallRow({
	entry,
}: {
	entry: MemoryRecallEntry;
}) {
	return (
		<li
			className={`flex min-w-0 flex-col gap-0.5 py-1 ${
				entry.injected ? '' : 'opacity-60'
			}`}
		>
			<div className="flex min-w-0 items-center gap-1.5">
				<Badge className={SCOPE_CLASS[entry.scope]}>{entry.scope}</Badge>
				<Badge
					className={
						entry.injected
							? 'border-emerald-500/30 text-emerald-700 dark:text-emerald-300'
							: 'border-border text-muted-foreground'
					}
					title={
						entry.injected
							? 'Placed in the prompt for this turn'
							: 'Matched the search but was not placed in the prompt'
					}
				>
					{entry.injected ? 'injected' : 'retrieved only'}
				</Badge>
				{entry.source ? (
					<span
						className="min-w-0 truncate text-[11px] text-muted-foreground"
						title={entry.source}
					>
						{entry.source}
					</span>
				) : null}
			</div>
			<p className="whitespace-pre-wrap break-words text-[12px] leading-relaxed text-foreground/85">
				{entry.content}
			</p>
		</li>
	);
});

const WriteRow = memo(function WriteRow({
	entry,
}: {
	entry: MemoryWriteEntry;
}) {
	const persisted = isPersistedWrite(entry.status);
	const scope = entry.memory?.scope ?? entry.scope;
	return (
		<li
			className={`flex min-w-0 flex-col gap-0.5 py-1 ${
				persisted || entry.status === 'forgotten' ? '' : 'opacity-70'
			}`}
		>
			<div className="flex min-w-0 flex-wrap items-center gap-1.5">
				<Badge className={statusClass(entry.status)}>
					{STATUS_LABEL[entry.status]}
				</Badge>
				{scope ? <Badge className={SCOPE_CLASS[scope]}>{scope}</Badge> : null}
				<Badge
					className="border-border text-muted-foreground"
					title={
						entry.origin === 'explicit'
							? 'Requested through a memory tool call'
							: 'Proposed by automatic capture from the user message'
					}
				>
					{entry.origin === 'explicit' ? 'tool call' : 'auto-capture'}
				</Badge>
				{entry.source ? (
					<span
						className="min-w-0 truncate text-[11px] text-muted-foreground"
						title={entry.source}
					>
						{entry.source}
					</span>
				) : null}
			</div>
			<p
				className={`whitespace-pre-wrap break-words text-[12px] leading-relaxed ${
					entry.status === 'forgotten' || entry.status === 'not_found'
						? 'font-mono text-muted-foreground'
						: 'text-foreground/85'
				}`}
			>
				{entry.memory?.content ?? entry.content}
			</p>
			{entry.reason ? (
				<p className="text-[11px] text-muted-foreground">{entry.reason}</p>
			) : null}
		</li>
	);
});

function SectionTitle({ children }: { children: string }) {
	return (
		<div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
			{children}
		</div>
	);
}

interface MemoryActivityProps {
	summary: MemoryTurnSummary;
	showLine: boolean;
	compact?: boolean;
}

/** Compact per-turn strip: `Used 2 memories · Saved 1`, expandable to details. */
export const MemoryActivity = memo(function MemoryActivity({
	summary,
	showLine,
	compact,
}: MemoryActivityProps) {
	const isCompactThread = useIsCompactThread();
	const isCompact = Boolean(compact || isCompactThread);
	const [expanded, setExpanded] = useState(false);
	const label = formatMemorySummaryLabel(summary);
	const rankingHint =
		summary.recall?.ranking === 'typesafe'
			? 'TypeSafe ranked'
			: summary.recall?.ranking === 'fts'
				? 'keyword ranked'
				: null;

	return (
		<div
			className={`flex ${isCompact ? 'gap-1.5' : 'gap-3'} pb-2 relative max-w-full overflow-hidden`}
		>
			<div
				className={`flex-shrink-0 ${isCompact ? 'w-4' : 'w-6'} flex items-start justify-center relative pt-0.5`}
			>
				<div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full relative bg-background">
					<BookMarked className="h-4 w-4 text-teal-600 dark:text-teal-300" />
				</div>
				{showLine && (
					<div
						className="absolute left-1/2 -translate-x-1/2 w-[2px] bg-border z-0"
						style={{ top: '1.25rem', bottom: '-0.5rem' }}
					/>
				)}
			</div>

			<div className="flex-1 min-w-0 pt-0.5">
				<button
					type="button"
					onClick={() => setExpanded((value) => !value)}
					aria-expanded={expanded}
					className={`flex w-full min-w-0 items-center gap-1.5 text-left text-foreground transition-colors hover:text-foreground/80 ${
						isCompact ? 'text-[12px]' : 'text-xs'
					}`}
				>
					{expanded ? (
						<ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
					) : (
						<ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
					)}
					<span className="min-w-0 truncate" title={label}>
						{label}
					</span>
					{rankingHint ? (
						<span className="shrink-0 text-muted-foreground/70">
							· {rankingHint}
						</span>
					) : null}
				</button>

				{expanded && (
					<div className="mt-1.5 flex flex-col gap-2 rounded-lg border border-border/60 bg-muted/20 px-3 py-2">
						{summary.recall && summary.recall.entries.length > 0 ? (
							<div>
								<SectionTitle>Recalled into context</SectionTitle>
								{summary.recall.query ? (
									<p
										className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground"
										title={summary.recall.query}
									>
										query: {summary.recall.query}
									</p>
								) : null}
								<ul className="divide-y divide-border/40">
									{summary.recall.entries.map((entry) => (
										<RecallRow key={entry.id} entry={entry} />
									))}
								</ul>
							</div>
						) : null}
						{summary.writes.length > 0 ? (
							<div>
								<SectionTitle>Written from this turn</SectionTitle>
								<ul className="divide-y divide-border/40">
									{summary.writes.map((entry) => (
										<WriteRow key={entry.key} entry={entry} />
									))}
								</ul>
							</div>
						) : null}
					</div>
				)}
			</div>
		</div>
	);
});
