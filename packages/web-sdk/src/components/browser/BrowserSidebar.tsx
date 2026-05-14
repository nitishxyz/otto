import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
	ExternalLink,
	Monitor,
	Plus,
	RefreshCw,
	Smartphone,
	X,
} from 'lucide-react';
import {
	useBrowserPanelStore,
	type BrowserPanelTab,
} from '../../stores/browserPanelStore';
import { usePanelWidthStore } from '../../stores/panelWidthStore';
import {
	useSimulatorStatus,
	useStartSimulator,
} from '../../hooks/useSimulator';
import { API_BASE_URL } from '../../lib/config';
import { openUrl } from '../../lib/open-url';
import { Button } from '../ui/Button';
import { ResizeHandle } from '../ui/ResizeHandle';
import { SidebarHeader } from '../ui/SidebarHeader';

const PANEL_KEY = 'browser';
const DEFAULT_WIDTH = 640;
const MIN_WIDTH = 360;
const MAX_WIDTH = 1100;
const DEFAULT_URL = 'about:blank';

interface TauriCoreApi {
	invoke: <T = unknown>(
		command: string,
		args?: Record<string, unknown>,
	) => Promise<T>;
}

type BrowserPanelCommand =
	| {
			id: string;
			type: 'open';
			url: string;
			title?: string;
			kind?: 'web' | 'simulator';
	  }
	| {
			id: string;
			type: 'navigate';
			tabId?: string;
			url: string;
			title?: string;
	  }
	| { id: string; type: 'close'; tabId?: string }
	| { id: string; type: 'reload'; tabId?: string }
	| { id: string; type: 'click'; tabId?: string; selector: string }
	| { id: string; type: 'type'; tabId?: string; selector: string; text: string }
	| { id: string; type: 'press'; tabId?: string; key: string }
	| { id: string; type: 'scroll'; tabId?: string; x?: number; y?: number }
	| { id: string; type: 'inspect'; tabId?: string; selector?: string }
	| { id: string; type: 'screenshot'; tabId?: string };

function normalizeUrl(input: string) {
	const trimmed = input.trim();
	if (!trimmed) return DEFAULT_URL;
	if (
		trimmed === 'about:blank' ||
		trimmed.startsWith('http://') ||
		trimmed.startsWith('https://')
	) {
		return trimmed;
	}
	if (
		trimmed.includes('localhost') ||
		trimmed.includes('.') ||
		trimmed.includes(':')
	) {
		return `http://${trimmed}`;
	}
	return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
}

function isTauriRuntime() {
	const scope = globalThis as typeof globalThis & {
		isTauri?: boolean;
		__TAURI_INTERNALS__?: unknown;
		__TAURI__?: unknown;
	};
	return (
		scope.isTauri === true ||
		'__TAURI_INTERNALS__' in scope ||
		'__TAURI__' in scope
	);
}

function isTopLevelWindow() {
	if (typeof window === 'undefined') return true;
	return window.self === window.top;
}

async function getTauriCore(): Promise<TauriCoreApi | null> {
	if (!isTauriRuntime()) return null;
	try {
		return (await import('@tauri-apps/api/core')) as TauriCoreApi;
	} catch {
		return null;
	}
}

async function invokeNativeBrowser(
	command: string,
	args: Record<string, unknown>,
) {
	const core = await getTauriCore();
	if (!core) return false;
	await core.invoke(command, args);
	return true;
}

function selectorScript(selector: string) {
	return `document.querySelector(${JSON.stringify(selector)})`;
}

async function openNativeBrowserTab(tab: BrowserPanelTab) {
	if (tab.url === DEFAULT_URL) return false;
	return invokeNativeBrowser('browser_open_tab', {
		tabId: tab.id,
		url: tab.url,
		title: tab.title,
	});
}

async function navigateNativeBrowserTab(tabId: string, url: string) {
	if (url === DEFAULT_URL) return false;
	const opened = await invokeNativeBrowser('browser_navigate_tab', {
		tabId,
		url,
	}).catch(() => false);
	if (opened) return true;
	return invokeNativeBrowser('browser_open_tab', { tabId, url });
}

