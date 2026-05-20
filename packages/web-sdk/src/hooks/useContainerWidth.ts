import { useEffect, useState, type RefObject } from 'react';

/**
 * Tracks the inline (width) size of the element referenced by `ref` via a
 * ResizeObserver. Returns 0 until the first measurement.
 */
export function useContainerWidth(ref: RefObject<HTMLElement | null>): number {
	const [width, setWidth] = useState(0);

	useEffect(() => {
		const el = ref.current;
		if (!el) return;

		const update = () => setWidth(el.clientWidth);
		update();

		const observer = new ResizeObserver(() => update());
		observer.observe(el);
		return () => observer.disconnect();
	}, [ref]);

	return width;
}
