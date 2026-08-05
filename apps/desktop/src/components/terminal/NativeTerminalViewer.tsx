import {
	TerminalViewer,
	loadEmbeddedTerminalFont,
	requestTerminalWebSocketTicket,
	resolveTerminalApiBaseUrl,
	terminalWebSocketUrl,
	type TerminalViewerProps,
} from '@ottocode/web-sdk/components';
import { useTheme } from '@ottocode/web-sdk/hooks';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import {
	DEFAULT_NATIVE_TERMINAL_METRICS,
	calculateNativeTerminalGrid,
	createNativeTerminalOutputBatcher,
	createNativeTerminal,
	createNativeTerminalSurface,
	destroyNativeTerminal,
	destroyNativeTerminalSurface,
	encodeNativeTerminalKeyLocally,
	encodeNativeTerminalKey,
	feedNativeTerminal,
	feedNativeTerminalGpu,
	getNativeTerminalStatus,
	measureNativeTerminalMetrics,
	nativeTerminalScrollDelta,
	resetNativeTerminal,
	resolveNativeTerminalTheme,
	resolveNativeTerminalShortcut,
	resizeNativeTerminal,
	selectNativeTerminal,
	setNativeTerminalSurfaceCursor,
	setNativeTerminalTheme,
	scrollNativeTerminal,
	updateNativeTerminalSurface,
	type NativeTerminalMetrics,
	type NativeTerminalPoint,
	type NativeTerminalRgb,
	type NativeTerminalSelection,
	type NativeTerminalSnapshot,
	type NativeTerminalUpdate,
} from '../../lib/native-terminal';

const FONT_FAMILY = '"JetBrainsMono NFM", "JetBrains Mono", monospace';
// The bundled TTF advertises this family name; the Canvas FontFace uses NFM.
const NATIVE_FONT_FAMILY = 'JetBrainsMono NF';
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY_MS = 1_500;
const CURSOR_BLINK_MS = 500;
const terminalDecoder = new TextDecoder();
// Matches web-sdk's native-overlay selector: any modal layer must cover the
// GPU overlay child window, which otherwise floats above all webview content.
const BLOCKING_OVERLAY_SELECTOR =
	'[data-native-overlay-root="true"], [aria-modal="true"]';

function hasBlockingOverlay(): boolean {
	return document.querySelector(BLOCKING_OVERLAY_SELECTOR) !== null;
}

function rgb(color: NativeTerminalRgb): string {
	return `rgb(${color.r} ${color.g} ${color.b})`;
}

type TerminalCursorDisplay = 'solid' | 'hidden' | 'hollow';

