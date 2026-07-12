import { logger, removeAuth, setAuth } from '@ottocode/sdk';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Hono } from 'hono';
import { zodOpenApiRoute } from '../../openapi/route.ts';
import {
	errorResponseSchema,
	githubCloneBodySchema,
	githubCloneSchema,
	githubDisconnectSchema,
	githubDevicePollBodySchema,
	githubDevicePollSchema,
	githubDeviceStartSchema,
	githubReposQuerySchema,
	githubReposSchema,
	githubStatusSchema,
} from './github-schemas.ts';
import {
	fetchGitHubUser,
	getGitHubToken,
	GITHUB_ACCESS_TOKEN_URL,
	GITHUB_CLIENT_ID,
	GITHUB_DEVICE_CODE_URL,
	githubRequest,
	resolveClonePath,
	toGitHubRepo,
	type GitHubRepoResponse,
	type GitHubUserResponse,
} from './github-service.ts';
import { githubDeviceSessions } from './state.ts';

export function registerAuthGitHubRoutes(app: Hono) {
	zodOpenApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/github/status',
			tags: ['github'],
			operationId: 'getGitHubStatus',
			summary: 'Get the connected GitHub account',
			responses: {
				'200': {
					description: 'OK',
					content: { 'application/json': { schema: githubStatusSchema } },
				},
			},
		},
		async (c) => {
			const token = await getGitHubToken();
			if (!token) return c.json({ connected: false });
			try {
				return c.json({ connected: true, user: await fetchGitHubUser(token) });
			} catch {
				return c.json({ connected: false });
			}
		},
	);

	zodOpenApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/github/device/start',
			tags: ['github'],
			operationId: 'startGitHubDeviceFlow',
			summary: 'Start GitHub device authorization',
			responses: {
				'200': {
					description: 'OK',
					content: { 'application/json': { schema: githubDeviceStartSchema } },
				},
				'500': {
					description: 'Server Error',
					content: { 'application/json': { schema: errorResponseSchema } },
				},
			},
		},
		async (c) => {
			try {
				const response = await fetch(GITHUB_DEVICE_CODE_URL, {
					method: 'POST',
					headers: {
						Accept: 'application/json',
						'Content-Type': 'application/json',
					},
					body: JSON.stringify({
						client_id: GITHUB_CLIENT_ID,
						scope: 'repo read:user',
					}),
				});
				if (!response.ok) {
					throw new Error(
						`GitHub device code request failed: ${response.status}`,
					);
				}
				const data = (await response.json()) as {
					device_code: string;
					user_code: string;
					verification_uri: string;
					interval: number;
					expires_in: number;
				};
				const sessionId = crypto.randomUUID();
				githubDeviceSessions.set(sessionId, {
					deviceCode: data.device_code,
					interval: data.interval,
					createdAt: Date.now(),
				});
				return c.json({
					sessionId,
					userCode: data.user_code,
					verificationUri: data.verification_uri,
					interval: data.interval,
					expiresIn: data.expires_in,
				});
			} catch (error) {
				logger.error('GitHub device flow start failed', error);
				return c.json(
					{
						error:
							error instanceof Error ? error.message : 'GitHub auth failed',
					},
					500,
				);
			}
		},
	);

	zodOpenApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/github/device/poll',
			tags: ['github'],
			operationId: 'pollGitHubDeviceFlow',
			summary: 'Poll GitHub device authorization',
			request: {
				body: {
					required: true,
					content: {
						'application/json': { schema: githubDevicePollBodySchema },
					},
				},
			},
			responses: {
				'200': {
					description: 'OK',
					content: { 'application/json': { schema: githubDevicePollSchema } },
				},
				'400': {
					description: 'Bad Request',
					content: { 'application/json': { schema: errorResponseSchema } },
				},
			},
		},
		async (c) => {
			const { sessionId } = githubDevicePollBodySchema.parse(
				await c.req.json(),
			);
			const session = githubDeviceSessions.get(sessionId);
			if (!session) return c.json({ error: 'Session expired or invalid' }, 400);
			try {
				const response = await fetch(GITHUB_ACCESS_TOKEN_URL, {
					method: 'POST',
					headers: {
						Accept: 'application/json',
						'Content-Type': 'application/json',
					},
					body: JSON.stringify({
						client_id: GITHUB_CLIENT_ID,
						device_code: session.deviceCode,
						grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
					}),
				});
				if (!response.ok)
					throw new Error(`GitHub token request failed: ${response.status}`);
				const data = (await response.json()) as {
					access_token?: string;
					error?: string;
					error_description?: string;
				};
				if (data.access_token) {
					await setAuth('github', {
						type: 'oauth',
						access: data.access_token,
						refresh: '',
						expires: 0,
					});
					githubDeviceSessions.delete(sessionId);
					return c.json({
						status: 'complete' as const,
						user: await fetchGitHubUser(data.access_token),
					});
				}
				if (
					data.error === 'authorization_pending' ||
					data.error === 'slow_down'
				) {
					return c.json({ status: 'pending' as const });
				}
				githubDeviceSessions.delete(sessionId);
				return c.json({
					status: 'error' as const,
					error:
						data.error_description ??
						data.error ??
						'GitHub authorization failed',
				});
			} catch (error) {
				logger.error('GitHub device flow poll failed', error);
				return c.json({
					status: 'error' as const,
					error: error instanceof Error ? error.message : 'GitHub auth failed',
				});
			}
		},
	);

	zodOpenApiRoute(
		app,
		{
			method: 'delete',
			path: '/v1/github',
			tags: ['github'],
			operationId: 'disconnectGitHub',
			summary: 'Disconnect the GitHub account',
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': { schema: githubDisconnectSchema },
					},
				},
			},
		},
		async (c) => {
			await removeAuth('github');
			return c.json({ success: true });
		},
	);

	zodOpenApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/github/repos',
			tags: ['github'],
			operationId: 'listGitHubRepositories',
			summary: 'List repositories for the connected GitHub account',
			request: { query: githubReposQuerySchema },
			responses: {
				'200': {
					description: 'OK',
					content: { 'application/json': { schema: githubReposSchema } },
				},
				'401': {
					description: 'Unauthorized',
					content: { 'application/json': { schema: errorResponseSchema } },
				},
			},
		},
		async (c) => {
			const token = await getGitHubToken();
			if (!token) return c.json({ error: 'GitHub is not connected' }, 401);
			const { page, search } = githubReposQuerySchema.parse(c.req.query());
			try {
				let repos: GitHubRepoResponse[];
				if (search?.trim()) {
					const user = await githubRequest<GitHubUserResponse>('/user', token);
					const query = encodeURIComponent(
						`${search.trim()} in:name user:${user.login}`,
					);
					const result = await githubRequest<{ items: GitHubRepoResponse[] }>(
						`/search/repositories?q=${query}&sort=updated&per_page=30&page=${page}`,
						token,
					);
					repos = result.items;
				} else {
					repos = await githubRequest<GitHubRepoResponse[]>(
						`/user/repos?sort=updated&per_page=30&page=${page}`,
						token,
					);
				}
				return c.json({ repos: repos.map(toGitHubRepo) });
			} catch (error) {
				return c.json(
					{
						error:
							error instanceof Error ? error.message : 'GitHub request failed',
					},
					500,
				);
			}
		},
	);

	zodOpenApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/github/clone',
			tags: ['github'],
			operationId: 'cloneGitHubRepository',
			summary: 'Clone a GitHub repository using server-owned credentials',
			request: {
				body: {
					required: true,
					content: { 'application/json': { schema: githubCloneBodySchema } },
				},
			},
			responses: {
				'200': {
					description: 'OK',
					content: { 'application/json': { schema: githubCloneSchema } },
				},
				'400': {
					description: 'Bad Request',
					content: { 'application/json': { schema: errorResponseSchema } },
				},
			},
		},
		async (c) => {
			const { url, path } = githubCloneBodySchema.parse(await c.req.json());
			const cloneUrl = new URL(url);
			if (
				cloneUrl.protocol !== 'https:' ||
				cloneUrl.hostname !== 'github.com' ||
				cloneUrl.port !== '' ||
				cloneUrl.username !== '' ||
				cloneUrl.password !== '' ||
				cloneUrl.hash !== ''
			) {
				return c.json(
					{ error: 'Only HTTPS GitHub repository URLs are supported' },
					400,
				);
			}
			const targetPath = resolveClonePath(path);
			if (!targetPath) {
				return c.json(
					{ error: 'Clone destination must be inside ~/Projects' },
					400,
				);
			}
			const token = await getGitHubToken();
			await mkdir(dirname(targetPath), { recursive: true });
			const authorization = token
				? `Basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`
				: null;
			const env: Record<string, string> = {
				...process.env,
				GIT_TERMINAL_PROMPT: '0',
			};
			if (authorization) {
				env.GIT_CONFIG_COUNT = '1';
				env.GIT_CONFIG_KEY_0 = 'http.extraHeader';
				env.GIT_CONFIG_VALUE_0 = `Authorization: ${authorization}`;
			}
			const processHandle = Bun.spawn(['git', 'clone', url, targetPath], {
				env,
				stdout: 'pipe',
				stderr: 'pipe',
			});
			const [exitCode, stderr] = await Promise.all([
				processHandle.exited,
				new Response(processHandle.stderr).text(),
			]);
			if (exitCode !== 0) {
				return c.json({ error: stderr.trim() || 'Git clone failed' }, 400);
			}
			return c.json({ path: targetPath });
		},
	);
}
