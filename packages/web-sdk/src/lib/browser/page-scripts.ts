import { BROWSER_RECORDER_SCRIPT } from './recorder-script';

export interface BrowserControlCommand {
	id: string;
	tabId: string;
	action: string;
	args: Record<string, unknown>;
}

const MAX_SNAPSHOT_TEXT = 30_000;
const MAX_SNAPSHOT_ELEMENTS = 250;
const MAX_HTML_LENGTH = 40_000;
const MAX_REFERENCE_ELEMENTS = 5_000;
const REFERENCE_STATE_PLACEHOLDER = '__OTTO_REFERENCE_STATE_KEY__';

function json(value: unknown): string {
	return JSON.stringify(value === undefined ? null : value);
}

function selectorArg(selector: unknown): string {
	return JSON.stringify(typeof selector === 'string' ? selector : '');
}

/** Shared helpers injected into every generated page script. */
const HELPERS = `
	var OTTO_REFERENCE_STATE_KEY = ${json(REFERENCE_STATE_PLACEHOLDER)};
	function ottoReferenceStore() {
		var existing = window[OTTO_REFERENCE_STATE_KEY];
		if (existing) {
			if (typeof existing.resolve !== 'function' || typeof existing.ref !== 'function') {
				throw new Error('Browser reference channel is unavailable');
			}
			return existing;
		}
		var elementToRef = new WeakMap();
		var refToElement = new Map();
		var nextId = 1;
		function prune() {
			refToElement.forEach(function (element, ref) {
				if (element && element.isConnected) return;
				refToElement.delete(ref);
				if (element) elementToRef.delete(element);
			});
		}
		var store = Object.freeze({
			resolve: function (requested) {
				if (!/^@e\\d+$/.test(requested)) return null;
				prune();
				return refToElement.get(requested.slice(1)) || null;
			},
			ref: function (element) {
				prune();
				var existingRef = elementToRef.get(element);
				if (existingRef && refToElement.get(existingRef) === element) return existingRef;
				if (refToElement.size >= ${MAX_REFERENCE_ELEMENTS}) {
					var oldestRef = refToElement.keys().next().value;
					var oldestElement = refToElement.get(oldestRef);
					refToElement.delete(oldestRef);
					if (oldestElement) elementToRef.delete(oldestElement);
				}
				var ref = 'e' + nextId++;
				elementToRef.set(element, ref);
				refToElement.set(ref, element);
				return ref;
			}
		});
		Object.defineProperty(window, OTTO_REFERENCE_STATE_KEY, {
			value: store,
			writable: false,
			configurable: false,
			enumerable: false
		});
		return store;
	}
	function ottoQuery(requested) {
		if (!requested) return document.activeElement;
		if (requested.charAt(0) === '@') return ottoReferenceStore().resolve(requested);
		return document.querySelector(requested);
	}
	function ottoRef(element) {
		return ottoReferenceStore().ref(element);
	}
	function ottoVisible(element) {
		var style = getComputedStyle(element);
		var rect = element.getBoundingClientRect();
		return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
	}
	function ottoLabel(element) {
		var input = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement;
		var raw = element.getAttribute('aria-label') || element.getAttribute('title') || element.getAttribute('placeholder') || element.innerText || (input ? element.value : '') || element.getAttribute('alt') || '';
		return raw.trim().replace(/\\s+/g, ' ').slice(0, 300);
	}
	function ottoRole(element) {
		var tag = element.tagName.toLowerCase();
		var roles = { a: 'link', button: 'button', input: 'input', textarea: 'textbox', select: 'select', summary: 'button' };
		return element.getAttribute('role') || roles[tag] || tag;
	}
	function ottoPage(extra) {
		var result = { ok: true, url: location.href, title: document.title, readyState: document.readyState };
		if (extra) for (var key in extra) result[key] = extra[key];
		return JSON.stringify(result);
	}
	function ottoMissing(requested) {
		return JSON.stringify({ ok: false, error: 'Element not found: ' + requested });
	}
`;

function wrap(body: string): string {
	return `(function(){${HELPERS}${body}})()`;
}

