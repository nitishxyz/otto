import { afterEach, describe, expect, it, mock } from 'bun:test';

const setConfigMock = mock(() => {});
const openProjectOnServerMock = mock(async () => ({
	baseUrl: 'http://127.0.0.1:7777',
	projectId: 'opened-project-id',
	projectRoot: '/tmp/opened-project',
	token: 'server-token',
	authHeaders: { Authorization: 'Bearer server-token' },
}));
const ensureDaemonProjectMock = mock(async () => ({
	baseUrl: 'http://127.0.0.1:8888',
	projectId: 'daemon-project-id',
	projectRoot: '/tmp/daemon-project',
	token: 'daemon-token',
	authHeaders: { Authorization: 'Bearer daemon-token' },
}));
const readDaemonTokenMock = mock(async () => 'server-token');

mock.module('@ottocode/server', () => ({
	createApp: () => ({ fetch: () => new Response('ok') }),
	bunWebSocket: {},
}));

mock.module('@ottocode/api', () => ({
	client: { setConfig: setConfigMock },
}));

mock.module('@ottocode/cli/src/daemon.ts', () => ({
	openProjectOnServer: openProjectOnServerMock,
	ensureDaemonProject: ensureDaemonProjectMock,
	readDaemonToken: readDaemonTokenMock,
}));

const serverModulePromise = import('@ottocode/cli/src/ask/server.ts');

afterEach(() => {
	delete process.env.OTTO_SERVER_URL;
	setConfigMock.mockClear();
	openProjectOnServerMock.mockClear();
	ensureDaemonProjectMock.mockClear();
	readDaemonTokenMock.mockClear();
});

describe('OTTO_SERVER_URL compatibility', () => {
	it('opens the selected project on an existing server and configures project headers', async () => {
		process.env.OTTO_SERVER_URL = 'http://127.0.0.1:7777';
		const { getOrStartServerContext } = await serverModulePromise;

		const context = await getOrStartServerContext('/tmp/legacy-project');

		expect(ensureDaemonProjectMock).toHaveBeenCalledTimes(0);
		expect(readDaemonTokenMock).toHaveBeenCalledTimes(1);
		expect(openProjectOnServerMock).toHaveBeenCalledWith({
			baseUrl: 'http://127.0.0.1:7777',
			projectRoot: '/tmp/legacy-project',
			token: 'server-token',
		});
		expect(context.projectId).toBe('opened-project-id');
		expect(setConfigMock).toHaveBeenCalledWith({
			baseURL: 'http://127.0.0.1:7777',
			adapter: 'fetch',
			headers: {
				Authorization: 'Bearer server-token',
				'X-Otto-Project-Id': 'opened-project-id',
				'X-Otto-Project': '/tmp/opened-project',
			},
		});
	});
});
