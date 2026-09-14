import { expect, it, spyOn } from 'bun:test';
import {
	requestBrowserControl,
	submitBrowserControlResult,
	waitForBrowserControlCommand,
} from '../packages/sdk/src/browser-control';

it('delivers commands to the replacement poll after disconnect', async () => {
	const root = crypto.randomUUID();
	const controller = new AbortController();
	const abandoned = waitForBrowserControlCommand(
		root,
		'browser:browser',
		500,
		{},
		controller.signal,
	);
	const live = waitForBrowserControlCommand(root, 'browser:browser', 500);
	controller.abort();
	expect(await abandoned).toBeNull();
	const result = requestBrowserControl(
		{
			projectRoot: root,
			tabId: 'browser:browser',
			action: 'snapshot',
			args: {},
		},
		500,
	);
	const command = await live;
	expect(command?.action).toBe('snapshot');
	expect(
		submitBrowserControlResult(root, command?.id ?? '', { ok: true }),
	).toBe(true);
	expect(await result).toEqual({ ok: true });
});

it('does not dequeue commands for an already aborted poll', async () => {
	const root = crypto.randomUUID();
	const result = requestBrowserControl(
		{
			projectRoot: root,
			tabId: 'browser:browser',
			action: 'snapshot',
			args: {},
		},
		500,
	);
	expect(
		await waitForBrowserControlCommand(
			root,
			'browser:browser',
			500,
			{},
			AbortSignal.abort(),
		),
	).toBeNull();
	const command = await waitForBrowserControlCommand(
		root,
		'browser:browser',
		500,
	);
	expect(command?.action).toBe('snapshot');
	submitBrowserControlResult(root, command?.id ?? '', { ok: true });
	expect(await result).toEqual({ ok: true });
});

it('removes poll abort listeners after delivery and timeout', async () => {
	const root = crypto.randomUUID();
	const controller = new AbortController();
	const removeListener = spyOn(controller.signal, 'removeEventListener');
	const poll = waitForBrowserControlCommand(
		root,
		'browser:browser',
		500,
		{},
		controller.signal,
	);
	const result = requestBrowserControl(
		{
			projectRoot: root,
			tabId: 'browser:browser',
			action: 'snapshot',
			args: {},
		},
		500,
	);
	const command = await poll;
	expect(removeListener).toHaveBeenCalledTimes(1);
	const next = waitForBrowserControlCommand(
		root,
		'browser:browser',
		5,
		{},
		controller.signal,
	);
	expect(await next).toBeNull();
	expect(removeListener).toHaveBeenCalledTimes(2);
	controller.abort();
	submitBrowserControlResult(root, command?.id ?? '', { ok: true });
	expect(await result).toEqual({ ok: true });
	removeListener.mockRestore();
});
