import { describe, expect, it } from 'bun:test';
import { createContext, runInContext } from 'node:vm';
import { BROWSER_RECORDER_SCRIPT } from '../packages/web-sdk/src/lib/browser/recorder-script';

type Entry = {
	source: string;
	method?: string;
	url: string;
	status?: number;
	error?: string;
};
type Resource = {
	name: string;
	initiatorType: string;
	startTime: number;
	responseStatus?: number;
};

function recorder(fetcher: typeof fetch) {
	let resources: (entries: Resource[]) => void = () => {};
	class XHR extends EventTarget {
		status = 0;
		open(_method: string, _url: string) {}
		send() {}
		complete(status: number, failure?: string) {
			this.status = status;
			if (failure) this.dispatchEvent(new Event(failure));
			this.dispatchEvent(new Event('loadend'));
		}
	}
	const context = createContext({
		fetch: fetcher,
		Request,
		URL,
		location: { href: 'https://example.test/' },
		Node: class {},
		XMLHttpRequest: XHR,
		performance: { now: () => 100 },
		console: { log() {}, info() {}, warn() {}, error() {}, debug() {} },
		addEventListener() {},
		PerformanceObserver: class {
			constructor(callback: (list: { getEntries(): Resource[] }) => void) {
				resources = (entries) => callback({ getEntries: () => entries });
			}
			observe() {}
		},
	});
	runInContext('window = globalThis', context);
	runInContext(BROWSER_RECORDER_SCRIPT, context);
	return {
		context,
		XHR,
		fetch: context.fetch as typeof fetch,
		entries: () =>
			(context.__ottoBrowserRecorder as { network: Entry[] }).network,
		resources: (entries: Resource[]) => resources(entries),
	};
}

describe('browser network recorder', () => {
	it('captures fetch method overrides, status and failures without consuming responses', async () => {
		const response = new Response('failure body', { status: 503 });
		const p = recorder((async (input) => {
			if (input === '/reject') throw new Error('network failed');
			return response;
		}) as typeof fetch);
		const request = new Request('https://example.test/items', {
			method: 'POST',
		});
		expect(await p.fetch(request, { method: 'PATCH' })).toBe(response);
		expect(await response.text()).toBe('failure body');
		await expect(p.fetch('/reject')).rejects.toThrow('network failed');
		expect(p.entries()).toMatchObject([
			{ source: 'fetch', method: 'PATCH', status: 503, url: request.url },
			{ source: 'fetch', method: 'GET', error: 'Error: network failed' },
		]);
	});

	it('tracks XHR methods, HTTP errors and aborts across reused instances', () => {
		const p = recorder(fetch);
		const xhr = new p.XHR();
		xhr.open('DELETE', '/items/1');
		xhr.send();
		xhr.complete(404);
		xhr.open('POST', '/items');
		xhr.send();
		xhr.complete(0, 'abort');
		expect(p.entries()).toMatchObject([
			{
				source: 'xhr',
				method: 'DELETE',
				status: 404,
				url: 'https://example.test/items/1',
			},
			{
				source: 'xhr',
				method: 'POST',
				error: 'abort',
				url: 'https://example.test/items',
			},
		]);
		expect(p.entries()[1]?.status).toBeUndefined();
	});

	it('does not invent methods/status for resource timings or double-count instrumented requests', () => {
		const p = recorder(fetch);
		p.resources([
			{ name: '/fetch', initiatorType: 'fetch', startTime: 101 },
			{ name: '/xhr', initiatorType: 'xmlhttprequest', startTime: 101 },
			{ name: '/early', initiatorType: 'fetch', startTime: 1 },
			{
				name: '/image',
				initiatorType: 'img',
				startTime: 101,
				responseStatus: 404,
			},
		]);
		expect(p.entries()).toHaveLength(2);
		expect(p.entries()[0]?.method).toBeUndefined();
		expect(p.entries()[0]?.status).toBeUndefined();
		expect(p.entries()[1]?.status).toBe(404);
	});

	it('installs once and bounds request history', async () => {
		const p = recorder((async () => new Response()) as typeof fetch);
		runInContext(BROWSER_RECORDER_SCRIPT, p.context);
		for (let index = 0; index < 310; index += 1)
			await p.fetch(`/item/${index}`);
		expect(p.entries()).toHaveLength(300);
		expect(p.entries()[0]?.url).toBe('https://example.test/item/10');
	});
});