function bindReferenceChannel(
	script: string,
	referenceChannel: string,
): string {
	return script.replace(
		json(REFERENCE_STATE_PLACEHOLDER),
		json(`__ottoBrowserRefs:${referenceChannel}`),
	);
}

function withElement(selector: unknown, body: string): string {
	return wrap(`
		var requested = ${selectorArg(selector)};
		var element = ottoQuery(requested);
		if (!(element instanceof HTMLElement)) return ottoMissing(requested);
		${body}
	`);
}

const snapshotScript = wrap(`
	var candidates = document.querySelectorAll('a[href],button,input,textarea,select,[role],[contenteditable="true"],summary');
	var elements = [];
	for (var index = 0; index < candidates.length; index += 1) {
		var element = candidates[index];
		if (!(element instanceof HTMLElement) || !ottoVisible(element)) continue;
		elements.push({
			ref: '@' + ottoRef(element),
			role: ottoRole(element),
			name: ottoLabel(element),
			disabled: 'disabled' in element ? Boolean(element.disabled) : undefined
		});
		if (elements.length >= ${MAX_SNAPSHOT_ELEMENTS}) break;
	}
	var text = ((document.body && document.body.innerText) || '').replace(/\\n{3,}/g, '\\n\\n').slice(0, ${MAX_SNAPSHOT_TEXT});
	return ottoPage({
		text: text,
		elements: elements,
		viewport: { width: innerWidth, height: innerHeight, scrollY: Math.round(scrollY), scrollHeight: document.documentElement.scrollHeight },
		truncated: text.length >= ${MAX_SNAPSHOT_TEXT} || elements.length >= ${MAX_SNAPSHOT_ELEMENTS}
	});
`);

function htmlScript(args: Record<string, unknown>): string {
	const maxLength = Math.max(
		500,
		Number(args.maxLength) || MAX_HTML_LENGTH,
	).toString();
	return wrap(`
		var requested = ${selectorArg(args.selector)};
		var element = requested ? ottoQuery(requested) : document.documentElement;
		if (!(element instanceof HTMLElement)) return ottoMissing(requested);
		var html = element.outerHTML || '';
		return ottoPage({
			selector: requested || 'html',
			length: html.length,
			html: html.slice(0, ${maxLength}),
			truncated: html.length > ${maxLength}
		});
	`);
}

function findScript(args: Record<string, unknown>): string {
	const limit = Math.max(1, Math.min(500, Number(args.limit) || 20)).toString();
	return wrap(`
		var query = ${json(String(args.query ?? ''))}.toLowerCase();
		var matches = [];
		var all = document.querySelectorAll('*');
		for (var index = 0; index < all.length; index += 1) {
			var element = all[index];
			if (!(element instanceof HTMLElement)) continue;
			var ownText = '';
			for (var child = 0; child < element.childNodes.length; child += 1) {
				var node = element.childNodes[child];
				if (node.nodeType === 3) ownText += node.nodeValue;
			}
			var html = element.outerHTML || '';
			var openTag = html.slice(0, (html.indexOf('>') + 1) || 200);
			if (ownText.toLowerCase().indexOf(query) < 0 && openTag.toLowerCase().indexOf(query) < 0) continue;
			matches.push({
				ref: '@' + ottoRef(element),
				tag: element.tagName.toLowerCase(),
				role: ottoRole(element),
				visible: ottoVisible(element),
				text: ownText.trim().replace(/\\s+/g, ' ').slice(0, 200),
				html: html.slice(0, 400)
			});
			if (matches.length >= ${limit}) break;
		}
		return ottoPage({ query: ${json(String(args.query ?? ''))}, count: matches.length, matches: matches, truncated: matches.length >= ${limit} });
	`);
}

function recorderReadScript(body: string): string {
	return `${BROWSER_RECORDER_SCRIPT}\n${wrap(`
		var state = window.__ottoBrowserRecorder;
		if (!state) return JSON.stringify({ ok: false, error: 'The page recorder could not be installed.' });
		${body}
	`)}`;
}

