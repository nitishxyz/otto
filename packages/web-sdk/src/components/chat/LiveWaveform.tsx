import { useEffect, useRef } from 'react';
import type { HTMLAttributes } from 'react';

export type LiveWaveformProps = HTMLAttributes<HTMLDivElement> & {
	/** When true, the waveform reads from the analyser and animates. */
	active?: boolean;
	/** Externally-owned analyser node (mic stream lives in useVoiceInput). */
	analyser?: AnalyserNode | null;
	barWidth?: number;
	barGap?: number;
	barRadius?: number;
	/** Minimum bar height in px. */
	barHeight?: number;
	/** CSS color string for bars. Falls back to computed text color. */
	barColor?: string;
	fadeEdges?: boolean;
	fadeWidth?: number;
	height?: string | number;
	sensitivity?: number;
	/** How many ms between sampling new bars (controls scroll speed). */
	updateRate?: number;
};

/**
 * Canvas-based microphone waveform visualizer (scrolling mode).
 *
 * New amplitude samples enter at the right edge and scroll leftward as a
 * continuous stream, fading in on the right and out on the left. The mic
 * stream and AudioContext are owned externally (see useVoiceInput) and
 * passed in via the `analyser` prop to avoid duplicate getUserMedia calls.
 */
export function LiveWaveform({
	active = false,
	analyser = null,
	barWidth = 3,
	barGap = 2,
	barRadius = 1.5,
	barHeight: baseBarHeight = 3,
	barColor,
	fadeEdges = true,
	fadeWidth = 32,
	height = 40,
	sensitivity = 1.4,
	updateRate = 45,
	className = '',
	...props
}: LiveWaveformProps) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const containerRef = useRef<HTMLDivElement>(null);
	const historyRef = useRef<number[]>([]);
	const gradientCacheRef = useRef<CanvasGradient | null>(null);
	const lastWidthRef = useRef(0);
	const lastUpdateRef = useRef(0);

	const heightStyle = typeof height === 'number' ? `${height}px` : height;

	// Handle canvas resizing (DPR-aware).
	useEffect(() => {
		const canvas = canvasRef.current;
		const container = containerRef.current;
		if (!canvas || !container) return;

		const resizeObserver = new ResizeObserver(() => {
			const rect = container.getBoundingClientRect();
			const dpr = window.devicePixelRatio || 1;
			canvas.width = rect.width * dpr;
			canvas.height = rect.height * dpr;
			canvas.style.width = `${rect.width}px`;
			canvas.style.height = `${rect.height}px`;
			const ctx = canvas.getContext('2d');
			if (ctx) ctx.scale(dpr, dpr);
			gradientCacheRef.current = null;
			lastWidthRef.current = rect.width;
		});

		resizeObserver.observe(container);
		return () => resizeObserver.disconnect();
	}, []);

	// Reset the stream when (de)activated.
	useEffect(() => {
		if (active) {
			historyRef.current = [];
			lastUpdateRef.current = 0;
		}
	}, [active]);

	// Animation loop.
	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		const ctx = canvas.getContext('2d');
		if (!ctx) return;

		let rafId = 0;

		const animate = (currentTime: number) => {
			const rect = canvas.getBoundingClientRect();
			const step = barWidth + barGap;
			const maxBars = Math.max(1, Math.floor(rect.width / step)) + 2;

			// Sample a new amplitude bar at a fixed cadence.
			if (
				active &&
				analyser &&
				currentTime - lastUpdateRef.current > updateRate
			) {
				lastUpdateRef.current = currentTime;
				const dataArray = new Uint8Array(analyser.frequencyBinCount);
				analyser.getByteFrequencyData(dataArray);

				// Average the vocal-friendly band of the spectrum.
				const startFreq = Math.floor(dataArray.length * 0.05);
				const endFreq = Math.floor(dataArray.length * 0.4);
				let sum = 0;
				for (let i = startFreq; i < endFreq; i++) sum += dataArray[i];
				const avg = (sum / (endFreq - startFreq) / 255) * sensitivity;

				historyRef.current.push(Math.min(1, Math.max(0.05, avg)));
				if (historyRef.current.length > maxBars) historyRef.current.shift();
			} else if (!active && historyRef.current.length > 0) {
				// Drain remaining bars off the left edge when stopped.
				if (currentTime - lastUpdateRef.current > updateRate) {
					lastUpdateRef.current = currentTime;
					historyRef.current.shift();
				}
			}

			ctx.clearRect(0, 0, rect.width, rect.height);

			const computedBarColor =
				barColor || getComputedStyle(canvas).color || '#000';
			const centerY = rect.height / 2;
			const history = historyRef.current;

			// Draw newest bar at the right, scrolling left.
			for (let i = 0; i < history.length; i++) {
				const dataIndex = history.length - 1 - i;
				const value = history[dataIndex] || 0.05;
				const x = rect.width - (i + 1) * step;
				if (x + barWidth < 0) break;
				const h = Math.max(baseBarHeight, value * rect.height * 0.85);
				const y = centerY - h / 2;
				ctx.fillStyle = computedBarColor;
				ctx.globalAlpha = 0.35 + value * 0.65;
				if (barRadius > 0) {
					ctx.beginPath();
					ctx.roundRect(x, y, barWidth, h, barRadius);
					ctx.fill();
				} else {
					ctx.fillRect(x, y, barWidth, h);
				}
			}

			// Edge fade: fade in on the right, fade out on the left.
			if (fadeEdges && fadeWidth > 0 && rect.width > 0) {
				if (!gradientCacheRef.current || lastWidthRef.current !== rect.width) {
					const gradient = ctx.createLinearGradient(0, 0, rect.width, 0);
					const fadePercent = Math.min(0.4, fadeWidth / rect.width);
					gradient.addColorStop(0, 'rgba(255,255,255,1)');
					gradient.addColorStop(fadePercent, 'rgba(255,255,255,0)');
					gradient.addColorStop(1 - fadePercent, 'rgba(255,255,255,0)');
					gradient.addColorStop(1, 'rgba(255,255,255,1)');
					gradientCacheRef.current = gradient;
					lastWidthRef.current = rect.width;
				}
				ctx.globalCompositeOperation = 'destination-out';
				ctx.fillStyle = gradientCacheRef.current;
				ctx.fillRect(0, 0, rect.width, rect.height);
				ctx.globalCompositeOperation = 'source-over';
			}

			ctx.globalAlpha = 1;
			rafId = requestAnimationFrame(animate);
		};

		rafId = requestAnimationFrame(animate);
		return () => {
			if (rafId) cancelAnimationFrame(rafId);
		};
	}, [
		active,
		analyser,
		sensitivity,
		updateRate,
		barWidth,
		baseBarHeight,
		barGap,
		barRadius,
		barColor,
		fadeEdges,
		fadeWidth,
	]);

	return (
		<div
			className={`relative h-full w-full ${className}`}
			ref={containerRef}
			style={{ height: heightStyle }}
			aria-label={active ? 'Live audio waveform' : 'Audio waveform idle'}
			role="img"
			{...props}
		>
			<canvas className="block h-full w-full" ref={canvasRef} />
		</div>
	);
}
