import { ChefHat } from 'lucide-react';
import { useSettingsStore } from '../../stores/settingsStore';

/** Primary workspace navigation displayed above the session list. */
export function SessionSidebarNav() {
	const openPreferences = useSettingsStore((state) => state.openPreferences);

	return (
		<nav
			className="shrink-0 border-b border-sidebar-border/60 px-2 py-2"
			aria-label="Workspace navigation"
		>
			<button
				type="button"
				onClick={() => openPreferences('recipes')}
				className="flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-sm font-medium text-sidebar-muted-foreground transition-colors hover:bg-sidebar-accent/70 hover:text-sidebar-foreground"
			>
				<ChefHat className="h-4 w-4 shrink-0" />
				<span>Recipes</span>
			</button>
		</nav>
	);
}
