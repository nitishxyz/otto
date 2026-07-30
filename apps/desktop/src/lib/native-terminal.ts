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

/**
 * Coalesces only the initial WebSocket history burst. Once that first browser
 * frame is flushed, steady-state PTY output is delivered immediately.
 */
export function createNativeTerminalOutputBatcher(
	deliver: (data: string) => void,
	schedule: (callback: () => void) => number,
	cancel: (id: number) => void,
): NativeTerminalOutputBatcher {
	let replaying = true;
	let pending = '';
	let scheduled: number | null = null;

	const flush = () => {
		if (scheduled !== null) {
			cancel(scheduled);
			scheduled = null;
		}
		replaying = false;
		const output = pending;
		pending = '';
		if (output) deliver(output);
	};

	return {
		beginReplay() {
			if (scheduled !== null) cancel(scheduled);
			replaying = true;
			pending = '';
			scheduled = null;
		},
		push(data) {
			if (!data) return;
			if (!replaying) {
				deliver(data);
				return;
			}
			pending += data;
			scheduled ??= schedule(flush);
		},
		flush,
		dispose() {
			if (scheduled !== null) cancel(scheduled);
			scheduled = null;
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

export function destroyNativeTerminalSurface(sessionId: string) {
	return invoke<void>('native_terminal_surface_destroy', { sessionId });
}
