import type { RendererProps } from './types';

export function ProgressUpdateRenderer({ contentJson }: RendererProps) {
	const result = contentJson.result || {};
	const args = contentJson.args || {};
	const message = String(result.message || args.message || 'Processing...');
	const stage = result.stage
		? String(result.stage)
		: args.stage
			? String(args.stage)
			: undefined;
	const pct = result.pct
		? Number(result.pct)
		: args.pct
			? Number(args.pct)
			: undefined;

	return (
		<div className="flex min-h-5 items-start gap-2 text-sm leading-5 text-violet-700 dark:text-violet-300 animate-pulse">
			{stage && (
				<span className="shrink-0 text-muted-foreground/80">[{stage}]</span>
			)}
			<span className="min-w-0 flex-1">{message}</span>
			{pct !== undefined && (
				<span className="shrink-0 text-muted-foreground/80">({pct}%)</span>
			)}
		</div>
	);
}
