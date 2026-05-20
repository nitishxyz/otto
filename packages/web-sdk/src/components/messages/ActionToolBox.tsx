import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
	Terminal,
	FileEdit,
	Diff,
	Loader2,
	type LucideIcon,
} from 'lucide-react';
import type { MessagePart } from '../../types/api';
import { ToolResultRenderer, type ContentJson } from './renderers';
import { useIsCompactThread } from './threadDensity';

const ANIM_MS = 320;
const EASING = 'cubic-bezier(0.25, 1, 0.5, 1)';
const MAX_SCROLL_H = 140;

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
	if (toolName === 'copy_into') return String(args.targetPath || '');
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
		return extractJsonStringField(raw, 'targetPath');
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
}

export function ActionToolBox({ part, showLine }: ActionToolBoxProps) {
	const isCompact = useIsCompactThread();
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
	const displayContent = isShellTool(toolName)
		? streamedOutput ||
			streamedContent ||
			(args ? getContentFromArgs(toolName, args) : '')
		: args
			? getContentFromArgs(toolName, args)
			: streamedContent;
	const hasDisplayContent = displayContent.trim().length > 0;

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
		const t = window.setTimeout(() => setShowSummary(true), 500);
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
								isCompact ? 'text-[12px]' : 'text-[13px]'
							} font-medium uppercase tracking-[0.18em] text-muted-foreground/70`}
						>
							<Loader2 className="h-3 w-3 animate-spin flex-shrink-0" />
							<span className="flex-shrink-0">{config.label}</span>
							{target && (
								<>
									<span className="text-muted-foreground/40 flex-shrink-0">
										·
									</span>
									<span className="truncate text-foreground/60 lowercase tracking-normal font-normal font-mono">
										{target}
									</span>
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
											className="px-1 pt-2.5 pb-1 text-[11px] leading-relaxed text-foreground/60 font-mono whitespace-pre-wrap break-all"
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
	if (toolName === 'multiedit') return '';
	if (toolName === 'copy_into') return '';
	return '';
}

function extractJsonStringField(raw: string, field: string): string {
	const pattern = new RegExp(`"${field}"\\s*:\\s*"`);
	const m = pattern.exec(raw);
	if (!m) return '';
	const start = m.index + m[0].length;
	let result = '';
	let i = start;
	while (i < raw.length) {
		if (raw[i] === '\\' && i + 1 < raw.length) {
			const next = raw[i + 1];
			if (next === 'n') result += '\n';
			else if (next === 't') result += '\t';
			else if (next === '"') result += '"';
			else if (next === '\\') result += '\\';
			else result += next;
			i += 2;
		} else if (raw[i] === '"') {
			break;
		} else {
			result += raw[i];
			i += 1;
		}
	}
	return result;
}

function getContentFromStream(toolName: string, raw: string): string {
	if (!raw) return '';
	if (isShellTool(toolName)) return extractJsonStringField(raw, 'cmd');
	if (toolName === 'write') return extractJsonStringField(raw, 'content');
	if (toolName === 'apply_patch') return extractJsonStringField(raw, 'patch');
	if (toolName === 'edit') return extractJsonStringField(raw, 'oldString');
	if (toolName === 'multiedit') return '';
	if (toolName === 'copy_into') return '';
	return '';
}
