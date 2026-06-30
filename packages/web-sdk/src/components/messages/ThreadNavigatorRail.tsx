import { memo, useEffect, useMemo, useRef, useState } from 'react';
import {
	motion,
	useMotionValue,
	useSpring,
	useTransform,
	type MotionValue,
} from 'motion/react';
import type { Message } from '../../types/api';
import {
	getMessagePartText,
	getUserMessageText,
	isCompactSlashCommand,
} from './compactionSummary';

interface ThreadNavigatorRailProps {
	messages: Message[];
	onNavigate: (index: number) => void;
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
}

const FAR_POINTER_Y = -10000;
const ROW_HEIGHT = 14;
const RAIL_WIDTH = 48;
const BAR_MIN_WIDTH = 16;
const BAR_MAX_WIDTH = 42;
const BAR_MIN_HEIGHT = 2;
const BAR_MAX_HEIGHT = 3.5;
const SIGMA = 18;
const MAX_TURNS = 90;
const SPRING = { stiffness: 420, damping: 30, mass: 0.35 };

function getAssistantText(message: Message): string {
	const parts = message.parts ?? [];
	for (const part of parts) {
		if (part.type !== 'text') continue;
		const text = getMessagePartText(part).trim();
		if (text) return text;
	}
	for (const part of parts) {
		if (part.type !== 'reasoning') continue;
		const text = getMessagePartText(part).trim();
		if (text) return text;
	}
	return '';
}

function firstLine(text: string, max = 60): string {
	const line = text.replace(/\s+/g, ' ').trim();
	if (line.length <= max) return line;
	return `${line.slice(0, max - 1)}…`;
}

function snippet(text: string, max = 180): string {
	const clean = text.replace(/\s+/g, ' ').trim();
	if (clean.length <= max) return clean;
	return `${clean.slice(0, max - 1)}…`;
}

function getProximity(pointerY: number, centerY: number) {
	const distance = Math.abs(pointerY - centerY);
	return Math.exp(-(distance * distance) / (2 * SIGMA * SIGMA));
}

function buildTurns(messages: Message[]): NavTurn[] {
	const turns: NavTurn[] = [];
	for (let i = 0; i < messages.length; i++) {
		const message = messages[i];
		if (message.role === 'user') {
			const userText = getUserMessageText(message).trim();
			if (!userText || isCompactSlashCommand(userText)) continue;
			const next = messages[i + 1];
			const assistantText =
				next && next.role === 'assistant' ? getAssistantText(next) : '';
			const title = firstLine(userText) || 'Message';
			const preview = snippet(assistantText || userText);
			turns.push({
				index: i,
				title,
				preview,
			});
		}
	}
	if (turns.length <= MAX_TURNS) return turns;
	// Keep the most recent turns when a thread gets very long.
	return turns.slice(turns.length - MAX_TURNS);
}

const ThreadNavigatorBar = memo(function ThreadNavigatorBar({
	turn,
	index,
	mouseY,
	onHover,
	onNavigate,
}: ThreadNavigatorBarProps) {
	const centerY = index * ROW_HEIGHT + ROW_HEIGHT / 2;
	const widthTarget = useTransform(mouseY, (latest) => {
		const proximity = getProximity(latest, centerY);
		return BAR_MIN_WIDTH + proximity * (BAR_MAX_WIDTH - BAR_MIN_WIDTH);
	});
	const heightTarget = useTransform(mouseY, (latest) => {
		const proximity = getProximity(latest, centerY);
		return BAR_MIN_HEIGHT + proximity * (BAR_MAX_HEIGHT - BAR_MIN_HEIGHT);
	});
	const opacityTarget = useTransform(mouseY, (latest) => {
		const proximity = getProximity(latest, centerY);
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
				top: index * ROW_HEIGHT,
				height: ROW_HEIGHT,
			}}
			aria-label={turn.title}
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
}: ThreadNavigatorRailProps) {
	const turns = useMemo(() => buildTurns(messages), [messages]);
	const railRef = useRef<HTMLDivElement>(null);
	const hoveredIndexRef = useRef<number | null>(null);
	const mouseY = useMotionValue(FAR_POINTER_Y);
	const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

	useEffect(() => {
		return () => mouseY.set(FAR_POINTER_Y);
	}, [mouseY]);

	if (turns.length < 2) return null;

	const railHeight = turns.length * ROW_HEIGHT;
	const hoveredTurn = hoveredIndex !== null ? turns[hoveredIndex] : undefined;
	const tooltipTop =
		hoveredIndex !== null
			? hoveredIndex * ROW_HEIGHT + ROW_HEIGHT / 2
			: ROW_HEIGHT / 2;

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
			Math.max(0, Math.floor(y / ROW_HEIGHT)),
		);
		mouseY.set(index * ROW_HEIGHT + ROW_HEIGHT / 2);
		setHoveredBar(index);
	};

	const handlePointerLeave = () => {
		mouseY.set(FAR_POINTER_Y);
		setHoveredBar(null);
	};

	return (
		<div
			data-smart-edge-ignore
			className="absolute left-0 top-0 h-full flex items-center justify-start z-20 pointer-events-none select-none"
		>
			<div
				ref={railRef}
				onPointerMove={handlePointerMove}
				onPointerLeave={handlePointerLeave}
				className="relative pointer-events-auto"
				style={{ width: RAIL_WIDTH, height: railHeight }}
			>
				{turns.map((turn, i) => (
					<ThreadNavigatorBar
						key={turn.index}
						turn={turn}
						index={i}
						mouseY={mouseY}
						onHover={setHoveredBar}
						onNavigate={onNavigate}
					/>
				))}

				{hoveredTurn && (
					<div
						className="pointer-events-none absolute left-full top-0 ml-2 w-80 rounded-xl border border-border bg-popover/95 backdrop-blur-sm shadow-lg p-3"
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
