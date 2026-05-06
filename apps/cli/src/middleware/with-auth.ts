import {
	getAllAuth,
	getOnboardingComplete,
	loadConfig,
	isProviderAuthorized,
	setOnboardingComplete,
	type ProviderId,
} from './auth-deps.ts';
import { runAuth } from '../auth.ts';

export type WithAuthOptions = {
	project?: string;
};

function isCiAuthMode(): boolean {
	return process.env.OTTO_CI_MODE === '1' || Boolean(process.env.CI);
}

export async function ensureAuth(projectRoot: string): Promise<boolean> {
	let cfg = await loadConfig(projectRoot);
	const storedAuth = await getAllAuth(projectRoot);
	const hasStoredAuth = Object.values(storedAuth).some(Boolean);
	let onboardingComplete = await getOnboardingComplete(projectRoot);
	const defaultProvider = cfg.defaults.provider as ProviderId;
	const ciAuthMode = isCiAuthMode();

	const checkAny = async (
		config: Awaited<ReturnType<typeof loadConfig>>,
	): Promise<boolean> => {
		const providers: ProviderId[] = [
			'openai',
			'anthropic',
			'google',
			'openrouter',
			'opencode',
			'ottorouter',
			'xai',
		];
		const statuses = await Promise.all(
			providers.map((provider) => isProviderAuthorized(config, provider)),
		);
		return statuses.some(Boolean);
	};

	if (ciAuthMode) {
		return (
			(await isProviderAuthorized(cfg, defaultProvider)) ||
			(await checkAny(cfg))
		);
	}

	if (hasStoredAuth && !onboardingComplete) {
		await setOnboardingComplete(projectRoot);
		onboardingComplete = true;
	}

	if (!hasStoredAuth && !onboardingComplete) {
		const authSuccess = await runAuth(['login']);
		if (!authSuccess) {
			return false;
		}
		await setOnboardingComplete(projectRoot);
		cfg = await loadConfig(projectRoot);
		return (
			(await isProviderAuthorized(cfg, defaultProvider)) ||
			(await checkAny(cfg))
		);
	}

	const defaultAuthorized = await isProviderAuthorized(cfg, defaultProvider);
	if (defaultAuthorized) return true;
	if (await checkAny(cfg)) return true;

	const authSuccess = await runAuth(['login']);
	if (!authSuccess) {
		return false;
	}
	await setOnboardingComplete(projectRoot);

	cfg = await loadConfig(projectRoot);
	return (
		(await isProviderAuthorized(cfg, defaultProvider)) || (await checkAny(cfg))
	);
}

export function withAuth<T extends WithAuthOptions>(
	handler: (opts: T) => Promise<void>,
): (opts: T) => Promise<void> {
	return async (opts: T) => {
		const projectRoot = opts.project ?? process.cwd();
		if (!(await ensureAuth(projectRoot))) {
			return;
		}
		await handler(opts);
	};
}
