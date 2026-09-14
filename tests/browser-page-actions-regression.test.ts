import { describe, expect, it, spyOn } from 'bun:test';
import { createContext, runInContext } from 'node:vm';
import {
	actionScript,
	evaluationResultScript,
	pageStateScript,
} from '../packages/web-sdk/src/lib/browser/page-scripts';
import { executeCommand } from '../packages/web-sdk/src/lib/browser/controller';

function page() {
	class Element extends EventTarget {
		isConnected = true;
		tagName = 'BUTTON';
		innerText = '';
		textContent = '';
		outerHTML = '<button></button>';
		childNodes: { nodeType: number; nodeValue: string }[] = [];
		isContentEditable = false;
		tabIndex = 0;
		disabled = false;
		shadowRoot: Root | null = null;
		clicks = 0;
		getAttribute() {
			return null;
		}
		getBoundingClientRect() {
			return { width: 20, height: 20 };
		}
		focus() {
			document.activeElement = this;
		}
		blur() {
			document.activeElement = null;
		}
		closest() {
			return null;
		}
		scrollIntoView() {}
		click() {
			this.clicks += 1;
		}
		matches(selector: string) {
			if (selector === ':disabled') return this.disabled;
			return this.tagName === 'BUTTON' && selector.includes('button');
		}
	}
	class Input extends Element {
		tagName = 'INPUT';
		private currentValue = 'abc';
		selectionStart = 3;
		selectionEnd = 3;
		readOnly = false;
		type = 'text';
		form: Form | null = null;
		get value() {
			return this.currentValue;
		}
		set value(value: string) {
			this.currentValue = value;
		}
		setSelectionRange(start: number, end: number) {
			this.selectionStart = start;
			this.selectionEnd = end;
		}
	}
	class Textarea extends Input {
		tagName = 'TEXTAREA';
		get value() {
			return super.value;
		}
		set value(value: string) {
			super.value = value;
		}
	}
	class Form extends Element {
		elements: Element[] = [];
		submissions = 0;
		requestSubmit() {
			this.submissions += 1;
		}
	}
	class Root {
		children: Element[] = [];
		activeElement: Element | null = null;
		selectors = new Map<string, Element>();
		querySelector(selector: string) {
			return this.selectors.get(selector) ?? null;
		}
		querySelectorAll() {
			return this.children;
		}
	}
	class Keyboard extends Event {
		key: string;
		constructor(type: string, options: EventInit & { key: string }) {
			super(type, options);
			this.key = options.key;
		}
	}
	const document = Object.assign(new Root(), {
		title: 'Test',
		readyState: 'complete',
		body: { innerText: 'Light DOM' },
		documentElement: { scrollHeight: 100 },
	});
	const context = createContext(
		{
			document,
			location: { href: 'https://example.test/' },
			HTMLElement: Element,
			HTMLInputElement: Input,
			HTMLTextAreaElement: Textarea,
			HTMLSelectElement: class extends Element {},
			HTMLFormElement: Form,
			Node: Element,
			KeyboardEvent: Keyboard,
			InputEvent: Event,
			MouseEvent: Event,
			PointerEvent: Event,
			Event,
			getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
			innerWidth: 800,
			innerHeight: 600,
			scrollY: 0,
			setTimeout,
			clearTimeout,
		},
		{ codeGeneration: { strings: false, wasm: false } },
	);
	runInContext('window = globalThis', context);
	function run(action: string, args: Record<string, unknown> = {}) {
		return JSON.parse(
			runInContext(
				actionScript(
					{ id: 'test', tabId: 'browser:test', action, args },
					'test-channel',
				),
				context,
			),
		);
	}
	return { context, document, Element, Input, Textarea, Form, Root, run };
}

