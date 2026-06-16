import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Terminal, FileEdit, Diff, type LucideIcon } from 'lucide-react';
import type { MessagePart } from '../../types/api';
import {
	extractStreamingMultiEditPreviewEdits,
	type StringEditPreview,
} from '../../hooks/tool-preview-helpers';
import { StableSpinner } from '../ui/StableSpinner';
import { ToolResultRenderer, type ContentJson } from './renderers';
import { useIsCompactThread } from './threadDensity';
import {
	InlineChangeCount,
	countPatchTextChanges,
	normalizeChangeCount,
	type ChangeCount,
} from '../workspace/ViewerStatusBar';

const ANIM_MS = 320;
const EASING = 'cubic-bezier(0.25, 1, 0.5, 1)';
const MAX_SCROLL_H = 140;
const LIVE_TOOL_CONTENT_PREVIEW_CHARS = 8_000;
const COMPLETE_SUMMARY_DELAY_MS = 120;

function getPayload(part: MessagePart): Record<string, unknown> {
	if (part.contentJson && typeof part.contentJson === 'object') {
		return part.contentJson as Record<string, unknown>;
	}
	try {
		if (part.content) {
			const parsed = JSON.parse(part.content);
			if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
				return parsed as Record<string, unknown>;
			}
		}
	} catch {}
	return {};
}

function getStreamedInput(part: MessagePart): string {
	const payload = getPayload(part);
	return typeof payload._streamedInput === 'string'
		? payload._streamedInput
		: '';
}

function getStreamedOutput(part: MessagePart): string {
	const payload = getPayload(part);
	return typeof payload._streamedOutput === 'string'
		? payload._streamedOutput
		: '';
}

function getArgs(part: MessagePart): Record<string, unknown> | undefined {
	const payload = getPayload(part);
	const args = payload?.args;
	if (args && typeof args === 'object' && !Array.isArray(args)) {
		return args as Record<string, unknown>;
	}
	return undefined;
}

function getPatchTarget(patch: string): string | null {
	const match = patch.match(
		/^\*\*\*\s+(?:Update|Add|Delete|Replace in):\s+(.+)$/m,
	);
	return match?.[1]?.trim() || null;
}

const TOOL_CONFIG: Record<
	string,
	{ Icon: LucideIcon; color: string; label: string }
> = {
	shell: { Icon: Terminal, color: 'text-muted-foreground', label: 'Running' },
	bash: { Icon: Terminal, color: 'text-muted-foreground', label: 'Running' },
	write: {
		Icon: FileEdit,
		color: 'text-emerald-600 dark:text-emerald-300',
		label: 'Writing',
	},
	apply_patch: {
		Icon: Diff,
		color: 'text-purple-600 dark:text-purple-300',
		label: 'Patching',
	},
	edit: {
		Icon: FileEdit,
		color: 'text-purple-600 dark:text-purple-300',
		label: 'Editing',
	},
	multiedit: {
		Icon: FileEdit,
		color: 'text-purple-600 dark:text-purple-300',
		label: 'Editing',
	},
	copy_into: {
		Icon: FileEdit,
		color: 'text-purple-600 dark:text-purple-300',
		label: 'Copying',
	},
	terminal: {
		Icon: Terminal,
		color: 'text-amber-600 dark:text-amber-300',
		label: 'Terminal',
	},
};

function normalizeToolName(toolName: string): string {
	return toolName === 'bash' ? 'shell' : toolName;
}

function isShellTool(toolName: string): boolean {
	return normalizeToolName(toolName) === 'shell';
}

function formatCopyIntoTarget(sourcePath: string, targetPath: string): string {
	if (sourcePath && targetPath) return `${sourcePath} → ${targetPath}`;
	return targetPath || sourcePath;
}

function getTargetFromArgs(
	toolName: string,
	args: Record<string, unknown> | undefined,
): string {
	if (!args) return '';
	if (isShellTool(toolName)) {
		const cmd = String(args.cmd || '');
		return cmd.length > 80 ? `${cmd.slice(0, 77)}…` : cmd;
	}
	if (toolName === 'write') return String(args.path || '');
	if (toolName === 'edit' || toolName === 'multiedit')
		return String(args.path || '');
	if (toolName === 'copy_into') {
		return formatCopyIntoTarget(
			String(args.sourcePath || ''),
			String(args.targetPath || ''),
		);
	}
	if (toolName === 'apply_patch') {
		const patch = String(args.patch || '');
		return getPatchTarget(patch) || '';
	}
	return '';
}

