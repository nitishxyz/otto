import {
	Code2,
	ExternalLink,
	ImageIcon,
	ListTree,
	Network,
	TerminalSquare,
} from 'lucide-react';
import type { GenericRendererProps } from './types';
import { formatDuration } from './utils';
import { ToolErrorDisplay } from './ToolErrorDisplay';
import {
	ToolContentBox,
	ToolHeader,
	ToolHeaderError,
	ToolHeaderMeta,
	ToolHeaderSeparator,
	ToolHeaderSuccess,
} from './shared';

const INSPECTION_ACTIONS = new Set([
	'snapshot',
	'html',
	'find',
	'console',
	'network',
	'evaluate',
]);

function getRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function getString(value: unknown): string | null {
	return typeof value === 'string' && value.trim() ? value : null;
}

function getNumber(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function getRecords(value: unknown): Record<string, unknown>[] {
	return Array.isArray(value)
		? value.map(getRecord).filter((item) => item !== null)
		: [];
}

function actionLabel(action: string | null): string {
	switch (action) {
		case 'open':
			return 'opening page';
		case 'navigate':
			return 'navigating';
		case 'back':
			return 'going back';
		case 'forward':
			return 'going forward';
		case 'reload':
			return 'reloading';
		case 'stop':
			return 'stopping load';
		case 'snapshot':
			return 'inspecting page';
		case 'screenshot':
			return 'capturing screenshot';
		case 'wait_for':
			return 'waiting for';
		case 'html':
			return 'reading HTML';
		case 'find':
			return 'finding';
		case 'console':
			return 'reading console';
		case 'network':
			return 'reading network';
		case 'click':
			return 'clicking';
		case 'hover':
			return 'hovering';
		case 'type':
			return 'typing';
		case 'press':
			return 'pressing key';
		case 'scroll':
			return 'scrolling';
		case 'evaluate':
			return 'evaluating script';
		default:
			return action?.replace(/_/g, ' ') || 'browser';
	}
}

function conciseDetail(value: string | null): string | null {
	if (!value) return null;
	return value.length > 120 ? `${value.slice(0, 117)}…` : value;
}

function actionDetail(
	action: string | null,
	args: Record<string, unknown>,
	result: Record<string, unknown>,
): string | null {
	if (action === 'open' || action === 'navigate') {
		return conciseDetail(getString(args.url) ?? getString(result.url));
	}
	if (action === 'find' || action === 'network') {
		return conciseDetail(getString(args.query) ?? getString(result.query));
	}
	if (action === 'wait_for') {
		return conciseDetail(
			getString(args.selector) ??
				getString(args.text) ??
				getString(result.found),
		);
	}
	if (action === 'press') {
		return conciseDetail(getString(args.key) ?? getString(result.key));
	}
	if (action === 'console') {
		return conciseDetail(getString(args.level) ?? getString(result.level));
	}
	if (action === 'evaluate') return conciseDetail(getString(args.script));
	if (action === 'click') {
		return conciseDetail(getString(args.selector) ?? getString(result.clicked));
	}
	if (action === 'hover') {
		return conciseDetail(getString(args.selector) ?? getString(result.hovered));
	}
	if (action === 'type') {
		return conciseDetail(
			getString(args.selector) ?? getString(result.selector),
		);
	}
	return conciseDetail(getString(args.selector) ?? getString(result.url));
}

function safeExternalUrl(value: unknown): string | null {
	const url = getString(value);
	if (!url) return null;
	try {
		const parsed = new URL(url);
		return parsed.protocol === 'http:' || parsed.protocol === 'https:'
			? parsed.toString()
			: null;
	} catch {
		return null;
	}
}

function JsonValue({ value }: { value: unknown }) {
	const text =
		typeof value === 'string' ? value : JSON.stringify(value ?? null, null, 2);
	return (
		<pre className="whitespace-pre-wrap break-words p-3 font-mono text-[11px] text-foreground/80">
			{text}
		</pre>
	);
}

function SnapshotContent({ result }: { result: Record<string, unknown> }) {
	const text = getString(result.text);
	const elements = getRecords(result.elements);
	return (
		<>
			{text && (
				<ToolContentBox
					title="page text"
					icon={<ListTree className="h-3 w-3" />}
					copyText={text}
				>
					<JsonValue value={text} />
				</ToolContentBox>
			)}
			{elements.length > 0 && (
				<ToolContentBox
					title="interactive elements"
					subtitle={`${elements.length} shown`}
				>
					<div className="divide-y divide-border font-mono text-[11px]">
						{elements.map((element, index) => (
							<div
								key={`${getString(element.ref) ?? 'element'}-${index}`}
								className="flex min-w-0 items-start gap-2 px-3 py-1.5"
							>
								<span className="shrink-0 text-blue-600 dark:text-blue-300">
									{getString(element.ref) ?? '—'}
								</span>
								<span className="shrink-0 text-muted-foreground">
									{getString(element.role) ?? 'element'}
								</span>
								<span className="min-w-0 break-words text-foreground/80">
									{getString(element.name) ?? '(unlabelled)'}
								</span>
								{element.disabled === true && (
									<span className="text-amber-600 dark:text-amber-300">
										disabled
									</span>
								)}
							</div>
						))}
					</div>
				</ToolContentBox>
			)}
		</>
	);
}

function InspectionContent({
	action,
	result,
}: {
	action: string | null;
	result: Record<string, unknown>;
}) {
	if (action === 'snapshot') return <SnapshotContent result={result} />;
	if (action === 'html') {
		const html = getString(result.html);
		return html ? (
			<ToolContentBox
				title="HTML"
				icon={<Code2 className="h-3 w-3" />}
				subtitle={result.truncated === true ? 'truncated' : undefined}
				copyText={html}
			>
				<JsonValue value={html} />
			</ToolContentBox>
		) : null;
	}
	if (action === 'find') {
		return (
			<ToolContentBox
				title="matches"
				subtitle={`${getNumber(result.count) ?? 0} found`}
			>
				<JsonValue value={result.matches ?? []} />
			</ToolContentBox>
		);
	}
	if (action === 'console') {
		return (
			<ToolContentBox
				title="console"
				icon={<TerminalSquare className="h-3 w-3" />}
				subtitle={`${getNumber(result.total) ?? 0} messages`}
			>
				<JsonValue value={result.messages ?? []} />
			</ToolContentBox>
		);
	}
	if (action === 'network') {
		return (
			<ToolContentBox
				title="network"
				icon={<Network className="h-3 w-3" />}
				subtitle={`${getNumber(result.failed) ?? 0} failed`}
			>
				<JsonValue value={result.requests ?? []} />
			</ToolContentBox>
		);
	}
	if (action === 'evaluate') {
		return (
			<ToolContentBox
				title="evaluation result"
				icon={<Code2 className="h-3 w-3" />}
			>
				<JsonValue value={result.value} />
			</ToolContentBox>
		);
	}
	return null;
}

function fallbackResult(
	result: Record<string, unknown>,
): Record<string, unknown> {
	const artifact = getRecord(result.artifact);
	return artifact?.data
		? { ...result, artifact: { ...artifact, data: '[image data omitted]' } }
		: result;
}

export function BrowserRenderer({
	contentJson,
	toolDurationMs,
	isExpanded,
	onToggle,
	compact,
}: GenericRendererProps) {
	const args = getRecord(contentJson.args) ?? {};
	const result = getRecord(contentJson.result) ?? {};
	const artifact =
		getRecord(result.artifact) ?? getRecord(contentJson.artifact);
	const action = getString(args.action) ?? getString(result.action);
	const detail = actionDetail(action, args, result);
	const hasError = result.ok === false || Boolean(contentJson.error);
	const error =
		getString(result.error) ??
		getString(contentJson.error) ??
		getString(contentJson.message) ??
		'The browser action failed.';
	const pageUrl = safeExternalUrl(result.url);
	const mediaType = getString(artifact?.mediaType);
	const imageData = getString(artifact?.data);
	const imageSrc =
		imageData && mediaType && /^image\/[a-z0-9.+-]+$/i.test(mediaType)
			? `data:${mediaType};base64,${imageData}`
			: null;
	const hasInspectionContent = action ? INSPECTION_ACTIONS.has(action) : false;
	const hasContent = hasError || Object.keys(result).length > 0;
	const message = getString(result.message);
	const warning = getString(result.warning);
	const hint = getString(result.hint);

	return (
		<div className="text-[12px]">
			<ToolHeader
				toolName="browser"
				isExpanded={isExpanded}
				onToggle={onToggle}
				isError={hasError}
				colorVariant="blue"
				canExpand={hasContent}
			>
				<ToolHeaderSeparator />
				<span className="shrink-0 text-foreground/70">
					{actionLabel(action)}
				</span>
				{detail && (
					<>
						<ToolHeaderSeparator />
						<span className="min-w-0 truncate font-mono text-[11px] text-foreground/60">
							{detail}
						</span>
					</>
				)}
				{!compact && (
					<>
						<ToolHeaderSeparator />
						{hasError ? (
							<ToolHeaderError>error</ToolHeaderError>
						) : (
							<ToolHeaderSuccess>ok</ToolHeaderSuccess>
						)}
						<ToolHeaderSeparator />
						<ToolHeaderMeta>{formatDuration(toolDurationMs)}</ToolHeaderMeta>
					</>
				)}
			</ToolHeader>

			{isExpanded && hasContent && (
				<div className="mt-2 ml-5 flex max-w-full flex-col gap-2">
					{hasError && <ToolErrorDisplay error={error} />}
					{!hasError && imageSrc && (
						<ToolContentBox
							title="browser screenshot"
							icon={<ImageIcon className="h-3 w-3" />}
							subtitle={mediaType ?? undefined}
							maxHeight="max-h-[36rem]"
						>
							<div className="bg-muted/10 p-3">
								<img
									alt={`Browser screenshot${pageUrl ? ` of ${pageUrl}` : ''}`}
									className="max-h-[32rem] max-w-full rounded-md border border-border bg-background object-contain"
									src={imageSrc}
								/>
							</div>
						</ToolContentBox>
					)}
					{!hasError && <InspectionContent action={action} result={result} />}
					{!hasError && !imageSrc && !hasInspectionContent && (
						<ToolContentBox title={`${actionLabel(action)} result`}>
							<JsonValue value={fallbackResult(result)} />
						</ToolContentBox>
					)}
					{result.truncated === true && (
						<div className="text-amber-600 dark:text-amber-300">
							Result truncated at the browser tool limit.
						</div>
					)}
					{warning && (
						<div className="text-amber-600 dark:text-amber-300">{warning}</div>
					)}
					{message && <div className="text-foreground/70">{message}</div>}
					{hint && <div className="text-muted-foreground">{hint}</div>}
					{pageUrl && (
						<a
							href={pageUrl}
							target="_blank"
							rel="noopener noreferrer"
							className="inline-flex min-w-0 items-center gap-1.5 font-mono text-blue-600 hover:underline dark:text-blue-300"
						>
							<ExternalLink className="h-3 w-3 shrink-0" />
							<span className="truncate">{pageUrl}</span>
						</a>
					)}
				</div>
			)}
		</div>
	);
}
