import { memo, useEffect } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Plus, ChevronRight, X } from 'lucide-react';
import { useSidebarStore, usePanelWidthStore } from '@ottocode/web-sdk/stores';
import { Button, ResizeHandle } from '@ottocode/web-sdk/components';
import { OttoWordmark } from './OttoWordmark';

const PANEL_KEY = 'left-sidebar';
const DEFAULT_WIDTH = 272;
const MIN_WIDTH = 256;
const MAX_WIDTH = 480;

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

	return (
		<>
			<aside
				className={`relative z-50 shrink-0 overflow-hidden border-r transition-[width,background-color,border-color] duration-300 ease-out fixed md:relative top-0 left-0 h-[var(--app-height,100dvh)] md:h-auto w-full ${
					isCollapsed
						? 'hidden md:flex md:w-12 border-border bg-background'
						: 'flex md:w-[var(--expanded-sidebar-width)] border-sidebar-border sidebar-fade-in'
				}`}
				style={sidebarStyle}
			>
				{isCollapsed ? (
					<div className="flex h-full w-full flex-col">
						<div className="h-12 border-b border-border flex items-center justify-center">
							<Button
								variant="ghost"
								size="icon"
								onClick={onNewSession}
								title="New session"
								className="h-8 w-8 rounded-md touch-manipulation text-muted-foreground hover:bg-muted/50"
							>
								<Plus className="size-[18px]" />
							</Button>
						</div>

						<button
							type="button"
							className="flex-1 cursor-pointer hover:bg-muted/50 transition-colors touch-manipulation"
							onClick={toggleCollapse}
							title="Expand sidebar"
							aria-label="Expand sidebar"
						/>

						<div className="h-12 border-t border-border flex items-center justify-center">
							<Button
								variant="ghost"
								size="icon"
								onClick={toggleCollapse}
								title="Expand sidebar"
								className="h-8 w-8 transition-transform duration-200 hover:scale-110 touch-manipulation text-muted-foreground hover:bg-muted/50"
							>
								<ChevronRight className="size-[18px]" />
							</Button>
						</div>
					</div>
				) : (
					<>
						<div className="flex h-full w-full md:w-[var(--expanded-sidebar-width)] flex-col min-w-0 relative">
							<div className="h-[calc(var(--mobile-safe-area-top)+3.5rem)] border-b border-sidebar-border px-4 pt-[var(--mobile-safe-area-top)] flex items-center gap-2 md:hidden bg-sidebar">
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
								<div className="flex-1 flex items-center">
									<OttoWordmark
										height={14}
										className="text-sidebar-foreground"
									/>
								</div>
							</div>

							<div className="flex-1 relative overflow-hidden">
								<div className="absolute top-0 left-0 right-0 z-30 pointer-events-none">
									<div className="h-12 px-3 flex items-center justify-between border-b border-sidebar-border/40 bg-sidebar/95 backdrop-blur-xl supports-[backdrop-filter]:bg-sidebar/90">
										<div className="flex items-center text-sidebar-foreground/90">
											<OttoWordmark height={14} className="select-none" />
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
								<div className="absolute inset-0 overflow-hidden">
									{children}
								</div>
							</div>

							<div className="h-12 border-t border-sidebar-border px-2 flex items-center justify-between gap-2">
								{connectionUrl && onSwitchConnection ? (
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
								) : (
									<div />
								)}
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
					</>
				)}
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
