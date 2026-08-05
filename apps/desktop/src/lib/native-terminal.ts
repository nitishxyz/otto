import { invoke } from '@tauri-apps/api/core';
import { getTheme } from '@ottocode/themes';

export const DEFAULT_NATIVE_TERMINAL_METRICS = {
	fontSize: 13,
	cellWidth: 8,
	cellHeight: 17,
} as const;

export interface NativeTerminalMetrics {
	fontSize: number;
	cellWidth: number;
	cellHeight: number;
}

export interface NativeTerminalSurfaceBounds {
	x: number;
	y: number;
	width: number;
	height: number;
	hidden: boolean;
}

export interface NativeTerminalSurfaceFont {
	family?: string;
	size?: number;
	cellWidth?: number;
	cellHeight?: number;
}

export interface NativeTerminalSurfaceStatus {
	available: boolean;
	backend: string;
	message: string;
	/** Logical cell width measured from the font the GPU renderer resolved. */
	cellWidth?: number;
	cellHeight?: number;
}

/**
 * Terminal-line wheel delta matching the Canvas Ghostty implementation:
 * deltaMode-aware, capped per event so trackpad momentum stays controllable.
 */
export function nativeTerminalScrollDelta(event: {
	deltaY: number;
	deltaMode: number;
}): number {
	const direction = Math.sign(event.deltaY);
	if (direction === 0) return 0;
	if (event.deltaMode === 1) {
		return (
			direction *
			Math.min(3, Math.max(1, Math.round(Math.abs(event.deltaY) / 2)))
		);
	}
	if (event.deltaMode === 2) {
		return direction * 8;
	}
	return (
		direction *
		Math.min(2, Math.max(1, Math.round(Math.abs(event.deltaY) / 80)))
	);
}

export interface NativeTerminalStatus {
	available: boolean;
	backend: string;
	renderer: string;
}

export interface NativeTerminalTheme {
	background: NativeTerminalRgb;
	foreground: NativeTerminalRgb;
	cursor: NativeTerminalRgb;
	selectionBackground: NativeTerminalRgb;
	selectionForeground: NativeTerminalRgb;
	palette: NativeTerminalRgb[];
}

export interface NativeTerminalRgb {
	r: number;
	g: number;
	b: number;
}

export interface NativeTerminalCell {
	text: string;
	fg?: NativeTerminalRgb | null;
	bg?: NativeTerminalRgb | null;
	bold: boolean;
	italic: boolean;
	faint: boolean;
	inverse: boolean;
	strikethrough: boolean;
	underline: boolean;
	wide: boolean;
	spacer: boolean;
	selected: boolean;
}

export interface NativeTerminalRow {
	cells: NativeTerminalCell[];
}

export interface NativeTerminalCursor {
	col: number;
	row: number;
	visible: boolean;
	blinking: boolean;
	shape: 'bar' | 'block' | 'blockHollow' | 'underline';
	color?: NativeTerminalRgb | null;
}

export interface NativeTerminalSnapshot {
	cols: number;
	rows: number;
	rowsData: NativeTerminalRow[];
	defaultFg: NativeTerminalRgb;
	defaultBg: NativeTerminalRgb;
	selectionBg: NativeTerminalRgb;
	selectionFg: NativeTerminalRgb;
	cursor: NativeTerminalCursor;
}

export interface NativeTerminalRenderResult {
	ptyWrites: number[];
}

export interface NativeTerminalUpdate {
	snapshot: NativeTerminalSnapshot;
	ptyWrites: number[];
	selectedText?: string | null;
}

export interface NativeTerminalPoint {
	col: number;
	row: number;
}

export interface NativeTerminalSelection {
	start: NativeTerminalPoint;
	end: NativeTerminalPoint;
}

export interface NativeTerminalKeyEvent {
	code: string;
	text?: string | null;
	ctrl: boolean;
	alt: boolean;
	shift: boolean;
	meta: boolean;
	repeat: boolean;
}

export interface NativeTerminalShortcutEvent {
	code: string;
	key: string;
	ctrlKey: boolean;
	altKey: boolean;
	shiftKey: boolean;
	metaKey: boolean;
}

export type NativeTerminalShortcut =
	| { action: 'copy' | 'paste' }
	| { action: 'send'; data: string }
	| { action: 'encode' };