async function reloadNativeBrowserTab(tabId: string) {
	return invokeNativeBrowser('browser_reload_tab', { tabId });
}

async function closeNativeBrowserTab(tabId: string) {
	return invokeNativeBrowser('browser_close_tab', { tabId });
}

async function evalNativeBrowserTab(tabId: string, script: string) {
	return invokeNativeBrowser('browser_eval_tab', { tabId, script });
}

async function postCommandResult(
	id: string,
	result: { ok: boolean; type?: string; message?: string; data?: unknown },
) {
	await fetch(
		`${API_BASE_URL.replace(/\/$/, '')}/v1/browser-panel/command-results`,
		{
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ id, ...result }),
		},
	).catch(() => undefined);
}

function elementSummary(element: Element, index: number) {
	const htmlElement = element instanceof HTMLElement ? element : null;
	const rect = htmlElement?.getBoundingClientRect();
	return {
		index,
		tag: element.tagName.toLowerCase(),
		id: element.id || undefined,
		name: element.getAttribute('name') || undefined,
		type: element.getAttribute('type') || undefined,
		role: element.getAttribute('role') || undefined,
		ariaLabel: element.getAttribute('aria-label') || undefined,
		placeholder: element.getAttribute('placeholder') || undefined,
		text: (element.textContent ?? '').trim().slice(0, 120) || undefined,
		selector:
			element.id && CSS.escape
				? `#${CSS.escape(element.id)}`
				: element.getAttribute('name')
					? `${element.tagName.toLowerCase()}[name=${JSON.stringify(element.getAttribute('name'))}]`
					: undefined,
		visible:
			rect !== undefined && rect.width > 0 && rect.height > 0
				? { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
				: undefined,
	};
}

function inspectDocument(document: Document, selector?: string) {
	const root = selector ? document.querySelector(selector) : document.body;
	if (!root) throw new Error(`No element matched selector: ${selector}`);
	const interactiveSelector = [
		'button',
		'a[href]',
		'input',
		'textarea',
		'select',
		'[role="button"]',
		'[role="textbox"]',
		'[contenteditable="true"]',
	].join(',');
	const elements = Array.from(root.querySelectorAll(interactiveSelector))
		.slice(0, 80)
		.map(elementSummary);
	return {
		title: document.title,
		url: document.location.href,
		activeElement: document.activeElement
			? elementSummary(document.activeElement, -1)
			: null,
		viewport: {
			width: window.innerWidth,
			height: window.innerHeight,
			scrollX: window.scrollX,
			scrollY: window.scrollY,
			scrollHeight: document.documentElement.scrollHeight,
			scrollWidth: document.documentElement.scrollWidth,
		},
		elements,
		text: (root.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 4000),
	};
}

function BrowserTabButton({ tab }: { tab: BrowserPanelTab }) {
	const activeTabId = useBrowserPanelStore((s) => s.activeTabId);
	const selectTab = useBrowserPanelStore((s) => s.selectTab);
	const closeTab = useBrowserPanelStore((s) => s.closeTab);
	const isActive = activeTabId === tab.id;
	const Icon = tab.kind === 'simulator' ? Smartphone : Monitor;

	return (
		<div
			className={`group h-7 min-w-0 max-w-36 rounded-md flex items-center text-xs transition-colors ${
				isActive
					? 'bg-muted text-foreground'
					: 'text-muted-foreground hover:bg-muted/60'
			}`}
		>
			<button
				type="button"
				onClick={() => selectTab(tab.id)}
				className="flex h-full min-w-0 flex-1 items-center gap-1.5 pl-2 pr-1 text-left"
				title={tab.url}
			>
				<Icon className="w-3.5 h-3.5 shrink-0" />
				<span className="truncate">{tab.title}</span>
			</button>
			<button
				type="button"
				onClick={() => {
					void closeNativeBrowserTab(tab.id).catch(() => undefined);
					closeTab(tab.id);
				}}
				className="mr-1 rounded p-0.5 opacity-50 hover:opacity-100 hover:bg-muted-foreground/15"
				title={`Close ${tab.title}`}
			>
				<X className="w-3 h-3" />
			</button>
		</div>
	);
}

function BlankTabState({ onOpen }: { onOpen: (url: string) => void }) {
	return (
		<div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center text-muted-foreground">
			<Monitor className="w-12 h-12 opacity-30" />
			<div>
				<h3 className="text-sm font-medium text-foreground">Blank tab</h3>
				<p className="mt-1 max-w-xs text-xs">
					Enter a URL above, or ask Otto to open a local app in the Browser
					panel.
				</p>
			</div>
			<div className="flex flex-wrap items-center justify-center gap-2">
				{[
					'http://localhost:3000',
					'http://localhost:5173',
					'http://localhost:8080',
				].map((url) => (
					<Button
						key={url}
						variant="secondary"
						size="sm"
						onClick={() => onOpen(url)}
					>
						{url.replace('http://', '')}
					</Button>
				))}
			</div>
		</div>
	);
}

function NativeBrowserState({ tab }: { tab: BrowserPanelTab }) {
	return (
		<div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center text-muted-foreground">
			<Monitor className="w-12 h-12 opacity-30" />
			<div>
				<h3 className="text-sm font-medium text-foreground">
					Native browser window
				</h3>
				<p className="mt-1 max-w-xs text-xs">
					This tab is running in an Otto-controlled desktop webview, so sites
					like Google can render outside iframe restrictions.
				</p>
				<p className="mt-2 max-w-xs truncate font-mono text-[11px]">
					{tab.url}
				</p>
			</div>
			<Button
				variant="secondary"
				size="sm"
				onClick={() => void openNativeBrowserTab(tab).catch(() => undefined)}
			>
				Focus browser window
			</Button>
		</div>
	);
}

function EmptyBrowserState() {
	const openTab = useBrowserPanelStore((s) => s.openTab);
	const { data: simulatorStatus } = useSimulatorStatus();
	const startSimulator = useStartSimulator();

	const handleOpenSimulator = async () => {
		if (simulatorStatus?.url) {
			openTab({
				url: simulatorStatus.url,
				title: simulatorStatus.deviceName ?? 'iOS Simulator',
				kind: 'simulator',
			});
			return;
		}

		try {
			const result = await startSimulator.mutateAsync(3200);
			openTab({
				url: result.url ?? 'http://localhost:3200',
				title: result.deviceName ?? 'iOS Simulator',
				kind: 'simulator',
			});
		} catch {
			// Error is rendered below from the mutation state.
		}
	};

	return (
		<div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center text-muted-foreground">
			<Monitor className="w-12 h-12 opacity-30" />
			<div>
				<h3 className="text-sm font-medium text-foreground">No browser tabs</h3>
				<p className="mt-1 max-w-xs text-xs">
					Open a web app, localhost URL, or serve-sim preview in this panel.
				</p>
			</div>
			<div className="flex flex-col gap-2 sm:flex-row">
				<Button
					variant="secondary"
					size="sm"
					onClick={() => openTab({ title: 'New Tab' })}
				>
					<Plus className="w-3.5 h-3.5" />
					New Tab
				</Button>
				<Button
					variant="secondary"
					size="sm"
					onClick={handleOpenSimulator}
					disabled={startSimulator.isPending}
				>
					<Smartphone className="w-3.5 h-3.5" />
					{startSimulator.isPending ? 'Starting...' : 'serve-sim'}
				</Button>
			</div>
			{startSimulator.error && (
				<p className="max-w-xs text-xs text-destructive">
					{startSimulator.error.message}
				</p>
			)}
		</div>
	);
}

export const BrowserSidebar = memo(function BrowserSidebar() {
	const isExpanded = useBrowserPanelStore((s) => s.isExpanded);
	const tabs = useBrowserPanelStore((s) => s.tabs);
	const activeTabId = useBrowserPanelStore((s) => s.activeTabId);
	const closePanel = useBrowserPanelStore((s) => s.collapseSidebar);
	const openTab = useBrowserPanelStore((s) => s.openTab);
	const closeTab = useBrowserPanelStore((s) => s.closeTab);
	const updateTab = useBrowserPanelStore((s) => s.updateTab);
	const setTabStatus = useBrowserPanelStore((s) => s.setTabStatus);
	const panelWidth = usePanelWidthStore(
		(s) => s.widths[PANEL_KEY] ?? DEFAULT_WIDTH,
	);
	const [reloadNonce, setReloadNonce] = useState(0);
	const iframeRef = useRef<HTMLIFrameElement>(null);
	const [frameMessage, setFrameMessage] = useState<string | null>(null);
	const nativeBrowserAvailable = isTauriRuntime();
	const canControlBrowserPanel = isTopLevelWindow();

	const activeTab = useMemo(
		() => tabs.find((tab) => tab.id === activeTabId) ?? null,
		[tabs, activeTabId],
	);
	const [urlDraft, setUrlDraft] = useState(activeTab?.url ?? DEFAULT_URL);

	useEffect(() => {
		setUrlDraft(activeTab?.url ?? DEFAULT_URL);
		setFrameMessage(null);
	}, [activeTab?.url]);

	useEffect(() => {
		if (!nativeBrowserAvailable || !activeTab || activeTab.url === DEFAULT_URL)
			return;
		void openNativeBrowserTab(activeTab)
			.then((opened) => {
				if (opened && activeTab.status !== 'ready') {
					setTabStatus(activeTab.id, 'ready');
				}
			})
			.catch((error) => setFrameMessage(String(error)));
	}, [activeTab, nativeBrowserAvailable, setTabStatus]);

	useEffect(() => {
		if (!isExpanded || !canControlBrowserPanel) return;
		void fetch(`${API_BASE_URL.replace(/\/$/, '')}/v1/browser-panel/state`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ isExpanded, activeTabId, tabs }),
		}).catch(() => {
			// State reporting is best-effort; command polling still works without it.
		});
	}, [activeTabId, canControlBrowserPanel, isExpanded, tabs]);

	const runFrameCommand = useCallback(
		async (
			command: Extract<
				BrowserPanelCommand,
				{
					type:
						| 'click'
						| 'type'
						| 'press'
						| 'scroll'
						| 'inspect'
						| 'screenshot';
				}
			>,
		) => {
			const state = useBrowserPanelStore.getState();
			const currentActiveTabId = state.activeTabId;
			const targetTabId = command.tabId ?? currentActiveTabId;
			if (!targetTabId) {
				const message = 'Select the target tab before sending browser input.';
				setFrameMessage(message);
				await postCommandResult(command.id, {
					ok: false,
					type: command.type,
					message,
				});
				return;
			}

			if (nativeBrowserAvailable) {
				if (command.type === 'inspect' || command.type === 'screenshot') {
					await postCommandResult(command.id, {
						ok: false,
						type: command.type,
						message:
							'Native browser inspection/screenshot results are not available yet. Use the web iframe panel for DOM inspect or add a Playwright backend for full browser screenshots.',
					});
					return;
				}

				if (command.type === 'scroll') {
					await evalNativeBrowserTab(
						targetTabId,
						`window.scrollBy(${command.x ?? 0}, ${command.y ?? 600});`,
					)
						.then(() =>
							postCommandResult(command.id, { ok: true, type: command.type }),
						)
						.catch((error) => {
							const message = String(error);
							setFrameMessage(message);
							void postCommandResult(command.id, {
								ok: false,
								type: command.type,
								message,
							});
						});
					return;
				}

				if (command.type === 'press') {
					await evalNativeBrowserTab(
						targetTabId,
						`document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(command.key)}, bubbles: true, cancelable: true }));`,
					)
						.then(() =>
							postCommandResult(command.id, { ok: true, type: command.type }),
						)
						.catch((error) => {
							const message = String(error);
							setFrameMessage(message);
							void postCommandResult(command.id, {
								ok: false,
								type: command.type,
								message,
							});
						});
					return;
				}

				const element = selectorScript(command.selector);
				const script =
					command.type === 'click'
						? `${element}?.click();`
						: `(() => { const element = ${element}; if (!element) return; element.focus?.(); if ('value' in element) { element.value = ${JSON.stringify(command.text)}; element.dispatchEvent(new Event('input', { bubbles: true })); element.dispatchEvent(new Event('change', { bubbles: true })); } else { element.textContent = ${JSON.stringify(command.text)}; element.dispatchEvent(new InputEvent('input', { bubbles: true })); } })();`;
				await evalNativeBrowserTab(targetTabId, script)
					.then(() =>
						postCommandResult(command.id, { ok: true, type: command.type }),
					)
					.catch((error) => {
						const message = String(error);
						setFrameMessage(message);
						void postCommandResult(command.id, {
							ok: false,
							type: command.type,
							message,
						});
					});
				return;
			}

			if (targetTabId !== currentActiveTabId) {
				const message = 'Select the target tab before sending browser input.';
				setFrameMessage(message);
				await postCommandResult(command.id, {
					ok: false,
					type: command.type,
					message,
				});
				return;
			}

			try {
				const frameWindow = iframeRef.current?.contentWindow;
				const document = frameWindow?.document;
				if (!frameWindow || !document) {
					const message =
						'Browser input is blocked for this page. Open it externally or use a local same-origin preview.';
					setFrameMessage(message);
					await postCommandResult(command.id, {
						ok: false,
						type: command.type,
						message,
					});
					return;
				}

				if (command.type === 'scroll') {
					frameWindow.scrollBy(command.x ?? 0, command.y ?? 600);
					await postCommandResult(command.id, { ok: true, type: command.type });
					return;
				}

				if (command.type === 'inspect') {
					await postCommandResult(command.id, {
						ok: true,
						type: command.type,
						data: inspectDocument(document, command.selector),
					});
					return;
				}

				if (command.type === 'screenshot') {
					await postCommandResult(command.id, {
						ok: false,
						type: command.type,
						message:
							'Screenshot capture is not available from the iframe panel yet. Use inspect for DOM visibility, or add the Playwright backend for real screenshots.',
						data: inspectDocument(document),
					});
					return;
				}

				if (command.type === 'press') {
					const event = new KeyboardEvent('keydown', {
						key: command.key,
						bubbles: true,
						cancelable: true,
					});
					document.activeElement?.dispatchEvent(event);
					await postCommandResult(command.id, { ok: true, type: command.type });
					return;
				}

				const element = document.querySelector(command.selector);
				if (!(element instanceof HTMLElement)) {
					const message = `No element matched selector: ${command.selector}`;
					setFrameMessage(message);
					await postCommandResult(command.id, {
						ok: false,
						type: command.type,
						message,
					});
					return;
				}

				element.focus();
				if (command.type === 'click') {
					element.click();
					await postCommandResult(command.id, { ok: true, type: command.type });
					return;
				}

				if (
					element instanceof HTMLInputElement ||
					element instanceof HTMLTextAreaElement
				) {
					element.value = command.text;
					element.dispatchEvent(new Event('input', { bubbles: true }));
					element.dispatchEvent(new Event('change', { bubbles: true }));
					await postCommandResult(command.id, { ok: true, type: command.type });
					return;
				}

				element.textContent = command.text;
				element.dispatchEvent(new InputEvent('input', { bubbles: true }));
				await postCommandResult(command.id, { ok: true, type: command.type });
			} catch (error) {
				const message =
					error instanceof Error
						? error.message
						: 'Browser input is blocked by cross-origin iframe security for this page.';
				setFrameMessage(message);
				await postCommandResult(command.id, {
					ok: false,
					type: command.type,
					message,
				});
			}
		},
		[nativeBrowserAvailable],
	);

	useEffect(() => {
		if (!isExpanded || !canControlBrowserPanel) return;
		let cancelled = false;

		const poll = async () => {
			try {
				const response = await fetch(
					`${API_BASE_URL.replace(/\/$/, '')}/v1/browser-panel/commands`,
				);
				if (!response.ok) return;
				const data = (await response.json()) as {
					commands?: BrowserPanelCommand[];
				};
				if (cancelled || !data.commands?.length) return;

				for (const command of data.commands) {
					switch (command.type) {
						case 'open': {
							const tabId = openTab({
								url: command.url,
								title: command.title,
								kind: command.kind,
								createdBy: 'llm',
							});
							if (nativeBrowserAvailable) {
								await invokeNativeBrowser('browser_open_tab', {
									tabId,
									url: command.url,
									title: command.title,
								}).catch((error) => setFrameMessage(String(error)));
							}
							break;
						}
						case 'navigate': {
							const targetTabId = command.tabId ?? activeTabId;
							if (command.tabId) {
								updateTab(command.tabId, {
									url: command.url,
									title: command.title,
									status: 'loading',
								});
							} else if (activeTabId) {
								updateTab(activeTabId, {
									url: command.url,
									title: command.title,
									status: 'loading',
								});
							} else {
								const tabId = openTab({
									url: command.url,
									title: command.title,
									createdBy: 'llm',
								});
								if (nativeBrowserAvailable) {
									await invokeNativeBrowser('browser_open_tab', {
										tabId,
										url: command.url,
										title: command.title,
									}).catch((error) => setFrameMessage(String(error)));
								}
								break;
							}
							if (nativeBrowserAvailable && targetTabId) {
								await navigateNativeBrowserTab(targetTabId, command.url).catch(
									(error) => setFrameMessage(String(error)),
								);
							}
							break;
						}
						case 'close': {
							const targetTabId = command.tabId ?? activeTabId;
							if (targetTabId && nativeBrowserAvailable) {
								await closeNativeBrowserTab(targetTabId).catch((error) =>
									setFrameMessage(String(error)),
								);
							}
							if (targetTabId) closeTab(targetTabId);
							break;
						}
						case 'reload': {
							const targetTabId = command.tabId ?? activeTabId;
							if (targetTabId && nativeBrowserAvailable) {
								await reloadNativeBrowserTab(targetTabId).catch((error) =>
									setFrameMessage(String(error)),
								);
							}
							setReloadNonce((value) => value + 1);
							break;
						}
						case 'click':
						case 'type':
						case 'press':
						case 'scroll':
						case 'inspect':
						case 'screenshot':
							await runFrameCommand(command);
							break;
					}
				}
			} catch {
				// Ignore polling errors; the next tick will retry.
			}
		};

		poll();
		const interval = window.setInterval(poll, 1000);
		return () => {
			cancelled = true;
			window.clearInterval(interval);
		};
	}, [
		activeTabId,
		canControlBrowserPanel,
		closeTab,
		isExpanded,
		nativeBrowserAvailable,
		openTab,
		runFrameCommand,
		updateTab,
	]);

	const handleSubmitUrl = useCallback(
		(event: React.FormEvent<HTMLFormElement>) => {
			event.preventDefault();
			if (!activeTab) return;
			const url = normalizeUrl(urlDraft);
			updateTab(activeTab.id, { url, status: 'loading' });
			if (nativeBrowserAvailable) {
				void navigateNativeBrowserTab(activeTab.id, url).catch((error) =>
					setFrameMessage(String(error)),
				);
			}
		},
		[activeTab, nativeBrowserAvailable, updateTab, urlDraft],
	);

	const handleReload = useCallback(() => {
		if (!activeTab) return;
		setTabStatus(activeTab.id, 'loading');
		if (nativeBrowserAvailable) {
			void reloadNativeBrowserTab(activeTab.id).catch((error) =>
				setFrameMessage(String(error)),
			);
		}
		setReloadNonce((value) => value + 1);
	}, [activeTab, nativeBrowserAvailable, setTabStatus]);

	const handleOpenBlankTabUrl = useCallback(
		(url: string) => {
			if (!activeTab) return;
			updateTab(activeTab.id, { url, status: 'loading' });
			if (nativeBrowserAvailable) {
				void navigateNativeBrowserTab(activeTab.id, url).catch((error) =>
					setFrameMessage(String(error)),
				);
			}
		},
		[activeTab, nativeBrowserAvailable, updateTab],
	);

	if (!isExpanded) return null;

	return (
		<div
			className="border-l border-sidebar-border sidebar-fade-in flex h-full relative bg-background"
			style={{ width: panelWidth }}
		>
			<ResizeHandle
				panelKey={PANEL_KEY}
				side="right"
				minWidth={MIN_WIDTH}
				maxWidth={MAX_WIDTH}
				defaultWidth={DEFAULT_WIDTH}
			/>
			<div className="flex-1 flex flex-col h-full min-w-0">
				<SidebarHeader
					icon={<Monitor className="size-[15px]" />}
					title="Browser"
					onClose={closePanel}
				>
					<div className="flex min-w-0 max-w-[42%] items-center gap-1 overflow-x-auto">
						{tabs.map((tab) => (
							<BrowserTabButton key={tab.id} tab={tab} />
						))}
						<button
							type="button"
							onClick={() => openTab({ title: 'New Tab' })}
							className="h-7 w-7 shrink-0 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted flex items-center justify-center"
							title="New tab"
						>
							<Plus className="w-3.5 h-3.5" />
						</button>
					</div>

					{activeTab && (
						<>
							<button
								type="button"
								onClick={handleReload}
								className="h-7 w-7 shrink-0 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted flex items-center justify-center"
								title="Reload"
							>
								<RefreshCw className="w-3.5 h-3.5" />
							</button>
							<form onSubmit={handleSubmitUrl} className="flex-1 min-w-0">
								<input
									value={urlDraft}
									onChange={(event) => setUrlDraft(event.target.value)}
									className="h-7 w-full rounded-md border border-border bg-muted/40 px-2 text-xs font-mono outline-none focus:border-primary"
									placeholder="https://example.com or localhost:3200"
								/>
							</form>
							<button
								type="button"
								onClick={() => openUrl(activeTab.url)}
								className="h-7 w-7 shrink-0 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted flex items-center justify-center"
								title="Open externally"
							>
								<ExternalLink className="w-3.5 h-3.5" />
							</button>
						</>
					)}
				</SidebarHeader>

				{activeTab ? (
					<div className="flex-1 min-h-0 bg-black/5 relative">
						{activeTab.url === DEFAULT_URL ? (
							<BlankTabState onOpen={handleOpenBlankTabUrl} />
						) : nativeBrowserAvailable ? (
							<NativeBrowserState tab={activeTab} />
						) : (
							<>
								<iframe
									ref={iframeRef}
									key={`${activeTab.id}:${activeTab.url}:${reloadNonce}`}
									src={activeTab.url}
									title={activeTab.title}
									className="h-full w-full border-0 bg-background"
									sandbox="allow-downloads allow-forms allow-modals allow-pointer-lock allow-popups allow-popups-to-escape-sandbox allow-same-origin allow-scripts"
									onLoad={() => setTabStatus(activeTab.id, 'ready')}
									onError={() => {
										setTabStatus(activeTab.id, 'error');
										setFrameMessage(
											'This page could not be embedded in the Browser panel.',
										);
									}}
								/>
								{frameMessage && (
									<div className="absolute bottom-3 left-3 right-3 rounded-lg border border-border bg-background/95 p-3 text-xs text-muted-foreground shadow-lg backdrop-blur">
										<p>{frameMessage}</p>
										<Button
											variant="secondary"
											size="sm"
											onClick={() => openUrl(activeTab.url)}
											className="mt-2"
										>
											Open externally
										</Button>
									</div>
								)}
							</>
						)}
					</div>
				) : (
					<EmptyBrowserState />
				)}
			</div>
		</div>
	);
});
