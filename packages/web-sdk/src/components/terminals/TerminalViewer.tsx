import { memo, useEffect, useRef, useState, useCallback } from 'react';
import { InlineGhosttyTerminal } from '../../lib/inline-ghostty-terminal';
import { loadGhosttyVt } from '../../lib/ghostty-vt';
import { getRuntimeApiBaseUrl } from '../../lib/config';
import {
	authenticatedFetch,
	getProjectQuery,
} from '../../lib/api-client/utils';
import { client } from '@ottocode/api';
import { StableSpinner } from '../ui/StableSpinner';

const FONT_FAMILY = '"JetBrainsMono NFM", monospace';
const WS_RECONNECT_DELAY = 1500;
const WS_MAX_RETRIES = 5;
const RESIZE_SETTLE_DELAY = 120;

export function resolveTerminalBackgroundColor(): string {
	if (typeof document === 'undefined') return '#121216';
	const el = document.createElement('div');
	el.style.display = 'none';
	el.className = 'bg-background';
	document.body.appendChild(el);
	const computed = getComputedStyle(el).backgroundColor;
	document.body.removeChild(el);
	const match = computed.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
	if (match) {
		const r = Number(match[1]);
		const g = Number(match[2]);
		const b = Number(match[3]);
		return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
	}
	return '#121216';
}

let fontsLoaded = false;

export async function loadEmbeddedTerminalFont(): Promise<void> {
	if (fontsLoaded) return;
	if (typeof document === 'undefined' || !('FontFace' in window)) return;

	const variants = [
		{
			file: 'JetBrainsMonoNerdFontMono-Regular.woff2',
			weight: '400',
			style: 'normal',
		},
		{
			file: 'JetBrainsMonoNerdFontMono-Bold.woff2',
			weight: '700',
			style: 'normal',
		},
		{
			file: 'JetBrainsMonoNerdFontMono-Italic.woff2',
			weight: '400',
			style: 'italic',
		},
		{
			file: 'JetBrainsMonoNerdFontMono-BoldItalic.woff2',
			weight: '700',
			style: 'italic',
		},
	];

	const loads = variants.map(async (v) => {
		try {
			const url = new URL(`../../assets/fonts/${v.file}`, import.meta.url).href;
			const face = new FontFace(
				'JetBrainsMono NFM',
				`url("${url}") format("woff2")`,
				{
					weight: v.weight,
					style: v.style,
				},
			);
			const loaded = await face.load();
			document.fonts.add(loaded);
		} catch {
			// variant not available
		}
	});

	await Promise.allSettled(loads);
	fontsLoaded = true;
}

export function resolveTerminalApiBaseUrl(): string {
	const config = client.getConfig?.();
	if (
		config &&
		typeof config.baseURL === 'string' &&
		config.baseURL.length > 0
	) {
		return config.baseURL;
	}
	return getRuntimeApiBaseUrl();
}

export function terminalWebSocketUrl(
	baseUrl: string,
	terminalId: string,
	ticket: string,
): string {
	const url = new URL(
		`/v1/terminals/${encodeURIComponent(terminalId)}/ws`,
		baseUrl,
	);
	url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
	url.searchParams.set('ticket', ticket);
	return url.toString();
}

export async function requestTerminalWebSocketTicket(
	baseUrl: string,
	terminalId: string,
): Promise<string> {
	const url = new URL(
		`/v1/terminals/${encodeURIComponent(terminalId)}/ws-ticket`,
		baseUrl,
	);
	const params = new URLSearchParams(getProjectQuery());
	url.search = params.toString();
	const response = await authenticatedFetch(url, {
		method: 'POST',
		credentials: 'include',
		cache: 'no-store',
	});
	if (!response.ok)
		throw new Error(`Terminal authorization failed (${response.status})`);
	const body = (await response.json()) as { ticket?: unknown };
	if (typeof body.ticket !== 'string' || !body.ticket) {
		throw new Error('Terminal authorization returned an invalid ticket');
	}
	return body.ticket;
}

export interface TerminalViewerProps {
	terminalId: string;
	isActive: boolean;
	onExit?: (terminalId: string) => void;
	onInitializationError?: (error: Error) => void;
}

