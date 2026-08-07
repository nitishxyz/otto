import { memo, useEffect } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Plus, X } from 'lucide-react';
import { usePanelWidthStore, useSidebarStore } from '@ottocode/web-sdk/stores';
import { Button, ResizeHandle, Tooltip } from '@ottocode/web-sdk/components';
import { useEdgeHover, usePreferences } from '@ottocode/web-sdk/hooks';

const PANEL_KEY = 'desktop-left-sidebar';
const DEFAULT_WIDTH = 272;
const MIN_WIDTH = 256;
const MAX_WIDTH = 480;
const LEFT_SIDEBAR_HOVER_RATIO = 0.02;
const SMART_EDGE_IGNORE_SELECTOR = '[data-smart-edge-ignore]';

interface DesktopSidebarProps {
	children: ReactNode;
	onNewSession?: () => void;
}

function Wordmark() {
	return <span className="font-semibold tracking-tight select-none">otto</span>;
}

export const DesktopSidebar = memo(function DesktopSidebar({
	children,
	onNewSession,
}: DesktopSidebarProps) {
	const isCollapsed = useSidebarStore((state) => state.isCollapsed);
	const isCompact = useSidebarStore((state) => state.isCompact);
	const toggleCollapse = useSidebarStore((state) => state.toggleCollapse);
	const panelWidth = usePanelWidthStore(
		(s) => s.widths[PANEL_KEY] ?? DEFAULT_WIDTH,
	);
	const { preferences } = usePreferences();
	const { isVisible: isAutoVisible, isHoverPending } = useEdgeHover({
		side: 'left',
		enabled: isCollapsed && preferences.smartEdges,
		hoverRatio: LEFT_SIDEBAR_HOVER_RATIO,
		activeWidth: panelWidth,
		ignoreSelector: SMART_EDGE_IGNORE_SELECTOR,
	});
	const shouldShowSidebar = !isCollapsed || isAutoVisible;
	const shouldShowEdgeHint = isCollapsed && isHoverPending && !isAutoVisible;
	const sidebarStyle = {
		'--expanded-sidebar-width': `${panelWidth}px`,
		maxWidth: '100%',
	} as CSSProperties;

	// Only the compact overlay locks page scrolling; the docked wide sidebar
	// must not freeze the workspace behind it.
	useEffect(() => {
		if (isCompact && !isCollapsed) {
			document.body.style.overflow = 'hidden';
		} else {
			document.body.style.overflow = '';
		}
		return () => {
			document.body.style.overflow = '';
		};
	}, [isCollapsed, isCompact]);

	return (
		<>
			<div
				className={`pointer-events-none fixed inset-y-0 left-0 z-40 hidden w-24 origin-left transition-[opacity,transform] duration-300 ease-out md:block ${
					shouldShowEdgeHint
						? 'opacity-50 scale-x-100'
						: 'opacity-0 scale-x-[0.35]'
				}`}
				aria-hidden="true"
			>
				<div className="h-full w-full bg-[radial-gradient(ellipse_at_left,hsl(var(--sidebar-ring)/0.14)_0%,hsl(var(--sidebar-ring)/0.07)_40%,transparent_78%)]" />
			</div>
			<aside
				className={`relative z-50 shrink-0 overflow-hidden border-r transition-[width,background-color,border-color] duration-300 ease-out fixed md:relative top-0 left-0 h-screen md:h-auto w-full ${
					shouldShowSidebar
						? isCollapsed
							? 'hidden md:flex md:w-[var(--expanded-sidebar-width)] border-sidebar-border sidebar-fade-in'
							: 'flex md:w-[var(--expanded-sidebar-width)] border-sidebar-border sidebar-fade-in'
						: 'hidden md:flex md:w-0 md:border-transparent md:bg-background md:pointer-events-none'
				}`}
				style={sidebarStyle}
				aria-hidden={!shouldShowSidebar}
				inert={!shouldShowSidebar ? true : undefined}
			>
				<div className="flex h-full w-full shrink-0 flex-col min-w-0 relative md:w-[var(--expanded-sidebar-width)] md:min-w-[var(--expanded-sidebar-width)]">
					<div className="h-14 border-b border-sidebar-border px-4 flex items-center gap-2 md:hidden bg-sidebar">
						<Button
							variant="ghost"
							size="icon"
							onClick={toggleCollapse}
							title="Close menu"
							className="touch-manipulation flex-shrink-0 text-sidebar-foreground hover:bg-sidebar-accent"
							aria-label="Close menu"
						>
							<X className="w-5 h-5" />
						</Button>
						<div className="flex-1 flex items-center text-sidebar-foreground">
							<Wordmark />
						</div>
					</div>

					<div className="flex-1 relative overflow-hidden">
						<div className="absolute top-0 left-0 right-0 z-30 pointer-events-none">
							<div className="h-12 px-3 flex items-center justify-between border-b border-sidebar-border/40 bg-sidebar/95 backdrop-blur-xl supports-[backdrop-filter]:bg-sidebar/90">
								<div className="flex items-center text-sidebar-foreground/90">
									<Wordmark />
								</div>
								<Tooltip content="New session" side="bottom">
									<button
										type="button"
										onClick={onNewSession}
										className="w-8 h-8 rounded-full bg-sidebar-primary flex items-center justify-center hover:opacity-90 transition-opacity touch-manipulation pointer-events-auto"
										aria-label="New session"
									>
										<Plus className="w-4 h-4 text-sidebar-primary-foreground" />
									</button>
								</Tooltip>
							</div>
						</div>
						<div className="absolute inset-0 overflow-hidden">{children}</div>
					</div>

					<div className="h-12 border-t border-sidebar-border px-2 flex items-center justify-end">
						<Tooltip content="Collapse sidebar" side="top">
							<Button
								variant="ghost"
								size="icon"
								onClick={toggleCollapse}
								aria-label="Collapse sidebar"
								className="transition-transform duration-200 hover:scale-110 touch-manipulation text-sidebar-muted-foreground hover:bg-sidebar-accent w-8 h-8"
							>
								<svg
									xmlns="http://www.w3.org/2000/svg"
									width="16"
									height="16"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									strokeWidth="2"
									strokeLinecap="round"
									strokeLinejoin="round"
									className="transition-transform duration-300"
									role="img"
									aria-label="Collapse sidebar"
								>
									<title>Collapse sidebar</title>
									<path d="M15 18l-6-6 6-6" />
								</svg>
							</Button>
						</Tooltip>
					</div>
				</div>
				<div className="hidden md:block">
					<ResizeHandle
						panelKey={PANEL_KEY}
						side="left"
						minWidth={MIN_WIDTH}
						maxWidth={MAX_WIDTH}
						defaultWidth={DEFAULT_WIDTH}
					/>
				</div>
			</aside>
			{!isCollapsed && (
				<div
					className="fixed inset-0 bg-black/50 z-40 md:hidden"
					onClick={toggleCollapse}
					aria-hidden="true"
				/>
			)}
		</>
	);
});
