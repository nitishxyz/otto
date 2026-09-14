import { expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';

interface Node {
	type: unknown;
	props: Record<string, unknown>;
	children: Node[];
}

// Execute the component with deterministic hooks/timers without loading its controller.
function viewerHarness(url: string) {
	const source = readFileSync(
		new URL(
			'../packages/web-sdk/src/components/browser/BrowserViewerPanel.tsx',
			import.meta.url,
		),
		'utf8',
	);
	const compiled = new Bun.Transpiler({
		loader: 'tsx',
		tsconfig: { compilerOptions: { jsx: 'react' } },
	})
		.transformSync(source)
		.replace(/^import[\s\S]*?;\n/gm, '')
		.replace(
			'export function BrowserViewerPanel',
			'function BrowserViewerPanel',
		);
	const slots: unknown[] = [];
	const dependencies: (unknown[] | undefined)[] = [];
	const cleanups = new Map<number, () => void>();
	const timers = new Map<number, { callback: () => void; delay: number }>();
	let timerId = 0;
	let cursor = 0;
	let dirty = false;
	let effects: (() => void)[] = [];
	let tree: Node;
	const tab = {
		id: 'browser:browser',
		type: 'browser',
		kind: 'browser',
		title: 'Browser',
		url,
		reloadKey: 0,
	};
	const store = {
		updateBrowserTabUrl() {},
		reloadBrowserTab() {},
		openBrowserTab() {},
		tabsById: { [tab.id]: tab },
	};
	const useStore = Object.assign(
		(selector: (state: typeof store) => unknown) => selector(store),
		{ getState: () => store },
	);
	const useState = (initial: unknown) => {
		const index = cursor++;
		if (!(index in slots))
			slots[index] = typeof initial === 'function' ? initial() : initial;
		return [
			slots[index],
			(value: unknown) => {
				const next = typeof value === 'function' ? value(slots[index]) : value;
				if (!Object.is(next, slots[index])) {
					slots[index] = next;
					dirty = true;
				}
			},
		];
	};
	const useRef = (initial: unknown) => {
		const index = cursor++;
		if (!(index in slots)) slots[index] = { current: initial };
		return slots[index];
	};
	const useEffect = (
		effect: () => undefined | (() => void),
		deps?: unknown[],
	) => {
		const index = cursor++;
		const previous = dependencies[index];
		if (
			deps &&
			previous &&
			deps.every((value, i) => Object.is(value, previous[i]))
		)
			return;
		dependencies[index] = deps;
		effects.push(() => {
			cleanups.get(index)?.();
			const cleanup = effect();
			if (cleanup) cleanups.set(index, cleanup);
			else cleanups.delete(index);
		});
	};
	const useCallback = (callback: unknown, deps: unknown[]) => {
		const index = cursor++;
		const previous = dependencies[index];
		if (!previous || deps.some((value, i) => !Object.is(value, previous[i]))) {
			slots[index] = callback;
			dependencies[index] = deps;
		}
		return slots[index];
	};
	const bindings = {
		React: {
			createElement: (
				type: unknown,
				props: Record<string, unknown> | null,
				...children: Node[]
			) => ({ type, props: props ?? {}, children }),
		},
		useState,
		useRef,
		useEffect,
		useCallback,
		useViewerTabsStore: useStore,
		connectBrowserController: () => () => {},
		setTimeout: (callback: () => void, delay: number) => {
			const id = ++timerId;
			timers.set(id, { callback, delay });
			return id;
		},
		clearTimeout: (id: number) => timers.delete(id),
		setInterval: () => 0,
		clearInterval: () => {},
		ChevronLeft: 'left',
		ChevronRight: 'right',
		ExternalLink: 'external',
		Globe2: 'globe',
		RefreshCw: 'refresh',
		X: 'x',
		Button: 'button',
	};
	const component = new Function(
		...Object.keys(bindings),
		`${compiled}; return BrowserViewerPanel;`,
	)(...Object.values(bindings)) as (props: { tab: typeof tab }) => Node;
	const render = () => {
		let attempts = 0;
		do {
			if (++attempts > 20) throw new Error('Unstable component render');
			dirty = false;
			cursor = 0;
			effects = [];
			tree = component({ tab });
			for (const effect of effects) effect();
		} while (dirty);
	};
	const nodes = (node: Node, predicate: (node: Node) => boolean): Node[] => {
		if (!node || typeof node !== 'object') return [];
		return [
			...(predicate(node) ? [node] : []),
			...node.children.flatMap((child) => nodes(child, predicate)),
		];
	};
	render();
	return {
		iframe: () => nodes(tree, (node) => node.type === 'iframe')[0],
		warnings: () => nodes(tree, (node) => node.type === 'output'),
		slowLoad: () => {
			for (const [id, timer] of [...timers]) {
				if (timer.delay !== 6000) continue;
				timers.delete(id);
				timer.callback();
			}
			render();
		},
		open: (nextUrl: string) => {
			tab.url = nextUrl;
			render();
		},
		reload: () => {
			tab.reloadKey += 1;
			render();
		},
		loaded: () => {
			const iframe = nodes(tree, (node) => node.type === 'iframe')[0];
			(iframe.props.onLoad as () => void)();
			render();
		},
		dispose: () => {
			for (const cleanup of cleanups.values()) cleanup();
		},
	};
}

it('renders scheme-less localhost URLs as HTTP previews', () => {
	const viewer = viewerHarness('localhost:3000/path');
	try {
		expect(viewer.iframe()?.props.src).toBe('http://localhost:3000/path');
	} finally {
		viewer.dispose();
	}
});

it('keeps the iframe mounted after a slow-load warning and allows completion', () => {
	const viewer = viewerHarness('https://example.com/slow');
	try {
		const original = viewer.iframe();
		viewer.slowLoad();
		expect(viewer.warnings()).toHaveLength(1);
		expect(viewer.iframe()?.props.src).toBe(original.props.src);
		expect(viewer.iframe()?.props.key).toBe(original.props.key);
		viewer.loaded();
		expect(viewer.warnings()).toHaveLength(0);
		expect(viewer.iframe()).toBeDefined();
	} finally {
		viewer.dispose();
	}
});

it('clears the previous load warning when a tool opens another URL in the tab', () => {
	const viewer = viewerHarness('https://example.com/slow');
	try {
		viewer.slowLoad();
		expect(viewer.warnings()).toHaveLength(1);
		viewer.open('https://example.com/fast');
		expect(viewer.warnings()).toHaveLength(0);
		expect(viewer.iframe()?.props.src).toBe('https://example.com/fast');
		viewer.slowLoad();
		expect(viewer.warnings()).toHaveLength(1);
	} finally {
		viewer.dispose();
	}
});

it('resets slow-load state and restarts the timer when reloading the same URL', () => {
	const viewer = viewerHarness('https://example.com/slow');
	try {
		viewer.slowLoad();
		expect(viewer.warnings()).toHaveLength(1);
		const key = viewer.iframe()?.props.key;
		viewer.reload();
		expect(viewer.warnings()).toHaveLength(0);
		expect(viewer.iframe()?.props.key).not.toBe(key);
		viewer.slowLoad();
		expect(viewer.warnings()).toHaveLength(1);
	} finally {
		viewer.dispose();
	}
});