describe('browser page keyboard defaults', () => {
	it('edits selections, emits input, and respects keydown and beforeinput cancellation', () => {
		const p = page();
		const input = new p.Input();
		p.document.activeElement = input;
		let inputs = 0;
		input.addEventListener('input', () => {
			inputs += 1;
		});
		expect(p.run('press', { key: 'Backspace' }).ok).toBe(true);
		expect(input.value).toBe('ab');
		expect(input.selectionStart).toBe(2);
		expect(inputs).toBe(1);
		input.addEventListener('keydown', (event) => event.preventDefault(), {
			once: true,
		});
		expect(p.run('press', { key: 'Backspace' }).prevented).toBe(true);
		expect(input.value).toBe('ab');
		input.addEventListener('beforeinput', (event) => event.preventDefault(), {
			once: true,
		});
		p.run('press', { key: 'Backspace' });
		expect(input.value).toBe('ab');
		input.setSelectionRange(0, 1);
		p.run('press', { key: 'Delete' });
		expect(input.value).toBe('b');
	});

	it('moves focus for Tab and Shift+Tab without ignoring cancellation', () => {
		const p = page();
		const first = new p.Input();
		const second = new p.Element();
		p.document.children = [first, second];
		first.focus();
		p.run('press', { key: 'Tab' });
		expect(p.document.activeElement).toBe(second);
		p.run('press', { key: 'Shift+Tab' });
		expect(p.document.activeElement).toBe(first);
		first.addEventListener('keydown', (event) => event.preventDefault());
		p.run('press', { key: 'Tab' });
		expect(p.document.activeElement).toBe(first);
	});

	it('does not submit prevented Enter or Enter in a textarea', () => {
		const p = page();
		const input = new p.Input();
		const form = new p.Form();
		input.form = form;
		form.elements = [input];
		input.focus();
		input.addEventListener('keydown', (event) => event.preventDefault(), {
			once: true,
		});
		p.run('press', { key: 'Enter' });
		expect(form.submissions).toBe(0);
		p.run('press', { key: 'Enter' });
		expect(form.submissions).toBe(1);
		const textarea = new p.Textarea();
		textarea.form = form;
		textarea.focus();
		p.run('press', { key: 'Enter' });
		expect(textarea.value).toBe('abc\n');
		expect(form.submissions).toBe(1);
	});

	it('preserves read-only values and reports unsupported native actions', () => {
		const p = page();
		const input = new p.Input();
		input.readOnly = true;
		input.focus();
		p.run('press', { key: 'Backspace' });
		expect(input.value).toBe('abc');
		expect(p.run('press', { key: 'Control+A' }).ok).toBe(false);
		expect(p.run('hover').error).toContain('CSS :hover');
		expect(p.run('hover').ok).toBe(false);
	});
});

describe('open shadow DOM inspection', () => {
	it('includes nested shadow elements, text and references in all query paths', () => {
		const p = page();
		const host = new p.Element();
		const nestedHost = new p.Element();
		const button = new p.Element();
		button.innerText = 'Shadow action';
		button.childNodes = [{ nodeType: 3, nodeValue: 'Shadow action' }];
		host.shadowRoot = new p.Root();
		host.shadowRoot.children = [nestedHost];
		nestedHost.shadowRoot = new p.Root();
		nestedHost.shadowRoot.children = [button];
		nestedHost.shadowRoot.selectors.set('#shadow-button', button);
		p.document.children = [host];
		const snapshot = p.run('snapshot');
		expect(snapshot.text).toContain('Shadow action');
		const item = snapshot.elements.find(
			(entry: { name: string }) => entry.name === 'Shadow action',
		);
		expect(item.ref).toMatch(/^@e/);
		expect(p.run('click', { selector: item.ref }).ok).toBe(true);
		expect(button.clicks).toBe(1);
		expect(
			p.run('wait_for', { selector: '#shadow-button', text: 'Shadow action' })
				.ok,
		).toBe(true);
		expect(p.run('find', { query: 'Shadow action' }).matches).toHaveLength(1);
		expect(p.run('html', { selector: '#shadow-button' }).html).toBe(
			'<button></button>',
		);
	});
});

