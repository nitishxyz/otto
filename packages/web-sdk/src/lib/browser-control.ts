import { pollBrowserCommand, submitBrowserCommandResult } from '@ottocode/api';

interface BrowserControlCommand {
	id: string;
	tabId: string;
	action: string;
	args: Record<string, unknown>;
}

interface BrowserControlWireCommand
	extends Omit<BrowserControlCommand, 'args'> {
	args: string;
}

export interface BrowserPageExecutor {
	execute(script: string): Promise<unknown>;
}

const MAX_SNAPSHOT_TEXT = 30_000;
const MAX_SNAPSHOT_ELEMENTS = 250;

function selectorScript(selector: unknown): string {
	const value = typeof selector === 'string' ? selector : '';
	return JSON.stringify(value);
}

function elementLookupSource(selector: unknown): string {
	return `
		const requested = ${selectorScript(selector)};
		const selector = requested.startsWith('@')
			? '[data-otto-ref="' + CSS.escape(requested.slice(1)) + '"]'
			: requested;
		const element = selector ? document.querySelector(selector) : document.activeElement;
		if (!(element instanceof HTMLElement)) {
			return JSON.stringify({ ok: false, error: 'Element not found: ' + requested });
		}
	`;
}

function actionScript(command: BrowserControlCommand): string {
	const { action, args } = command;
	switch (action) {
		case 'navigate':
			return `(function(){ setTimeout(function(){ location.assign(${JSON.stringify(args.url)}); }, 0); return JSON.stringify({ ok: true, url: ${JSON.stringify(args.url)} }); })()`;
		case 'back':
			return `(function(){ setTimeout(function(){ history.back(); }, 0); return JSON.stringify({ ok: true }); })()`;
		case 'forward':
			return `(function(){ setTimeout(function(){ history.forward(); }, 0); return JSON.stringify({ ok: true }); })()`;
		case 'reload':
			return `(function(){ setTimeout(function(){ location.reload(); }, 0); return JSON.stringify({ ok: true }); })()`;
		case 'stop':
			return `(function(){ window.stop(); return JSON.stringify({ ok: true }); })()`;
		case 'snapshot':
			return `(function(){
				const visible = function(element) {
					const style = getComputedStyle(element);
					const rect = element.getBoundingClientRect();
					return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
				};
				const candidates = Array.from(document.querySelectorAll('a[href],button,input,textarea,select,[role],[contenteditable="true"],summary'));
				let nextRef = 1;
				const used = new Set(candidates.map(function(element) { return element.getAttribute('data-otto-ref'); }).filter(Boolean));
				const elements = [];
				for (const element of candidates) {
					if (!(element instanceof HTMLElement) || !visible(element)) continue;
					let ref = element.getAttribute('data-otto-ref');
					while (!ref && used.has('e' + nextRef)) nextRef += 1;
					if (!ref) {
						ref = 'e' + nextRef++;
						element.setAttribute('data-otto-ref', ref);
						used.add(ref);
					}
					const tag = element.tagName.toLowerCase();
					const input = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement;
					const name = (element.getAttribute('aria-label') || element.getAttribute('title') || element.getAttribute('placeholder') || element.innerText || (input ? element.value : '') || element.getAttribute('alt') || '').trim().replace(/\\s+/g, ' ').slice(0, 300);
					const role = element.getAttribute('role') || ({ a: 'link', button: 'button', input: 'input', textarea: 'textbox', select: 'select', summary: 'button' }[tag]) || tag;
					elements.push({ ref: '@' + ref, role: role, name: name, disabled: 'disabled' in element ? Boolean(element.disabled) : undefined });
					if (elements.length >= ${MAX_SNAPSHOT_ELEMENTS}) break;
				}
				const text = (document.body?.innerText || '').replace(/\\n{3,}/g, '\\n\\n').slice(0, ${MAX_SNAPSHOT_TEXT});
				return JSON.stringify({ ok: true, url: location.href, title: document.title, text: text, elements: elements, truncated: text.length >= ${MAX_SNAPSHOT_TEXT} || elements.length >= ${MAX_SNAPSHOT_ELEMENTS} });
			})()`;
		case 'click':
			return `(function(){ ${elementLookupSource(args.selector)} element.scrollIntoView({ block: 'center', inline: 'center' }); element.focus(); setTimeout(function(){ element.click(); }, 0); return JSON.stringify({ ok: true, clicked: ${selectorScript(args.selector)} }); })()`;
		case 'type':
			return `(function(){ ${elementLookupSource(args.selector)}
				const text = ${JSON.stringify(args.text ?? '')};
				element.focus();
				if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
					const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
					const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
					if (setter) setter.call(element, text); else element.value = text;
				} else if (element.isContentEditable) element.textContent = text;
				else return JSON.stringify({ ok: false, error: 'Element is not editable' });
				element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
				element.dispatchEvent(new Event('change', { bubbles: true }));
				return JSON.stringify({ ok: true, typed: text.length });
			})()`;
		case 'press':
			return `(function(){ ${elementLookupSource(args.selector)}
				const key = ${JSON.stringify(args.key ?? '')};
				element.focus();
				element.dispatchEvent(new KeyboardEvent('keydown', { key: key, bubbles: true, cancelable: true }));
				if (key === 'Enter') {
					const form = element.closest('form');
					if (form instanceof HTMLFormElement) setTimeout(function(){ form.requestSubmit(); }, 0);
				}
				if (key === 'Escape') element.blur();
				element.dispatchEvent(new KeyboardEvent('keyup', { key: key, bubbles: true, cancelable: true }));
				return JSON.stringify({ ok: true, key: key });
			})()`;
		case 'scroll':
			return `(function(){
				const requested = ${selectorScript(args.selector)};
				let target = window;
				if (requested) {
					const selector = requested.startsWith('@') ? '[data-otto-ref="' + CSS.escape(requested.slice(1)) + '"]' : requested;
					target = document.querySelector(selector);
					if (!(target instanceof HTMLElement)) return JSON.stringify({ ok: false, error: 'Element not found: ' + requested });
				}
				target.scrollBy({ left: ${Number(args.x) || 0}, top: ${Number(args.y) || 0}, behavior: 'instant' });
				return JSON.stringify({ ok: true, x: scrollX, y: scrollY });
			})()`;
		case 'wait_for':
			return `(function(){ ${elementLookupSource(args.selector)} return JSON.stringify({ ok: true, found: ${selectorScript(args.selector)} }); })()`;
		case 'evaluate':
			return `(function(){ try { const value = (0, eval)(${JSON.stringify(args.script ?? '')}); return JSON.stringify({ ok: true, value: value }, function(_key, item){ if (typeof item === 'bigint') return String(item); if (item instanceof Node) return item.outerHTML || item.textContent; return item; }); } catch (error) { return JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }); } })()`;
		default:
			return `JSON.stringify({ ok: false, error: ${JSON.stringify(`Unsupported browser action: ${action}`)} })`;
	}
}

