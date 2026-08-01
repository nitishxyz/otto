import { useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import {
	ACCENT_CAST_BORDER,
	ACCENT_FILL,
	cn,
	NEO_RADIUS,
	NeoEmptyState,
	type NeoAccent,
} from './neopop';
import { GROW_MS, GROW_TRANSITION, growDelay, useGrow } from './useGrow';

/**
 * One row of any ranked breakdown. Panels only have to map their aggregate
 * into this shape, so adding a new dimension (agents, tools, sessions…) is a
 * mapping function rather than a new list component.
 */
export interface BreakdownItem {
	key: string;
	label: string;
	sublabel?: ReactNode;
	icon?: ReactNode;
	/** Badge/tag rendered under the value, e.g. the credential type. */
	metaLabel?: ReactNode;
	value: number;
	valueLabel: string;
	title?: string;
}

export interface NeoRowBarProps {
	pct: number;
	accent: NeoAccent;
	/** When false the fill renders at zero width so it can transition open. */
	grown?: boolean;
	delayMs?: number;
	className?: string;
}

/**
 * Hard-edged proportional bar. The track owns the 2px edge and the fill sits
 * inside it, so a full-width bar can never paint past the row.
 */
export function NeoRowBar({
	pct,
	accent,
	grown = true,
	delayMs = 0,
	className,
}: NeoRowBarProps) {
	const width = grown ? Math.max(pct > 0 ? 2 : 0, Math.min(100, pct)) : 0;
	return (
		<div
			className={cn(
				'h-2 w-full overflow-hidden border-2 border-[rgb(var(--np-edge))] bg-background',
				NEO_RADIUS,
				className,
			)}
		>
			<div
				className={cn('h-full', ACCENT_FILL[accent])}
				style={{
					width: `${width}%`,
					transition: `width ${GROW_MS}ms ${GROW_TRANSITION} ${delayMs}ms`,
				}}
			/>
		</div>
	);
}

function RowBody({
	item,
	pct,
	accent,
	grown,
	delayMs,
}: {
	item: BreakdownItem;
	pct: number;
	accent: NeoAccent;
	grown: boolean;
	delayMs: number;
}) {
	return (
		<>
			<div className="flex items-center gap-2.5">
				{item.icon && (
					<span
						className={cn(
							'flex size-7 shrink-0 items-center justify-center border-2 bg-background',
							NEO_RADIUS,
							'border-[rgb(var(--np-edge))]',
						)}
					>
						{item.icon}
					</span>
				)}
				<div className="min-w-0 flex-1">
					<p className="truncate text-[13px] font-medium leading-tight">
						{item.label}
					</p>
					{item.sublabel && (
						<p className="mt-0.5 truncate text-[11px] leading-tight tabular-nums text-muted-foreground">
							{item.sublabel}
						</p>
					)}
				</div>
				<div className="shrink-0 text-right tabular-nums">
					<p className="text-[13px] font-semibold leading-tight">
						{item.valueLabel}
					</p>
					{item.metaLabel && (
						<p className="mt-0.5 text-[11px] leading-tight text-muted-foreground">
							{item.metaLabel}
						</p>
					)}
				</div>
			</div>
			{/* Padding on the wrapper, never a margin on the bar: a `w-full` bar
			    with a left margin overflows its row by exactly that margin. */}
			<div className={cn('mt-2', item.icon && 'pl-[38px]')}>
				<NeoRowBar pct={pct} accent={accent} grown={grown} delayMs={delayMs} />
			</div>
		</>
	);
}

export interface BreakdownListProps {
	items: BreakdownItem[];
	emptyLabel: string;
	/** Rows shown before the "show all" affordance. */
	limit?: number;
	/** Fill colour for every bar in the list. */
	accent?: NeoAccent;
	/** Replays the grow-in when the sort or filter behind the list changes. */
	resetKey?: string;
	selectedKey?: string | null;
	onSelect?: (key: string) => void;
}

export function BreakdownList({
	items,
	emptyLabel,
	limit,
	accent = 'blue',
	resetKey,
	selectedKey,
	onSelect,
}: BreakdownListProps) {
	const [expanded, setExpanded] = useState(false);
	const grown = useGrow(`${resetKey ?? ''}:${expanded}`);

	if (items.length === 0) return <NeoEmptyState>{emptyLabel}</NeoEmptyState>;

	const max = items.reduce((m, item) => Math.max(m, item.value), 0);
	const visible = limit && !expanded ? items.slice(0, limit) : items;
	const hidden = items.length - visible.length;

	return (
		<div>
			<ul className="space-y-1">
				{visible.map((item, index) => {
					const selected = selectedKey === item.key;
					const pct = max > 0 ? (item.value / max) * 100 : 0;
					const rowClass = cn(
						'block w-full border-2 px-2.5 py-2 text-left transition-colors duration-100',
						NEO_RADIUS,
						selected
							? cn('bg-muted/60', ACCENT_CAST_BORDER[accent])
							: 'border-transparent',
						onSelect && !selected && 'hover:bg-muted/40',
					);
					const body = (
						<RowBody
							item={item}
							pct={pct}
							accent={accent}
							grown={grown}
							delayMs={growDelay(index, visible.length)}
						/>
					);
					return (
						<li key={item.key}>
							{onSelect ? (
								<button
									type="button"
									onClick={() => onSelect(item.key)}
									aria-pressed={selected}
									title={item.title}
									className={rowClass}
								>
									{body}
								</button>
							) : (
								<div title={item.title} className={rowClass}>
									{body}
								</div>
							)}
						</li>
					);
				})}
			</ul>
			{limit && items.length > limit && (
				<button
					type="button"
					onClick={() => setExpanded((value) => !value)}
					className={cn(
						'mt-2.5 flex w-full items-center justify-center gap-1.5 border-2 border-dashed py-1.5',
						'border-[rgb(var(--np-edge)/0.5)] text-[11px] font-semibold uppercase tracking-[0.12em]',
						'text-muted-foreground hover:border-[rgb(var(--np-edge))] hover:text-foreground',
						NEO_RADIUS,
					)}
				>
					<ChevronDown
						className={cn(
							'size-3 transition-transform duration-150',
							expanded && 'rotate-180',
						)}
					/>
					{expanded ? 'Show less' : `Show ${hidden} more`}
				</button>
			)}
		</div>
	);
}