describe('evaluation without nested dynamic compilation', () => {
	it.each([
		['const answer = 40; Promise.resolve(answer + 2); // trailing comment', 42],
		['await Promise.resolve(23)', 23],
		['({ large: 12n })', { large: '12' }],
		['undefined', '[undefined]'],
	])(
		'awaits and serializes %s with string compilation disabled',
		async (source, expected) => {
			const p = page();
			expect(p.run('evaluate', { script: source }).pending).toBe(true);
			await new Promise((resolve) => setTimeout(resolve, 0));
			const result = JSON.parse(
				runInContext(evaluationResultScript('test', 'test-channel'), p.context),
			);
			expect(result).toMatchObject({ ok: true, value: expected });
		},
	);

	it.each([
		'Promise.reject(new Error("rejected"))',
		'throw new Error("rejected")',
	])('reports evaluation errors: %s', async (source) => {
		const p = page();
		p.run('evaluate', { script: source });
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(
			JSON.parse(
				runInContext(evaluationResultScript('test', 'test-channel'), p.context),
			),
		).toEqual({ ok: false, error: 'rejected' });
	});

	it('rejects malformed source before dispatching it', () => {
		expect(() => page().run('evaluate', { script: 'const = ;' })).toThrow(
			'Invalid JavaScript',
		);
	});

	it('controller polls async completion even when executor only returns synchronous values', async () => {
		const p = page();
		const result = await executeCommand(
			{
				id: 'async',
				tabId: 'browser:test',
				action: 'evaluate',
				args: {
					script: 'new Promise(resolve => setTimeout(() => resolve(77), 10))',
				},
			},
			{
				execute: async (script) => runInContext(script, p.context),
			},
			'channel',
		);
		expect(result).toMatchObject({ ok: true, value: 77 });
		expect(
			Object.keys(p.context).filter((key) =>
				key.startsWith('__ottoBrowserEvaluation:'),
			),
		).toEqual([]);
	});
});

describe('controller completion timeouts', () => {
	it.each(['reload', 'evaluate'])(
		'reports %s timeouts rather than false success',
		async (action) => {
			let now = 0;
			let reads = 0;
			let cleaned = false;
			const clock = spyOn(Date, 'now').mockImplementation(() => now);
			try {
				const result = await executeCommand(
					{
						id: 'timeout',
						tabId: 'browser:test',
						action,
						args: { script: 'new Promise(() => {})' },
					},
					{
						execute: async (script) => {
							if (script === pageStateScript) {
								if (++reads > 2) now = 20_000;
								return {
									ok: true,
									readyState: 'complete',
									documentId: 'unchanged',
									url: 'https://example.test/',
								};
							}
							if (script === evaluationResultScript('timeout', 'channel', true))
								cleaned = true;
							if (script === evaluationResultScript('timeout', 'channel'))
								now = 20_000;
							return { ok: true, pending: true };
						},
					},
					'channel',
				);
				expect(result.ok).toBe(false);
				expect(result.error).toContain('within');
				if (action === 'evaluate') expect(cleaned).toBe(true);
			} finally {
				clock.mockRestore();
			}
		},
	);
});

describe('navigation document completion', () => {
	it.each(['reload', 'navigate'])(
		'waits for a new document on same-URL %s',
		async (action) => {
			let reads = 0;
			const state = {
				ok: true,
				url: 'https://example.test/',
				title: 'Page',
				readyState: 'complete',
			};
			const result = await executeCommand(
				{ id: 'nav', tabId: 'browser:test', action, args: { url: state.url } },
				{
					execute: async (script) => {
						if (script !== pageStateScript) return JSON.stringify({ ok: true });
						reads += 1;
						return JSON.stringify({
							...state,
							documentId: reads < 5 ? 'old' : 'new',
						});
					},
				},
				'channel',
			);
			expect(reads).toBe(5);
			expect(result).toMatchObject({
				ok: true,
				urlChanged: false,
				documentChanged: true,
			});
		},
	);

	it('accepts same-document fragment navigation', async () => {
		let reads = 0;
		const result = await executeCommand(
			{
				id: 'hash',
				tabId: 'browser:test',
				action: 'navigate',
				args: { url: 'https://example.test/#next' },
			},
			{
				execute: async (script) =>
					script === pageStateScript
						? JSON.stringify({
								ok: true,
								readyState: 'complete',
								documentId: 'same',
								url: `https://example.test/${++reads > 2 ? '#next' : ''}`,
							})
						: JSON.stringify({ ok: true }),
			},
			'channel',
		);
		expect(result).toMatchObject({
			ok: true,
			urlChanged: true,
			documentChanged: false,
		});
	});
});
