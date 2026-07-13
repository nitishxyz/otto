import type { ReactNode } from 'react';
import { ArrowLeft, ChevronRight, Plus } from 'lucide-react';
import { Button } from '../ui/Button';

export const entityInputClass =
	'h-8 w-full rounded-md border border-border bg-background px-2.5 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/50 focus:border-primary';

export const entityMonoInputClass = `${entityInputClass} font-mono text-[13px]`;

export const entitySelectClass =
	'h-8 w-full appearance-none rounded-md border border-border bg-background px-2.5 pr-8 text-sm text-foreground outline-none transition-colors focus:border-primary';

interface SegmentedControlProps<T extends string> {
	value: T;
	options: ReadonlyArray<{ value: T; label: string }>;
	onChange: (value: T) => void;
}

export function SegmentedControl<T extends string>({
	value,
	options,
	onChange,
}: SegmentedControlProps<T>) {
	return (
		<div className="inline-flex h-7 items-center rounded-md bg-muted/70 p-0.5">
			{options.map((option) => (
				<button
					key={option.value}
					type="button"
					onClick={() => onChange(option.value)}
					className={`h-6 rounded-[5px] px-2.5 text-xs font-medium transition-colors ${
						value === option.value
							? 'bg-background text-foreground shadow-sm'
							: 'text-muted-foreground hover:text-foreground'
					}`}
				>
					{option.label}
				</button>
			))}
		</div>
	);
}

interface EntityListPageProps {
	toolbar: ReactNode;
	createLabel?: string;
	onCreate?: () => void;
	hint?: string;
	children: ReactNode;
}

export function EntityListPage({
	toolbar,
	createLabel,
	onCreate,
	hint,
	children,
}: EntityListPageProps) {
	return (
		<div className="flex h-full min-h-0 flex-col">
			<div
				className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border/60 px-4 py-3 sm:pl-5 sm:pr-12"
				title={hint}
			>
				<div className="flex min-w-0 items-center gap-3">{toolbar}</div>
				{createLabel && onCreate ? (
					<Button
						size="sm"
						onClick={onCreate}
						className="h-7 shrink-0 gap-1 px-2.5 text-xs"
					>
						<Plus className="h-3.5 w-3.5" /> {createLabel}
					</Button>
				) : null}
			</div>
			<div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
		</div>
	);
}

export function EntityListGroup({ children }: { children: ReactNode }) {
	return (
		<div className="divide-y divide-border/50 border-b border-border/50">
			{children}
		</div>
	);
}

interface EntityRowProps {
	onClick: () => void;
	title: ReactNode;
	badge?: ReactNode;
	description?: ReactNode;
	meta?: ReactNode;
	warning?: ReactNode;
	end?: ReactNode;
}

export function EntityRow({
	onClick,
	title,
	badge,
	description,
	meta,
	warning,
	end,
}: EntityRowProps) {
	return (
		<button
			type="button"
			onClick={onClick}
			className="group flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-muted/40"
		>
			<div className="min-w-0 flex-1">
				<div className="flex items-center gap-2">
					<span className="truncate text-[13px] font-medium text-foreground">
						{title}
					</span>
					{badge ? (
						<span className="shrink-0 rounded border border-border/70 px-1.5 py-px text-[10px] font-medium text-muted-foreground">
							{badge}
						</span>
					) : null}
				</div>
				{warning ? (
					<div className="mt-0.5 text-[11px] text-amber-500">{warning}</div>
				) : null}
				{description ? (
					<p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
						{description}
					</p>
				) : null}
			</div>
			{meta ? (
				<span className="hidden max-w-[180px] shrink-0 truncate font-mono text-[10px] text-muted-foreground/60 sm:block">
					{meta}
				</span>
			) : null}
			{end}
			<ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40 transition-all group-hover:translate-x-0.5 group-hover:text-muted-foreground" />
		</button>
	);
}

interface EntityEmptyStateProps {
	icon: ReactNode;
	title: string;
	description: string;
	actionLabel?: string;
	onAction?: () => void;
}

export function EntityEmptyState({
	icon,
	title,
	description,
	actionLabel,
	onAction,
}: EntityEmptyStateProps) {
	return (
		<div className="flex h-full min-h-[220px] flex-col items-center justify-center px-8 text-center">
			<div className="flex h-9 w-9 items-center justify-center rounded-md bg-muted/70 text-muted-foreground/70">
				{icon}
			</div>
			<p className="mt-3 text-sm font-medium text-foreground">{title}</p>
			<p className="mt-1 max-w-xs text-xs leading-relaxed text-muted-foreground">
				{description}
			</p>
			{actionLabel && onAction ? (
				<Button
					size="sm"
					variant="secondary"
					onClick={onAction}
					className="mt-4 h-7 gap-1 px-2.5 text-xs"
				>
					<Plus className="h-3.5 w-3.5" /> {actionLabel}
				</Button>
			) : null}
		</div>
	);
}

interface EntityEditorProps {
	backLabel: string;
	onBack: () => void;
	title: string;
	subtitle?: ReactNode;
	children: ReactNode;
	footerStart?: ReactNode;
	footerEnd: ReactNode;
}

export function EntityEditor({
	backLabel,
	onBack,
	title,
	subtitle,
	children,
	footerStart,
	footerEnd,
}: EntityEditorProps) {
	return (
		<div className="flex h-full min-h-0 flex-col">
			<div className="flex shrink-0 items-center gap-2.5 border-b border-border/70 px-3 py-2.5 sm:pl-4 sm:pr-12">
				<button
					type="button"
					onClick={onBack}
					title={backLabel}
					aria-label={backLabel}
					className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
				>
					<ArrowLeft className="h-3.5 w-3.5" />
				</button>
				<div className="flex min-w-0 flex-1 items-baseline gap-2">
					<h3 className="truncate text-sm font-semibold text-foreground">
						{title}
					</h3>
					{subtitle ? (
						<span className="hidden truncate text-[11px] text-muted-foreground sm:block">
							{subtitle}
						</span>
					) : null}
				</div>
			</div>
			<div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4 sm:px-5">
				{children}
			</div>
			<div className="flex shrink-0 items-center justify-between gap-2 border-t border-border px-4 py-2.5 sm:px-5">
				<div className="flex items-center gap-1">{footerStart}</div>
				<div className="flex items-center gap-2">{footerEnd}</div>
			</div>
		</div>
	);
}

interface EntityFieldProps {
	id: string;
	label: string;
	hint?: string;
	error?: string;
	children: ReactNode;
}

export function EntityField({
	id,
	label,
	hint,
	error,
	children,
}: EntityFieldProps) {
	return (
		<div className="min-w-0">
			<label className="text-xs font-medium text-muted-foreground" htmlFor={id}>
				{label}
			</label>
			<div className="mt-1">{children}</div>
			{error ? (
				<p className="mt-1 text-[11px] text-red-400">{error}</p>
			) : hint ? (
				<p className="mt-1 text-[11px] text-muted-foreground/60">{hint}</p>
			) : null}
		</div>
	);
}

interface EntityCheckboxProps {
	id: string;
	checked: boolean;
	onChange: (checked: boolean) => void;
	children: ReactNode;
}

export function EntityCheckbox({
	id,
	checked,
	onChange,
	children,
}: EntityCheckboxProps) {
	return (
		<label
			htmlFor={id}
			className="flex items-start gap-2.5 text-xs leading-relaxed text-muted-foreground"
		>
			<input
				id={id}
				type="checkbox"
				checked={checked}
				onChange={(event) => onChange(event.target.checked)}
				className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border-border accent-primary"
			/>
			<span>{children}</span>
		</label>
	);
}