export interface NativeTerminalOutputBatcher {
	beginReplay(): void;
	push(data: string): void;
	flush(): void;
	dispose(): void;
}

export interface NativeTerminalOutputBatcherTimers {
	schedule: (callback: () => void, delayMs: number) => number;
	cancel: (id: number) => void;
	now: () => number;
}

export interface NativeTerminalOutputBatcherOptions {
	/** Replay flushes after this quiet gap between history chunks. */
	quietMs?: number;
	/** Replay force-flushes after this total duration. */
	maxMs?: number;
	timers?: NativeTerminalOutputBatcherTimers;
}

const defaultBatcherTimers: NativeTerminalOutputBatcherTimers = {
	schedule: (callback, delayMs) => window.setTimeout(callback, delayMs),
	cancel: (id) => window.clearTimeout(id),
	now: () => performance.now(),
};

/**
 * Coalesces the initial history replay into one atomic delivery. Remote
 * daemons stream history across many frames over time, so replay batching is
 * quiet-window based rather than single-frame. After the replay flush,
 * steady-state PTY output is delivered immediately. Replay deliveries are
 * flagged so callers can drop VT query replies that the replayed history
 * would otherwise regenerate and echo into the live PTY.
 */
export function createNativeTerminalOutputBatcher(
	deliver: (data: string, replay: boolean) => void,
	options: NativeTerminalOutputBatcherOptions = {},
): NativeTerminalOutputBatcher {
	const quietMs = options.quietMs ?? 48;
	const maxMs = options.maxMs ?? 750;
	const timers = options.timers ?? defaultBatcherTimers;
	let replaying = true;
	let pending = '';
	let scheduled: number | null = null;
	let replayStartedAt = timers.now();

	const clearScheduled = () => {
		if (scheduled !== null) {
			timers.cancel(scheduled);
			scheduled = null;
		}
	};

	const flush = () => {
		clearScheduled();
		replaying = false;
		const output = pending;
		pending = '';
		if (output) deliver(output, true);
	};

	return {
		beginReplay() {
			clearScheduled();
			replaying = true;
			pending = '';
			replayStartedAt = timers.now();
		},
		push(data) {
			if (!data) return;
			if (!replaying) {
				deliver(data, false);
				return;
			}
			pending += data;
			if (timers.now() - replayStartedAt >= maxMs) {
				flush();
				return;
			}
			clearScheduled();
			scheduled = timers.schedule(flush, quietMs);
		},
		flush,
		dispose() {
			clearScheduled();
			pending = '';
			replaying = false;
		},
	};
}

let statusPromise: Promise<NativeTerminalStatus> | null = null;

function hexRgb(value: string): NativeTerminalRgb {
	const hex = value.replace('#', '');
	const expanded =
		hex.length === 3
			? hex
					.split('')
					.map((digit) => `${digit}${digit}`)
					.join('')
			: hex;
	return {
		r: Number.parseInt(expanded.slice(0, 2), 16),
		g: Number.parseInt(expanded.slice(2, 4), 16),
		b: Number.parseInt(expanded.slice(4, 6), 16),
	};
}

function renderedCssColor(
	className: string,
	property: 'backgroundColor' | 'color',
): NativeTerminalRgb | null {
	if (typeof document === 'undefined') return null;
	const element = document.createElement('span');
	element.className = className;
	element.style.position = 'fixed';
	element.style.visibility = 'hidden';
	document.body.appendChild(element);
	const value = getComputedStyle(element)[property];
	element.remove();
	const channels = value
		.match(/[\d.]+/g)
		?.slice(0, 3)
		.map(Number);
	if (!channels || channels.length !== 3 || channels.some(Number.isNaN)) {
		return null;
	}
	return { r: channels[0], g: channels[1], b: channels[2] };
}

