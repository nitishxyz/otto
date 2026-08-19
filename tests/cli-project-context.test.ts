import { afterAll, afterEach, describe, expect, it, mock } from 'bun:test';
import * as sessionsActual from '@ottocode/cli/src/sessions.ts';
import * as shareActual from '@ottocode/cli/src/share.ts';
import * as withAuthActual from '@ottocode/cli/src/middleware/with-auth.ts';
import * as askServerActual from '@ottocode/cli/src/ask/server.ts';

const realSessions = { ...sessionsActual };
const realShare = { ...shareActual };
const realWithAuth = { ...withAuthActual };
const realAskServer = { ...askServerActual };

const ensureAuthMock = mock(async () => true);
const ensureServerMock = mock(async () => 'http://127.0.0.1:4317');
const runSessionsMock = mock(async () => {});
const runShareMock = mock(async () => {});

mock.module('@ottocode/cli/src/middleware/with-auth.ts', () => ({
	...realWithAuth,
	ensureAuth: ensureAuthMock,
}));

mock.module('@ottocode/cli/src/ask/server.ts', () => ({
	...realAskServer,
	ensureServer: ensureServerMock,
}));

mock.module('@ottocode/cli/src/sessions.ts', () => ({
	...realSessions,
	runSessions: runSessionsMock,
}));

mock.module('@ottocode/cli/src/share.ts', () => ({
	...realShare,
	runShare: runShareMock,
}));

afterAll(() => {
	mock.module('@ottocode/cli/src/middleware/with-auth.ts', () => realWithAuth);
	mock.module('@ottocode/cli/src/ask/server.ts', () => realAskServer);
	mock.module('@ottocode/cli/src/sessions.ts', () => realSessions);
	mock.module('@ottocode/cli/src/share.ts', () => realShare);
});

const sessionsCommandPromise = import('@ottocode/cli/src/commands/sessions.ts');
const shareCommandPromise = import('@ottocode/cli/src/commands/share.ts');

afterEach(() => {
	ensureAuthMock.mockClear();
	ensureServerMock.mockClear();
	runSessionsMock.mockClear();
	runShareMock.mockClear();
});

describe('CLI project-scoped server context', () => {
	it('initializes sessions for --project when cwd differs', async () => {
		const project = `${process.cwd()}/selected-sessions-project`;
		expect(project).not.toBe(process.cwd());
		const { handleSessions } = await sessionsCommandPromise;

		await handleSessions({
			project,
			json: true,
			list: false,
			pick: false,
		});

		expect(ensureAuthMock).toHaveBeenCalledWith(project);
		expect(ensureServerMock).toHaveBeenCalledWith(project);
		expect(runSessionsMock).toHaveBeenCalledWith({
			project,
			json: true,
			pick: false,
			limit: undefined,
		});
	});

	it('initializes sharing for --project when cwd differs', async () => {
		const project = `${process.cwd()}/selected-share-project`;
		expect(project).not.toBe(process.cwd());
		const { handleShare } = await shareCommandPromise;

		await handleShare('session-id', {
			project,
			title: 'Shared session',
		});

		expect(ensureAuthMock).toHaveBeenCalledWith(project);
		expect(ensureServerMock).toHaveBeenCalledWith(project);
		expect(runShareMock).toHaveBeenCalledWith({
			project,
			sessionId: 'session-id',
			title: 'Shared session',
			description: undefined,
			until: undefined,
			update: undefined,
			delete: undefined,
			status: undefined,
			list: undefined,
		});
	});
});