function getTargetFromStream(toolName: string, raw: string): string {
	if (isShellTool(toolName)) {
		const cmd = extractJsonStringField(raw, 'cmd');
		if (cmd) {
			return cmd.length > 80 ? `${cmd.slice(0, 77)}…` : cmd;
		}
	}
	if (toolName === 'write') {
		return (
			extractJsonStringField(raw, 'path') ||
			extractJsonStringField(raw, 'filePath')
		);
	}
	if (toolName === 'edit' || toolName === 'multiedit') {
		return extractJsonStringField(raw, 'path');
	}
	if (toolName === 'copy_into') {
		return formatCopyIntoTarget(
			extractJsonStringField(raw, 'sourcePath'),
			extractJsonStringField(raw, 'targetPath'),
		);
	}
	if (toolName === 'apply_patch') {
		const m = raw.match(
			/\*\*\*\s+(?:Update|Add|Delete|Replace in):\s+(.+?)(?:\\n|")/,
		);
		return m ? m[1].trim() : '';
	}
	return '';
}

function getResultContentJson(part: MessagePart): ContentJson {
	try {
		if (part.contentJson && typeof part.contentJson === 'object') {
			return part.contentJson as ContentJson;
		}
		if (typeof part.content === 'string') {
			return JSON.parse(part.content);
		}
	} catch {}
	return {};
}

interface ActionToolBoxProps {
	part: MessagePart;
	showLine: boolean;
	compact?: boolean;
}

export function ActionToolBox({ part, showLine, compact }: ActionToolBoxProps) {
	const isCompactThread = useIsCompactThread();
	const isCompact = Boolean(compact || isCompactThread);
	const contentMeasureRef = useRef<HTMLPreElement>(null);
	const scrollRef = useRef<HTMLDivElement>(null);
	const scrollAnimationRef = useRef<number | null>(null);
	const hoveredRef = useRef(false);
	const previousContentLengthRef = useRef(0);
	const [contentHeight, setContentHeight] = useState(0);
	const toolName = normalizeToolName(part.toolName || '');
	const isComplete = part.type === 'tool_result';
	const config = TOOL_CONFIG[toolName] || {
		Icon: Terminal,
		color: 'text-muted-foreground',
		label: toolName.replace(/_/g, ' '),
	};

	const [showSummary, setShowSummary] = useState(() => isComplete);
	const [latched, setLatched] = useState(() => isComplete);

	const args = getArgs(part);
	const streamedInput = getStreamedInput(part);
	const streamedOutput = getStreamedOutput(part);
	const target =
		getTargetFromArgs(toolName, args) ||
		getTargetFromStream(toolName, streamedInput);
	const streamedContent = getContentFromStream(toolName, streamedInput);
	const rawDisplayContent = isShellTool(toolName)
		? streamedOutput ||
			streamedContent ||
			(args ? getContentFromArgs(toolName, args) : '')
		: args
			? getContentFromArgs(toolName, args)
			: streamedContent;
	const displayContent = getLiveToolContentPreview(toolName, rawDisplayContent);
	const hasDisplayContent = displayContent.trim().length > 0;

	const liveChangeCount: ChangeCount | undefined = (() => {
		if (toolName === 'apply_patch') {
			const patch = String(args?.patch ?? streamedContent ?? '');
			return countPatchTextChanges(patch, target || undefined);
		}
		if (toolName === 'write') {
			const content = String(args?.content ?? streamedContent ?? '');
			if (!content) return undefined;
			return normalizeChangeCount({
				additions: content.length === 0 ? 0 : content.split('\n').length,
				removals: 0,
			});
		}
		return undefined;
	})();

	useEffect(() => {
		if (!isComplete && !latched) {
			setShowSummary(false);
			return;
		}
		if (!latched && isComplete) {
			setLatched(true);
		}
		if (showSummary) return;
		if (!isComplete) return;
		const t = window.setTimeout(
			() => setShowSummary(true),
			COMPLETE_SUMMARY_DELAY_MS,
		);
		return () => window.clearTimeout(t);
	}, [isComplete, showSummary, latched]);

	useLayoutEffect(() => {
		if (!hasDisplayContent) {
			setContentHeight(0);
			return;
		}
		const el = contentMeasureRef.current;
		if (!el || el.textContent !== displayContent) return;
		const nextHeight = Math.min(el.scrollHeight, MAX_SCROLL_H - 12);
		setContentHeight((prev) => (prev === nextHeight ? prev : nextHeight));
	}, [displayContent, hasDisplayContent]);

	useEffect(() => {
		return () => {
			if (scrollAnimationRef.current !== null) {
				window.cancelAnimationFrame(scrollAnimationRef.current);
			}
		};
	}, []);

	useEffect(() => {
		const el = scrollRef.current;

		if (!el || hoveredRef.current) return;
		const nextLength = displayContent.length;
		const naturalHeight = contentMeasureRef.current?.scrollHeight ?? 0;
		const isOverflowing = naturalHeight > contentHeight + 1;
		const targetTop = isOverflowing
			? Math.max(0, naturalHeight - contentHeight)
			: 0;

		if (scrollAnimationRef.current !== null) {
			window.cancelAnimationFrame(scrollAnimationRef.current);
			scrollAnimationRef.current = null;
		}

		if (!isOverflowing) {
			el.scrollTop = 0;
			previousContentLengthRef.current = nextLength;
			return;
		}

		if (nextLength <= previousContentLengthRef.current) {
			el.scrollTop = targetTop;
			previousContentLengthRef.current = nextLength;
			return;
		}

		const startTop = el.scrollTop;
		const distance = targetTop - startTop;
		if (distance <= 1) {
			el.scrollTop = targetTop;
			previousContentLengthRef.current = nextLength;
			return;
		}

		const startTime = performance.now();
		const duration = Math.min(360, Math.max(180, distance * 0.9));
		const tick = (now: number) => {
			const progress = Math.min(1, (now - startTime) / duration);
			const eased = 1 - (1 - progress) ** 3;
			el.scrollTop = startTop + distance * eased;
			if (progress < 1 && !hoveredRef.current) {
				scrollAnimationRef.current = window.requestAnimationFrame(tick);
				return;
			}
			scrollAnimationRef.current = null;
		};

		scrollAnimationRef.current = window.requestAnimationFrame(tick);
		previousContentLengthRef.current = nextLength;
	}, [displayContent, contentHeight]);

	const isLive = !showSummary;

	const resultContentJson = isComplete ? getResultContentJson(part) : null;

	return (
		<div
			className={`flex ${isCompact ? 'gap-1.5' : 'gap-3'} pb-2 relative max-w-full overflow-hidden`}
		>
			<div
				className={`flex-shrink-0 ${isCompact ? 'w-4' : 'w-6'} flex items-start justify-center relative pt-0.5`}
			>
				<div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full relative bg-background">
					<config.Icon className={`h-4 w-4 ${config.color}`} />
				</div>
				{showLine && (
					<div
						className="absolute left-1/2 -translate-x-1/2 w-[2px] bg-border z-0"
						style={{ top: '1.25rem', bottom: '-0.5rem' }}
					/>
				)}
			</div>

			<div className="flex-1 min-w-0 pt-0.5">
				<div
					className="relative rounded-lg overflow-hidden"
					style={{
						border: isLive
							? '1px solid hsl(var(--border) / 0.6)'
							: '1px solid transparent',
						background: isLive ? 'hsl(var(--muted) / 0.2)' : 'transparent',
						padding: isLive ? (isCompact ? '6px 8px' : '8px 12px') : '0px 0px',
						transition: `border ${ANIM_MS}ms ${EASING}, background ${ANIM_MS}ms ${EASING}, padding ${ANIM_MS}ms ${EASING}`,
					}}
				>
					<div
						style={{
							overflow: 'hidden',
							opacity: isLive ? 1 : 0,
							maxHeight: isLive ? `${MAX_SCROLL_H + 28}px` : '0px',
							transition: `opacity ${ANIM_MS}ms ${EASING}, max-height ${ANIM_MS}ms ${EASING}`,
						}}
					>
						<div
							className={`flex items-center gap-2 ${
								isCompact ? 'text-[13px]' : 'text-[14px]'
							} font-medium uppercase tracking-[0.18em] text-muted-foreground/70`}
						>
							<StableSpinner
								size="xs"
								className="flex-shrink-0"
								title={config.label}
							/>
							<span className="flex-shrink-0">{config.label}</span>
							{target && (
								<>
									<span className="text-muted-foreground/40 flex-shrink-0">
										·
									</span>
									<span className="truncate text-foreground/60 normal-case tracking-normal font-normal font-mono">
										{target}
									</span>
								</>
							)}
							{liveChangeCount && (
								<>
									<span className="text-muted-foreground/40 flex-shrink-0">
										·
									</span>
									<InlineChangeCount
										count={liveChangeCount}
										className="text-[11px] tracking-normal normal-case"
									/>
								</>
							)}
							{!args && !streamedContent && !streamedOutput && (
								<span className="text-muted-foreground/50 animate-pulse lowercase tracking-normal font-normal">
									generating…
								</span>
							)}
						</div>

						<div
							style={{
								overflow: 'hidden',
								opacity: hasDisplayContent ? 1 : 0,
								height: hasDisplayContent ? `${contentHeight + 6}px` : '0px',
								transition: `opacity ${ANIM_MS}ms ${EASING}, height ${ANIM_MS}ms ${EASING}`,
							}}
						>
							{displayContent && (
								<div className="pt-1.5">
									<section
										ref={scrollRef}
										className="overflow-y-auto"
										aria-label={`${config.label} content`}
										style={{
											height: `${contentHeight}px`,
											maskImage:
												'linear-gradient(to bottom, transparent 0px, black 20px)',
											WebkitMaskImage:
												'linear-gradient(to bottom, transparent 0px, black 20px)',
										}}
										onMouseEnter={() => {
											hoveredRef.current = true;
										}}
										onMouseLeave={() => {
											hoveredRef.current = false;
										}}
									>
										<pre
											ref={contentMeasureRef}
											className="px-1 pt-2.5 pb-1 text-[12px] leading-relaxed text-foreground/60 font-mono whitespace-pre-wrap break-words"
										>
											{displayContent}
										</pre>
									</section>
								</div>
							)}
						</div>
					</div>

					<div
						className="min-w-0 text-xs"
						style={{
							opacity: showSummary ? 1 : 0,
							maxHeight: showSummary ? '1200px' : '0px',
							overflow: 'hidden',
							transition: `opacity ${ANIM_MS}ms ${EASING}, max-height ${ANIM_MS}ms ${EASING}`,
						}}
					>
						{resultContentJson ? (
							<div className="min-w-0">
								<ToolResultRenderer
									toolName={toolName}
									contentJson={resultContentJson}
									toolDurationMs={part.toolDurationMs ?? undefined}
									debug={false}
									compact={false}
								/>
							</div>
						) : (
							<div className="flex min-w-0 items-center">
								<span
									className="block min-w-0 truncate leading-5 text-foreground"
									title={target || config.label}
								>
									{target ? `${config.label}\u00A0· ${target}` : config.label}
								</span>
							</div>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}

function getContentFromArgs(
	toolName: string,
	args: Record<string, unknown>,
): string {
	if (isShellTool(toolName)) return String(args.cmd || '');
	if (toolName === 'write') return String(args.content || '');
	if (toolName === 'apply_patch') return String(args.patch || '');
	if (toolName === 'edit') return String(args.oldString || '');
	if (toolName === 'multiedit') return getMultiEditContentFromArgs(args);
	if (toolName === 'copy_into') return '';
	return '';
}

function getPatchTextLines(value: string): string[] {
	if (value.length === 0) return [];
	const lines = value.split('\n');
	if (value.endsWith('\n')) lines.pop();
	return lines;
}

function formatMultiEditContent(edits: StringEditPreview[]): string {
	const validEdits = edits.filter(
		(edit) => edit.oldString.length > 0 || edit.newString.length > 0,
	);
	if (validEdits.length === 0) return '';

	const lines: string[] = [];
	for (let index = 0; index < validEdits.length; index += 1) {
		const edit = validEdits[index];
		if (lines.length > 0) lines.push('');
		for (const line of getPatchTextLines(edit.oldString)) {
			lines.push(`-${line}`);
		}
		for (const line of getPatchTextLines(edit.newString)) {
			lines.push(`+${line}`);
		}
	}

	return lines.join('\n');
}

function getMultiEditContentFromArgs(args: Record<string, unknown>): string {
	const rawEdits = Array.isArray(args.edits) ? args.edits : [];
	const edits = rawEdits.flatMap((edit) => {
		if (!edit || typeof edit !== 'object' || Array.isArray(edit)) return [];
		const record = edit as Record<string, unknown>;
		return typeof record.oldString === 'string' &&
			typeof record.newString === 'string'
			? [{ oldString: record.oldString, newString: record.newString }]
			: [];
	});
	return formatMultiEditContent(edits);
}

function extractJsonStringField(raw: string, field: string): string {
	const pattern = new RegExp(`"${field}"\\s*:\\s*"`);
	const m = pattern.exec(raw);
	if (!m) return '';
	const start = m.index + m[0].length;
	let result = '';
	let i = start;
	while (i < raw.length) {
		const decoded = decodeJsonStringChar(raw, i);
		if (decoded) {
			result += decoded.value;
			i = decoded.nextIndex;
		} else if (raw[i] === '"') {
			break;
		} else {
			result += raw[i];
			i += 1;
		}
	}
	return result;
}

function decodeJsonStringChar(
	raw: string,
	index: number,
): { value: string; nextIndex: number } | null {
	if (raw[index] !== '\\' || index + 1 >= raw.length) return null;
	const next = raw[index + 1];
	if (next === 'n') return { value: '\n', nextIndex: index + 2 };
	if (next === 't') return { value: '\t', nextIndex: index + 2 };
	if (next === 'r') return { value: '\r', nextIndex: index + 2 };
	if (next === 'b') return { value: '\b', nextIndex: index + 2 };
	if (next === 'f') return { value: '\f', nextIndex: index + 2 };
	if (next === '"') return { value: '"', nextIndex: index + 2 };
	if (next === '\\') return { value: '\\', nextIndex: index + 2 };
	if (next === '/') return { value: '/', nextIndex: index + 2 };
	if (next === 'u' && index + 5 < raw.length) {
		const hex = raw.slice(index + 2, index + 6);
		if (/^[0-9a-fA-F]{4}$/.test(hex)) {
			return {
				value: String.fromCharCode(Number.parseInt(hex, 16)),
				nextIndex: index + 6,
			};
		}
	}
	return { value: next, nextIndex: index + 2 };
}

function extractJsonStringFieldPreview(raw: string, field: string): string {
	const pattern = new RegExp(`"${field}"\\s*:\\s*"`);
	const m = pattern.exec(raw);
	if (!m) return '';
	const start = m.index + m[0].length;
	if (raw.length - start <= LIVE_TOOL_CONTENT_PREVIEW_CHARS) {
		return extractJsonStringField(raw, field);
	}

	let result = '';
	let i = start;
	while (i < raw.length) {
		const decoded = decodeJsonStringChar(raw, i);
		if (decoded) {
			result += decoded.value;
			i = decoded.nextIndex;
		} else if (raw[i] === '"') {
			break;
		} else {
			result += raw[i];
			i += 1;
		}

		if (result.length > LIVE_TOOL_CONTENT_PREVIEW_CHARS) {
			result = result.slice(-LIVE_TOOL_CONTENT_PREVIEW_CHARS);
		}
	}

	return `… showing latest streamed content only …\n${result}`;
}

function getLiveToolContentPreview(toolName: string, content: string): string {
	if (
		toolName !== 'write' &&
		toolName !== 'apply_patch' &&
		content.length <= LIVE_TOOL_CONTENT_PREVIEW_CHARS
	) {
		return content;
	}

	if (content.length <= LIVE_TOOL_CONTENT_PREVIEW_CHARS) return content;
	return `… showing latest content only …\n${content.slice(
		-LIVE_TOOL_CONTENT_PREVIEW_CHARS,
	)}`;
}

function getContentFromStream(toolName: string, raw: string): string {
	if (!raw) return '';
	if (isShellTool(toolName)) return extractJsonStringField(raw, 'cmd');
	if (toolName === 'write')
		return extractJsonStringFieldPreview(raw, 'content');
	if (toolName === 'apply_patch')
		return extractJsonStringFieldPreview(raw, 'patch');
	if (toolName === 'edit') return extractJsonStringField(raw, 'oldString');
	if (toolName === 'multiedit')
		return formatMultiEditContent(extractStreamingMultiEditPreviewEdits(raw));
	if (toolName === 'copy_into') return '';
	return '';
}
