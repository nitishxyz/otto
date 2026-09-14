import { javascriptLanguage } from '@codemirror/lang-javascript';
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
			documentId: String(Date.now()) + ':' + Math.random().toString(36).slice(2),
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
	function ottoRoots() {
		var roots = [document];
		for (var index = 0; index < roots.length; index += 1) {
			var elements = roots[index].querySelectorAll('*');
			for (var child = 0; child < elements.length; child += 1) {
				if (elements[child].shadowRoot) roots.push(elements[child].shadowRoot);
			}
		}
		return roots;
	}
	function ottoQueryAll(selector) {
		var result = [];
		ottoRoots().forEach(function (root) {
			result.push.apply(result, Array.from(root.querySelectorAll(selector)));
		});
		return result;
	}
	function ottoActiveElement() {
		var element = document.activeElement;
		while (element && element.shadowRoot && element.shadowRoot.activeElement) element = element.shadowRoot.activeElement;
		return element;
	}
	function ottoQuery(requested) {
		if (!requested) return ottoActiveElement();
		if (requested.charAt(0) === '@') return ottoReferenceStore().resolve(requested);
		var roots = ottoRoots();
		for (var index = 0; index < roots.length; index += 1) {
			var element = roots[index].querySelector(requested);
			if (element) return element;
		}
		return null;
	}
	function ottoText() {
		return ottoRoots().map(function (root) {
			if (root === document) return (document.body && document.body.innerText) || '';
			return Array.from(root.children).filter(ottoVisible).map(function (element) { return element.innerText || ''; }).join('\\n');
		}).join('\\n');
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
	var candidates = ottoQueryAll('a[href],button,input,textarea,select,[role],[contenteditable="true"],summary');
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
	var text = ottoText().replace(/\\n{3,}/g, '\\n\\n').slice(0, ${MAX_SNAPSHOT_TEXT});
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
		var all = ottoQueryAll('*');
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
			coverage: 'Page fetch/XHR calls since installation plus available resource timings. Workers, navigation requests, and pre-install request details are not captured. Missing method/status fields are unknown, not successful GET requests.',
			requests: requests.slice(-${limit})
		});
	`);
}

function clickScript(
	args: Record<string, unknown>,
	requireDownload = false,
): string {
	return withElement(
		args.selector,
		`
		var anchor = typeof element.closest === 'function' ? element.closest('a[href]') : null;
		var downloadRequested = ${requireDownload} || (anchor instanceof HTMLElement && anchor.hasAttribute('download'));
		var target = anchor instanceof HTMLElement ? (anchor.getAttribute('target') || '').toLowerCase() : '';
		var targetRequestsNewTab = !${Boolean(args.nativePopups)} && !downloadRequested && target && target !== '_self' && target !== '_parent' && target !== '_top';
		var openedUrl = '';
		var originalOpen = window.open;
		var interceptedOpen = function (url) {
			try { openedUrl = new URL(String(url || 'about:blank'), location.href).href; } catch (error) {}
			return null;
		};
		try { if (!${requireDownload || Boolean(args.nativePopups)}) {
			window.open = interceptedOpen;
		} } catch (error) {}
		var preventNewTab = function (event) { event.preventDefault(); };
		if (targetRequestsNewTab) anchor.addEventListener('click', preventNewTab, true);
		element.scrollIntoView({ block: 'center', inline: 'center' });
		var rect = element.getBoundingClientRect();
		var options = { bubbles: true, cancelable: true, composed: true, view: window, button: 0, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 };
		try { element.dispatchEvent(new PointerEvent('pointerdown', options)); } catch (error) {}
		element.dispatchEvent(new MouseEvent('mousedown', options));
		if (typeof element.focus === 'function') element.focus();
		try { element.dispatchEvent(new PointerEvent('pointerup', options)); } catch (error) {}
		element.dispatchEvent(new MouseEvent('mouseup', options));
		try { element.click(); } finally {
			if (targetRequestsNewTab) anchor.removeEventListener('click', preventNewTab, true);
			try { if (!${requireDownload} && window.open === interceptedOpen) window.open = originalOpen; } catch (error) {}
		}
		var anchorUrl = anchor instanceof HTMLElement ? anchor.href : '';
		var newTabUrl = openedUrl || (targetRequestsNewTab ? anchorUrl : '');
		return ottoPage({
			clicked: requested,
			tag: element.tagName.toLowerCase(),
			name: ottoLabel(element),
			newTab: newTabUrl ? { url: newTabUrl } : undefined,
			download: downloadRequested ? { url: anchorUrl || undefined, filename: anchor instanceof HTMLElement ? (anchor.getAttribute('download') || undefined) : undefined } : undefined
		});
	`,
	);
}

function hoverScript(args: Record<string, unknown>): string {
	return withElement(
		args.selector,
		`
		return JSON.stringify({ ok: false, error: 'Hover requires native pointer input. Synthetic mouse events cannot activate CSS :hover; this browser executor does not support native hover.' });
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
		var shift = key === 'Shift+Tab';
		if (shift) key = 'Tab';
		var editable = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement;
		var textInput = editable && typeof element.selectionStart === 'number';
		var supported = ['Enter', 'Tab', 'Backspace', 'Delete', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Escape', ' '];
		if (supported.indexOf(key) < 0 && key.length !== 1) return JSON.stringify({ ok: false, error: 'This key requires native keyboard input: ' + key });
		if (element.isContentEditable || (['Backspace', 'Delete', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].indexOf(key) >= 0 && !textInput)) return JSON.stringify({ ok: false, error: 'This target requires native keyboard input for ' + key });
		if (element.matches(':disabled')) return JSON.stringify({ ok: false, error: 'Element is disabled' });
		element.focus();
		var options = { key: key, shiftKey: shift, bubbles: true, cancelable: true, composed: true };
		var allowed = element.dispatchEvent(new KeyboardEvent('keydown', options));
		if (allowed) {
			if (key === 'Tab') {
				var targets = ottoQueryAll('a[href],button,input,textarea,select,[tabindex],summary,[contenteditable="true"]').filter(function (candidate) {
					return candidate.tabIndex >= 0 && !candidate.matches(':disabled') && !candidate.closest('[inert]') && ottoVisible(candidate);
				});
				targets.sort(function (a, b) { return (a.tabIndex || Infinity) - (b.tabIndex || Infinity); });
				var current = targets.indexOf(element);
				var next = targets[current + (shift ? -1 : 1)];
				if (next) next.focus(); else element.blur();
			} else if (textInput && !element.readOnly && (key.length === 1 || key === 'Backspace' || key === 'Delete' || (key === 'Enter' && element instanceof HTMLTextAreaElement))) {
				var start = element.selectionStart;
				var end = element.selectionEnd;
				var text = key === 'Enter' ? '\\n' : key.length === 1 ? key : '';
				var inputType = key === 'Backspace' ? 'deleteContentBackward' : key === 'Delete' ? 'deleteContentForward' : key === 'Enter' ? 'insertLineBreak' : 'insertText';
				if (start === end && key === 'Backspace') start = Math.max(0, start - Array.from(element.value.slice(0, start)).slice(-1).join('').length);
				if (start === end && key === 'Delete') end += Array.from(element.value.slice(end))[0]?.length || 0;
				if (element.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, composed: true, inputType: inputType, data: text || null }))) {
					var value = element.value.slice(0, start) + text + element.value.slice(end);
					var prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
					Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value);
					element.setSelectionRange(start + text.length, start + text.length);
					element.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: inputType, data: text || null }));
				}
			} else if (textInput && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].indexOf(key) >= 0) {
				var position = key === 'Home' ? 0 : key === 'End' ? element.value.length : key === 'ArrowLeft' ? (element.selectionStart === element.selectionEnd ? Math.max(0, element.selectionStart - 1) : element.selectionStart) : (element.selectionStart === element.selectionEnd ? Math.min(element.value.length, element.selectionEnd + 1) : element.selectionEnd);
				element.setSelectionRange(position, position);
			} else if (key === 'Enter') {
				if (element.matches('button,a[href],summary,input[type="submit"],input[type="button"],input[type="reset"]')) element.click();
				else if (element instanceof HTMLInputElement && element.form) {
					var submitter = Array.from(element.form.elements).find(function (candidate) { return candidate.matches('button[type="submit"],button:not([type]),input[type="submit"],input[type="image"]'); });
					if (submitter) { if (!submitter.disabled) submitter.click(); }
					else if (Array.from(element.form.elements).filter(function (candidate) { return candidate instanceof HTMLInputElement && ['text', 'search', 'url', 'tel', 'email', 'password', 'date', 'month', 'week', 'time', 'datetime-local', 'number'].indexOf(candidate.type) >= 0; }).length <= 1) element.form.requestSubmit();
				}
			} else if (key === ' ' && element.matches('button,input[type="checkbox"],input[type="radio"]')) element.click();
		}
		(ottoActiveElement() || element).dispatchEvent(new KeyboardEvent('keyup', options));
		return ottoPage({ key: key, prevented: !allowed, inputMode: 'emulated', warning: 'Keyboard events are untrusted; only common editing, focus, and activation defaults are emulated.' });
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
			var body = ottoText();
			if (body.indexOf(text) < 0) return JSON.stringify({ ok: false, error: 'Text not found yet: ' + text });
		}
		return ottoPage({ found: requested || text });
	`);
}

function evaluationKey(commandId: string, referenceChannel: string): string {
	return `__ottoBrowserEvaluation:${referenceChannel}:${commandId}`;
}

function evaluateScript(
	command: BrowserControlCommand,
	native = false,
): string {
	const source = String(command.args.script ?? '');
	const tree = javascriptLanguage.parser.parse(source);
	tree.iterate({
		enter(node) {
			if (node.type.isError)
				throw new Error(`Invalid JavaScript near offset ${node.from}`);
		},
	});
	let last = tree.topNode.lastChild;
	while (last?.type.name.endsWith('Comment')) last = last.prevSibling;
	const expression =
		last?.type.name === 'ExpressionStatement' ? last.firstChild : null;
	const body = expression
		? `${source.slice(0, expression.from)}return (${source.slice(expression.from, expression.to)});${source.slice(expression.to)}`
		: source;
	return wrap(`
		var key = '__ottoBrowserEvaluation:' + OTTO_REFERENCE_STATE_KEY + ':' + ${json(command.id)};
		var state = { pending: true };
		if (!${native}) window[key] = state;
		var completion = (async function () {
			try {
				var value = await (async function () {\n${body}\n})();
				state.result = JSON.stringify({ ok: true, url: location.href, value: value === undefined ? '[undefined]' : value }, function (_key, item) {
					if (typeof item === 'bigint') return String(item);
					if (typeof item === 'function') return '[function ' + (item.name || 'anonymous') + ']';
					if (item instanceof Node) return item.outerHTML || item.textContent;
					return item;
				});
			} catch (error) {
				state.result = JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) });
			} finally { state.pending = false; }
			return state.result;
		})();
		return ${native} ? completion : JSON.stringify({ ok: true, pending: true });
	`);
}

/** Native async executors receive a function body, not a bare expression. */
export function nativeEvaluationScript(command: BrowserControlCommand): string {
	return `return (${evaluateScript(command, true)});`;
}

/** Resolves references and prepares a target before trusted host input. */
export function nativeInputTargetScript(
	command: BrowserControlCommand,
	referenceChannel: string,
): string {
	return bindReferenceChannel(
		withElement(
			command.args.selector,
			`
		if (element.matches(':disabled')) return JSON.stringify({ ok: false, error: 'Element is disabled' });
		element.scrollIntoView({ block: 'center', inline: 'center' });
		if (${command.action === 'press'}) element.focus();
		var rect = element.getBoundingClientRect();
		return ottoPage({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
	`,
		),
		referenceChannel,
	);
}

/** Reads a settled evaluation without requiring native execute to await promises. */
export function evaluationResultScript(
	commandId: string,
	referenceChannel: string,
	cleanup = false,
): string {
	const key = json(
		evaluationKey(commandId, `__ottoBrowserRefs:${referenceChannel}`),
	);
	return `(function () {
		var state = window[${key}];
		if (${cleanup}) { delete window[${key}]; return; }
		if (!state) return JSON.stringify({ ok: false, error: 'Evaluation context was lost, possibly due to navigation.' });
		if (state.pending) return JSON.stringify({ ok: true, pending: true });
		delete window[${key}];
		return state.result;
	})()`;
}

/** Reports document readiness so the controller can gate and await navigation. */
export const pageStateScript = bindReferenceChannel(
	wrap('return ottoPage({ documentId: ottoReferenceStore().documentId });'),
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
		case 'download':
			return clickScript(args, true);
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
			return evaluateScript(command);
		default:
			return `JSON.stringify({ ok: false, error: ${json(`Unsupported browser action: ${action}`)} })`;
	}
}

/**
 * Builds a page action. Evaluation runs in an async local scope and returns its
 * final expression through evaluationResultScript, without page-side eval.
 */
export function actionScript(
	command: BrowserControlCommand,
	referenceChannel = 'default',
): string {
	return bindReferenceChannel(buildActionScript(command), referenceChannel);
}