/** Resolves terminal colors directly from Otto's active application theme. */
export function resolveNativeTerminalTheme(
	themeId?: string,
): NativeTerminalTheme {
	const theme = getTheme(themeId);
	const colors = theme.colors;
	const foreground =
		renderedCssColor('text-foreground', 'color') ?? hexRgb(colors.fg);
	return {
		background:
			renderedCssColor('bg-background', 'backgroundColor') ?? hexRgb(colors.bg),
		foreground,
		cursor: foreground,
		selectionBackground:
			renderedCssColor('bg-accent', 'backgroundColor') ??
			hexRgb(colors.bgHighlight),
		selectionForeground:
			renderedCssColor('text-accent-foreground', 'color') ??
			hexRgb(colors.fgBright),
		palette: [
			hexRgb(colors.bgDark),
			hexRgb(colors.red),
			hexRgb(colors.green),
			hexRgb(colors.yellow),
			hexRgb(colors.blue),
			hexRgb(colors.purple),
			hexRgb(colors.cyan),
			hexRgb(colors.fg),
			hexRgb(colors.fgDark),
			hexRgb(colors.red),
			hexRgb(colors.green),
			hexRgb(colors.orange),
			hexRgb(colors.blue),
			hexRgb(colors.magenta),
			hexRgb(colors.teal),
			hexRgb(colors.fgBright),
		],
	};
}

/** Maps desktop terminal shortcuts that browsers and VT encoders cannot infer. */
export function resolveNativeTerminalShortcut(
	event: NativeTerminalShortcutEvent,
	isMac: boolean,
): NativeTerminalShortcut {
	const key = event.key.toLowerCase();
	if (
		(isMac && event.metaKey && key === 'c') ||
		(event.ctrlKey && event.shiftKey && key === 'c') ||
		(event.ctrlKey && event.code === 'Insert')
	) {
		return { action: 'copy' };
	}
	if (
		(isMac && event.metaKey && key === 'v') ||
		(event.ctrlKey && event.shiftKey && key === 'v') ||
		(event.shiftKey && event.code === 'Insert')
	) {
		return { action: 'paste' };
	}
	if (isMac && event.metaKey && event.code === 'Backspace') {
		return { action: 'send', data: '\x15' };
	}
	if (isMac && event.metaKey && event.code === 'ArrowLeft') {
		return { action: 'send', data: '\x01' };
	}
	if (isMac && event.metaKey && event.code === 'ArrowRight') {
		return { action: 'send', data: '\x05' };
	}
	if (isMac && event.altKey && event.code === 'ArrowLeft') {
		return { action: 'send', data: '\x1bb' };
	}
	if (isMac && event.altKey && event.code === 'ArrowRight') {
		return { action: 'send', data: '\x1bf' };
	}
	if (isMac && event.altKey && event.code === 'Backspace') {
		return { action: 'send', data: '\x1b\x7f' };
	}
	return { action: 'encode' };
}

/** Encodes mode-independent terminal keys without a Tauri command round-trip. */
export function encodeNativeTerminalKeyLocally(
	event: NativeTerminalShortcutEvent,
): string | null {
	if (!event.metaKey && !event.altKey && !event.ctrlKey) {
		if (event.key.length === 1) return event.key;
		if (event.code === 'Enter' || event.code === 'NumpadEnter') return '\r';
		if (event.code === 'Tab' && !event.shiftKey) return '\t';
		if (event.code === 'Backspace') return '\x7f';
		if (event.code === 'Escape') return '\x1b';
	}
	if (
		event.ctrlKey &&
		!event.metaKey &&
		!event.altKey &&
		/^Key[A-Z]$/.test(event.code)
	) {
		return String.fromCharCode(event.code.charCodeAt(3) - 64);
	}
	if (
		event.ctrlKey &&
		!event.metaKey &&
		!event.altKey &&
		(event.code === 'Space' || event.code === 'Digit2')
	) {
		return '\0';
	}
	return null;
}

/** Checks whether the desktop native libghostty-vt backend is available. */
export function getNativeTerminalStatus(): Promise<NativeTerminalStatus> {
	statusPromise ??= invoke<NativeTerminalStatus>(
		'native_terminal_status',
	).catch(() => ({
		available: false,
		backend: 'ghostty-web',
		renderer: 'web',
	}));
	return statusPromise;
}

export function calculateNativeTerminalGrid(
	width: number,
	height: number,
	metrics: NativeTerminalMetrics = DEFAULT_NATIVE_TERMINAL_METRICS,
) {
	return {
		cols: Math.max(1, Math.floor(width / metrics.cellWidth)),
		rows: Math.max(1, Math.floor(height / metrics.cellHeight)),
	};
}

