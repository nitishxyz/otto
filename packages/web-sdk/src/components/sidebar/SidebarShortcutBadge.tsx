import { memo } from 'react';
import { useShortcutHintsVisible } from '../../hooks/useShortcutHintsVisible';

interface SidebarShortcutBadgeProps {
	shortcut: string;
}

export const SidebarShortcutBadge = memo(function SidebarShortcutBadge({
	shortcut,
}: SidebarShortcutBadgeProps) {
	const isVisible = useShortcutHintsVisible();

	if (!isVisible) return null;

	return (
		<span
			aria-hidden="true"
			className="absolute bottom-0.5 right-0.5 min-w-4 h-4 px-1 rounded border border-border bg-background/95 text-[10px] font-semibold leading-none text-foreground shadow-sm flex items-center justify-center pointer-events-none"
		>
			{shortcut}
		</span>
	);
});
