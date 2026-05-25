import { memo, useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Plus, X } from 'lucide-react';
import { usePanelWidthStore, useSidebarStore } from '@ottocode/web-sdk/stores';
import { Button, ResizeHandle } from '@ottocode/web-sdk/components';

const PANEL_KEY = 'desktop-left-sidebar';
const DEFAULT_WIDTH = 272;
const MIN_WIDTH = 256;
const MAX_WIDTH = 480;
const LEFT_SIDEBAR_HOVER_RATIO = 0.02;
const HOVER_SHOW_DELAY_MS = 260;
const HOVER_HIDE_DELAY_MS = 120;

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
	const toggleCollapse = useSidebarStore((state) => state.toggleCollapse);
	const panelWidth = usePanelWidthStore(
		(s) => s.widths[PANEL_KEY] ?? DEFAULT_WIDTH,
	);
	const [isAutoVisible, setIsAutoVisible] = useState(false);
	const [isHoverPending, setIsHoverPending] = useState(false);
	const isAutoVisibleRef = useRef(false);
	const autoShowTimeoutRef = useRef<number | null>(null);
	const autoHideTimeoutRef = useRef<number | null>(null);
	const shouldShowSidebar = !isCollapsed || isAutoVisible;
	const shouldShowEdgeHint = isCollapsed && isHoverPending && !isAutoVisible;
	const sidebarStyle = {
		'--expanded-sidebar-width': `${panelWidth}px`,
		maxWidth: '100%',
	} as CSSProperties;

	useEffect(() => {
		if (!isCollapsed) {
			document.body.style.overflow = 'hidden';
		} else {
			document.body.style.overflow = '';
		}
		return () => {
			document.body.style.overflow = '';
		};
	}, [isCollapsed]);

	useEffect(() => {
		const setAutoVisible = (visible: boolean) => {
			isAutoVisibleRef.current = visible;
			setIsAutoVisible(visible);
		};

		const clearHoverTimeouts = () => {
			if (autoShowTimeoutRef.current !== null) {
				window.clearTimeout(autoShowTimeoutRef.current);
				autoShowTimeoutRef.current = null;
			}
			if (autoHideTimeoutRef.current !== null) {
				window.clearTimeout(autoHideTimeoutRef.current);
				autoHideTimeoutRef.current = null;
			}
		};

		const scheduleAutoVisible = (visible: boolean) => {
			if (isAutoVisibleRef.current === visible) {
				setIsHoverPending(false);
				return;
			}

			setIsHoverPending(visible);
			const delay = visible ? HOVER_SHOW_DELAY_MS : HOVER_HIDE_DELAY_MS;
			const targetRef = visible ? autoShowTimeoutRef : autoHideTimeoutRef;
			const oppositeRef = visible ? autoHideTimeoutRef : autoShowTimeoutRef;

			if (oppositeRef.current !== null) {
				window.clearTimeout(oppositeRef.current);
				oppositeRef.current = null;
			}

			if (targetRef.current !== null) return;

			targetRef.current = window.setTimeout(() => {
				setAutoVisible(visible);
				setIsHoverPending(false);
				targetRef.current = null;
			}, delay);
		};

		if (!isCollapsed) {
			clearHoverTimeouts();
			setIsHoverPending(false);
			setAutoVisible(false);
			return;
		}

		const handleMouseMove = (event: MouseEvent) => {
			const triggerWidth = window.innerWidth * LEFT_SIDEBAR_HOVER_RATIO;
			const activeWidth = isAutoVisibleRef.current
				? Math.max(triggerWidth, panelWidth)
				: triggerWidth;
			scheduleAutoVisible(event.clientX <= activeWidth);
		};
		const handleMouseLeave = () => {
			clearHoverTimeouts();
			setIsHoverPending(false);
			setAutoVisible(false);
		};
		const handleMouseOut = (event: MouseEvent) => {
			if (!event.relatedTarget) {
				handleMouseLeave();
			}
		};

		window.addEventListener('mousemove', handleMouseMove);
		window.addEventListener('mouseout', handleMouseOut);
		window.addEventListener('blur', handleMouseLeave);
		document.documentElement.addEventListener('mouseleave', handleMouseLeave);
		return () => {
			clearHoverTimeouts();
			window.removeEventListener('mousemove', handleMouseMove);
			window.removeEventListener('mouseout', handleMouseOut);
			window.removeEventListener('blur', handleMouseLeave);
			document.documentElement.removeEventListener(
				'mouseleave',
				handleMouseLeave,
			);
		};
	}, [isCollapsed, panelWidth]);

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
						<div className="absolute top-0 left-0 right-0 z-10 pointer-events-none">
							<div className="h-12 px-3 flex items-center justify-between border-b border-sidebar-border/40 bg-sidebar/40 backdrop-blur-xl supports-[backdrop-filter]:bg-sidebar/20">
								<div className="flex items-center text-sidebar-foreground/90">
									<Wordmark />
								</div>
								<button
									type="button"
									onClick={onNewSession}
									className="w-8 h-8 rounded-full bg-sidebar-primary flex items-center justify-center hover:opacity-90 transition-opacity touch-manipulation pointer-events-auto"
									title="New session"
								>
									<Plus className="w-4 h-4 text-sidebar-primary-foreground" />
								</button>
							</div>
						</div>
						<div className="absolute inset-0 overflow-hidden">{children}</div>
					</div>

					<div className="h-12 border-t border-sidebar-border px-2 flex items-center justify-end">
						<Button
							variant="ghost"
							size="icon"
							onClick={toggleCollapse}
							title="Collapse sidebar"
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
