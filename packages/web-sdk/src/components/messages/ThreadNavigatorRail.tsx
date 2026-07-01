import { memo, useEffect, useMemo, useRef, useState } from 'react';
import {
	motion,
	useMotionValue,
	useSpring,
	useTransform,
	type MotionValue,
} from 'motion/react';
import type { Message } from '../../types/api';
import { getMessagePartText, isCompactSlashCommand } from './compactionSummary';
import {
	getThreadNavigatorLayout,
	getThreadNavigatorRowHeight,
	type ThreadNavigatorLayout,
} from './threadNavigatorLayout';

interface ThreadNavigatorRailProps {
	messages: Message[];
	onNavigate: (index: number) => void;
	/** Measured thread width (px). Drives compact vs roomy rail layout. */
	threadWidth?: number;
	/** Top inset (px) reserved for visible thread headers. */
	topInset?: number;
	/** Bottom inset (px) reserved for the chat input stack. */
	bottomInset?: number;
}

interface NavTurn {
	/** Index into the filtered messages array to scroll to. */
	index: number;
	title: string;
	preview: string;
}

interface ThreadNavigatorBarProps {
	turn: NavTurn;
	index: number;
	mouseY: MotionValue<number>;
	onHover: (index: number) => void;
	onNavigate: (index: number) => void;
	barMinWidth: number;
	barMaxWidth: number;
	compact: boolean;
	rowHeight: number;
}

const FAR_POINTER_Y = -10000;
const BAR_MIN_HEIGHT = 2;
const BAR_MAX_HEIGHT = 3.5;
const MAX_TURNS = 90;
const NAVIGATOR_TEXT_SCAN_LIMIT = 6000;
const SPRING = { stiffness: 420, damping: 30, mass: 0.35 };
const RAIL_VERTICAL_MARGIN_PX = 28;
const RAIL_SHELL_CLASS_NAME =
	'absolute left-0 flex items-center justify-start z-20 pointer-events-none select-none';

function limitNavigatorSource(text: string): string {
	return text.length > NAVIGATOR_TEXT_SCAN_LIMIT
		? text.slice(0, NAVIGATOR_TEXT_SCAN_LIMIT)
		: text;
}

function getNavigatorPartText(part: NonNullable<Message['parts']>[number]) {
	if (
		part.contentJson &&
		typeof part.contentJson === 'object' &&
		'text' in part.contentJson
	) {
		return limitNavigatorSource(String(part.contentJson.text));
	}

	if (typeof part.content !== 'string') return '';
	if (part.content.length > NAVIGATOR_TEXT_SCAN_LIMIT) {
		return limitNavigatorSource(part.content);
	}

	return limitNavigatorSource(getMessagePartText(part));
}

function getAssistantText(message: Message): string {
	const parts = message.parts ?? [];
	for (const part of parts) {
		if (part.type !== 'text') continue;
		const text = getNavigatorPartText(part).trim();
		if (text) return text;
	}
	for (const part of parts) {
		if (part.type !== 'reasoning') continue;
		const text = getNavigatorPartText(part).trim();
		if (text) return text;
	}
	return '';
}

function getUserText(message: Message): string {
	if (message.role !== 'user') return '';
	const textPart = message.parts?.find((part) => part.type === 'text');
	return textPart ? getNavigatorPartText(textPart) : '';
}

function firstLine(text: string, max = 60): string {
	const line = text.replace(/\s+/g, ' ').trim();
	if (line.length <= max) return line;
	return `${line.slice(0, max - 1)}…`;
}

function snippet(text: string, max = 180): string {
	const clean = cleanNavigatorPreviewText(text);
	if (clean.length <= max) return clean;
	return `${clean.slice(0, max - 1)}…`;
}

function decodeXmlEntities(text: string): string {
	return text
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&amp;/g, '&');
}

