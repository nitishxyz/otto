import { CanvasRenderer, Ghostty, InputHandler } from 'ghostty-web';
import type { GhosttyVtModule } from './ghostty-vt';
import { GhosttyVtTerminal } from './ghostty-vt';
import {
	drawTerminalCursor,
	resolveTerminalCursorDisplay,
	resolveTerminalCursorShape,
	terminalCursorCellRect,
} from './terminal-cursor';

interface Disposable {
	dispose(): void;
}
interface ResizeEvent {
	cols: number;
	rows: number;
}

type Listener<T> = (value: T) => void;

const CURSOR_BLINK_MS = 530;
const DEFAULT_CURSOR_COLOR = '#ffffff';

export function calculateTerminalGridSize(
	width: number,
	height: number,
	cellWidth: number,
	cellHeight: number,
): ResizeEvent | null {
	if (width < cellWidth * 2 || height < cellHeight) return null;
	return {
		cols: Math.floor(width / cellWidth),
		rows: Math.floor(height / cellHeight),
	};
}

export function syncInlineTerminalActivation(
	terminal: Pick<InlineGhosttyTerminal, 'fit' | 'focus' | 'blur'>,
	isActive: boolean,
): void {
	if (isActive) {
		terminal.fit();
		terminal.focus();
	} else {
		terminal.blur();
	}
}

/**
 * Lightweight Ghostty canvas terminal used by the web viewer.
 *
 * CanvasRenderer's built-in blink only toggles an internal flag and never
 * schedules paints. The full ghostty-web Terminal pairs that flag with a
 * continuous rAF loop; this wrapper instead owns blink timing and paints the
 * cursor overlay (solid while focused, hollow block while blurred).
 */
export class InlineGhosttyTerminal {
	readonly model: GhosttyVtTerminal;
	readonly renderer: CanvasRenderer;
	readonly ghostty: Ghostty;
	cols: number;
	rows: number;
	element?: HTMLDivElement;
	textarea?: HTMLTextAreaElement;
	private canvas?: HTMLCanvasElement;
	private input?: InputHandler;
	private dataListeners = new Set<Listener<string>>();
	private resizeListeners = new Set<Listener<ResizeEvent>>();
	private scrollListeners = new Set<Listener<number>>();
	private frame = 0;
	private pendingForce = false;
	private wheelListener?: (event: WheelEvent) => void;
	private focused = false;
	private blinkPhaseVisible = true;
	private blinkTimer: ReturnType<typeof setInterval> | null = null;
	private cursorColor = DEFAULT_CURSOR_COLOR;

	constructor(
		module: GhosttyVtModule,
		options: {
			cols?: number;
			rows?: number;
			fontSize?: number;
			fontFamily?: string;
		},
	) {
		this.cols = options.cols ?? 80;
		this.rows = options.rows ?? 24;
		this.model = new GhosttyVtTerminal(module, this.cols, this.rows);
		this.ghostty = new Ghostty(module.instance);
		const canvas = document.createElement('canvas');
		canvas.className = 'absolute inset-0';
		this.canvas = canvas;
		// Disable the library blink interval — it never triggers a repaint here.
		this.renderer = new CanvasRenderer(canvas, {
			fontSize: options.fontSize ?? 13,
			fontFamily: options.fontFamily,
			cursorBlink: false,
			theme: {
				background: '#121216',
				foreground: '#d4d4d4',
				cursor: DEFAULT_CURSOR_COLOR,
				selectionBackground: '#264f78',
			},
		});
	}

	open(container: HTMLDivElement): void {
		this.element = container;
		container.tabIndex = 0;
		container.setAttribute('role', 'textbox');
		container.setAttribute('aria-label', 'Terminal');
		container.setAttribute('aria-multiline', 'true');
		if (!this.canvas) throw new Error('Terminal canvas is unavailable');
		container.appendChild(this.canvas);
		const textarea = document.createElement('textarea');
		textarea.className = 'absolute opacity-0 pointer-events-none w-px h-px';
		textarea.setAttribute('aria-label', 'Terminal input');
		container.appendChild(textarea);
		this.textarea = textarea;
		this.input = new InputHandler(
			this.ghostty,
			container,
			(data) =>
				this.dataListeners.forEach((listener) => {
					listener(data);
				}),
			() => undefined,
			undefined,
			undefined,
			(mode) => this.getMode(mode),
		);
		this.wheelListener = (event) => {
			if (!event.deltaY) return;
			event.preventDefault();
			const lines =
				Math.sign(event.deltaY) *
				Math.max(
					1,
					Math.round(Math.abs(event.deltaY) / this.renderer.charHeight),
				);
			this.model.scroll(lines);
			this.scrollListeners.forEach((listener) => {
				listener(lines);
			});
			this.render(true);
		};
		container.addEventListener('wheel', this.wheelListener, { passive: false });
		// Start unfocused so inactive tabs show the hollow outline.
		this.setFocused(false);
	}