export const TerminalViewer = memo(function TerminalViewer({
	terminalId,
	isActive,
	onExit,
	onInitializationError,
}: TerminalViewerProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const termRef = useRef<InlineGhosttyTerminal | null>(null);
	const fitAddonRef = useRef<{ fit(): void } | null>(null);
	const wsRef = useRef<WebSocket | null>(null);
	const retryCountRef = useRef(0);
	const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const [ready, setReady] = useState(false);
	const [initializationError, setInitializationError] = useState<Error | null>(
		null,
	);
	const onExitRef = useRef(onExit);
	onExitRef.current = onExit;
	const onInitializationErrorRef = useRef(onInitializationError);
	onInitializationErrorRef.current = onInitializationError;
	const userScrolledRef = useRef(false);
	const disposedRef = useRef(false);
	const focusHandlersRef = useRef<{
		focusin: () => void;
		focusout: () => void;
	} | null>(null);

	const fitTerminal = useCallback(() => {
		if (fitAddonRef.current) {
			try {
				fitAddonRef.current.fit();
			} catch {
				// container might not be visible yet
			}
		}
	}, []);

	const connectWebSocket = useCallback(
		async (term: InlineGhosttyTerminal, baseUrl: string) => {
			const scheduleReconnect = () => {
				if (disposedRef.current || retryCountRef.current >= WS_MAX_RETRIES) {
					return;
				}
				retryCountRef.current++;
				if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
				retryTimerRef.current = setTimeout(() => {
					retryTimerRef.current = null;
					if (termRef.current && !disposedRef.current) {
						connectWebSocket(termRef.current, baseUrl);
					}
				}, WS_RECONNECT_DELAY);
			};

			if (wsRef.current) {
				wsRef.current.close();
				wsRef.current = null;
			}

			let ticket: string;
			try {
				ticket = await requestTerminalWebSocketTicket(baseUrl, terminalId);
			} catch (error) {
				console.warn('[TerminalViewer] Failed to authorize WebSocket:', error);
				setReady(false);
				scheduleReconnect();
				return;
			}
			if (disposedRef.current) return;
			const wsUrl = terminalWebSocketUrl(baseUrl, terminalId, ticket);
			const ws = new WebSocket(wsUrl);
			ws.binaryType = 'arraybuffer';
			wsRef.current = ws;

			ws.onopen = () => {
				if (term.cols && term.rows) {
					ws.send(
						JSON.stringify({
							type: 'resize',
							cols: term.cols,
							rows: term.rows,
						}),
					);
				}
				setTimeout(() => {
					if (
						wsRef.current === ws &&
						ws.readyState === WebSocket.OPEN &&
						!disposedRef.current
					) {
						retryCountRef.current = 0;
						setReady(true);
					}
				}, 200);
			};

			ws.onmessage = (event) => {
				retryCountRef.current = 0;
				setReady(true);
				const message =
					typeof event.data === 'string'
						? event.data
						: event.data instanceof ArrayBuffer
							? new Uint8Array(event.data)
							: '';

				if (typeof message === 'string' && message.startsWith('{')) {
					try {
						const data = JSON.parse(message);
						if (data.type === 'exit') {
							term.write(
								`\r\n\x1b[33m[Process exited with code ${data.exitCode}]\x1b[0m\r\n`,
							);
							if (onExitRef.current) {
								onExitRef.current(terminalId);
							}
							return;
						}
					} catch {
						// not JSON control message, write as terminal data
					}
				}

				const savedY = userScrolledRef.current ? term.getViewportY() : 0;
				term.write(message);
				if (userScrolledRef.current && savedY > 0) {
					term.scrollToLine(savedY);
				}
			};

			ws.onerror = () => {
				// error handling done in onclose
			};

			ws.onclose = () => {
				if (wsRef.current === ws) {
					wsRef.current = null;
				}
				scheduleReconnect();
			};
		},
		[terminalId],
	);

	useEffect(() => {
		if (!containerRef.current || !terminalId) return;

		let disposed = false;
		disposedRef.current = false;
		let term: InlineGhosttyTerminal | null = null;
		let fitAddon: { fit(): void } | null = null;
		let resizeObserver: ResizeObserver | null = null;
		let resizeTimer: ReturnType<typeof setTimeout> | null = null;

		setReady(false);
		setInitializationError(null);
		retryCountRef.current = 0;

		if (wsRef.current) {
			wsRef.current.close();
			wsRef.current = null;
		}
		if (retryTimerRef.current) {
			clearTimeout(retryTimerRef.current);
			retryTimerRef.current = null;
		}

		const setup = async () => {
			const ghosttyVt = await loadGhosttyVt();
			if (disposed || !containerRef.current) return;

			await loadEmbeddedTerminalFont();
			await document.fonts.ready;

			term = new InlineGhosttyTerminal(ghosttyVt, {
				fontSize: 13,
				fontFamily: FONT_FAMILY,
			});

			fitAddon = { fit: () => term?.fit() };
			term.open(containerRef.current);

			// Typing should keep the cursor solid; blink ownership lives on the
			// terminal so the phase never gets stuck invisible without a repaint.
			term.onData(() => {
				termRef.current?.resetCursorBlink();
			});

			const handleFocusIn = () => {
				termRef.current?.setFocused(true);
			};

			const handleFocusOut = () => {
				termRef.current?.setFocused(false);
			};

			containerRef.current.addEventListener('focusin', handleFocusIn);
			containerRef.current.addEventListener('focusout', handleFocusOut);
			focusHandlersRef.current = {
				focusin: handleFocusIn,
				focusout: handleFocusOut,
			};

			await new Promise<void>((resolve) => {
				requestAnimationFrame(() => {
					try {
						fitAddon?.fit();
					} catch {
						// container might not be visible
					}
					resolve();
				});
			});

			if (disposed) return;

			const baseUrl = resolveTerminalApiBaseUrl();

			connectWebSocket(term, baseUrl);

			term.onData((data) => {
				if (wsRef.current?.readyState === WebSocket.OPEN) {
					wsRef.current.send(data);
				}
			});

			term.onResize(({ cols, rows }) => {
				if (wsRef.current?.readyState === WebSocket.OPEN) {
					wsRef.current.send(JSON.stringify({ type: 'resize', cols, rows }));
				}
			});

			term.onScroll(() => {
				userScrolledRef.current = term.getViewportY() > 0;
			});

			termRef.current = term;
			fitAddonRef.current = fitAddon;

			resizeObserver = new ResizeObserver(() => {
				if (resizeTimer) clearTimeout(resizeTimer);
				resizeTimer = setTimeout(() => {
					resizeTimer = null;
					if (fitAddonRef.current && !disposed) {
						try {
							fitAddonRef.current.fit();
						} catch {
							// ignore
						}
					}
				}, RESIZE_SETTLE_DELAY);
			});
			resizeObserver.observe(containerRef.current);
		};

		setup().catch((error) => {
			const terminalError =
				error instanceof Error
					? error
					: new Error('Unknown terminal initialization error');
			console.error('[TerminalViewer] Failed to initialize:', terminalError);
			if (disposed) return;
			setInitializationError(terminalError);
			onInitializationErrorRef.current?.(terminalError);
		});

		return () => {
			disposed = true;
			disposedRef.current = true;
			if (containerRef.current && focusHandlersRef.current) {
				containerRef.current.removeEventListener(
					'focusin',
					focusHandlersRef.current.focusin,
				);
				containerRef.current.removeEventListener(
					'focusout',
					focusHandlersRef.current.focusout,
				);
				focusHandlersRef.current = null;
			}
			if (retryTimerRef.current) {
				clearTimeout(retryTimerRef.current);
				retryTimerRef.current = null;
			}
			if (wsRef.current) {
				wsRef.current.close();
				wsRef.current = null;
			}
			if (resizeObserver) {
				resizeObserver.disconnect();
			}
			if (resizeTimer) {
				clearTimeout(resizeTimer);
			}
			if (term) {
				term.dispose();
			}
			termRef.current = null;
			fitAddonRef.current = null;
		};
	}, [terminalId, connectWebSocket]);

	useEffect(() => {
		const term = termRef.current;
		if (!term) return;
		if (isActive) {
			fitTerminal();
			term.focus();
		} else {
			term.blur();
		}
	}, [isActive, fitTerminal]);

	useEffect(() => {
		if (isActive) {
			fitTerminal();
		}
	}, [fitTerminal, isActive]);

	return (
		<div
			className="flex h-full flex-col overflow-hidden bg-background absolute inset-0"
			style={{ visibility: isActive ? 'visible' : 'hidden' }}
			data-terminal-viewer
		>
			<div className="relative flex-1 min-h-0 overflow-hidden">
				<div ref={containerRef} className="absolute inset-0 bg-background" />
				{isActive && initializationError ? (
					<div
						className="absolute inset-0 bg-background flex items-center justify-center p-6"
						role="alert"
						data-terminal-initialization-error
					>
						<div className="max-w-md text-center">
							<p className="text-sm font-medium text-foreground">
								Terminal failed to initialize
							</p>
							<p className="mt-1 text-xs text-muted-foreground">
								{initializationError.message}
							</p>
						</div>
					</div>
				) : isActive ? (
					<div
						className="absolute inset-0 bg-background flex items-center justify-center pointer-events-none transition-opacity duration-300"
						style={{ opacity: ready ? 0 : 1 }}
					>
						<div className="flex items-center gap-2 text-muted-foreground">
							<StableSpinner title="Loading terminal" />
							<span className="text-xs">Loading terminal…</span>
						</div>
					</div>
				) : null}
			</div>
		</div>
	);
});