function stripXmlTags(text: string): string {
	return decodeXmlEntities(text)
		.replace(/<\/?[\w:-]+\b[^>]*>/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function extractXmlBlock(content: string, tag: string): string {
	return (
		new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`)
			.exec(content)?.[1]
			?.trim() ?? ''
	);
}

function parseXmlAttrs(raw: string): Record<string, string> {
	const attrs: Record<string, string> = {};
	for (const match of raw.matchAll(/([\w:-]+)="([^"]*)"/g)) {
		attrs[match[1]] = decodeXmlEntities(match[2]);
	}
	return attrs;
}

function cleanNavigatorPreviewText(text: string): string {
	const trimmed = limitNavigatorSource(text).trim();
	if (!trimmed) return '';

	try {
		const parsed = JSON.parse(trimmed) as unknown;
		if (parsed && typeof parsed === 'object' && 'text' in parsed) {
			return cleanNavigatorPreviewText(
				String((parsed as { text: unknown }).text),
			);
		}
	} catch {
		// Plain text or XML-ish payload.
	}

	return stripXmlTags(trimmed);
}

function summarizeSubagentResults(content: string): NavTurn | null {
	const results: Array<{
		agent: string;
		status: string;
		task: string;
		result: string;
	}> = [];
	for (const match of content.matchAll(
		/<subagent_result\b([^>]*)>([\s\S]*?)<\/subagent_result>/g,
	)) {
		const attrs = parseXmlAttrs(match[1] ?? '');
		const body = match[2] ?? '';
		results.push({
			agent: attrs.agent ?? 'sub-agent',
			status: attrs.status ?? 'completed',
			task: extractXmlBlock(body, 'task'),
			result: extractXmlBlock(body, 'result'),
		});
	}

	if (!results.length) return null;
	if (results.length === 1) {
		const result = results[0];
		return {
			index: 0,
			title: `${result.agent} ${result.status}`,
			preview: snippet(
				result.result || result.task || 'Sub-agent result received',
			),
		};
	}

	return {
		index: 0,
		title: `Sub-agent results (${results.length})`,
		preview: results
			.map(
				(result) =>
					`${result.agent}: ${firstLine(
						cleanNavigatorPreviewText(result.result || result.task),
						72,
					)}`,
			)
			.join(' • '),
	};
}

function summarizeTaggedUserMessage(
	content: string,
): Omit<NavTurn, 'index'> | null {
	const trimmed = limitNavigatorSource(content).trimStart();
	if (trimmed.startsWith('<subagent_results>')) {
		const summary = summarizeSubagentResults(trimmed);
		return summary ? { title: summary.title, preview: summary.preview } : null;
	}

	if (trimmed.startsWith('<goal_start')) {
		const title = cleanNavigatorPreviewText(extractXmlBlock(trimmed, 'title'));
		const tasks = cleanNavigatorPreviewText(extractXmlBlock(trimmed, 'tasks'));
		return {
			title: title ? `Goal started: ${title}` : 'Goal started',
			preview: tasks || title || 'Goal started',
		};
	}

	if (trimmed.startsWith('<otto_kickoff')) {
		const title = cleanNavigatorPreviewText(extractXmlBlock(trimmed, 'title'));
		const tasks = cleanNavigatorPreviewText(extractXmlBlock(trimmed, 'tasks'));
		return {
			title: title ? `Otto kickoff: ${title}` : 'Otto kickoff',
			preview:
				tasks ||
				cleanNavigatorPreviewText(extractXmlBlock(trimmed, 'instructions')),
		};
	}

	if (trimmed.startsWith('<otto_wakeup')) {
		const goal = cleanNavigatorPreviewText(extractXmlBlock(trimmed, 'goal'));
		const transcript = cleanNavigatorPreviewText(
			extractXmlBlock(trimmed, 'transcript'),
		);
		return {
			title: goal ? `Otto update: ${firstLine(goal)}` : 'Otto update',
			preview:
				transcript ||
				cleanNavigatorPreviewText(extractXmlBlock(trimmed, 'instructions')),
		};
	}

	return null;
}

function getNavigatorTextSummary(text: string): Omit<NavTurn, 'index'> {
	const taggedSummary = summarizeTaggedUserMessage(text);
	if (taggedSummary) return taggedSummary;

	const clean = cleanNavigatorPreviewText(text);
	return {
		title: firstLine(clean) || 'Message',
		preview: snippet(clean),
	};
}

function getProximity(pointerY: number, centerY: number, rowHeight: number) {
	const distance = Math.abs(pointerY - centerY);
	const sigma = Math.max(8, rowHeight * 1.3);
	return Math.exp(-(distance * distance) / (2 * sigma * sigma));
}

function buildTurns(messages: Message[]): NavTurn[] {
	const turns: NavTurn[] = [];
	for (let i = messages.length - 1; i >= 0 && turns.length < MAX_TURNS; i--) {
		const message = messages[i];
		if (message.role === 'user') {
			const userText = getUserText(message).trim();
			if (!userText || isCompactSlashCommand(userText)) continue;
			const next = messages[i + 1];
			const assistantText =
				next && next.role === 'assistant' ? getAssistantText(next) : '';
			const userSummary = getNavigatorTextSummary(userText);
			const assistantSummary = assistantText
				? getNavigatorTextSummary(assistantText)
				: undefined;
			const title = userSummary.title;
			const preview = assistantSummary?.preview || userSummary.preview;
			turns.push({
				index: i,
				title,
				preview,
			});
		}
	}
	return turns.reverse();
}

const ThreadNavigatorBar = memo(function ThreadNavigatorBar({
	turn,
	index,
	mouseY,
	onHover,
	onNavigate,
	barMinWidth,
	barMaxWidth,
	compact,
	rowHeight,
}: ThreadNavigatorBarProps) {
	const centerY = index * rowHeight + rowHeight / 2;
	const minHeight = Math.min(BAR_MIN_HEIGHT, Math.max(0.75, rowHeight * 0.55));
	const maxHeight = compact
		? minHeight
		: Math.min(BAR_MAX_HEIGHT, Math.max(minHeight, rowHeight * 0.75));
	const widthTarget = useTransform(mouseY, (latest) => {
		const proximity = getProximity(latest, centerY, rowHeight);
		return barMinWidth + proximity * (barMaxWidth - barMinWidth);
	});
	const heightTarget = useTransform(mouseY, (latest) => {
		const proximity = getProximity(latest, centerY, rowHeight);
		return minHeight + proximity * (maxHeight - minHeight);
	});
	const opacityTarget = useTransform(mouseY, (latest) => {
		const proximity = getProximity(latest, centerY, rowHeight);
		return Math.max(0.58, 0.34 + proximity * 0.66);
	});
	const width = useSpring(widthTarget, SPRING);
	const height = useSpring(heightTarget, SPRING);
	const opacity = useSpring(opacityTarget, SPRING);

	return (
		<button
			type="button"
			onPointerEnter={() => onHover(index)}
			onFocus={() => onHover(index)}
			onClick={() => onNavigate(turn.index)}
			className="absolute left-0 flex items-center justify-start w-full"
			style={{
				top: index * rowHeight,
				height: rowHeight,
			}}
			aria-label={turn.title}
			title={compact ? turn.title : undefined}
		>
			<motion.span
				className="block rounded-full bg-foreground"
				style={{ width, height, opacity }}
			/>
		</button>
	);
});

export const ThreadNavigatorRail = memo(function ThreadNavigatorRail({
	messages,
	onNavigate,
	threadWidth = 0,
	topInset = 0,
	bottomInset = 0,
}: ThreadNavigatorRailProps) {
	const layout: ThreadNavigatorLayout = useMemo(
		() => getThreadNavigatorLayout(threadWidth),
		[threadWidth],
	);
	const turns = useMemo(() => buildTurns(messages), [messages]);
	const shellRef = useRef<HTMLDivElement>(null);
	const railRef = useRef<HTMLDivElement>(null);
	const hoveredIndexRef = useRef<number | null>(null);
	const mouseY = useMotionValue(FAR_POINTER_Y);
	const [availableRailHeight, setAvailableRailHeight] = useState(0);
	const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
	const shellStyle = {
		top: Math.max(0, topInset),
		bottom: Math.max(0, bottomInset),
	};

	useEffect(() => {
		return () => mouseY.set(FAR_POINTER_Y);
	}, [mouseY]);

	useEffect(() => {
		const shell = shellRef.current;
		if (!shell) return;

		const measure = () => {
			setAvailableRailHeight(shell.getBoundingClientRect().height);
		};

		measure();

		if (typeof ResizeObserver === 'undefined') {
			window.addEventListener('resize', measure);
			return () => window.removeEventListener('resize', measure);
		}

		const resizeObserver = new ResizeObserver(([entry]) => {
			setAvailableRailHeight(
				entry?.contentRect.height ?? shell.getBoundingClientRect().height,
			);
		});
		resizeObserver.observe(shell);
		return () => resizeObserver.disconnect();
	}, []);

	if (turns.length < 2) {
		return (
			<div
				ref={shellRef}
				data-smart-edge-ignore="left"
				data-smart-edge-ignore-mode="edge-corridor"
				className={RAIL_SHELL_CLASS_NAME}
				style={shellStyle}
			/>
		);
	}

	const rowHeightAvailable = Math.max(
		0,
		availableRailHeight - RAIL_VERTICAL_MARGIN_PX * 2,
	);
	const rowHeight = getThreadNavigatorRowHeight(
		turns.length,
		rowHeightAvailable,
	);
	const railHeight = turns.length * rowHeight;
	const hoveredTurn = hoveredIndex !== null ? turns[hoveredIndex] : undefined;
	const tooltipTop =
		hoveredIndex !== null
			? hoveredIndex * rowHeight + rowHeight / 2
			: rowHeight / 2;

	const setHoveredBar = (index: number | null) => {
		if (hoveredIndexRef.current === index) return;
		hoveredIndexRef.current = index;
		setHoveredIndex(index);
	};

	const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
		const rail = railRef.current;
		if (!rail) return;
		const rect = rail.getBoundingClientRect();
		const y = Math.min(railHeight - 1, Math.max(0, event.clientY - rect.top));
		const index = Math.min(
			turns.length - 1,
			Math.max(0, Math.floor(y / rowHeight)),
		);
		mouseY.set(index * rowHeight + rowHeight / 2);
		setHoveredBar(index);
	};

	const handlePointerLeave = () => {
		mouseY.set(FAR_POINTER_Y);
		setHoveredBar(null);
	};

	return (
		<div
			ref={shellRef}
			data-smart-edge-ignore="left"
			data-smart-edge-ignore-mode="edge-corridor"
			className={RAIL_SHELL_CLASS_NAME}
			style={shellStyle}
		>
			<div
				ref={railRef}
				onPointerMove={handlePointerMove}
				onPointerLeave={handlePointerLeave}
				className="relative pointer-events-auto"
				style={{ width: layout.railWidth, height: railHeight }}
			>
				{turns.map((turn, i) => (
					<ThreadNavigatorBar
						key={turn.index}
						turn={turn}
						index={i}
						mouseY={mouseY}
						onHover={setHoveredBar}
						onNavigate={onNavigate}
						barMinWidth={layout.barMinWidth}
						barMaxWidth={layout.barMaxWidth}
						compact={layout.compact}
						rowHeight={rowHeight}
					/>
				))}

				{hoveredTurn && layout.showPreviewCard && (
					<div
						className={`pointer-events-none absolute left-full top-0 ml-2 ${
							layout.compact ? 'w-64' : 'w-80'
						} rounded-xl border border-border bg-popover/95 backdrop-blur-sm shadow-lg p-3`}
						style={{
							transform: `translateY(${tooltipTop}px) translateY(-50%)`,
						}}
					>
						<p className="text-sm font-semibold text-foreground leading-snug line-clamp-2">
							{hoveredTurn.title}
						</p>
						{hoveredTurn.preview && (
							<p className="mt-1 text-sm text-muted-foreground leading-snug line-clamp-3">
								{hoveredTurn.preview}
							</p>
						)}
					</div>
				)}
			</div>
		</div>
	);
});
