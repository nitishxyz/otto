import { motion } from 'motion/react';
import type { ReactNode } from 'react';
import { StableSpinner } from '../ui/StableSpinner';

export interface ChangeCount {
	additions: number;
	removals: number;
}

export type ViewerStatusTone =
	| 'neutral'
	| 'read'
	| 'write'
	| 'patch'
	| 'success'
	| 'error';

export function countLineTones(
	lineTones:
		| Map<number, 'add' | 'remove'>
		| Array<[number, 'add' | 'remove']>
		| undefined,
): ChangeCount {
	let additions = 0;
	let removals = 0;
	for (const [, tone] of lineTones ?? []) {
		if (tone === 'add') additions += 1;
		else removals += 1;
	}
	return { additions, removals };
}

export function normalizeChangeCount(
	count: ChangeCount,
): ChangeCount | undefined {
	return count.additions > 0 || count.removals > 0 ? count : undefined;
}

function patchPathMatches(patchPath: string, targetPath: string): boolean {
	const normalize = (path: string) =>
		path
			.trim()
			.replace(/^a\//, '')
			.replace(/^b\//, '')
			.replace(/^\.\//, '')
			.replace(/\/+/g, '/')
			.replace(/\/+$/, '');
	const normalizedPatch = normalize(patchPath);
	const normalizedTarget = normalize(targetPath);
	return (
		normalizedPatch === normalizedTarget ||
		normalizedPatch.endsWith(`/${normalizedTarget}`) ||
		normalizedTarget.endsWith(`/${normalizedPatch}`)
	);
}

export function countPatchTextChanges(
	patch: string | undefined,
	targetPath: string | undefined,
): ChangeCount | undefined {
	if (!patch) return undefined;
	const count = { additions: 0, removals: 0 };
	let activeFile = true;
	let envelopeMode: 'find' | 'with' | null = null;
	for (const line of patch.split('\n')) {
		const fileDirective = line.match(
			/^\*\*\* (?:Update|Add|Delete|Replace in|Delete Lines in|Replace Lines in|Insert Before in|Insert After in): (.+)$/,
		);
		if (fileDirective?.[1] && targetPath) {
			activeFile = patchPathMatches(fileDirective[1], targetPath);
			envelopeMode = null;
			continue;
		}

		if (!activeFile) continue;
		if (line.startsWith('*** Find:')) {
			envelopeMode = 'find';
			continue;
		}
		if (line.startsWith('*** With:')) {
			envelopeMode = 'with';
			continue;
		}
		if (line.startsWith('*** ')) {
			envelopeMode = null;
			continue;
		}

		if (envelopeMode === 'find') {
			count.removals += 1;
			continue;
		}
		if (envelopeMode === 'with') {
			count.additions += 1;
			continue;
		}

		if (line.startsWith('+++') || line.startsWith('---')) continue;
		if (line.startsWith('+')) count.additions += 1;
		else if (line.startsWith('-')) count.removals += 1;
	}
	return normalizeChangeCount(count);
}

const DIGIT_KEYS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];

function SlotDigit({ value }: { value: number }) {
	return (
		<span
			className="relative inline-block overflow-hidden tabular-nums leading-none"
			style={{ height: '1em', width: '0.62em' }}
		>
			<motion.span
				className="absolute left-0 top-0 flex w-full flex-col items-center"
				animate={{ y: `-${value}em` }}
				transition={{ type: 'spring', stiffness: 320, damping: 32 }}
				style={{ height: '10em' }}
			>
				{DIGIT_KEYS.map((digit) => (
					<span
						key={digit}
						className="flex w-full items-center justify-center"
						style={{ height: '1em', lineHeight: '1em' }}
					>
						{digit}
					</span>
				))}
			</motion.span>
		</span>
	);
}

export function AnimatedSignedCount({
	prefix,
	value,
	className,
}: {
	prefix: '+' | '-';
	value: number;
	className: string;
}) {
	const safeValue = Math.max(0, value);
	const digits = String(safeValue).split('').map(Number);
	return (
		<span className={`${className} inline-flex items-center leading-none`}>
			<span className="mr-px">{prefix}</span>
			{digits.map((digit, index) => {
				const place = digits.length - 1 - index;
				return <SlotDigit key={`${prefix}-${place}`} value={digit} />;
			})}
		</span>
	);
}

export function ChangeCountSlot({ count }: { count: ChangeCount }) {
	return (
		<div
			className="inline-flex shrink-0 items-center gap-2 rounded-full border border-sidebar-border/70 bg-background/70 px-2 py-0.5 font-mono text-[11px] shadow-sm"
			title={`${count.additions} additions, ${count.removals} removals`}
		>
			<AnimatedSignedCount
				prefix="+"
				value={count.additions}
				className="inline-flex font-semibold text-emerald-600 dark:text-emerald-300"
			/>
			<AnimatedSignedCount
				prefix="-"
				value={count.removals}
				className="inline-flex font-semibold text-red-600 dark:text-red-300"
			/>
		</div>
	);
}

export function InlineChangeCount({
	count,
	className,
}: {
	count: ChangeCount;
	className?: string;
}) {
	return (
		<span
			className={`inline-flex shrink-0 items-center gap-1.5 font-mono ${className ?? ''}`}
			title={`${count.additions} additions, ${count.removals} removals`}
		>
			<AnimatedSignedCount
				prefix="+"
				value={count.additions}
				className="inline-flex font-semibold text-emerald-600 dark:text-emerald-400"
			/>
			<AnimatedSignedCount
				prefix="-"
				value={count.removals}
				className="inline-flex font-semibold text-red-600 dark:text-red-400"
			/>
		</span>
	);
}

const TONE_CLASSES: Record<ViewerStatusTone, string> = {
	neutral:
		'border-sidebar-border bg-muted/30 text-muted-foreground dark:text-muted-foreground',
	read: 'border-sidebar-border bg-blue-500/10 text-blue-700 dark:text-blue-300',
	write:
		'border-sidebar-border bg-blue-500/10 text-blue-700 dark:text-blue-300',
	patch:
		'border-sidebar-border bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
	success:
		'border-sidebar-border bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
	error: 'border-sidebar-border bg-red-500/10 text-red-700 dark:text-red-300',
};

interface ViewerStatusBarProps {
	label?: string;
	path: string;
	tone?: ViewerStatusTone;
	changeCount?: ChangeCount;
	showSpinner?: boolean;
	spinnerTitle?: string;
	leading?: ReactNode;
	trailing?: ReactNode;
}

export function ViewerStatusBar({
	label,
	path,
	tone = 'neutral',
	changeCount,
	showSpinner,
	spinnerTitle,
	leading,
	trailing,
}: ViewerStatusBarProps) {
	return (
		<div
			className={`shrink-0 border-t px-3 py-1.5 text-[12px] ${TONE_CLASSES[tone]}`}
		>
			<div className="flex w-full min-w-0 items-center gap-2 overflow-hidden pr-1">
				{showSpinner && (
					<StableSpinner size="xs" title={spinnerTitle ?? label ?? 'Working'} />
				)}
				{leading}
				{label && <span className="shrink-0">{label}</span>}
				{label && <span className="shrink-0 opacity-60">·</span>}
				<span className="min-w-0 flex-1 truncate font-mono" title={path}>
					{path}
				</span>
				{trailing}
				{changeCount && <ChangeCountSlot count={changeCount} />}
			</div>
		</div>
	);
}
