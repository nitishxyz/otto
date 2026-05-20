import { useEffect, useState } from 'react';
import { Terminal } from 'lucide-react';
import { NERD_FONT_FAMILY, loadNerdFont } from '../../../lib/nerd-font';
import type { RendererProps } from './types';
import { formatDuration } from './utils';
import { ToolErrorDisplay } from './ToolErrorDisplay';
import {
	ToolHeader,
	ToolHeaderSeparator,
	ToolHeaderMeta,
	ToolHeaderSuccess,
	ToolContentBox,
} from './shared';

const ANSI_RE =
	/[\x1B\x9B][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nq-uy=><~]/g;
const CONTROL_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

function cleanTerminalOutput(raw: string): string {
	return raw
		.replace(ANSI_RE, '')
		.replace(CONTROL_RE, '')
		.replace(/\\n/g, '\n')
		.replace(/\r\n/g, '\n')
		.replace(/\r/g, '\n');
}

export function TerminalRenderer({
	contentJson,
	toolDurationMs,
	isExpanded,
	onToggle,
	compact,
}: RendererProps) {
	const [, setFontReady] = useState(false);
	useEffect(() => {
		loadNerdFont().then(() => setFontReady(true));
	}, []);

	const result = contentJson.result || {};
	const args = contentJson.args || {};

	const operation = String(args.operation || args.command || '');
	const hasToolError =
		typeof result === 'object' && 'ok' in result && result.ok === false;
	const errorMessage =
		hasToolError && 'error' in result && typeof result.error === 'string'
			? result.error
			: null;
	const errorStack =
		hasToolError && 'stack' in result && typeof result.stack === 'string'
			? result.stack
			: undefined;

	const timeStr = formatDuration(toolDurationMs);

	const terminalId = String(result.terminalId || args.terminalId || '');
	const shortId =
		terminalId.length > 12 ? `${terminalId.slice(0, 12)}…` : terminalId;
	const purpose = String(result.purpose || args.purpose || '');
	const command = String(result.command || args.command || '');

	const renderStartResult = () => {
		const pid = result.pid ? `PID ${result.pid}` : '';
		return (
			<div className="mt-2 ml-5 flex flex-col gap-1 text-xs">
				{command && (
					<div className="flex items-center gap-2 text-foreground/70">
						<Terminal className="h-3 w-3" />
						<code className="font-mono">{command}</code>
					</div>
				)}
				{purpose && <div className="text-muted-foreground/70">{purpose}</div>}
				<div className="flex items-center gap-2 text-muted-foreground/60">
					{shortId && <span className="font-mono">{shortId}</span>}
					{pid && (
						<>
							<span>·</span>
							<span>{pid}</span>
						</>
					)}
				</div>
			</div>
		);
	};

	const renderReadResult = () => {
		const rawOutput = String(result.text || result.output || '');
		const output = cleanTerminalOutput(rawOutput);
		const status = String(result.status || '');
		const exitCode = result.exitCode;
		const lineCount = typeof result.lines === 'number' ? result.lines : 0;

		return (
			<div className="mt-2 ml-5 flex flex-col gap-2 max-w-full">
				<div className="flex items-center gap-2 text-xs text-muted-foreground/70">
					{shortId && <span className="font-mono">{shortId}</span>}
					<span>·</span>
					<span>{lineCount} lines</span>
					<span>·</span>
					<span
						className={
							status === 'running'
								? 'text-emerald-600 dark:text-emerald-400'
								: ''
						}
					>
						{status}
						{status === 'exited' && exitCode !== undefined
							? ` (${exitCode})`
							: ''}
					</span>
				</div>
				{output.trim() && (
					<ToolContentBox
						title="output"
						copyText={output}
						maxHeight="max-h-[30rem]"
					>
						<pre
							className="px-3 py-2 text-xs text-foreground/85 whitespace-pre-wrap break-words overflow-x-auto"
							style={{ fontFamily: NERD_FONT_FAMILY }}
						>
							{output}
						</pre>
					</ToolContentBox>
				)}
			</div>
		);
	};

	const renderListResult = () => {
		const terminals = Array.isArray(result.terminals) ? result.terminals : [];
		const count =
			typeof result.count === 'number' ? result.count : terminals.length;

		return (
			<div className="mt-2 ml-5 flex flex-col gap-1 text-xs">
				<div className="text-muted-foreground/70">
					{count} terminal{count !== 1 ? 's' : ''}
				</div>
				{terminals.slice(0, 8).map((t: Record<string, unknown>, i: number) => (
					<div
						key={String(t.id || i)}
						className="flex items-center gap-2 text-foreground/70 font-mono"
					>
						<span
							className={`h-2 w-2 rounded-full ${t.status === 'running' ? 'bg-emerald-500' : 'bg-muted-foreground/40'}`}
						/>
						<span className="truncate max-w-[100px]">
							{String(t.id || '').slice(0, 12)}
						</span>
						<span className="text-muted-foreground/60 truncate">
							{String(t.purpose || '')}
						</span>
					</div>
				))}
			</div>
		);
	};

	const renderWriteResult = () => {
		const written = String(args.input || '');
		return written ? (
			<div className="mt-2 ml-5 text-xs">
				<code className="font-mono text-foreground/70 whitespace-pre-wrap">
					{written}
				</code>
			</div>
		) : null;
	};

	const label = operation || 'terminal';
	const headerLabel = `terminal ${label}`;
	const hasContent =
		!hasToolError &&
		(operation === 'start' ||
			operation === 'read' ||
			operation === 'list' ||
			(operation === 'write' && (args.input || result.message)));

	return (
		<div className="text-[12px]">
			<ToolHeader
				toolName={headerLabel}
				isExpanded={isExpanded}
				onToggle={onToggle}
				isError={!!hasToolError}
				colorVariant="amber"
				canExpand={!!hasContent || !!hasToolError}
			>
				{!compact && shortId && (
					<>
						<ToolHeaderSeparator />
						<span className="text-foreground/70 font-mono text-[11px]">
							{shortId}
						</span>
					</>
				)}
				{!compact && purpose && !shortId && (
					<>
						<ToolHeaderSeparator />
						<span className="text-foreground/70 text-[11px] truncate max-w-xs">
							{purpose}
						</span>
					</>
				)}
				{!hasToolError && !compact && (
					<>
						<ToolHeaderSeparator />
						<ToolHeaderSuccess>ok</ToolHeaderSuccess>
						<ToolHeaderSeparator />
						<ToolHeaderMeta>{timeStr}</ToolHeaderMeta>
					</>
				)}
				{hasToolError && !compact && (
					<ToolHeaderMeta>· {timeStr}</ToolHeaderMeta>
				)}
			</ToolHeader>

			{isExpanded && hasToolError && errorMessage && (
				<ToolErrorDisplay error={errorMessage} stack={errorStack} showStack />
			)}

			{isExpanded &&
				!hasToolError &&
				operation === 'start' &&
				renderStartResult()}
			{isExpanded &&
				!hasToolError &&
				operation === 'read' &&
				renderReadResult()}
			{isExpanded &&
				!hasToolError &&
				operation === 'list' &&
				renderListResult()}
			{isExpanded &&
				!hasToolError &&
				operation === 'write' &&
				renderWriteResult()}
		</div>
	);
}
