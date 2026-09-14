/**
 * Source of the in-page recorder that captures console output, page errors, and
 * network activity so the browser tool can report them back to the agent.
 *
 * The script is idempotent: the desktop webview installs it before page scripts
 * run, and web clients inject it lazily before reading recorded entries.
 */
export const BROWSER_RECORDER_SCRIPT = `(function () {
	var KEY = '__ottoBrowserRecorder';
	if (window[KEY]) return;
	var MAX_ENTRIES = 300;
	var MAX_TEXT = 4000;
	var state = {
		installedAt: Date.now(),
		nextId: 1,
		console: [],
		network: [],
	};

	function push(list, entry) {
		entry.id = state.nextId++;
		list.push(entry);
		if (list.length > MAX_ENTRIES) list.splice(0, list.length - MAX_ENTRIES);
		return entry;
	}

	function describe(value) {
		try {
			if (typeof value === 'string') return value;
			if (value instanceof Error) {
				return value.stack || value.name + ': ' + value.message;
			}
			if (value && typeof value === 'object') {
				var seen = new WeakSet();
				return JSON.stringify(value, function (_key, item) {
					if (item && typeof item === 'object') {
						if (seen.has(item)) return '[Circular]';
						seen.add(item);
					}
					if (typeof item === 'bigint') return String(item);
					if (item instanceof Node) return item.nodeName;
					return item;
				});
			}
			return String(value);
		} catch (error) {
			try {
				return String(value);
			} catch (_ignored) {
				return '[unserializable]';
			}
		}
	}

	function joinArgs(args) {
		var parts = [];
		for (var index = 0; index < args.length; index += 1) {
			parts.push(describe(args[index]));
		}
		return parts.join(' ').slice(0, MAX_TEXT);
	}

	var levels = ['log', 'info', 'warn', 'error', 'debug'];
	for (var index = 0; index < levels.length; index += 1) {
		(function (level) {
			var original = console[level];
			if (typeof original !== 'function') return;
			console[level] = function () {
				try {
					push(state.console, {
						level: level,
						text: joinArgs(arguments),
						at: Date.now(),
					});
				} catch (error) {}
				return original.apply(console, arguments);
			};
		})(levels[index]);
	}

	window.addEventListener('error', function (event) {
		var location = event.filename
			? ' (' + event.filename + ':' + event.lineno + ':' + event.colno + ')'
			: '';
		push(state.console, {
			level: 'error',
			text: (event.message || describe(event.error)) + location,
			at: Date.now(),
		});
	});

	window.addEventListener('unhandledrejection', function (event) {
		push(state.console, {
			level: 'error',
			text: 'Unhandled promise rejection: ' + describe(event.reason),
			at: Date.now(),
		});
	});

	var instrumentedAt = typeof performance !== 'undefined' ? performance.now() : 0;
	var fetchInstalled = false;
	var xhrInstalled = false;
	function requestEntry(source, method, url) {
		try { url = new URL(String(url), location.href).href; } catch (error) { url = String(url); }
		return push(state.network, { source: source, method: String(method || 'GET').toUpperCase(), url: url, at: Date.now() });
	}
	function finish(entry, status, error) {
		if (!entry) return;
		entry.durationMs = Date.now() - entry.at;
		if (status > 0) entry.status = status;
		if (error) entry.error = String(error).slice(0, MAX_TEXT);
	}
	if (typeof window.fetch === 'function') {
		try {
			var originalFetch = window.fetch;
			window.fetch = function (input, init) {
				var entry;
				try {
					var request = typeof Request !== 'undefined' && input instanceof Request ? input : null;
					entry = requestEntry('fetch', (init && init.method) || (request && request.method), request ? request.url : input);
				} catch (error) {}
				try {
					return originalFetch.apply(this, arguments).then(function (response) {
						finish(entry, response.status);
						if (entry) entry.responseType = response.type;
						return response;
					}, function (error) { finish(entry, 0, error); throw error; });
				} catch (error) { finish(entry, 0, error); throw error; }
			};
			fetchInstalled = window.fetch !== originalFetch;
		} catch (error) {}
	}
	if (typeof XMLHttpRequest !== 'undefined') {
		try {
			var requests = new WeakMap();
			var originalOpen = XMLHttpRequest.prototype.open;
			var originalSend = XMLHttpRequest.prototype.send;
			XMLHttpRequest.prototype.open = function (method, url) {
				var result = originalOpen.apply(this, arguments);
				requests.set(this, { method: method, url: url });
				return result;
			};
			XMLHttpRequest.prototype.send = function () {
				var xhr = this;
				var metadata = requests.get(xhr);
				var entry;
				try { if (metadata) entry = requestEntry('xhr', metadata.method, metadata.url); } catch (error) {}
				function failed(event) { if (entry) entry.error = event.type; }
				function completed() {
					finish(entry, xhr.status, entry && entry.error);
					xhr.removeEventListener('loadend', completed);
					['error', 'abort', 'timeout'].forEach(function (type) { xhr.removeEventListener(type, failed); });
				}
				xhr.addEventListener('loadend', completed);
				['error', 'abort', 'timeout'].forEach(function (type) { xhr.addEventListener(type, failed); });
				try { return originalSend.apply(xhr, arguments); }
				catch (error) { if (entry) entry.error = String(error); completed(); throw error; }
			};
			xhrInstalled = XMLHttpRequest.prototype.send !== originalSend;
		} catch (error) {}
	}

	if (typeof PerformanceObserver === 'function') {
		try {
			var observer = new PerformanceObserver(function (list) {
				var entries = list.getEntries();
				for (var i = 0; i < entries.length; i += 1) {
					var entry = entries[i];
					if (entry.startTime >= instrumentedAt && ((fetchInstalled && entry.initiatorType === 'fetch') || (xhrInstalled && entry.initiatorType === 'xmlhttprequest'))) continue;
					push(state.network, {
						source: 'resource',
						status: entry.responseStatus > 0 ? entry.responseStatus : undefined,
						url: String(entry.name),
						type: entry.initiatorType,
						durationMs: Math.round(entry.duration),
						size: entry.transferSize,
						at: Date.now(),
					});
				}
			});
			observer.observe({ type: 'resource', buffered: true });
		} catch (error) {}
	}

	window[KEY] = state;
})();`;