function consoleScript(args: Record<string, unknown>): string {
	const limit = Math.max(1, Math.min(500, Number(args.limit) || 50)).toString();
	const level = String(args.level ?? 'all');
	return recorderReadScript(`
		var level = ${json(level)};
		var messages = state.console.filter(function (entry) { return level === 'all' || entry.level === level; });
		var counts = {};
		for (var index = 0; index < state.console.length; index += 1) {
			var current = state.console[index].level;
			counts[current] = (counts[current] || 0) + 1;
		}
		return ottoPage({
			level: level,
			total: messages.length,
			counts: counts,
			installedAt: state.installedAt,
			messages: messages.slice(-${limit})
		});
	`);
}

function networkScript(args: Record<string, unknown>): string {
	const limit = Math.max(1, Math.min(500, Number(args.limit) || 50)).toString();
	return recorderReadScript(`
		var query = ${json(typeof args.query === 'string' ? args.query.toLowerCase() : '')};
		var requests = state.network.filter(function (entry) {
			return !query || String(entry.url).toLowerCase().indexOf(query) >= 0;
		});
		var failed = requests.filter(function (entry) { return entry.error || (entry.status >= 400); }).length;
		return ottoPage({
			total: requests.length,
			failed: failed,
			installedAt: state.installedAt,
			requests: requests.slice(-${limit})
		});
	`);
}

function clickScript(args: Record<string, unknown>): string {
	return withElement(
		args.selector,
		`
		element.scrollIntoView({ block: 'center', inline: 'center' });
		var rect = element.getBoundingClientRect();
		var options = { bubbles: true, cancelable: true, composed: true, view: window, button: 0, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 };
		try { element.dispatchEvent(new PointerEvent('pointerdown', options)); } catch (error) {}
		element.dispatchEvent(new MouseEvent('mousedown', options));
		if (typeof element.focus === 'function') element.focus();
		try { element.dispatchEvent(new PointerEvent('pointerup', options)); } catch (error) {}
		element.dispatchEvent(new MouseEvent('mouseup', options));
		element.click();
		return ottoPage({ clicked: requested, tag: element.tagName.toLowerCase(), name: ottoLabel(element) });
	`,
	);
}

function hoverScript(args: Record<string, unknown>): string {
	return withElement(
		args.selector,
		`
		element.scrollIntoView({ block: 'center', inline: 'center' });
		var rect = element.getBoundingClientRect();
		var options = { bubbles: true, cancelable: true, composed: true, view: window, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 };
		try { element.dispatchEvent(new PointerEvent('pointerover', options)); } catch (error) {}
		element.dispatchEvent(new MouseEvent('mouseover', options));
		element.dispatchEvent(new MouseEvent('mousemove', options));
		return ottoPage({ hovered: requested, name: ottoLabel(element) });
	`,
	);
}

function typeScript(args: Record<string, unknown>): string {
	return withElement(
		args.selector,
		`
		var text = ${json(String(args.text ?? ''))};
		element.focus();
		if (element instanceof HTMLSelectElement) {
			var matched = false;
			for (var index = 0; index < element.options.length; index += 1) {
				var option = element.options[index];
				if (option.value === text || option.text.trim() === text) {
					element.selectedIndex = index;
					matched = true;
					break;
				}
			}
			if (!matched) return JSON.stringify({ ok: false, error: 'No option matches: ' + text });
		} else if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
			var prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
			var descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
			var setter = descriptor && descriptor.set;
			if (setter) setter.call(element, text); else element.value = text;
		} else if (element.isContentEditable) {
			element.textContent = text;
		} else {
			return JSON.stringify({ ok: false, error: 'Element is not editable' });
		}
		element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
		element.dispatchEvent(new Event('change', { bubbles: true }));
		return ottoPage({ typed: text.length, selector: requested });
	`,
	);
}

function pressScript(args: Record<string, unknown>): string {
	return withElement(
		args.selector,
		`
		var key = ${json(String(args.key ?? ''))};
		element.focus();
		var options = { key: key, bubbles: true, cancelable: true, composed: true };
		element.dispatchEvent(new KeyboardEvent('keydown', options));
		if (key === 'Enter') {
			var form = element.closest('form');
			if (form instanceof HTMLFormElement) setTimeout(function () { form.requestSubmit(); }, 0);
		}
		if (key === 'Escape' && typeof element.blur === 'function') element.blur();
		element.dispatchEvent(new KeyboardEvent('keyup', options));
		return ottoPage({ key: key });
	`,
	);
}

