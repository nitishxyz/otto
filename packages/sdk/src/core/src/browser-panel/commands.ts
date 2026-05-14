export type BrowserPanelCommandInput =
	| {
			type: 'open';
			url: string;
			title?: string;
			kind?: 'web' | 'simulator';
	  }
	| { type: 'navigate'; tabId?: string; url: string; title?: string }
	| { type: 'close'; tabId?: string }
	| { type: 'reload'; tabId?: string }
	| { type: 'click'; tabId?: string; selector: string }
	| { type: 'type'; tabId?: string; selector: string; text: string }
	| { type: 'press'; tabId?: string; key: string }
	| { type: 'scroll'; tabId?: string; x?: number; y?: number }
	| { type: 'inspect'; tabId?: string; selector?: string }
	| { type: 'screenshot'; tabId?: string };

export type BrowserPanelCommand = BrowserPanelCommandInput & { id: string };

export type BrowserPanelCommandResult = {
	id: string;
	ok: boolean;
	type?: string;
	message?: string;
	data?: unknown;
	createdAt: string;
};

export type BrowserPanelTabSnapshot = {
	id: string;
	kind: 'web' | 'simulator';
	title: string;
	url: string;
	status: 'idle' | 'loading' | 'ready' | 'error';
	createdBy: 'user' | 'llm';
};

export type BrowserPanelStateSnapshot = {
	isExpanded: boolean;
	activeTabId: string | null;
	tabs: BrowserPanelTabSnapshot[];
	updatedAt: string;
};

const commands: BrowserPanelCommand[] = [];
const commandResults = new Map<string, BrowserPanelCommandResult>();
const commandResultWaiters = new Map<
	string,
	Array<(result: BrowserPanelCommandResult) => void>
>();

let panelState: BrowserPanelStateSnapshot = {
	isExpanded: false,
	activeTabId: null,
	tabs: [],
	updatedAt: new Date(0).toISOString(),
};

function createCommandId() {
	return `browser-command-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function enqueueBrowserPanelCommand(
	command: BrowserPanelCommandInput,
): BrowserPanelCommand {
	const item = { ...command, id: createCommandId() } as BrowserPanelCommand;
	commands.push(item);
	return item;
}

export function drainBrowserPanelCommands(): BrowserPanelCommand[] {
	return commands.splice(0, commands.length);
}

export function completeBrowserPanelCommand(
	result: Omit<BrowserPanelCommandResult, 'createdAt'>,
): BrowserPanelCommandResult {
	const completed = { ...result, createdAt: new Date().toISOString() };
	commandResults.set(result.id, completed);
	const waiters = commandResultWaiters.get(result.id) ?? [];
	commandResultWaiters.delete(result.id);
	for (const resolve of waiters) resolve(completed);
	return completed;
}

export async function waitForBrowserPanelCommandResult(
	id: string,
	timeoutMs = 5000,
): Promise<BrowserPanelCommandResult> {
	const existing = commandResults.get(id);
	if (existing) return existing;

	return new Promise((resolve) => {
		const timeout = setTimeout(() => {
			resolve({
				id,
				ok: false,
				message: `Timed out waiting for Browser panel command ${id}`,
				createdAt: new Date().toISOString(),
			});
		}, timeoutMs);

		const waiters = commandResultWaiters.get(id) ?? [];
		waiters.push((result) => {
			clearTimeout(timeout);
			resolve(result);
		});
		commandResultWaiters.set(id, waiters);
	});
}

export function updateBrowserPanelState(
	state: Omit<BrowserPanelStateSnapshot, 'updatedAt'>,
): BrowserPanelStateSnapshot {
	panelState = { ...state, updatedAt: new Date().toISOString() };
	return panelState;
}

export function getBrowserPanelState(): BrowserPanelStateSnapshot {
	return panelState;
}
