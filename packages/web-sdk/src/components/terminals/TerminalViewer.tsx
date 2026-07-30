import { memo, useEffect, useRef, useState, useCallback } from 'react';
import {
	init,
	Terminal,
	FitAddon,
	OSC8LinkProvider,
	UrlRegexProvider,
	type ILinkProvider,
} from 'ghostty-web';
import { getRuntimeApiBaseUrl } from '../../lib/config';
import { openUrl } from '../../lib/open-url';
import {
	authenticatedFetch,
	getProjectQuery,
} from '../../lib/api-client/utils';
import { client } from '@ottocode/api';
import { StableSpinner } from '../ui/StableSpinner';

const FONT_FAMILY = '"JetBrainsMono NFM", monospace';
const WS_RECONNECT_DELAY = 1500;
const WS_MAX_RETRIES = 5;
const CURSOR_BLINK_RESUME_DELAY = 600;

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

function shouldOpenTerminalLink(event: MouseEvent): boolean {
	return event.ctrlKey || event.metaKey;
}

function withPlatformLinkActivation(provider: ILinkProvider): ILinkProvider {
	return {
		provideLinks(y, callback) {
			provider.provideLinks(y, (links) => {
				callback(
					links?.map((link) => ({
						...link,
						activate(event) {
							if (shouldOpenTerminalLink(event)) {
								openUrl(link.text);
								event.preventDefault();
								return;
							}
							link.activate(event);
						},
					})),
				);
			});
		},
		dispose() {
			provider.dispose?.();
		},
	};
}

function registerPlatformLinkProviders(term: Terminal) {
	term.registerLinkProvider(
		withPlatformLinkActivation(new OSC8LinkProvider(term)),
	);
	term.registerLinkProvider(
		withPlatformLinkActivation(new UrlRegexProvider(term)),
	);
}

export interface TerminalViewerProps {
	terminalId: string;
	isActive: boolean;
	onExit?: (terminalId: string) => void;
}

export const TerminalViewer = memo(function TerminalViewer({
	terminalId,
	isActive,
	onExit,
}: TerminalViewerProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const termRef = useRef<Terminal | null>(null);
	const fitAddonRef = useRef<FitAddon | null>(null);
	const wsRef = useRef<WebSocket | null>(null);
	const retryCountRef = useRef(0);
	const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const [ready, setReady] = useState(false);
	const onExitRef = useRef(onExit);
	onExitRef.current = onExit;
	const blinkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const userScrolledRef = useRef(false);
	const bgColorRef = useRef('#121216');
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
		async (term: Terminal, baseUrl: string) => {
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
				const message = typeof event.data === 'string' ? event.data : '';

				if (message.startsWith('{')) {
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
		let term: Terminal | null = null;
		let fitAddon: FitAddon | null = null;
		let resizeObserver: ResizeObserver | null = null;

		setReady(false);
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
			await init();
			if (disposed || !containerRef.current) return;

			await loadEmbeddedTerminalFont();
			await document.fonts.ready;

			const bg = resolveTerminalBackgroundColor();

			term = new Terminal({
				theme: {
					background: bg,
					foreground: '#d4d4d4',
					cursor: '#ffffff',
					cursorAccent: '#000000',
					selectionBackground: '#264f78',
					black: '#000000',
					red: '#cd3131',
					green: '#0dbc79',
					yellow: '#e5e510',
					blue: '#2472c8',
					magenta: '#bc3fbc',
					cyan: '#11a8cd',
					white: '#e5e5e5',
					brightBlack: '#666666',
					brightRed: '#f14c4c',
					brightGreen: '#23d18b',
					brightYellow: '#f5f543',
					brightBlue: '#3b8eea',
					brightMagenta: '#d670d6',
					brightCyan: '#29b8db',
					brightWhite: '#e5e5e5',
				},
				fontSize: 13,
				fontFamily: FONT_FAMILY,
				cursorBlink: true,
				convertEol: true,
				scrollback: 5000,
			});

			fitAddon = new FitAddon();
			term.loadAddon(fitAddon);
			term.open(containerRef.current);
			registerPlatformLinkProviders(term);

			term.onData(() => {
				if (!termRef.current?.renderer) return;
				termRef.current.renderer.setCursorBlink(false);
				if (blinkTimerRef.current) clearTimeout(blinkTimerRef.current);
				blinkTimerRef.current = setTimeout(() => {
					if (
						termRef.current?.renderer &&
						document.activeElement &&
						containerRef.current?.contains(document.activeElement)
					) {
						termRef.current.renderer.setCursorBlink(true);
					}
				}, CURSOR_BLINK_RESUME_DELAY);
			});

			bgColorRef.current = bg;

			const handleFocusIn = () => {
				if (!termRef.current?.renderer) return;
				termRef.current.renderer.setCursorBlink(true);
				termRef.current.renderer.setTheme({
					cursor: '#ffffff',
					cursorAccent: '#000000',
				});
			};

			const handleFocusOut = () => {
				if (!termRef.current?.renderer) return;
				termRef.current.renderer.setCursorBlink(false);
				termRef.current.renderer.setTheme({
					cursor: bgColorRef.current,
					cursorAccent: bgColorRef.current,
				});
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
				requestAnimationFrame(() => {
					if (fitAddonRef.current && !disposed) {
						try {
							fitAddonRef.current.fit();
						} catch {
							// ignore
						}
					}
				});
			});
			resizeObserver.observe(containerRef.current);
		};

		setup().catch((error) => {
			console.error('[TerminalViewer] Failed to initialize:', error);
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
			if (blinkTimerRef.current) {
				clearTimeout(blinkTimerRef.current);
				blinkTimerRef.current = null;
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
			if (term.renderer) {
				term.renderer.setCursorBlink(false);
				term.renderer.setTheme({
					cursor: bgColorRef.current,
					cursorAccent: bgColorRef.current,
				});
			}
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
				{isActive ? (
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
