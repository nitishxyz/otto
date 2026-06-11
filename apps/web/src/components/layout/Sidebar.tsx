import { memo, useEffect } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Plus, X } from 'lucide-react';
import { useSidebarStore, usePanelWidthStore } from '@ottocode/web-sdk/stores';
import { useEdgeHover, usePreferences } from '@ottocode/web-sdk/hooks';
import { Button, ResizeHandle } from '@ottocode/web-sdk/components';
import { OttoWordmark } from './OttoWordmark';

const PANEL_KEY = 'left-sidebar';
const DEFAULT_WIDTH = 272;
const MIN_WIDTH = 256;
const MAX_WIDTH = 480;
const LEFT_SIDEBAR_HOVER_RATIO = 0.02;

function getConnectionLabel(url: string): string {
	try {
		return new URL(url).host;
	} catch {
		return url;
	}
}

interface SidebarProps {
	children: ReactNode;
	onNewSession?: () => void;
	connectionUrl?: string;
	onSwitchConnection?: () => void;
}

export const Sidebar = memo(function Sidebar({
	children,
	onNewSession,
	connectionUrl,
	onSwitchConnection,
}: SidebarProps) {
	const isCollapsed = useSidebarStore((state) => state.isCollapsed);
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
	});
	const shouldShowSidebar = !isCollapsed || isAutoVisible;
	const shouldShowEdgeHint = isCollapsed && isHoverPending && !isAutoVisible;
	const sidebarStyle = {
		'--expanded-sidebar-width': `${panelWidth}px`,
		maxWidth: '100%',
	} as CSSProperties;

	return (
		<>
			<SidebarBodyOverflowController isCollapsed={isCollapsed} />
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
				className={`relative z-50 shrink-0 overflow-hidden border-r transition-[width,background-color,border-color] duration-300 ease-out fixed md:relative top-0 left-0 h-[var(--app-height,100dvh)] md:h-auto w-full ${
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
				<ExpandedSidebarContent
					onNewSession={onNewSession}
					onCollapse={toggleCollapse}
					connectionUrl={connectionUrl}
					onSwitchConnection={onSwitchConnection}
				>
					{children}
				</ExpandedSidebarContent>
			</aside>
			<MobileSidebarBackdrop
				isVisible={!isCollapsed}
				onClose={toggleCollapse}
			/>
		</>
	);
});

interface SidebarBodyOverflowControllerProps {
	isCollapsed: boolean;
}

function SidebarBodyOverflowController({
	isCollapsed,
}: SidebarBodyOverflowControllerProps) {
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

	return null;
}

interface ExpandedSidebarContentProps {
	children: ReactNode;
	onNewSession?: () => void;
	onCollapse: () => void;
	connectionUrl?: string;
	onSwitchConnection?: () => void;
}

const ExpandedSidebarContent = memo(function ExpandedSidebarContent({
	children,
	onNewSession,
	onCollapse,
	connectionUrl,
	onSwitchConnection,
}: ExpandedSidebarContentProps) {
	return (
		<>
			<div className="flex h-full w-full shrink-0 flex-col min-w-0 relative md:w-[var(--expanded-sidebar-width)] md:min-w-[var(--expanded-sidebar-width)]">
				<MobileSidebarHeader onClose={onCollapse} onNewSession={onNewSession} />
				<div className="hidden md:flex h-12 shrink-0 px-3 items-center justify-between border-b border-sidebar-border/40 bg-sidebar">
					<div className="flex items-center text-sidebar-foreground/90">
						<OttoWordmark height={14} className="select-none" />
					</div>
					<button
						type="button"
						onClick={onNewSession}
						className="w-8 h-8 rounded-full bg-sidebar-primary flex items-center justify-center hover:opacity-90 transition-opacity touch-manipulation"
						title="New session"
					>
						<Plus className="w-4 h-4 text-sidebar-primary-foreground" />
					</button>
				</div>
				<div className="flex-1 relative overflow-hidden">
					<div className="absolute inset-0 overflow-hidden">{children}</div>
				</div>
				<SidebarFooter
					connectionUrl={connectionUrl}
					onSwitchConnection={onSwitchConnection}
					onCollapse={onCollapse}
				/>
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
		</>
	);
});

const MobileSidebarHeader = memo(function MobileSidebarHeader({
	onClose,
	onNewSession,
}: {
	onClose: () => void;
	onNewSession?: () => void;
}) {
	return (
		<div className="h-[calc(var(--mobile-safe-area-top)+3.5rem)] border-b border-sidebar-border px-4 pt-[var(--mobile-safe-area-top)] flex items-center gap-2 md:hidden bg-sidebar">
			<Button
				variant="ghost"
				size="icon"
				onClick={onClose}
				title="Close menu"
				className="touch-manipulation flex-shrink-0 text-sidebar-foreground hover:bg-sidebar-accent"
				aria-label="Close menu"
			>
				<X className="w-5 h-5" />
			</Button>
			<div className="flex-1 flex items-center">
				<OttoWordmark height={14} className="text-sidebar-foreground" />
			</div>
			<button
				type="button"
				onClick={onNewSession}
				className="w-8 h-8 rounded-full bg-sidebar-primary flex items-center justify-center hover:opacity-90 transition-opacity touch-manipulation"
				title="New session"
			>
				<Plus className="w-4 h-4 text-sidebar-primary-foreground" />
			</button>
		</div>
	);
});

interface SidebarFooterProps {
	connectionUrl?: string;
	onSwitchConnection?: () => void;
	onCollapse: () => void;
}

const SidebarFooter = memo(function SidebarFooter({
	connectionUrl,
	onSwitchConnection,
	onCollapse,
}: SidebarFooterProps) {
	return (
		<div className="h-12 border-t border-sidebar-border px-2 flex items-center justify-between gap-2">
			<ConnectionStatus
				connectionUrl={connectionUrl}
				onSwitchConnection={onSwitchConnection}
			/>
			<Button
				variant="ghost"
				size="icon"
				onClick={onCollapse}
				title="Collapse sidebar"
				className="transition-transform duration-200 hover:scale-110 touch-manipulation text-sidebar-muted-foreground hover:bg-sidebar-accent w-8 h-8"
			>
				<CollapseSidebarIcon />
			</Button>
		</div>
	);
});

interface ConnectionStatusProps {
	connectionUrl?: string;
	onSwitchConnection?: () => void;
}

const ConnectionStatus = memo(function ConnectionStatus({
	connectionUrl,
	onSwitchConnection,
}: ConnectionStatusProps) {
	if (!connectionUrl || !onSwitchConnection) return <div />;

	return (
		<div className="min-w-0 flex flex-1 items-center gap-2 rounded-full border border-sidebar-border bg-sidebar-accent/40 px-2 py-1">
			<span className="h-2 w-2 flex-shrink-0 rounded-full bg-green-500" />
			<span
				className="min-w-0 flex-1 truncate text-[11px] text-sidebar-muted-foreground"
				title={connectionUrl}
			>
				{getConnectionLabel(connectionUrl)}
			</span>
			<button
				type="button"
				onClick={onSwitchConnection}
				className="flex-shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium text-sidebar-foreground hover:bg-sidebar-accent"
				title="Disconnect and choose another tunnel"
			>
				Switch
			</button>
		</div>
	);
});

function CollapseSidebarIcon() {
	return (
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
	);
}

interface MobileSidebarBackdropProps {
	isVisible: boolean;
	onClose: () => void;
}

const MobileSidebarBackdrop = memo(function MobileSidebarBackdrop({
	isVisible,
	onClose,
}: MobileSidebarBackdropProps) {
	if (!isVisible) return null;

	return (
		<div
			className="fixed inset-0 bg-black/50 z-40 md:hidden"
			onClick={onClose}
			aria-hidden="true"
		/>
	);
});
