import type { GenericRendererProps } from './types';
import { formatDuration } from './utils';
import {
	ToolHeader,
	ToolHeaderSeparator,
	ToolHeaderMeta,
	ToolHeaderSuccess,
	ToolHeaderError,
} from './shared';

type MemoryRow = {
	id?: string;
	content?: string;
	scope?: string;
	origin?: string;
	source?: string;
};

function asRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

function truncate(value: string, max = 72): string {
	return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function MemoryLine({ memory }: { memory: MemoryRow }) {
	return (
		<div className="flex flex-col gap-0.5 py-1 text-[11px]">
			<div className="flex flex-wrap items-center gap-1.5">
				{memory.scope ? (
					<span className="rounded border border-border px-1 font-mono text-[10px] text-muted-foreground">
						{memory.scope}
					</span>
				) : null}
				{memory.origin ? (
					<span className="rounded border border-border px-1 font-mono text-[10px] text-muted-foreground">
						{memory.origin}
					</span>
				) : null}
				{memory.source ? (
					<span
						className="min-w-0 truncate text-muted-foreground"
						title={memory.source}
					>
						{memory.source}
					</span>
				) : null}
				{memory.id ? (
					<span
						className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground/60"
						title={memory.id}
					>
						{memory.id.slice(0, 8)}
					</span>
				) : null}
			</div>
			{memory.content ? (
				<p className="whitespace-pre-wrap break-words text-foreground/80">
					{memory.content}
				</p>
			) : null}
		</div>
	);
}

export function MemoryToolRenderer({
	contentJson,
	toolDurationMs,
	isExpanded,
	onToggle,
	compact,
	toolName,
}: GenericRendererProps) {
	const name = toolName ?? 'memory';
	const args = asRecord(contentJson.args);
	const result = asRecord(contentJson.result);
	const timeStr = formatDuration(toolDurationMs);
	const toolError =
		typeof contentJson.error === 'string'
			? contentJson.error
			: result.ok === false && typeof result.error === 'string'
				? result.error
				: null;

	let headline = '';
	let outcome: { text: string; ok: boolean } | null = null;
	let memories: MemoryRow[] = [];
	let reason: string | undefined;

	if (name === 'remember') {
		const memory = asRecord(result.memory) as MemoryRow;
		const content =
			typeof args.content === 'string' ? args.content : memory.content;
		headline = content ? truncate(content) : '';
		const status = typeof result.status === 'string' ? result.status : '';
		const persisted = status === 'created' || status === 'updated';
		outcome = status
			? { text: status, ok: persisted || status === 'duplicate' }
			: null;
		reason = typeof result.reason === 'string' ? result.reason : undefined;
		if (memory.content) memories = [memory];
		else if (content)
			memories = [
				{
					content,
					scope: typeof args.scope === 'string' ? args.scope : undefined,
					source: typeof args.source === 'string' ? args.source : undefined,
				},
			];
	} else if (name === 'recall_memory') {
		const query = typeof args.query === 'string' ? args.query : '';
		headline = query ? truncate(query) : '';
		memories = Array.isArray(result.memories)
			? (result.memories as MemoryRow[])
			: [];
		const ranking =
			result.ranking === 'typesafe'
				? 'TypeSafe'
				: result.ranking === 'fts'
					? 'keyword'
					: null;
		outcome = {
			text: `${memories.length} ${memories.length === 1 ? 'match' : 'matches'}${
				ranking ? ` · ${ranking}` : ''
			}`,
			ok: true,
		};
	} else if (name === 'forget_memory') {
		const id = typeof args.id === 'string' ? args.id : '';
		headline = id;
		outcome =
			result.forgotten === true
				? { text: 'forgotten', ok: true }
				: { text: 'not found', ok: false };
	}

	const hasError = Boolean(toolError) || outcome?.ok === false;
	const canExpand =
		memories.length > 0 || Boolean(reason) || Boolean(toolError);

	return (
		<div className="text-[12px]">
			<ToolHeader
				toolName={name}
				isExpanded={isExpanded}
				onToggle={onToggle}
				isError={Boolean(toolError)}
				colorVariant="cyan"
				canExpand={canExpand}
			>
				{!compact && headline && (
					<>
						<ToolHeaderSeparator />
						<span className="max-w-[280px] truncate font-mono text-[11px] text-foreground/60">
							{headline}
						</span>
					</>
				)}
				{!compact && outcome && (
					<>
						<ToolHeaderSeparator />
						{hasError ? (
							<ToolHeaderError>{outcome.text}</ToolHeaderError>
						) : (
							<ToolHeaderSuccess>{outcome.text}</ToolHeaderSuccess>
						)}
					</>
				)}
				{!compact && (
					<>
						<ToolHeaderSeparator />
						<ToolHeaderMeta>{timeStr}</ToolHeaderMeta>
					</>
				)}
			</ToolHeader>

			{isExpanded && (
				<div className="mt-1.5 ml-5 flex flex-col divide-y divide-border/40">
					{toolError ? (
						<p className="py-1 text-[11px] text-red-600 dark:text-red-400">
							{toolError}
						</p>
					) : null}
					{reason ? (
						<p className="py-1 text-[11px] text-muted-foreground">{reason}</p>
					) : null}
					{memories.map((memory, index) => (
						<MemoryLine key={memory.id ?? `memory-${index}`} memory={memory} />
					))}
				</div>
			)}
		</div>
	);
}
