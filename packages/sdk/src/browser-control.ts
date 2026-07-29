export interface BrowserControlCommand {
	id: string;
	projectRoot: string;
	tabId: string;
	action: string;
	args: Record<string, unknown>;
	createdAt: number;
}

export interface BrowserControlResult {
	ok: boolean;
	[key: string]: unknown;
}

interface CommandWaiter {
	resolve: (command: BrowserControlCommand | null) => void;
	timer: ReturnType<typeof setTimeout>;
}

interface ResultWaiter {
	projectRoot: string;
	resolve: (result: BrowserControlResult) => void;
	timer: ReturnType<typeof setTimeout>;
}

const commandQueues = new Map<string, BrowserControlCommand[]>();
const commandWaiters = new Map<string, CommandWaiter[]>();
const resultWaiters = new Map<string, ResultWaiter>();
const viewerSeenAt = new Map<string, number>();

/** A viewer is considered connected while it keeps long-polling for commands. */
const VIEWER_PRESENCE_TTL_MS = 90_000;

function targetKey(projectRoot: string, tabId: string): string {
	return `${projectRoot}\0${tabId}`;
}

/** Records that a browser viewer for the project polled the command channel. */
export function markBrowserViewerSeen(projectRoot: string): void {
	viewerSeenAt.set(projectRoot, Date.now());
}

/** Reports whether a browser viewer recently polled for this project. */
export function isBrowserViewerConnected(projectRoot: string): boolean {
	const seenAt = viewerSeenAt.get(projectRoot);
	if (seenAt === undefined) return false;
	if (Date.now() - seenAt <= VIEWER_PRESENCE_TTL_MS) return true;
	viewerSeenAt.delete(projectRoot);
	return false;
}

function removeCommand(
	commandId: string,
	projectRoot: string,
	tabId: string,
): void {
	const key = targetKey(projectRoot, tabId);
	const queue = commandQueues.get(key);
	if (!queue) return;
	const nextQueue = queue.filter((command) => command.id !== commandId);
	if (nextQueue.length > 0) commandQueues.set(key, nextQueue);
	else commandQueues.delete(key);
}

/** Queues a browser command and waits for the connected viewer to return a result. */
export function requestBrowserControl(
	input: Omit<BrowserControlCommand, 'id' | 'createdAt'>,
	timeoutMs = 20_000,
): Promise<BrowserControlResult> {
	const command: BrowserControlCommand = {
		...input,
		id: crypto.randomUUID(),
		createdAt: Date.now(),
	};

	return new Promise((resolve) => {
		const timer = setTimeout(() => {
			resultWaiters.delete(command.id);
			removeCommand(command.id, command.projectRoot, command.tabId);
			resolve({
				ok: false,
				error: isBrowserViewerConnected(command.projectRoot)
					? `Browser preview did not respond in time for "${command.action}". Make sure the ${command.tabId} tab is open and visible in Otto, then try again.`
					: 'No Otto browser preview is connected. Open the workspace preview (desktop app or `otto web`) so the page can be controlled, then try again.',
			});
		}, timeoutMs);
		resultWaiters.set(command.id, {
			projectRoot: command.projectRoot,
			resolve,
			timer,
		});

		const key = targetKey(command.projectRoot, command.tabId);
		const waitingClients = commandWaiters.get(key);
		const client = waitingClients?.shift();
		if (waitingClients && waitingClients.length === 0) {
			commandWaiters.delete(key);
		}
		if (client) {
			clearTimeout(client.timer);
			client.resolve(command);
		} else {
			const queue = commandQueues.get(key) ?? [];
			queue.push(command);
			commandQueues.set(key, queue);
		}
	});
}

/** Long-polls for the next command targeting a browser viewer tab. */
export function waitForBrowserControlCommand(
	projectRoot: string,
	tabId: string,
	timeoutMs = 25_000,
): Promise<BrowserControlCommand | null> {
	markBrowserViewerSeen(projectRoot);
	const key = targetKey(projectRoot, tabId);
	const queue = commandQueues.get(key);
	const command = queue?.shift();
	if (queue && queue.length === 0) commandQueues.delete(key);
	if (command) return Promise.resolve(command);

	return new Promise((resolve) => {
		const waiter: CommandWaiter = {
			resolve,
			timer: setTimeout(() => {
				const waiters = commandWaiters.get(key);
				if (waiters) {
					const remaining = waiters.filter((item) => item !== waiter);
					if (remaining.length > 0) commandWaiters.set(key, remaining);
					else commandWaiters.delete(key);
				}
				resolve(null);
			}, timeoutMs),
		};
		const waiters = commandWaiters.get(key) ?? [];
		waiters.push(waiter);
		commandWaiters.set(key, waiters);
	});
}

/** Resolves an in-flight browser command with the viewer's execution result. */
export function submitBrowserControlResult(
	projectRoot: string,
	commandId: string,
	result: BrowserControlResult,
): boolean {
	const waiter = resultWaiters.get(commandId);
	if (!waiter || waiter.projectRoot !== projectRoot) return false;
	clearTimeout(waiter.timer);
	resultWaiters.delete(commandId);
	waiter.resolve(result);
	return true;
}
