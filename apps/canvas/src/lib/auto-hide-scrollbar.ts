const SCROLLING_CLASS = 'is-scrolling';
const HIDE_DELAY_MS = 800;

const timers = new WeakMap<Element, number>();

function handleScroll(event: Event) {
	const target = event.target;
	if (!(target instanceof Element)) return;
	target.classList.add(SCROLLING_CLASS);
	const existing = timers.get(target);
	if (existing) window.clearTimeout(existing);
	timers.set(
		target,
		window.setTimeout(() => {
			target.classList.remove(SCROLLING_CLASS);
			timers.delete(target);
		}, HIDE_DELAY_MS),
	);
}

let initialized = false;

export function initAutoHideScrollbar() {
	if (initialized || typeof document === 'undefined') return;
	initialized = true;
	document.addEventListener('scroll', handleScroll, {
		capture: true,
		passive: true,
	});
}
