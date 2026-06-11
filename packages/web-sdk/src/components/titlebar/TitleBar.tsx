import { memo } from 'react';
import type { MouseEvent, ReactNode } from 'react';
import { Moon, Sun } from 'lucide-react';
import { useSidebarStore } from '../../stores/sidebarStore';
import { useRightRailStore } from '../../stores/rightRailStore';
import type { Theme } from '../../hooks/useTheme';

interface TitleBarButtonProps {
	onClick: () => void;
	title?: string;
	ariaLabel?: string;
	ariaPressed?: boolean;
	children: ReactNode;
}

/** Standard 32x32 icon button used inside the {@link TitleBar}. */
export function TitleBarButton({
	onClick,
	title,
	ariaLabel,
	ariaPressed,
	children,
}: TitleBarButtonProps) {
	return (
		<button
			type="button"
			onClick={onClick}
			className="w-8 h-8 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors"
			title={title}
			aria-label={ariaLabel ?? title}
			aria-pressed={ariaPressed}
		>
			{children}
		</button>
	);
}

/** Toggles the left sessions sidebar (backed by `useSidebarStore`). */
export const TitleBarSidebarToggle = memo(function TitleBarSidebarToggle() {
	const isCollapsed = useSidebarStore((state) => state.isCollapsed);
	const toggleCollapse = useSidebarStore((state) => state.toggleCollapse);
	const label = `${isCollapsed ? 'Show' : 'Hide'} sidebar`;
	return (
		<TitleBarButton
			onClick={toggleCollapse}
			title={label}
			ariaPressed={!isCollapsed}
		>
			<PanelIcon side="left" />
		</TitleBarButton>
	);
});

/** Toggles the right rail pin state (backed by `useRightRailStore`). */
export const TitleBarRightRailToggle = memo(function TitleBarRightRailToggle() {
	const isPinned = useRightRailStore((state) => state.isPinned);
	const togglePinned = useRightRailStore((state) => state.togglePinned);
	const label = `${isPinned ? 'Hide' : 'Show'} right sidebar`;
	return (
		<TitleBarButton onClick={togglePinned} title={label} ariaPressed={isPinned}>
			<PanelIcon side="right" />
		</TitleBarButton>
	);
});

interface TitleBarThemeToggleProps {
	theme: Theme;
	onToggleTheme: () => void;
}

/** Light/dark theme toggle button for the {@link TitleBar}. */
export const TitleBarThemeToggle = memo(function TitleBarThemeToggle({
	theme,
	onToggleTheme,
}: TitleBarThemeToggleProps) {
	return (
		<TitleBarButton
			onClick={onToggleTheme}
			title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
		>
			{theme === 'dark' ? (
				<Sun className="w-4 h-4" />
			) : (
				<Moon className="w-4 h-4" />
			)}
		</TitleBarButton>
	);
});

function PanelIcon({ side }: { side: 'left' | 'right' }) {
	return (
		<svg
			width="16"
			height="16"
			viewBox="0 0 16 16"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.5"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
		>
			<rect x="2" y="2" width="12" height="12" rx="2" />
			<path d={side === 'left' ? 'M6 2v12' : 'M10 2v12'} />
		</svg>
	);
}

export interface TitleBarProps {
	/** Centered title text (absolutely positioned, never shifts layout). */
	title?: ReactNode;
	/** Renders a back arrow button at the very start. */
	onBack?: () => void;
	/** Show the left-sidebar toggle (default true). */
	showSidebarToggle?: boolean;
	/** Extra content after the leading toggles (e.g. workspace tabs). */
	leading?: ReactNode;
	/** Content on the right side (status, theme toggle, window controls…). */
	trailing?: ReactNode;
	/** Inset leading content for macOS traffic lights. */
	leadingInset?: boolean;
	/** Mark the bar as a native drag region (Tauri). */
	dragRegion?: boolean;
	/** Mouse-down handler (e.g. to start native window dragging). */
	onMouseDown?: (e: MouseEvent<HTMLDivElement>) => void;
	className?: string;
}

/**
 * Shared application title bar: back button, sidebar toggle, optional
 * centered title, and host-provided leading/trailing content. Used by the
 * desktop app (with native drag + window controls) and the web app.
 */
export const TitleBar = memo(function TitleBar({
	title,
	onBack,
	showSidebarToggle = true,
	leading,
	trailing,
	leadingInset = false,
	dragRegion = false,
	onMouseDown,
	className,
}: TitleBarProps) {
	return (
		<div
			className={`flex items-center gap-2 pl-4 pr-2 h-12 shrink-0 border-b border-border cursor-default select-none bg-background relative ${className ?? ''}`}
			onMouseDown={onMouseDown}
			{...(dragRegion ? { 'data-tauri-drag-region': true } : {})}
			role="toolbar"
		>
			<div className={`flex items-center gap-2 ${leadingInset ? 'ml-20' : ''}`}>
				{onBack && (
					<button
						type="button"
						onClick={onBack}
						className="w-8 h-8 flex items-center justify-center text-base text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors"
						title="Back"
						aria-label="Back"
					>
						←
					</button>
				)}
				{showSidebarToggle && <TitleBarSidebarToggle />}
				{leading}
			</div>
			{title != null && (
				<div className="absolute inset-0 flex items-center justify-center pointer-events-none">
					<span className="font-medium text-foreground truncate text-base max-w-[40%]">
						{title}
					</span>
				</div>
			)}
			<div className="flex-1" />
			{trailing}
		</div>
	);
});
