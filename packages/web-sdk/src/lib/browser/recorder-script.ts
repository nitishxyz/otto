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

	if (typeof PerformanceObserver === 'function') {
		try {
			var observer = new PerformanceObserver(function (list) {
				var entries = list.getEntries();
				for (var i = 0; i < entries.length; i += 1) {
					var entry = entries[i];
					push(state.network, {
						source: 'resource',
						method: 'GET',
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
