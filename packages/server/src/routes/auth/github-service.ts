import { getAuth, getHomeDir } from '@ottocode/sdk';
import { isAbsolute, relative, resolve } from 'node:path';

export const GITHUB_CLIENT_ID = 'Ov23lip6QjVYxHUAeW4d';
export const GITHUB_DEVICE_CODE_URL = 'https://github.com/login/device/code';
export const GITHUB_ACCESS_TOKEN_URL =
	'https://github.com/login/oauth/access_token';
const GITHUB_API_URL = 'https://api.github.com';

export interface GitHubUserResponse {
	login: string;
	name: string | null;
	avatar_url: string;
}

export interface GitHubRepoResponse {
	id: number;
	name: string;
	full_name: string;
	clone_url: string;
	private: boolean;
	description: string | null;
}

export async function getGitHubToken(): Promise<string | null> {
	const auth = await getAuth('github');
	if (auth?.type === 'oauth') return auth.access;
	if (auth?.type === 'api') return auth.key;
	return null;
}

export async function githubRequest<T>(
	path: string,
	token: string,
): Promise<T> {
	const response = await fetch(`${GITHUB_API_URL}${path}`, {
		headers: {
			Authorization: `Bearer ${token}`,
			Accept: 'application/vnd.github+json',
			'User-Agent': 'otto',
			'X-GitHub-Api-Version': '2022-11-28',
		},
	});
	if (!response.ok) throw new Error(`GitHub API error: ${response.status}`);
	return (await response.json()) as T;
}

export function toGitHubUser(user: GitHubUserResponse) {
	return {
		login: user.login,
		name: user.name,
		avatarUrl: user.avatar_url,
	};
}

export function toGitHubRepo(repo: GitHubRepoResponse) {
	return {
		id: repo.id,
		name: repo.name,
		fullName: repo.full_name,
		cloneUrl: repo.clone_url,
		private: repo.private,
		description: repo.description,
	};
}

export async function fetchGitHubUser(token: string) {
	return toGitHubUser(await githubRequest<GitHubUserResponse>('/user', token));
}

export function resolveClonePath(path: string): string | null {
	const cloneRoot = resolve(getHomeDir(), 'Projects');
	const targetPath = path.startsWith('~/')
		? resolve(getHomeDir(), path.slice(2))
		: resolve(path);
	const relativePath = relative(cloneRoot, targetPath);
	if (
		targetPath === cloneRoot ||
		relativePath.startsWith('..') ||
		isAbsolute(relativePath)
	) {
		return null;
	}
	return targetPath;
}
