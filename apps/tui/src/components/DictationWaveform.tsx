import { memo, useEffect, useRef, useState } from 'react';
import type { DictationPhase } from '../hooks/useDictation.ts';
import { useTheme } from '../theme.ts';
import { useTerminalDimensions } from '../terminal-dimensions.tsx';
import { TinySpinner } from './TinySpinner.tsx';

const WAVEFORM_ROWS = [
	{ id: 'wave-row-0', row: 0 },
	{ id: 'wave-row-1', row: 1 },
	{ id: 'wave-row-2', row: 2 },
	{ id: 'wave-row-3', row: 3 },
	{ id: 'wave-row-4', row: 4 },
] as const;
const VERTICAL_SUBCELLS = WAVEFORM_ROWS.length * 2;
const VERTICAL_CENTER = VERTICAL_SUBCELLS / 2;

interface DictationWaveformProps {
	phase: DictationPhase;
	level: number;
	startedAt: number | null;
}

export const DictationWaveform = memo(function DictationWaveform({
	phase,
	level,
	startedAt,
}: DictationWaveformProps) {
	const { colors } = useTheme();
	const { width } = useTerminalDimensions();
	const barCount = Math.max(
		12,
		Math.min(42, Math.floor(((width || 80) - 8) / 2)),
	);
	const historyRef = useRef<number[]>([]);
	const levelRef = useRef(level);
	const smoothedLevelRef = useRef(0.08);
	const previousPhaseRef = useRef<DictationPhase>('idle');
	const [tick, setTick] = useState(0);
	const [elapsedSeconds, setElapsedSeconds] = useState(0);
	levelRef.current = level;

	useEffect(() => {
		if (phase === 'recording' && previousPhaseRef.current !== 'recording') {
			historyRef.current = [];
			smoothedLevelRef.current = 0.08;
		}
		previousPhaseRef.current = phase;
	}, [phase]);

	useEffect(() => {
		const timer = setInterval(
			() => {
				if (phase === 'recording') {
					const current = smoothedLevelRef.current;
					const target = levelRef.current;
					const smoothing = target > current ? 0.62 : 0.28;
					const next = current + (target - current) * smoothing;
					smoothedLevelRef.current = next;
					historyRef.current.push(Math.min(0.95, Math.max(0.08, next)));
					if (historyRef.current.length > barCount) historyRef.current.shift();
				}
				setTick((current) => current + 1);
			},
			phase === 'recording' ? 55 : 90,
		);
		return () => clearInterval(timer);
	}, [barCount, phase]);

	useEffect(() => {
		if (!startedAt) {
			setElapsedSeconds(0);
			return;
		}
		const update = () =>
			setElapsedSeconds(
				Math.max(0, Math.floor((Date.now() - startedAt) / 1000)),
			);
		update();
		const timer = setInterval(update, 500);
		return () => clearInterval(timer);
	}, [startedAt]);

	const source = historyRef.current;
	const fallback = createIdleWave(barCount, tick);
	const values =
		source.length > 0
			? [
					...Array.from(
						{ length: Math.max(0, barCount - source.length) },
						() => 0.08,
					),
					...source.slice(-barCount),
				]
			: fallback;
	const shimmerStep = tick % Math.max(1, barCount * 2 - 2);
	const shimmerCenter =
		shimmerStep < barCount ? shimmerStep : barCount * 2 - 2 - shimmerStep;
	const bars = values.map((value, slot) => {
		const shimmerDistance = Math.abs(slot - shimmerCenter);
		const shimmer =
			phase === 'transcribing' && shimmerDistance <= 4
				? 1 - shimmerDistance / 5
				: 0;
		return {
			id: `waveform-slot-${slot}`,
			value: toDisplayLevel(value, phase, shimmer),
		};
	});

	return (
		<box
			style={{
				width: '100%',
				height: 6,
				flexDirection: 'column',
				justifyContent: 'center',
				overflow: 'hidden',
			}}
		>
			<box
				style={{
					height: 1,
					width: '100%',
					flexDirection: 'row',
					justifyContent: 'center',
					gap: 1,
				}}
			>
				{phase === 'recording' ? (
					<text wrapMode="none">
						<span fg={colors.red}>●</span>
						<span fg={colors.fgBright}>
							{'  '}Recording {formatDuration(elapsedSeconds)}
						</span>
					</text>
				) : (
					<>
						<TinySpinner fg={colors.blue} />
						<text fg={colors.fgBright} wrapMode="none">
							{phase === 'transcribing'
								? 'Transcribing locally…'
								: phase === 'checking'
									? 'Checking dictation…'
									: 'Connecting microphone…'}
						</text>
					</>
				)}
			</box>

			{WAVEFORM_ROWS.map(({ id, row }) => (
				<box
					key={id}
					style={{
						height: 1,
						width: '100%',
						flexDirection: 'row',
						justifyContent: 'center',
					}}
				>
					<text fg={colors.blue} wrapMode="none">
						{bars.map((bar) => {
							return <span key={bar.id}>{renderBarCell(bar.value, row)} </span>;
						})}
					</text>
				</box>
			))}
		</box>
	);
});

function createIdleWave(barCount: number, tick: number): number[] {
	return Array.from({ length: barCount }, (_, slot) => {
		const wave = Math.sin(slot * 0.72 + tick * 0.08) * 0.11;
		return Math.min(0.42, Math.max(0.08, 0.2 + wave));
	});
}

function toDisplayLevel(
	value: number,
	phase: DictationPhase,
	shimmer: number,
): number {
	if (phase === 'transcribing') {
		return Math.min(0.98, Math.max(0.24, value) + shimmer * 0.28);
	}
	if (phase !== 'recording') return value;

	const shaped = 0.06 + Math.max(0, value) ** 0.82 * 0.78;
	return Math.min(0.96, Math.max(0.07, shaped));
}

function renderBarCell(value: number, row: number): string {
	const height = 0.8 + Math.min(1, Math.max(0, value)) * 9;
	const top = VERTICAL_CENTER - height / 2;
	const bottom = VERTICAL_CENTER + height / 2;
	const topHalfCenter = row * 2 + 0.5;
	const bottomHalfCenter = row * 2 + 1.5;
	const topFilled = topHalfCenter >= top && topHalfCenter <= bottom;
	const bottomFilled = bottomHalfCenter >= top && bottomHalfCenter <= bottom;
	if (topFilled && bottomFilled) return '█';
	if (topFilled) return '▀';
	if (bottomFilled) return '▄';
	return ' ';
}

function formatDuration(totalSeconds: number): string {
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}