export function measureNativeTerminalMetrics(
	fontFamily: string,
	fontSize = DEFAULT_NATIVE_TERMINAL_METRICS.fontSize,
): NativeTerminalMetrics {
	const canvas = document.createElement('canvas');
	const context = canvas.getContext('2d');
	if (!context) return DEFAULT_NATIVE_TERMINAL_METRICS;
	context.font = `${fontSize}px ${fontFamily}`;
	const measured = context.measureText('M');
	const lineHeight =
		measured.actualBoundingBoxAscent + measured.actualBoundingBoxDescent;
	return {
		fontSize,
		cellWidth: Math.max(8, Math.ceil(measured.width)),
		cellHeight: Math.max(16, Math.ceil(lineHeight + 4)),
	};
}

export function setNativeTerminalTheme(
	sessionId: string,
	theme: NativeTerminalTheme,
) {
	return invoke<NativeTerminalUpdate>('native_terminal_set_theme', {
		sessionId,
		theme,
	});
}

export function createNativeTerminal(
	sessionId: string,
	cols: number,
	rows: number,
	theme: NativeTerminalTheme,
) {
	return invoke<NativeTerminalUpdate>('native_terminal_create', {
		sessionId,
		cols,
		rows,
		theme,
	});
}

export function feedNativeTerminalGpu(sessionId: string, data: Uint8Array) {
	return invoke<NativeTerminalRenderResult>('native_terminal_feed_gpu', {
		sessionId,
		data: Array.from(data),
	});
}

export function feedNativeTerminal(sessionId: string, data: Uint8Array) {
	return invoke<NativeTerminalUpdate>('native_terminal_feed', {
		sessionId,
		data: Array.from(data),
	});
}

export function resizeNativeTerminal(
	sessionId: string,
	cols: number,
	rows: number,
) {
	return invoke<NativeTerminalUpdate>('native_terminal_resize', {
		sessionId,
		cols,
		rows,
	});
}

export function encodeNativeTerminalKey(
	sessionId: string,
	event: NativeTerminalKeyEvent,
) {
	return invoke<number[]>('native_terminal_key', { sessionId, event });
}

export function selectNativeTerminal(
	sessionId: string,
	selection: NativeTerminalSelection | null,
) {
	return invoke<NativeTerminalUpdate>('native_terminal_select', {
		sessionId,
		selection,
	});
}

export function scrollNativeTerminal(sessionId: string, delta: number) {
	return invoke<NativeTerminalUpdate>('native_terminal_scroll', {
		sessionId,
		delta,
	});
}

export function resetNativeTerminal(sessionId: string) {
	return invoke<NativeTerminalUpdate>('native_terminal_reset', { sessionId });
}

export function destroyNativeTerminal(sessionId: string) {
	return invoke<void>('native_terminal_destroy', { sessionId });
}

export function createNativeTerminalSurface(
	sessionId: string,
	bounds: NativeTerminalSurfaceBounds,
	font: NativeTerminalSurfaceFont,
) {
	return invoke<NativeTerminalSurfaceStatus>('native_terminal_surface_create', {
		sessionId,
		bounds,
		font,
	});
}

export function updateNativeTerminalSurface(
	sessionId: string,
	bounds: NativeTerminalSurfaceBounds,
) {
	return invoke<void>('native_terminal_surface_update', { sessionId, bounds });
}

export function setNativeTerminalSurfaceFont(
	sessionId: string,
	font: NativeTerminalSurfaceFont,
) {
	return invoke<void>('native_terminal_surface_set_font', { sessionId, font });
}

export interface NativeTerminalSurfaceCursor {
	/** Draw the cursor as a hollow outline (unfocused terminal). */
	hollow: boolean;
	/** Hide the cursor entirely (focused blink off-phase). */
	hidden: boolean;
}

/** Overrides GPU cursor presentation for focus and blink state. */
export function setNativeTerminalSurfaceCursor(
	sessionId: string,
	cursor: NativeTerminalSurfaceCursor,
) {
	return invoke<void>('native_terminal_surface_cursor', { sessionId, cursor });
}

export function destroyNativeTerminalSurface(sessionId: string) {
	return invoke<void>('native_terminal_surface_destroy', { sessionId });
}