function drawTerminalSnapshot(
	canvas: HTMLCanvasElement,
	snapshot: NativeTerminalSnapshot,
	cursorDisplay: TerminalCursorDisplay,
	metrics: NativeTerminalMetrics,
	fontFamily: string,
) {
	const width = snapshot.cols * metrics.cellWidth;
	const height = snapshot.rows * metrics.cellHeight;
	const ratio = window.devicePixelRatio || 1;
	const pixelWidth = Math.max(1, Math.round(width * ratio));
	const pixelHeight = Math.max(1, Math.round(height * ratio));
	if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
		canvas.width = pixelWidth;
		canvas.height = pixelHeight;
	}
	canvas.style.width = `${width}px`;
	canvas.style.height = `${height}px`;

	const context = canvas.getContext('2d');
	if (!context) return;
	context.setTransform(ratio, 0, 0, ratio, 0, 0);
	context.textBaseline = 'alphabetic';
	context.fillStyle = rgb(snapshot.defaultBg);
	context.fillRect(0, 0, width, height);

	for (let rowIndex = 0; rowIndex < snapshot.rows; rowIndex++) {
		const row = snapshot.rowsData[rowIndex];
		if (!row) continue;
		for (let colIndex = 0; colIndex < snapshot.cols; colIndex++) {
			const cell = row.cells[colIndex];
			if (!cell) continue;
			let foreground = cell.inverse
				? (cell.bg ?? snapshot.defaultBg)
				: (cell.fg ?? snapshot.defaultFg);
			let background = cell.inverse
				? (cell.fg ?? snapshot.defaultFg)
				: (cell.bg ?? snapshot.defaultBg);
			if (cell.selected) {
				foreground = snapshot.selectionFg;
				background = snapshot.selectionBg;
			}
			const x = colIndex * metrics.cellWidth;
			const y = rowIndex * metrics.cellHeight;

			if (cell.bg || cell.inverse || cell.selected) {
				context.fillStyle = rgb(background);
				context.fillRect(
					x,
					y,
					cell.wide ? metrics.cellWidth * 2 : metrics.cellWidth,
					metrics.cellHeight,
				);
			}
			if (!cell.text || cell.spacer) continue;

			context.globalAlpha = cell.faint ? 0.6 : 1;
			context.fillStyle = rgb(foreground);
			context.font = `${cell.italic ? 'italic ' : ''}${
				cell.bold ? '700' : '400'
			} ${metrics.fontSize}px ${fontFamily}`;
			context.fillText(cell.text, x, y + metrics.fontSize + 1);
			context.globalAlpha = 1;
			if (cell.underline) {
				context.fillRect(x, y + metrics.cellHeight - 2, metrics.cellWidth, 1);
			}
			if (cell.strikethrough) {
				context.fillRect(
					x,
					y + Math.floor(metrics.cellHeight / 2),
					metrics.cellWidth,
					1,
				);
			}
		}
	}

	const cursor = snapshot.cursor;
	if (!cursor.visible || cursorDisplay === 'hidden') return;
	const x = cursor.col * metrics.cellWidth;
	const y = cursor.row * metrics.cellHeight;
	context.fillStyle = rgb(cursor.color ?? snapshot.defaultFg);
	// Unfocused terminals render a steady hollow outline regardless of the
	// shape the running application configured.
	const shape = cursorDisplay === 'hollow' ? 'blockHollow' : cursor.shape;
	switch (shape) {
		case 'bar':
			context.fillRect(x, y, 2, metrics.cellHeight);
			break;
		case 'underline':
			context.fillRect(x, y + metrics.cellHeight - 2, metrics.cellWidth, 2);
			break;
		case 'blockHollow':
			context.strokeStyle = context.fillStyle;
			context.strokeRect(
				x + 0.5,
				y + 0.5,
				metrics.cellWidth - 1,
				metrics.cellHeight - 1,
			);
			break;
		default:
			context.globalAlpha = 0.65;
			context.fillRect(x, y, metrics.cellWidth, metrics.cellHeight);
			context.globalAlpha = 1;
	}
}

export const NativeTerminalViewer = memo(function NativeTerminalViewer(
	props: TerminalViewerProps,
) {
	const [nativeAvailable, setNativeAvailable] = useState<boolean | null>(null);

	useEffect(() => {
		let disposed = false;
		void getNativeTerminalStatus().then((status) => {
			if (!disposed) setNativeAvailable(status.available);
		});
		return () => {
			disposed = true;
		};
	}, []);

	if (nativeAvailable === false) return <TerminalViewer {...props} />;
	if (nativeAvailable === null) {
		return (
			<div className="flex h-full items-center justify-center bg-background text-xs text-muted-foreground">
				Starting native terminal…
			</div>
		);
	}
	return <NativeTerminalSurface {...props} />;
});