	write(data: string | Uint8Array): void {
		this.model.write(data);
		this.scheduleRender();
	}
	resize(cols: number, rows: number): void {
		const metrics = this.renderer.getMetrics();
		this.model.resize(cols, rows, metrics.width, metrics.height);
		this.cols = cols;
		this.rows = rows;
		this.renderer.resize(cols, rows);
		this.resizeListeners.forEach((listener) => {
			listener({ cols, rows });
		});
		this.render(true);
	}
	fit(): void {
		if (!this.element) return;
		const metrics = this.renderer.getMetrics();
		if (!metrics.width || !metrics.height) return;
		const size = calculateTerminalGridSize(
			this.element.clientWidth,
			this.element.clientHeight,
			metrics.width,
			metrics.height,
		);
		if (!size) return;
		if (size.cols !== this.cols || size.rows !== this.rows) {
			this.resize(size.cols, size.rows);
		}
	}
	private scheduleRender(force = false): void {
		if (force) this.pendingForce = true;
		if (this.frame) return;
		this.frame = requestAnimationFrame(() => {
			this.frame = 0;
			const nextForce = this.pendingForce;
			this.pendingForce = false;
			this.render(nextForce);
		});
	}
	private render(force = false): void {
		const cursor = this.model.getCursor();
		const display = resolveTerminalCursorDisplay({
			focused: this.focused,
			modelVisible: cursor.visible,
			modelBlinking: cursor.blinking,
			blinkPhaseVisible: this.blinkPhaseVisible,
		});
		const shape = resolveTerminalCursorShape(display, cursor.style);
		// Suppress CanvasRenderer's solid cursor so we can paint solid/hollow
		// ourselves after the cell content is drawn.
		const wasVisible = cursor.visible;
		cursor.visible = false;
		this.renderer.render(this.model, force);
		cursor.visible = wasVisible;
		if (shape) this.paintCursorOverlay(shape, cursor.x, cursor.y);
	}
	private paintCursorOverlay(
		shape: NonNullable<ReturnType<typeof resolveTerminalCursorShape>>,
		col: number,
		row: number,
	): void {
		const canvas = this.canvas;
		if (!canvas) return;
		const ctx = canvas.getContext('2d');
		if (!ctx) return;
		const metrics = this.renderer.getMetrics();
		if (!metrics.width || !metrics.height) return;
		drawTerminalCursor(ctx, {
			shape,
			color: this.cursorColor,
			rect: terminalCursorCellRect(col, row, metrics.width, metrics.height),
		});
	}
	private startBlinkTimer(): void {
		this.stopBlinkTimer();
		this.blinkPhaseVisible = true;
		this.blinkTimer = setInterval(() => {
			if (!this.focused) return;
			const cursor = this.model.getCursor();
			if (!cursor.visible || !cursor.blinking) {
				if (!this.blinkPhaseVisible) {
					this.blinkPhaseVisible = true;
					this.scheduleRender(true);
				}
				return;
			}
			this.blinkPhaseVisible = !this.blinkPhaseVisible;
			// Force a full paint so the previous solid cursor is erased.
			this.scheduleRender(true);
		}, CURSOR_BLINK_MS);
	}
	private stopBlinkTimer(): void {
		if (this.blinkTimer !== null) {
			clearInterval(this.blinkTimer);
			this.blinkTimer = null;
		}
		this.blinkPhaseVisible = true;
	}
	/**
	 * Focused terminals blink indefinitely; unfocused terminals show a steady
	 * hollow block. Call from DOM focusin/focusout and tab activation.
	 */
	setFocused(focused: boolean): void {
		if (this.focused === focused) {
			// Still repaint so first open / theme changes stay consistent.
			if (!focused) this.scheduleRender(true);
			return;
		}
		this.focused = focused;
		if (focused) {
			this.startBlinkTimer();
		} else {
			this.stopBlinkTimer();
		}
		this.scheduleRender(true);
	}
	/** Keep the cursor solid while the user is typing, then resume blinking. */
	resetCursorBlink(): void {
		if (!this.focused) return;
		this.blinkPhaseVisible = true;
		this.startBlinkTimer();
		this.scheduleRender(true);
	}
	private listen<T>(set: Set<Listener<T>>, listener: Listener<T>): Disposable {
		set.add(listener);
		return { dispose: () => set.delete(listener) };
	}
	onData(listener: Listener<string>): Disposable {
		return this.listen(this.dataListeners, listener);
	}
	onResize(listener: Listener<ResizeEvent>): Disposable {
		return this.listen(this.resizeListeners, listener);
	}
	onScroll(listener: Listener<number>): Disposable {
		return this.listen(this.scrollListeners, listener);
	}
	getViewportY(): number {
		return this.model.getScrollbar().offset;
	}
	isViewportAtBottom(): boolean {
		return this.model.isViewportAtBottom();
	}
	scrollToLine(line = 0): void {
		this.model.scrollToRow(line);
		this.render(true);
	}
	getMode(_mode?: number): boolean {
		return false;
	}
	registerLinkProvider(): Disposable {
		return { dispose() {} };
	}
	focus(): void {
		this.setFocused(true);
		this.element?.focus();
		this.textarea?.focus();
	}
	blur(): void {
		this.setFocused(false);
		this.textarea?.blur();
		this.element?.blur();
	}
	dispose(): void {
		this.stopBlinkTimer();
		if (this.frame) cancelAnimationFrame(this.frame);
		if (this.element && this.wheelListener)
			this.element.removeEventListener('wheel', this.wheelListener);
		this.input?.dispose();
		this.renderer.dispose();
		this.model.free();
		this.canvas?.remove();
		this.textarea?.remove();
		this.dataListeners.clear();
		this.resizeListeners.clear();
		this.scrollListeners.clear();
	}
}
