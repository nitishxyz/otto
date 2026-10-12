import { expect, test } from 'bun:test';
import type {
	IExitEvent,
	IPty,
} from '../packages/sdk/src/core/src/terminals/bun-pty.ts';
import { TerminalManager } from '../packages/sdk/src/core/src/terminals/manager.ts';
import { Terminal } from '../packages/sdk/src/core/src/terminals/terminal.ts';

function managedTerminal() {
	const manager = new TerminalManager();
	let onExit: ((event: IExitEvent) => void) | undefined;
	let kills = 0;
	const pty: IPty = {
		pid: 1,
		write() {},
		resize() {},
		kill() {
			kills++;
			onExit?.({ exitCode: 0 });
		},
		onData() {},
		onExit(callback) {
			onExit = callback;
		},
	};
	const terminal = new Terminal('term-test', pty, {
		command: 'test',
		cwd: '.',
		purpose: 'cleanup regression',
		createdBy: 'user',
	});
	const terminals = Reflect.get(manager, 'terminals') as Map<string, Terminal>;
	terminals.set(terminal.id, terminal);
	return {
		manager,
		terminal,
		finish: () => onExit?.({ exitCode: 0 }),
		kills: () => kills,
	};
}

test('kill observes a synchronous exit and removes the terminal', async () => {
	const { manager, terminal, kills } = managedTerminal();
	await manager.kill(terminal.id);
	expect(kills()).toBe(1);
	expect(terminal.status).toBe('exited');
	expect(manager.list()).toEqual([]);
});

test('kill does not signal a process that has already exited', async () => {
	const { manager, terminal, finish, kills } = managedTerminal();
	finish();
	await manager.kill(terminal.id);
	expect(kills()).toBe(0);
	expect(manager.list()).toEqual([]);
});

test('killAll handles reentrant deletion from an exit callback', async () => {
	const { manager, terminal } = managedTerminal();
	terminal.onExit(() => manager.delete(terminal.id));
	await manager.killAll();
	expect(manager.list()).toEqual([]);
});