function scrollScript(args: Record<string, unknown>): string {
	return wrap(`
		var requested = ${selectorArg(args.selector)};
		var target = window;
		if (requested) {
			target = ottoQuery(requested);
			if (!(target instanceof HTMLElement)) return ottoMissing(requested);
		}
		target.scrollBy({ left: ${Number(args.x) || 0}, top: ${Number(args.y) || 0}, behavior: 'instant' });
		return ottoPage({ scrollY: Math.round(scrollY), scrollHeight: document.documentElement.scrollHeight });
	`);
}

function waitForScript(args: Record<string, unknown>): string {
	return wrap(`
		var requested = ${selectorArg(args.selector)};
		var text = ${json(typeof args.text === 'string' ? args.text : '')};
		if (requested) {
			var element = ottoQuery(requested);
			if (!(element instanceof HTMLElement)) return ottoMissing(requested);
			if (!ottoVisible(element)) return JSON.stringify({ ok: false, error: 'Element is not visible yet: ' + requested });
		}
		if (text) {
			var body = (document.body && document.body.innerText) || '';
			if (body.indexOf(text) < 0) return JSON.stringify({ ok: false, error: 'Text not found yet: ' + text });
		}
		return ottoPage({ found: requested || text });
	`);
}

function evaluateScript(args: Record<string, unknown>): string {
	return `(function(){
		try {
			var value = (0, eval)(${json(String(args.script ?? ''))});
			return JSON.stringify({ ok: true, url: location.href, value: value === undefined ? '[undefined]' : value }, function (_key, item) {
				if (typeof item === 'bigint') return String(item);
				if (typeof item === 'function') return '[function ' + (item.name || 'anonymous') + ']';
				if (item instanceof Node) return item.outerHTML || item.textContent;
				return item;
			});
		} catch (error) {
			return JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) });
		}
	})()`;
}

/** Reports document readiness so the controller can gate and await navigation. */
export const pageStateScript = bindReferenceChannel(
	wrap('return ottoPage({});'),
	'page-state',
);

/** Brings an element into view before the host captures a screenshot. */
export function scrollIntoViewScript(
	selector: string,
	referenceChannel = 'default',
): string {
	return bindReferenceChannel(
		withElement(
			selector,
			`
		element.scrollIntoView({ block: 'center', inline: 'center' });
		return ottoPage({ selector: requested });
	`,
		),
		referenceChannel,
	);
}

function buildActionScript(command: BrowserControlCommand): string {
	const { action, args } = command;
	switch (action) {
		case 'navigate':
			return `(function(){ var url = ${json(args.url)}; setTimeout(function(){ location.assign(url); }, 0); return JSON.stringify({ ok: true, url: url }); })()`;
		case 'back':
			return `(function(){ setTimeout(function(){ history.back(); }, 0); return JSON.stringify({ ok: true }); })()`;
		case 'forward':
			return `(function(){ setTimeout(function(){ history.forward(); }, 0); return JSON.stringify({ ok: true }); })()`;
		case 'reload':
			return `(function(){ setTimeout(function(){ location.reload(); }, 0); return JSON.stringify({ ok: true }); })()`;
		case 'stop':
			return `(function(){ window.stop(); return JSON.stringify({ ok: true }); })()`;
		case 'snapshot':
			return snapshotScript;
		case 'html':
			return htmlScript(args);
		case 'find':
			return findScript(args);
		case 'console':
			return consoleScript(args);
		case 'network':
			return networkScript(args);
		case 'click':
			return clickScript(args);
		case 'hover':
			return hoverScript(args);
		case 'type':
			return typeScript(args);
		case 'press':
			return pressScript(args);
		case 'scroll':
			return scrollScript(args);
		case 'wait_for':
			return waitForScript(args);
		case 'evaluate':
			return evaluateScript(args);
		default:
			return `JSON.stringify({ ok: false, error: ${json(`Unsupported browser action: ${action}`)} })`;
	}
}

/** Builds the page script that fulfils a browser control command. */
export function actionScript(
	command: BrowserControlCommand,
	referenceChannel = 'default',
): string {
	return bindReferenceChannel(buildActionScript(command), referenceChannel);
}
