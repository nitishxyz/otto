import type { ReactNode } from 'react';
import { cn } from '../neopop/cn';
import {
	ACCENT_FILL,
	ACCENT_ON,
	RESET_LIST,
	RESET_TEXT,
	type DocAccent,
} from './primitives';

export interface DiagramProps {
	/** Window-chrome label, e.g. `runtime / one daemon, many projects`. */
	label: string;
	/** Right-aligned status text in the chrome bar. */
	status?: string;
	/**
	 * Plain-text rendering used by "Copy as Markdown". Diagrams are layout,
	 * not prose, so they ship their own text form instead of a DOM dump.
	 */
	md?: string;
	children: ReactNode;
	className?: string;
}

/** Boxy window frame that hosts a docs diagram. */
export function Diagram({
	label,
	status,
	md,
	children,
	className,
}: DiagramProps) {
	return (
		<figure
			data-md={md}
			className={cn(
				'my-8 overflow-hidden rounded-[3px] np-edge np-shadow-md bg-otto-bg',
				className,
			)}
		>
			<div className="flex items-center gap-2 border-b-2 border-otto-border bg-otto-card px-3 py-2">
				<span className="h-2.5 w-2.5 shrink-0 bg-np-coral" />
				<span className="h-2.5 w-2.5 shrink-0 bg-np-yellow" />
				<span className="h-2.5 w-2.5 shrink-0 bg-np-lime" />
				<span className="ml-1.5 truncate text-[11px] text-otto-muted">
					{label}
				</span>
				{status ? (
					<span className="ml-auto hidden shrink-0 items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] text-otto-dim sm:flex">
						<span className="h-1.5 w-1.5 bg-np-lime" />
						{status}
					</span>
				) : null}
			</div>
			<div className="np-grid-bg p-4 sm:p-5">{children}</div>
		</figure>
	);
}

export interface DiagramRowProps {
	children: ReactNode;
	/** Column count from `sm` upwards. Stacks on small screens. */
	cols?: 2 | 3 | 4;
	className?: string;
}

const COLS: Record<2 | 3 | 4, string> = {
	2: 'sm:grid-cols-2',
	3: 'sm:grid-cols-2 lg:grid-cols-3',
	4: 'grid-cols-2 lg:grid-cols-4',
};

/** Responsive grid of diagram nodes. */
export function DiagramRow({ children, cols = 3, className }: DiagramRowProps) {
	return (
		<div className={cn('grid gap-3', COLS[cols], className)}>{children}</div>
	);
}

export interface DiagramNodeProps {
	/** Uppercase micro-label in the node header. */
	label: string;
	title: string;
	desc?: string;
	items?: string[];
	accent?: DocAccent;
	/** Renders the node as the emphasised element of the diagram. */
	emphasis?: boolean;
	className?: string;
}

/** Single boxed node inside a diagram. */
export function DiagramNode({
	label,
	title,
	desc,
	items,
	accent = 'neutral',
	emphasis = false,
	className,
}: DiagramNodeProps) {
	return (
		<div
			className={cn(
				'flex flex-col overflow-hidden rounded-[3px] np-edge np-shadow-sm',
				emphasis ? 'bg-otto-card' : 'bg-otto-surface',
				className,
			)}
		>
			<div className="flex items-center gap-2 border-b-2 border-otto-border px-2.5 py-1.5">
				<span className={cn('h-2 w-2 shrink-0', ACCENT_FILL[accent])} />
				<span className="np-eyebrow truncate text-otto-dim">{label}</span>
			</div>
			<div className="px-3 py-2.5">
				<p className={cn('text-[13px] font-bold text-otto-text', RESET_TEXT)}>
					{title}
				</p>
				{desc ? (
					<p
						className={cn(
							'mt-1 text-[12px] leading-relaxed text-otto-muted',
							RESET_TEXT,
						)}
					>
						{desc}
					</p>
				) : null}
				{items?.length ? (
					<ul className={cn('mt-2 space-y-1', RESET_LIST)}>
						{items.map((item) => (
							<li
								key={item}
								className="flex gap-1.5 text-[11px] leading-snug text-otto-dim"
							>
								<span className="text-otto-border-light">▪</span>
								<span>{item}</span>
							</li>
						))}
					</ul>
				) : null}
			</div>
		</div>
	);
}

export interface DiagramFlowProps {
	/** Text on the arrow chip, e.g. `HTTP + SSE`. */
	label?: string;
	accent?: DocAccent;
	className?: string;
}

/** Vertical connector with an arrow chip, used between diagram rows. */
export function DiagramFlow({
	label,
	accent = 'blue',
	className,
}: DiagramFlowProps) {
	return (
		<div
			aria-hidden="true"
			className={cn('flex flex-col items-center py-1', className)}
		>
			<span className="h-2 w-2 bg-np-blue" />
			<span className="h-4 w-0.5 bg-otto-border" />
			<span
				className={cn(
					'flex items-center gap-1.5 rounded-[3px] np-edge np-shadow-sm px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em]',
					ACCENT_ON[accent],
				)}
			>
				<span className="leading-none">↓</span>
				{label ? <span className="leading-none">{label}</span> : null}
			</span>
			<span className="h-4 w-0.5 bg-otto-border" />
			<span className="h-2 w-2 bg-np-blue" />
		</div>
	);
}

export interface DiagramStackProps {
	label: string;
	title: string;
	desc?: string;
	accent?: DocAccent;
	/** Right-aligned tag, e.g. a layer number. */
	tag?: string;
}

/** Layer row used for stacked/dependency diagrams. */
export function DiagramLayer({
	label,
	title,
	desc,
	accent = 'neutral',
	tag,
}: DiagramStackProps) {
	return (
		<div className="flex items-stretch gap-0 overflow-hidden rounded-[3px] np-edge np-shadow-sm bg-otto-surface">
			<span className={cn('w-1.5 shrink-0', ACCENT_FILL[accent])} />
			<div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-3 gap-y-1 px-3 py-2.5">
				<span className="np-eyebrow shrink-0 text-otto-dim">{label}</span>
				<span className="text-[13px] font-bold text-otto-text">{title}</span>
				{desc ? (
					<span className="text-[12px] text-otto-muted">{desc}</span>
				) : null}
				{tag ? (
					<span className="ml-auto shrink-0 text-[10px] uppercase tracking-[0.14em] text-otto-dim">
						{tag}
					</span>
				) : null}
			</div>
		</div>
	);
}