const NativeTerminalSurface = memo(function NativeTerminalSurface({
	terminalId,
	isActive,
	onExit,
}: TerminalViewerProps) {
	const { theme: themeId } = useTheme();
	const hostRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLTextAreaElement>(null);
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const socketRef = useRef<WebSocket | null>(null);
	const snapshotRef = useRef<NativeTerminalSnapshot | null>(null);
	const updateQueueRef = useRef(Promise.resolve());
	const reconnectTimerRef = useRef<number | null>(null);
	const reconnectAttemptsRef = useRef(0);
	const exitedRef = useRef(false);
	const nativeSessionIdRef = useRef<string | null>(null);
	const appliedThemeIdRef = useRef<string | null>(null);
	const selectionAnchorRef = useRef<NativeTerminalPoint | null>(null);
	const selectionFocusRef = useRef<NativeTerminalPoint | null>(null);
	const selectionTextRef = useRef('');
	const selectingRef = useRef(false);
	const gpuActiveRef = useRef(false);
	const isActiveRef = useRef(isActive);
	const metricsRef = useRef<NativeTerminalMetrics>(
		DEFAULT_NATIVE_TERMINAL_METRICS,
	);
	const canvasFontFamilyRef = useRef(FONT_FAMILY);
	const onExitRef = useRef(onExit);
	const focusedRef = useRef(false);
	const blinkHiddenRef = useRef(false);
	const [ready, setReady] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [gpuActive, setGpuActive] = useState(false);
	const [focused, setFocused] = useState(false);
	const activeThemeId =
		themeId ??
		(typeof document === 'undefined'
			? undefined
			: document.documentElement.dataset.theme);
	const activeThemeIdRef = useRef(activeThemeId);
	activeThemeIdRef.current = activeThemeId;
	onExitRef.current = onExit;
	isActiveRef.current = isActive;
	canvasFontFamilyRef.current = FONT_FAMILY;

	const redraw = useCallback(() => {
		if (!gpuActiveRef.current && canvasRef.current && snapshotRef.current) {
			drawTerminalSnapshot(
				canvasRef.current,
				snapshotRef.current,
				focusedRef.current
					? blinkHiddenRef.current
						? 'hidden'
						: 'solid'
					: 'hollow',
				metricsRef.current,
				canvasFontFamilyRef.current,
			);
		}
	}, []);

	const syncGpuCursor = useCallback(() => {
		const nativeSessionId = nativeSessionIdRef.current;
		if (!nativeSessionId || !gpuActiveRef.current) return;
		void setNativeTerminalSurfaceCursor(nativeSessionId, {
			hollow: !focusedRef.current,
			hidden: focusedRef.current && blinkHiddenRef.current,
		}).catch(() => undefined);
	}, []);

	/** Restarts the blink phase so the cursor is solid while typing. */
	const resetCursorBlink = useCallback(() => {
		if (!blinkHiddenRef.current) return;
		blinkHiddenRef.current = false;
		redraw();
		syncGpuCursor();
	}, [redraw, syncGpuCursor]);

	const applyUpdate = useCallback(
		(update: NativeTerminalUpdate) => {
			snapshotRef.current = update.snapshot;
			if (update.selectedText !== undefined) {
				selectionTextRef.current = update.selectedText ?? '';
			}
			redraw();
			if (
				update.ptyWrites.length > 0 &&
				socketRef.current?.readyState === WebSocket.OPEN
			) {
				socketRef.current.send(
					terminalDecoder.decode(new Uint8Array(update.ptyWrites)),
				);
			}
		},
		[redraw],
	);

	const enqueue = useCallback((operation: () => Promise<void>) => {
		updateQueueRef.current = updateQueueRef.current.then(operation, operation);
		return updateQueueRef.current;
	}, []);

	useEffect(() => {
		const nativeSessionId = nativeSessionIdRef.current;
		if (
			!nativeSessionId ||
			appliedThemeIdRef.current === (activeThemeId ?? null)
		) {
			return;
		}
		void enqueue(async () => {
			const terminalTheme = resolveNativeTerminalTheme(
				activeThemeIdRef.current,
			);
			const update = await setNativeTerminalTheme(
				nativeSessionId,
				terminalTheme,
			);
			appliedThemeIdRef.current = activeThemeIdRef.current ?? null;
			applyUpdate(update);
		}).catch(() => undefined);
	}, [activeThemeId, applyUpdate, enqueue]);

	useEffect(() => {
		if (isActive) inputRef.current?.focus();
		const frame = window.requestAnimationFrame(() => {
			const host = hostRef.current;
			const nativeSessionId = nativeSessionIdRef.current;
			if (!host || !nativeSessionId) return;
			const bounds = host.getBoundingClientRect();
			void updateNativeTerminalSurface(nativeSessionId, {
				x: bounds.x,
				y: bounds.y,
				width: bounds.width,
				height: bounds.height,
				hidden: !isActive || hasBlockingOverlay(),
			})
				.then(async () => {
					if (!isActive) return;
					const grid = calculateNativeTerminalGrid(
						bounds.width,
						bounds.height,
						metricsRef.current,
					);
					applyUpdate(
						await resizeNativeTerminal(nativeSessionId, grid.cols, grid.rows),
					);
				})
				.catch(() => undefined);
		});
		return () => window.cancelAnimationFrame(frame);
	}, [applyUpdate, isActive]);

	// Focused terminals blink; unfocused terminals show a steady hollow
	// outline. Focus and blink phase live in the webview, so the GPU surface
	// mirrors them through a cursor override.
	useEffect(() => {
		focusedRef.current = focused;
		blinkHiddenRef.current = false;
		redraw();
		syncGpuCursor();
		if (!focused) return;
		const timer = window.setInterval(() => {
			blinkHiddenRef.current = !blinkHiddenRef.current;
			redraw();
			syncGpuCursor();
		}, CURSOR_BLINK_MS);
		return () => window.clearInterval(timer);
	}, [focused, redraw, syncGpuCursor]);

	useEffect(() => {
		const host = hostRef.current;
		if (!host) return;
		const nativeSessionId = `${terminalId}:${crypto.randomUUID()}`;
		nativeSessionIdRef.current = nativeSessionId;
		let disposed = false;
		exitedRef.current = false;
		setError(null);
		setReady(false);
		setGpuActive(false);
		gpuActiveRef.current = false;
		selectionAnchorRef.current = null;
		selectionFocusRef.current = null;
		selectionTextRef.current = '';
		selectingRef.current = false;
		appliedThemeIdRef.current = null;
		const encoder = new TextEncoder();
		let resizeObserver: ResizeObserver | null = null;
		let overlayObserver: MutationObserver | null = null;
		let unlistenMoved: (() => void) | null = null;
		const overlayFollowsOwner = /Macintosh|Mac OS X/.test(navigator.userAgent);
		let lastGrid = { cols: 0, rows: 0 };
		let surfaceCreated = false;

		const surfaceBounds = () => {
			const bounds = host.getBoundingClientRect();
			return {
				x: bounds.x,
				y: bounds.y,
				width: bounds.width,
				height: bounds.height,
				hidden: !isActiveRef.current || hasBlockingOverlay(),
			};
		};

		const syncSurface = () => {
			if (!surfaceCreated || disposed) return;
			void updateNativeTerminalSurface(nativeSessionId, surfaceBounds()).catch(
				() => undefined,
			);
		};

		const fail = (cause: unknown) => {
			if (disposed) return;
			setError(cause instanceof Error ? cause.message : String(cause));
		};

		// Chunks arriving while a native feed is in flight merge into the next
		// feed, so heavy output costs one IPC per drain instead of one per chunk.
		// Replay chunks are kept separate: replayed history regenerates VT query
		// replies (DECRQM, DA1, DSR, OSC color reports) that must never reach the
		// live PTY, where the shell would echo them as line noise.
		let outputQueue: Array<{ data: string; replay: boolean }> = [];
		const sendPtyWrites = (ptyWrites: number[]) => {
			if (
				ptyWrites.length > 0 &&
				socketRef.current?.readyState === WebSocket.OPEN
			) {
				socketRef.current.send(
					terminalDecoder.decode(new Uint8Array(ptyWrites)),
				);
			}
		};
		const feedOutput = (message: string, replay: boolean) => {
			if (!message || disposed) return;
			const drainPending = outputQueue.length > 0;
			const tail = outputQueue[outputQueue.length - 1];
			if (tail && tail.replay === replay) {
				tail.data += message;
			} else {
				outputQueue.push({ data: message, replay });
			}
			if (drainPending) return;
			void enqueue(async () => {
				while (outputQueue.length > 0 && !disposed) {
					const { data: chunk, replay: isReplay } = outputQueue[0];
					outputQueue.shift();
					if (gpuActiveRef.current) {
						const result = await feedNativeTerminalGpu(
							nativeSessionId,
							encoder.encode(chunk),
						);
						if (!isReplay) sendPtyWrites(result.ptyWrites);
					} else {
						const update = await feedNativeTerminal(
							nativeSessionId,
							encoder.encode(chunk),
						);
						if (!disposed) {
							applyUpdate(isReplay ? { ...update, ptyWrites: [] } : update);
						}
					}
				}
			}).catch(fail);
		};
		const outputBatcher = createNativeTerminalOutputBatcher(feedOutput);

		const processOutput = (message: string) => {
			if (disposed) return;
			if (message.startsWith('{')) {
				try {
					const control = JSON.parse(message) as {
						type?: unknown;
						exitCode?: unknown;
						data?: unknown;
					};
					if (control.type === 'exit') {
						outputBatcher.flush();
						exitedRef.current = true;
						const exitCode =
							typeof control.exitCode === 'number' ? control.exitCode : 0;
						void enqueue(async () => {
							const update = await feedNativeTerminal(
								nativeSessionId,
								encoder.encode(
									`\r\n\x1b[33m[Process exited with code ${exitCode}]\x1b[0m\r\n`,
								),
							);
							applyUpdate(update);
						});
						onExitRef.current?.(terminalId);
						return;
					}
					if (control.type === 'history' && typeof control.data === 'string') {
						outputBatcher.push(control.data);
						outputBatcher.flush();
						return;
					}
				} catch {
					// Ordinary terminal output may begin with a brace.
				}
			}
			outputBatcher.push(message);
		};

		const connect = async () => {
			try {
				outputBatcher.beginReplay();
				if (reconnectAttemptsRef.current > 0) {
					const update = await resetNativeTerminal(nativeSessionId);
					if (disposed) return;
					applyUpdate(update);
				}
				const baseUrl = resolveTerminalApiBaseUrl();
				const ticket = await requestTerminalWebSocketTicket(
					baseUrl,
					terminalId,
				);
				if (disposed) return;
				const socketUrl = new URL(
					terminalWebSocketUrl(baseUrl, terminalId, ticket),
				);
				socketUrl.searchParams.set('historyMode', 'framed');
				const socket = new WebSocket(socketUrl);
				socketRef.current = socket;
				socket.onopen = () => {
					reconnectAttemptsRef.current = 0;
					setReady(true);
					setError(null);
					if (lastGrid.cols > 0 && lastGrid.rows > 0) {
						socket.send(JSON.stringify({ type: 'resize', ...lastGrid }));
					}
				};
				socket.onmessage = (event) => {
					if (typeof event.data === 'string') processOutput(event.data);
				};
				socket.onerror = () => {
					// Reconnect and error reporting are handled by onclose.
				};
				socket.onclose = () => {
					if (socketRef.current === socket) socketRef.current = null;
					setReady(false);
					if (
						disposed ||
						exitedRef.current ||
						reconnectAttemptsRef.current >= MAX_RECONNECT_ATTEMPTS
					) {
						return;
					}
					reconnectAttemptsRef.current += 1;
					reconnectTimerRef.current = window.setTimeout(() => {
						void connect();
					}, RECONNECT_DELAY_MS);
				};
			} catch (cause) {
				fail(cause);
				if (
					!disposed &&
					reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS
				) {
					reconnectAttemptsRef.current += 1;
					reconnectTimerRef.current = window.setTimeout(() => {
						void connect();
					}, RECONNECT_DELAY_MS);
				}
			}
		};

		const resize = () => {
			const bounds = host.getBoundingClientRect();
			syncSurface();
			if (!isActiveRef.current || bounds.width < 1 || bounds.height < 1) {
				return;
			}
			const grid = calculateNativeTerminalGrid(
				bounds.width,
				bounds.height,
				metricsRef.current,
			);
			if (grid.cols === lastGrid.cols && grid.rows === lastGrid.rows) return;
			lastGrid = grid;
			void enqueue(async () => {
				const update = await resizeNativeTerminal(
					nativeSessionId,
					grid.cols,
					grid.rows,
				);
				if (disposed) return;
				applyUpdate(update);
				if (socketRef.current?.readyState === WebSocket.OPEN) {
					socketRef.current.send(JSON.stringify({ type: 'resize', ...grid }));
				}
			}).catch(fail);
		};

		void (async () => {
			const bounds = host.getBoundingClientRect();
			lastGrid = calculateNativeTerminalGrid(
				bounds.width,
				bounds.height,
				metricsRef.current,
			);
			const update = await createNativeTerminal(
				nativeSessionId,
				lastGrid.cols,
				lastGrid.rows,
				resolveNativeTerminalTheme(activeThemeIdRef.current),
			);
			if (disposed) return;
			appliedThemeIdRef.current = activeThemeIdRef.current ?? null;
			applyUpdate(update);
			resizeObserver = new ResizeObserver(resize);
			resizeObserver.observe(host);
			overlayObserver = new MutationObserver(syncSurface);
			overlayObserver.observe(document.body, {
				childList: true,
				subtree: true,
				attributes: true,
			});
			window.addEventListener('resize', syncSurface);
			window.addEventListener('scroll', syncSurface, true);
			// Clicking the webview raises the owner window above the GPU overlay
			// child; re-assert overlay order on any pointer or focus activity.
			window.addEventListener('pointerdown', syncSurface, true);
			window.addEventListener('focus', syncSurface);
			if (!overlayFollowsOwner) {
				void getCurrentWindow()
					.onMoved(syncSurface)
					.then((unlisten) => {
						unlistenMoved = unlisten;
					});
			}
			void connect();
			await loadEmbeddedTerminalFont();
			await document.fonts.ready;
			if (disposed) return;
			const activeMetrics = measureNativeTerminalMetrics(FONT_FAMILY);
			metricsRef.current = activeMetrics;
			resize();
			try {
				const surface = await createNativeTerminalSurface(
					nativeSessionId,
					surfaceBounds(),
					{
						family: NATIVE_FONT_FAMILY,
						size: activeMetrics.fontSize,
						cellWidth: activeMetrics.cellWidth,
						cellHeight: activeMetrics.cellHeight,
					},
				);
				surfaceCreated = surface.available;
				if (disposed) {
					await destroyNativeTerminalSurface(nativeSessionId).catch(
						() => undefined,
					);
					return;
				}
				if (surfaceCreated && !disposed) {
					// Adopt the cell metrics the GPU font system actually resolved;
					// the canvas measurement can disagree, which drifts the cursor
					// and right-aligned TUI content away from the shaped text.
					if (surface.cellWidth && surface.cellHeight) {
						metricsRef.current = {
							...metricsRef.current,
							cellWidth: surface.cellWidth,
							cellHeight: surface.cellHeight,
						};
					}
					gpuActiveRef.current = true;
					setGpuActive(true);
					// The GPU override defaults to solid; mirror current focus state.
					syncGpuCursor();
					const hostBounds = host.getBoundingClientRect();
					const grid = calculateNativeTerminalGrid(
						hostBounds.width,
						hostBounds.height,
						metricsRef.current,
					);
					lastGrid = grid;
					const rendered = await resizeNativeTerminal(
						nativeSessionId,
						grid.cols,
						grid.rows,
					);
					applyUpdate(rendered);
					if (socketRef.current?.readyState === WebSocket.OPEN) {
						socketRef.current.send(JSON.stringify({ type: 'resize', ...grid }));
					}
				}
			} catch {
				// Canvas fallback remains active when a GPU adapter is unavailable.
			}
		})().catch(fail);

		return () => {
			disposed = true;
			gpuActiveRef.current = false;
			outputBatcher.dispose();
			outputQueue = [];
			resizeObserver?.disconnect();
			overlayObserver?.disconnect();
			unlistenMoved?.();
			window.removeEventListener('resize', syncSurface);
			window.removeEventListener('scroll', syncSurface, true);
			window.removeEventListener('pointerdown', syncSurface, true);
			window.removeEventListener('focus', syncSurface);
			if (reconnectTimerRef.current !== null) {
				window.clearTimeout(reconnectTimerRef.current);
				reconnectTimerRef.current = null;
			}
			if (socketRef.current) {
				socketRef.current.onopen = null;
				socketRef.current.onmessage = null;
				socketRef.current.onclose = null;
				socketRef.current.onerror = null;
				socketRef.current.close();
			}
			socketRef.current = null;
			void updateNativeTerminalSurface(nativeSessionId, {
				x: 0,
				y: 0,
				width: 0,
				height: 0,
				hidden: true,
			})
				.catch(() => undefined)
				.finally(async () => {
					await destroyNativeTerminalSurface(nativeSessionId).catch(
						() => undefined,
					);
					await destroyNativeTerminal(nativeSessionId).catch(() => undefined);
				});
			if (nativeSessionIdRef.current === nativeSessionId) {
				nativeSessionIdRef.current = null;
			}
		};
	}, [applyUpdate, enqueue, syncGpuCursor, terminalId]);

	const updateSelection = useCallback(
		(selection: NativeTerminalSelection | null) => {
			const nativeSessionId = nativeSessionIdRef.current;
			if (!nativeSessionId) return;
			void enqueue(async () => {
				const update = await selectNativeTerminal(nativeSessionId, selection);
				applyUpdate(update);
			}).catch((cause) => {
				setError(cause instanceof Error ? cause.message : String(cause));
			});
		},
		[applyUpdate, enqueue],
	);

	const clearSelection = useCallback(() => {
		if (!selectionAnchorRef.current && !selectionTextRef.current) return;
		selectionAnchorRef.current = null;
		selectionFocusRef.current = null;
		selectionTextRef.current = '';
		updateSelection(null);
	}, [updateSelection]);

	const pointFromPointer = useCallback(
		(
			event: React.PointerEvent<HTMLTextAreaElement>,
		): NativeTerminalPoint | null => {
			const host = hostRef.current;
			const snapshot = snapshotRef.current;
			if (!host || !snapshot) return null;
			const bounds = host.getBoundingClientRect();
			return {
				col: Math.max(
					0,
					Math.min(
						snapshot.cols - 1,
						Math.floor(
							(event.clientX - bounds.left) / metricsRef.current.cellWidth,
						),
					),
				),
				row: Math.max(
					0,
					Math.min(
						snapshot.rows - 1,
						Math.floor(
							(event.clientY - bounds.top) / metricsRef.current.cellHeight,
						),
					),
				),
			};
		},
		[],
	);

	const sendTerminalData = useCallback((data: string) => {
		if (data && socketRef.current?.readyState === WebSocket.OPEN) {
			socketRef.current.send(data);
		}
	}, []);

	const handleKeyDown = useCallback(
		(event: React.KeyboardEvent<HTMLTextAreaElement>) => {
			const nativeSessionId = nativeSessionIdRef.current;
			if (!nativeSessionId) return;
			const shortcut = resolveNativeTerminalShortcut(
				event,
				/Mac|iPhone|iPad|iPod/.test(navigator.platform),
			);
			if (shortcut.action === 'copy') {
				event.preventDefault();
				event.stopPropagation();
				if (!selectionTextRef.current) return;
				if (navigator.clipboard?.writeText) {
					void navigator.clipboard
						.writeText(selectionTextRef.current)
						.catch(() => undefined);
				} else {
					document.execCommand('copy');
				}
				return;
			}
			if (shortcut.action === 'paste') {
				if (!navigator.clipboard?.readText) return;
				event.preventDefault();
				event.stopPropagation();
				void navigator.clipboard
					.readText()
					.then((text) => {
						if (!text) return;
						clearSelection();
						sendTerminalData(text);
					})
					.catch(() => undefined);
				return;
			}
			if (event.key === 'Process' || event.nativeEvent.isComposing) return;
			event.preventDefault();
			event.stopPropagation();
			resetCursorBlink();
			clearSelection();
			if (shortcut.action === 'send') {
				sendTerminalData(shortcut.data);
				return;
			}
			const localEncoding = encodeNativeTerminalKeyLocally(event);
			if (localEncoding !== null) {
				sendTerminalData(localEncoding);
				return;
			}
			void encodeNativeTerminalKey(nativeSessionId, {
				code: event.code,
				text: event.key.length === 1 ? event.key : null,
				ctrl: event.ctrlKey,
				alt: event.altKey,
				shift: event.shiftKey,
				meta: event.metaKey,
				repeat: event.repeat,
			})
				.then((output) => {
					if (
						output.length > 0 &&
						socketRef.current?.readyState === WebSocket.OPEN
					) {
						socketRef.current.send(
							terminalDecoder.decode(new Uint8Array(output)),
						);
					}
				})
				.catch((cause) => {
					setError(cause instanceof Error ? cause.message : String(cause));
				});
		},
		[clearSelection, resetCursorBlink, sendTerminalData],
	);

	return (
		<div
			ref={hostRef}
			data-terminal-viewer
			className="relative h-full w-full overflow-hidden bg-background outline-none"
		>
			<canvas
				ref={canvasRef}
				className={`pointer-events-none block ${
					gpuActive ? 'opacity-0' : 'opacity-100'
				}`}
			/>
			<textarea
				ref={inputRef}
				value=""
				aria-label="Terminal input"
				spellCheck={false}
				className="absolute inset-0 z-10 h-full w-full resize-none opacity-0"
				onChange={() => undefined}
				onKeyDown={handleKeyDown}
				onFocus={() => setFocused(true)}
				onBlur={() => setFocused(false)}
				onCopy={(event) => {
					if (!selectionTextRef.current) return;
					event.preventDefault();
					event.clipboardData.setData('text/plain', selectionTextRef.current);
				}}
				onCompositionEnd={(event) => {
					if (event.data && socketRef.current?.readyState === WebSocket.OPEN) {
						socketRef.current.send(event.data);
					}
				}}
				onPaste={(event) => {
					const text = event.clipboardData.getData('text/plain');
					if (!text || socketRef.current?.readyState !== WebSocket.OPEN) return;
					event.preventDefault();
					clearSelection();
					socketRef.current.send(text);
				}}
				onPointerDown={(event) => {
					if (event.button !== 0) return;
					const point = pointFromPointer(event);
					if (!point) return;
					event.preventDefault();
					inputRef.current?.focus();
					event.currentTarget.setPointerCapture(event.pointerId);
					selectingRef.current = true;
					selectionAnchorRef.current = point;
					selectionFocusRef.current = point;
					selectionTextRef.current = '';
					updateSelection({ start: point, end: point });
				}}
				onPointerMove={(event) => {
					if (!selectingRef.current || !selectionAnchorRef.current) return;
					const point = pointFromPointer(event);
					const previous = selectionFocusRef.current;
					if (
						!point ||
						(previous?.col === point.col && previous.row === point.row)
					) {
						return;
					}
					selectionFocusRef.current = point;
					updateSelection({ start: selectionAnchorRef.current, end: point });
				}}
				onPointerUp={(event) => {
					if (!selectingRef.current) return;
					selectingRef.current = false;
					event.currentTarget.releasePointerCapture(event.pointerId);
					const start = selectionAnchorRef.current;
					const end = pointFromPointer(event) ?? selectionFocusRef.current;
					if (
						!start ||
						!end ||
						(start.col === end.col && start.row === end.row)
					) {
						clearSelection();
						return;
					}
					selectionFocusRef.current = end;
					updateSelection({ start, end });
				}}
				onPointerCancel={() => {
					selectingRef.current = false;
				}}
				onWheel={(event) => {
					event.preventDefault();
					const nativeSessionId = nativeSessionIdRef.current;
					if (!nativeSessionId) return;
					const delta = nativeTerminalScrollDelta(event);
					if (delta === 0) return;
					selectionAnchorRef.current = null;
					selectionFocusRef.current = null;
					selectionTextRef.current = '';
					void enqueue(async () => {
						await selectNativeTerminal(nativeSessionId, null);
						applyUpdate(await scrollNativeTerminal(nativeSessionId, delta));
					}).catch(() => undefined);
				}}
			/>
			{!ready && !error ? (
				<div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-background/70 text-xs text-muted-foreground">
					Connecting terminal…
				</div>
			) : null}
			{error ? (
				<div className="pointer-events-none absolute right-3 bottom-2 rounded bg-destructive/15 px-2 py-1 text-[10px] text-destructive">
					{error}
				</div>
			) : null}
		</div>
	);
});
