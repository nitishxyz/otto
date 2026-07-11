import type { HTMLAttributes, ReactNode } from 'react';
import { handleTitleBarDrag } from '../utils/title-bar';

interface DesktopDragRegionProps extends HTMLAttributes<HTMLDivElement> {
	children: ReactNode;
}

/** Native desktop header surface with guarded dragging around interactive controls. */
export function DesktopDragRegion({
	children,
	role = 'toolbar',
	onMouseDown,
	...props
}: DesktopDragRegionProps) {
	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: role defaults to "toolbar"; Biome cannot see the dynamic role value on this shared drag surface
		<div
			{...props}
			role={role}
			data-tauri-drag-region
			onMouseDown={(event) => {
				onMouseDown?.(event);
				if (!event.defaultPrevented) handleTitleBarDrag(event);
			}}
		>
			{children}
		</div>
	);
}