function decodeResult(value: unknown): Record<string, unknown> {
	let decoded = value;
	for (let index = 0; index < 2 && typeof decoded === 'string'; index += 1) {
		try {
			decoded = JSON.parse(decoded);
		} catch {
			break;
		}
	}
	if (decoded && typeof decoded === 'object' && !Array.isArray(decoded)) {
		return decoded as Record<string, unknown>;
	}
	return { ok: true, value: decoded };
}

async function executeCommand(
	command: BrowserControlCommand,
	executor: BrowserPageExecutor,
): Promise<Record<string, unknown>> {
	const timeout =
		command.action === 'wait_for'
			? Math.max(100, Number(command.args.timeoutMs) || 5_000)
			: 0;
	const deadline = Date.now() + timeout;

	do {
		try {
			const result = decodeResult(
				await executor.execute(actionScript(command)),
			);
			if (result.ok !== false || command.action !== 'wait_for') return result;
		} catch (error) {
			if (command.action !== 'wait_for' || Date.now() >= deadline) {
				return {
					ok: false,
					error: error instanceof Error ? error.message : String(error),
				};
			}
		}
		await new Promise((resolve) => setTimeout(resolve, 200));
	} while (Date.now() < deadline);

	return {
		ok: false,
		error: `Timed out waiting for ${String(command.args.selector ?? 'element')}`,
	};
}

/** Connects a mounted browser surface to server-side browser tool commands. */
export function connectBrowserController(
	tabId: string,
	executor: BrowserPageExecutor,
): () => void {
	const abortController = new AbortController();

	void (async () => {
		while (!abortController.signal.aborted) {
			try {
				const response = await pollBrowserCommand({
					query: { tabId },
					signal: abortController.signal,
				});
				if (response.error) throw new Error('Browser command poll failed');
				const payload = response.data as {
					command: BrowserControlWireCommand | null;
				};
				if (!payload.command) continue;
				const command: BrowserControlCommand = {
					...payload.command,
					args: JSON.parse(payload.command.args) as Record<string, unknown>,
				};
				const result = await executeCommand(command, executor);
				const completion = await submitBrowserCommandResult({
					path: { commandId: payload.command.id },
					body: { result: JSON.stringify(result) },
					signal: abortController.signal,
				});
				if (completion.error) {
					throw new Error('Browser command result was not accepted');
				}
			} catch (error) {
				if (abortController.signal.aborted) return;
				console.warn('[otto] Browser controller reconnecting:', error);
				await new Promise((resolve) => setTimeout(resolve, 1_000));
			}
		}
	})();

	return () => abortController.abort();
}
