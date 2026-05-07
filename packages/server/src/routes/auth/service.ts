import { spawnSync } from 'node:child_process';

const COPILOT_MODELS_URL = 'https://api.githubcopilot.com/models';
const GH_CAPABILITY_CACHE_TTL_MS = 60 * 1000;

let ghCapabilityCache: {
	expiresAt: number;
	value: { available: boolean; authenticated: boolean; reason?: string };
} = {
	expiresAt: 0,
	value: {
		available: false,
		authenticated: false,
		reason: 'Not checked yet',
	},
};

export function getGhImportCapability() {
	if (ghCapabilityCache.expiresAt > Date.now()) return ghCapabilityCache.value;

	const version = spawnSync('gh', ['--version'], {
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'pipe'],
	});
	if (version.status !== 0) {
		ghCapabilityCache = {
			expiresAt: Date.now() + GH_CAPABILITY_CACHE_TTL_MS,
			value: {
				available: false,
				authenticated: false,
				reason: 'GitHub CLI (gh) is not installed',
			},
		};
		return ghCapabilityCache.value;
	}

	const authStatus = spawnSync('gh', ['auth', 'status', '-h', 'github.com'], {
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'pipe'],
	});
	if (authStatus.status !== 0) {
		ghCapabilityCache = {
			expiresAt: Date.now() + GH_CAPABILITY_CACHE_TTL_MS,
			value: {
				available: true,
				authenticated: false,
				reason: 'Run `gh auth login` first',
			},
		};
		return ghCapabilityCache.value;
	}

	ghCapabilityCache = {
		expiresAt: Date.now() + GH_CAPABILITY_CACHE_TTL_MS,
		value: {
			available: true,
			authenticated: true,
		},
	};
	return ghCapabilityCache.value;
}

export function parseErrorMessageFromBody(text: string): string | undefined {
	if (!text) return undefined;
	try {
		const parsed = JSON.parse(text) as {
			message?: string;
			error?: { message?: string };
		};
		return parsed.error?.message ?? parsed.message;
	} catch {
		return undefined;
	}
}

export async function fetchCopilotModels(token: string): Promise<
	| {
			ok: true;
			models: Set<string>;
	  }
	| {
			ok: false;
			status: number;
			message: string;
	  }
> {
	try {
		const response = await fetch(COPILOT_MODELS_URL, {
			headers: {
				Authorization: `Bearer ${token}`,
				'Openai-Intent': 'conversation-edits',
				'User-Agent': 'ottocode',
			},
		});
		const text = await response.text();
		if (!response.ok) {
			return {
				ok: false,
				status: response.status,
				message:
					parseErrorMessageFromBody(text) ||
					`Copilot models endpoint returned ${response.status}`,
			};
		}

		const payload = JSON.parse(text) as {
			data?: Array<{ id?: string }>;
		};
		const models = new Set(
			(payload.data ?? [])
				.map((item) => item.id)
				.filter((id): id is string => Boolean(id)),
		);
		return { ok: true, models };
	} catch (error) {
		const message =
			error instanceof Error ? error.message : 'Failed to fetch Copilot models';
		return { ok: false, status: 0, message };
	}
}

export async function detectOAuthOrgRestriction(token: string): Promise<{
	restricted: boolean;
	org?: string;
	message?: string;
}> {
	try {
		const orgsResponse = await fetch('https://api.github.com/user/orgs', {
			headers: {
				Authorization: `Bearer ${token}`,
				'User-Agent': 'ottocode',
				Accept: 'application/vnd.github+json',
			},
		});
		if (!orgsResponse.ok) {
			return { restricted: false };
		}

		const orgs = (await orgsResponse.json()) as Array<{ login?: string }>;
		for (const org of orgs) {
			if (!org.login) continue;
			const membershipResponse = await fetch(
				`https://api.github.com/user/memberships/orgs/${org.login}`,
				{
					headers: {
						Authorization: `Bearer ${token}`,
						'User-Agent': 'ottocode',
						Accept: 'application/vnd.github+json',
					},
				},
			);
			if (membershipResponse.status !== 403) continue;

			const bodyText = await membershipResponse.text();
			const message = parseErrorMessageFromBody(bodyText) || bodyText;
			if (message.includes('enabled OAuth App access restrictions')) {
				return {
					restricted: true,
					org: org.login,
					message,
				};
			}
		}
	} catch {}

	return { restricted: false };
}
