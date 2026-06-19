import {
	intro,
	outro,
	select,
	password,
	isCancel,
	cancel,
	log,
	text,
} from '@clack/prompts';
import { execFileSync, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { box, table, colors } from './ui.ts';
import {
	getAllAuth,
	providerEnvVar,
	readEnvKey,
	setAuth,
	removeAuth,
	setOnboardingComplete,
	type ProviderId,
	authorize,
	exchange,
	openAuthUrl,
	createApiKey,
	providerIds,
	authorizeOpenAI,
	exchangeOpenAIDeviceCode,
	exchangeOpenAI,
	openOpenAIAuthUrl,
	obtainOpenAIApiKey,
	pollOpenAIDeviceCodeOnce,
	requestOpenAIDeviceCode,
	authorizeXai,
	exchangeXai,
	openXaiAuthUrl,
	readGrokCliAuth,
	generateWallet,
	importWallet,
	authorizeCopilot,
	pollForCopilotToken,
	openCopilotAuthUrl,
	isBuiltInProviderId,
} from '@ottocode/sdk';
import { loadConfig } from '@ottocode/sdk';
import { catalog } from '@ottocode/sdk';
import { getGlobalConfigDir, getGlobalConfigPath } from '@ottocode/sdk';

const PROVIDER_LINKS: Record<
	ProviderId,
	{ name: string; url: string; env: string }
> = {
	openai: {
		name: 'OpenAI',
		url: 'https://platform.openai.com/api-keys',
		env: 'OPENAI_API_KEY',
	},
	anthropic: {
		name: 'Anthropic',
		url: 'https://console.anthropic.com/settings/keys',
		env: 'ANTHROPIC_API_KEY',
	},
	google: {
		name: 'Google AI Studio',
		url: 'https://aistudio.google.com/app/apikey',
		env: 'GOOGLE_GENERATIVE_AI_API_KEY',
	},
	'ollama-cloud': {
		name: 'Ollama Cloud',
		url: 'https://ollama.com/settings/keys',
		env: 'OLLAMA_API_KEY',
	},
	baseten: {
		name: 'Baseten',
		url: 'https://app.baseten.co/settings/api_keys',
		env: 'BASETEN_API_KEY',
	},
	huggingface: {
		name: 'Hugging Face',
		url: 'https://huggingface.co/settings/tokens',
		env: 'HF_TOKEN',
	},
	openrouter: {
		name: 'OpenRouter',
		url: 'https://openrouter.ai/keys',
		env: 'OPENROUTER_API_KEY',
	},
	opencode: {
		name: 'OpenCode',
		url: 'https://opencode.ai',
		env: 'OPENCODE_API_KEY',
	},
	ottorouter: {
		name: 'OttoRouter',
		url: 'https://dash.ottorouter.org',
		env: 'OTTOROUTER_PRIVATE_KEY',
	},
	xai: {
		name: 'xAI',
		url: 'https://console.x.ai/team/default/api-keys',
		env: 'XAI_API_KEY',
	},
	zai: {
		name: 'Z.AI (GLM)',
		url: 'https://z.ai/manage-apikey/apikey-list',
		env: 'ZAI_API_KEY',
	},
	'zai-coding': {
		name: 'Z.AI Coding Plan',
		url: 'https://z.ai/manage-apikey/apikey-list',
		env: 'ZAI_CODING_API_KEY',
	},
	deepseek: {
		name: 'DeepSeek',
		url: 'https://platform.deepseek.com/api_keys',
		env: 'DEEPSEEK_API_KEY',
	},
	kimi: {
		name: 'Kimi',
		url: 'https://platform.kimi.ai/console/api-keys',
		env: 'KIMI_API_KEY',
	},
	minimax: {
		name: 'MiniMax',
		url: 'https://api.minimaxi.chat/user-center/basic-information/interface-key',
		env: 'MINIMAX_API_KEY',
	},
	copilot: {
		name: 'GitHub Copilot',
		url: 'https://github.com/features/copilot',
		env: 'GITHUB_TOKEN',
	},
};

const COPILOT_MODELS_URL = 'https://api.githubcopilot.com/models';
const KIMI_CODE_OAUTH_CLIENT_ID = '17e5f671-d194-4dfb-9706-5516cb48c098';
const KIMI_CODE_OAUTH_HOST =
	process.env.KIMI_CODE_OAUTH_HOST ??
	process.env.KIMI_OAUTH_HOST ??
	'https://auth.kimi.com';

type CopilotLoginMethod = 'oauth' | 'token' | 'gh';
type XaiLoginMethod = 'oauth' | 'key' | 'grok-cli';
type KimiLoginMethod = 'oauth' | 'key';

function parseOptionValue(
	args: string[],
	optionName: string,
): string | undefined {
	const exactPrefix = `${optionName}=`;
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg.startsWith(exactPrefix)) return arg.slice(exactPrefix.length);
		if (arg === optionName && i + 1 < args.length) return args[i + 1];
	}
	return undefined;
}

function getCopilotLoginMethodArg(
	args: string[],
): CopilotLoginMethod | undefined {
	const method = parseOptionValue(args, '--method');
	if (method === 'oauth' || method === 'token' || method === 'gh')
		return method;
	return undefined;
}

function getKimiLoginMethodArg(args: string[]): KimiLoginMethod | undefined {
	const method = parseOptionValue(args, '--method');
	if (method === 'oauth' || method === 'key') return method;
	return undefined;
}

async function fetchCopilotModels(
	token: string,
): Promise<
	| { ok: true; models: Set<string> }
	| { ok: false; status: number; message: string }
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
			let message = `Copilot models endpoint returned ${response.status}`;
			try {
				const parsed = JSON.parse(text) as {
					message?: string;
					error?: { message?: string };
				};
				message = parsed.error?.message || parsed.message || message;
			} catch {}
			return { ok: false, status: response.status, message };
		}

		const payload = JSON.parse(text) as { data?: Array<{ id?: string }> };
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

function logCopilotTokenSummary(models: Set<string>) {
	log.info(`Visible Copilot models: ${models.size}`);
	const sampleModels = Array.from(models).sort().slice(0, 8);
	if (sampleModels.length > 0) {
		log.info(`Sample models: ${sampleModels.join(', ')}`);
	}
}

async function finalizeSuccessfulLogin(provider: ProviderId) {
	await ensureGlobalConfigDefaults(provider);
	await setOnboardingComplete();
}

async function maybeImportEnvCredential(
	provider: ProviderId,
	cfg: Awaited<ReturnType<typeof loadConfig>>,
	wantLocal: boolean,
): Promise<'imported' | 'continue' | 'cancelled'> {
	const envValue = readEnvKey(provider);
	if (!envValue) return 'continue';

	const envVar = providerEnvVar(provider);
	const choice = (await select({
		message: `Found ${envVar} in your environment`,
		options: [
			{ value: 'import', label: `Import ${envVar} into Otto` },
			{ value: 'continue', label: 'Use a different credential or auth method' },
		],
	})) as 'import' | 'continue' | symbol;

	if (isCancel(choice)) {
		cancel('Cancelled');
		return 'cancelled';
	}

	if (choice !== 'import') return 'continue';

	if (provider === 'ottorouter') {
		await setAuth(
			provider,
			{ type: 'wallet', secret: envValue },
			cfg.projectRoot,
			'global',
		);
	} else if (provider === 'copilot') {
		await setAuth(
			provider,
			{ type: 'oauth', refresh: envValue, access: envValue, expires: 0 },
			cfg.projectRoot,
			'global',
		);
	} else {
		await setAuth(
			provider,
			{ type: 'api', key: envValue },
			cfg.projectRoot,
			'global',
		);
	}

	if (wantLocal)
		log.warn(
			'Local credential storage is disabled; saved to secure global location.',
		);

	await finalizeSuccessfulLogin(provider);
	log.success(`Imported ${envVar}`);
	outro('Done');
	return 'imported';
}

export async function runAuth(args: string[]) {
	const sub = args[0];
	if (sub === 'login') return await runAuthLogin(args.slice(1));
	if (sub === 'list' || sub === 'ls') return await runAuthList(args.slice(1));
	if (sub === 'status') return await runAuthStatus(args.slice(1));
	if (sub === 'logout' || sub === 'rm' || sub === 'remove')
		return await runAuthLogout(args.slice(1));
	intro('otto auth');
	log.info('usage: otto auth login|list|status|logout');
	outro('');
	return false;
}

export async function runAuthList(_args: string[]) {
	const cfg = await loadConfig(process.cwd());
	const all = await getAllAuth(cfg.projectRoot);
	const entries = Object.entries(all);
	const defProv = cfg.defaults.provider;
	const defModel = cfg.defaults.model;
	const rows = entries.map(([id, info]) => [
		id,
		info?.type ?? '-',
		id === defProv ? 'yes' : 'no',
		id === defProv ? defModel : '-',
	]);
	if (rows.length) {
		box('Credentials', []);
		table(['Provider', 'Type', 'Default', 'Model'], rows);
	} else {
		box('Credentials', [colors.dim('No stored credentials')]);
	}
	const envRows: string[] = [];
	const providerEntries = Object.entries(PROVIDER_LINKS) as Array<
		[ProviderId, (typeof PROVIDER_LINKS)[ProviderId]]
	>;
	for (const [pid, meta] of providerEntries) {
		if (process.env[meta.env]) envRows.push(`${pid} ${colors.dim(meta.env)}`);
	}
	if (envRows.length) box('Environment', envRows);
}

export async function runAuthStatus(_args: string[]) {
	const cfg = await loadConfig(process.cwd());
	const auth = await getAllAuth(cfg.projectRoot);
	const provider = _args[0] as ProviderId | undefined;

	if (provider && provider !== 'copilot') {
		log.info('Detailed status currently supports only Copilot.');
		return runAuthList([]);
	}

	const rows: string[][] = [];
	const envToken =
		process.env.COPILOT_GITHUB_TOKEN ??
		process.env.GH_TOKEN ??
		process.env.GITHUB_TOKEN;

	if (envToken) {
		const envModels = await fetchCopilotModels(envToken);
		rows.push([
			'env',
			envModels.ok ? String(envModels.models.size) : '-',
			envModels.ok
				? envModels.models.has('gpt-5.2-codex')
					? 'yes'
					: 'no'
				: '-',
			envModels.ok ? 'ok' : envModels.message,
		]);
	} else {
		rows.push(['env', '-', '-', 'not configured']);
	}

	const stored = auth.copilot;
	if (stored?.type === 'oauth') {
		const storedModels = await fetchCopilotModels(stored.refresh);
		rows.push([
			'stored',
			storedModels.ok ? String(storedModels.models.size) : '-',
			storedModels.ok
				? storedModels.models.has('gpt-5.2-codex')
					? 'yes'
					: 'no'
				: '-',
			storedModels.ok ? 'ok' : storedModels.message,
		]);
	} else {
		rows.push(['stored', '-', '-', 'not configured']);
	}

	box('Copilot token status', []);
	table(['Source', 'Models', 'Codex', 'Details'], rows);
	outro('Done');
}

export async function runAuthLogin(_args: string[]): Promise<boolean> {
	const cfg = await loadConfig(process.cwd());
	const wantLocal = _args.includes('--local');
	const providerAlias = _args.includes('ollama')
		? 'ollama-cloud'
		: _args.includes('kimi')
			? 'kimi'
			: undefined;
	const providerArg = (providerAlias ??
		_args.find((arg) =>
			(providerIds as readonly string[]).includes(arg as ProviderId),
		)) as ProviderId | undefined;
	intro('Add credential');
	let provider: ProviderId;
	if (providerArg) {
		provider = providerArg;
	} else {
		const selected = (await select({
			message: 'Select provider',
			options: [
				{ value: 'openai', label: PROVIDER_LINKS.openai.name },
				{ value: 'anthropic', label: PROVIDER_LINKS.anthropic.name },
				{ value: 'google', label: PROVIDER_LINKS.google.name },
				{
					value: 'ollama-cloud',
					label: PROVIDER_LINKS['ollama-cloud'].name,
				},
				{ value: 'baseten', label: PROVIDER_LINKS.baseten.name },
				{ value: 'huggingface', label: PROVIDER_LINKS.huggingface.name },
				{ value: 'openrouter', label: PROVIDER_LINKS.openrouter.name },
				{ value: 'opencode', label: PROVIDER_LINKS.opencode.name },
				{ value: 'copilot', label: PROVIDER_LINKS.copilot.name },
				{ value: 'ottorouter', label: PROVIDER_LINKS.ottorouter.name },
				{ value: 'xai', label: PROVIDER_LINKS.xai.name },
				{ value: 'zai', label: PROVIDER_LINKS.zai.name },
				{ value: 'zai-coding', label: PROVIDER_LINKS['zai-coding'].name },
				{ value: 'deepseek', label: PROVIDER_LINKS.deepseek.name },
				{ value: 'kimi', label: PROVIDER_LINKS.kimi.name },
				{ value: 'minimax', label: PROVIDER_LINKS.minimax.name },
			],
		})) as ProviderId | symbol;
		if (isCancel(selected)) {
			cancel('Cancelled');
			return false;
		}
		provider = selected as ProviderId;
	}

	const envImportResult = await maybeImportEnvCredential(
		provider,
		cfg,
		wantLocal,
	);
	if (envImportResult === 'imported') return true;
	if (envImportResult === 'cancelled') return false;

	if (provider === 'anthropic') {
		return runAuthLoginAnthropic(cfg, wantLocal);
	}

	if (provider === 'openai') {
		return runAuthLoginOpenAI(cfg, wantLocal);
	}

	if (provider === 'ottorouter') {
		return runAuthLoginOttoRouter(cfg, wantLocal);
	}

	if (provider === 'copilot') {
		return runAuthLoginCopilot(cfg, wantLocal, _args);
	}

	if (provider === 'xai') {
		return runAuthLoginXai(cfg, wantLocal);
	}

	if (provider === 'kimi') {
		return runAuthLoginKimi(cfg, wantLocal, _args);
	}

	const meta = PROVIDER_LINKS[provider];
	if (provider === 'zai-coding') {
		log.info('GLM Coding Plan uses a Z.AI API key, not OAuth.');
		log.info('Use an API key from Z.AI after subscribing to GLM Coding Plan.');
	}
	log.info(`Open in browser: ${meta.url}`);
	const key = await password({
		message: `Paste ${meta.env} here`,
		validate: (v) =>
			v && String(v).trim().length > 0 ? undefined : 'Required',
	});
	if (isCancel(key)) {
		cancel('Cancelled');
		return false;
	}
	await setAuth(
		provider,
		{ type: 'api', key: String(key) },
		cfg.projectRoot,
		'global',
	);
	if (wantLocal)
		log.warn(
			'Local credential storage is disabled; saved to secure global location.',
		);
	await finalizeSuccessfulLogin(provider);
	log.success('Saved');
	log.info(`Tip: you can also set ${meta.env} in your environment.`);
	outro('Done');
	return true;
}

async function requestKimiDeviceAuthorization(): Promise<{
	userCode: string;
	deviceCode: string;
	verificationUriComplete: string;
	interval: number;
	expiresIn: number | null;
}> {
	const response = await fetch(
		`${KIMI_CODE_OAUTH_HOST.replace(/\/$/, '')}/api/oauth/device_authorization`,
		{
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
				Accept: 'application/json',
			},
			body: new URLSearchParams({
				client_id: KIMI_CODE_OAUTH_CLIENT_ID,
			}).toString(),
		},
	);
	const data = (await response.json()) as Record<string, unknown>;
	if (!response.ok) {
		throw new Error(
			`Kimi OAuth device authorization failed (${response.status})`,
		);
	}
	const userCode = data.user_code;
	const deviceCode = data.device_code;
	const verificationUriComplete = data.verification_uri_complete;
	if (
		typeof userCode !== 'string' ||
		typeof deviceCode !== 'string' ||
		typeof verificationUriComplete !== 'string'
	) {
		throw new Error('Kimi OAuth device authorization response was incomplete.');
	}
	return {
		userCode,
		deviceCode,
		verificationUriComplete,
		interval: Number(data.interval ?? 5),
		expiresIn:
			data.expires_in === undefined || data.expires_in === null
				? null
				: Number(data.expires_in),
	};
}

async function pollKimiDeviceToken(deviceCode: string): Promise<{
	accessToken: string;
	refreshToken: string;
	expiresAt: number;
	scope?: string;
}> {
	const response = await fetch(
		`${KIMI_CODE_OAUTH_HOST.replace(/\/$/, '')}/api/oauth/token`,
		{
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
				Accept: 'application/json',
			},
			body: new URLSearchParams({
				client_id: KIMI_CODE_OAUTH_CLIENT_ID,
				device_code: deviceCode,
				grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
			}).toString(),
		},
	);
	const data = (await response.json()) as Record<string, unknown>;
	if (response.ok && typeof data.access_token === 'string') {
		const expiresIn = Number(data.expires_in ?? 0);
		return {
			accessToken: data.access_token,
			refreshToken:
				typeof data.refresh_token === 'string' ? data.refresh_token : '',
			expiresAt: Date.now() + expiresIn * 1000,
			scope: typeof data.scope === 'string' ? data.scope : undefined,
		};
	}
	const errorCode =
		typeof data.error === 'string' ? data.error : 'unknown_error';
	if (errorCode === 'authorization_pending' || errorCode === 'slow_down') {
		throw new Error(errorCode);
	}
	if (errorCode === 'expired_token')
		throw new Error('Kimi OAuth code expired.');
	if (errorCode === 'access_denied')
		throw new Error('Kimi OAuth access denied.');
	throw new Error(`Kimi OAuth token polling failed: ${errorCode}`);
}

async function runAuthLoginKimi(
	cfg: Awaited<ReturnType<typeof loadConfig>>,
	wantLocal: boolean,
	args: string[],
): Promise<boolean> {
	const methodArg = getKimiLoginMethodArg(args);
	const authMethod =
		methodArg ??
		((await select({
			message: 'Select Kimi login method',
			options: [
				{ value: 'oauth', label: 'Kimi Code OAuth device flow' },
				{ value: 'key', label: 'Kimi Platform API key' },
			],
		})) as KimiLoginMethod | symbol);
	if (isCancel(authMethod)) {
		cancel('Cancelled');
		return false;
	}
	if (authMethod === 'key') {
		const meta = PROVIDER_LINKS.kimi;
		log.info(`Open in browser: ${meta.url}`);
		const key = await password({
			message: `Paste ${meta.env} here`,
			validate: (v) =>
				v && String(v).trim().length > 0 ? undefined : 'Required',
		});
		if (isCancel(key)) {
			cancel('Cancelled');
			return false;
		}
		await setAuth(
			'kimi',
			{ type: 'api', key: String(key) },
			cfg.projectRoot,
			'global',
		);
		await finalizeSuccessfulLogin('kimi');
		log.success('Saved');
		outro('Done');
		return true;
	}

	try {
		const device = await requestKimiDeviceAuthorization();
		log.info(`Open: ${device.verificationUriComplete}`);
		log.info(`Code: ${device.userCode}`);
		await openAuthUrl(device.verificationUriComplete);
		const startedAt = Date.now();
		const expiresMs = (device.expiresIn ?? 900) * 1000;
		while (Date.now() - startedAt < expiresMs) {
			await new Promise((resolve) =>
				setTimeout(resolve, Math.max(device.interval, 1) * 1000),
			);
			try {
				const token = await pollKimiDeviceToken(device.deviceCode);
				await setAuth(
					'kimi',
					{
						type: 'oauth',
						access: token.accessToken,
						refresh: token.refreshToken,
						expires: token.expiresAt,
						scopes: token.scope,
					},
					cfg.projectRoot,
					'global',
				);
				if (wantLocal)
					log.warn(
						'Local credential storage is disabled; saved to secure global location.',
					);
				await finalizeSuccessfulLogin('kimi');
				log.success('Kimi Code OAuth tokens saved!');
				outro('Done');
				return true;
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				if (message === 'authorization_pending' || message === 'slow_down') {
					continue;
				}
				throw error;
			}
		}
		log.error('Kimi OAuth timed out before authorization completed.');
		outro('Failed');
		return false;
	} catch (error) {
		log.error(error instanceof Error ? error.message : String(error));
		outro('Failed');
		return false;
	}
}

async function runAuthLoginOpenAI(
	cfg: Awaited<ReturnType<typeof loadConfig>>,
	wantLocal: boolean,
): Promise<boolean> {
	try {
		const authMethod = (await select({
			message: 'Select authentication method',
			options: [
				{
					value: 'oauth',
					label: 'ChatGPT Plus/Pro (Free with subscription)',
				},
				{ value: 'manual', label: 'Manually enter API Key' },
			],
		})) as 'oauth' | 'manual' | symbol;

		if (isCancel(authMethod)) {
			cancel('Cancelled');
			return false;
		}

		if (authMethod === 'manual') {
			const meta = PROVIDER_LINKS.openai;
			log.info(`Open in browser: ${meta.url}`);
			const key = await password({
				message: `Paste ${meta.env} here`,
				validate: (v) =>
					v && String(v).trim().length > 0 ? undefined : 'Required',
			});
			if (isCancel(key)) {
				cancel('Cancelled');
				return false;
			}
			await setAuth(
				'openai',
				{ type: 'api', key: String(key) },
				cfg.projectRoot,
				'global',
			);
			if (wantLocal)
				log.warn(
					'Local credential storage is disabled; saved to secure global location.',
				);
			await finalizeSuccessfulLogin('openai');
			log.success('Saved');
			log.info(
				`Tip: you can also set ${PROVIDER_LINKS.openai.env} in your environment.`,
			);
			outro('Done');
			return true;
		}

		const oauthFlow = (await select({
			message: 'Select OpenAI OAuth flow',
			options: [
				{
					value: 'callback',
					label: 'Browser callback OAuth (localhost callback)',
				},
				{
					value: 'device',
					label: 'Device code OAuth (SSH, tunnels, remote browsers)',
				},
			],
		})) as 'callback' | 'device' | symbol;

		if (isCancel(oauthFlow)) {
			cancel('Cancelled');
			return false;
		}

		try {
			let tokens: Awaited<ReturnType<typeof exchangeOpenAIDeviceCode>>;

			if (oauthFlow === 'callback') {
				log.info('Starting OpenAI browser callback OAuth flow...');
				log.info(
					'⚠️  This uses localhost port 1455 and only works when your browser can reach the machine running otto.\n',
				);

				const oauthResult = await authorizeOpenAI();
				try {
					log.info('Opening browser for authorization...');
					log.info(`URL: ${oauthResult.url}\n`);

					const opened = await openOpenAIAuthUrl(oauthResult.url);
					if (!opened) {
						log.warn(
							'⚠️  Could not open browser automatically. Please visit the URL above manually.\n',
						);
					}

					log.info('Waiting for authorization callback...');
					log.info('(Complete the login in your browser)\n');

					const code = await oauthResult.waitForCallback();
					log.info('🔄 Exchanging authorization code for tokens...');
					tokens = await exchangeOpenAI(code, oauthResult.verifier);
				} finally {
					oauthResult.close();
				}
			} else {
				log.info('Starting OpenAI device authorization...');
				const deviceData = await requestOpenAIDeviceCode();

				log.info('Open this URL in your browser:');
				log.info(`${deviceData.verificationUri}\n`);
				log.info('Enter this one-time code:');
				log.info(`${deviceData.userCode}\n`);

				const opened = await openOpenAIAuthUrl(deviceData.verificationUri);
				if (!opened) {
					log.warn(
						'⚠️  Could not open browser automatically. Please visit the URL above manually.\n',
					);
				}

				log.info('Waiting for authorization...');
				log.info(
					'(Complete the login in your browser; this code expires in 15 minutes)\n',
				);

				const startedAt = Date.now();
				let authorization: { code: string; codeVerifier: string } | undefined;
				while (Date.now() - startedAt < 15 * 60 * 1000) {
					const result = await pollOpenAIDeviceCodeOnce(
						deviceData.deviceAuthId,
						deviceData.userCode,
					);
					if (result.status === 'complete') {
						authorization = {
							code: result.code,
							codeVerifier: result.codeVerifier,
						};
						break;
					}
					if (result.status === 'error') {
						throw new Error(result.error);
					}
					await Bun.sleep(Math.max(deviceData.interval, 5) * 1000);
				}

				if (!authorization) {
					throw new Error('OpenAI device authorization timed out');
				}

				log.info('🔄 Exchanging authorization code for tokens...');

				tokens = await exchangeOpenAIDeviceCode(
					authorization.code,
					authorization.codeVerifier,
				);
			}

			let useApiKey = false;
			let apiKey = '';

			try {
				log.info('🔑 Trying to obtain API key...');
				apiKey = await obtainOpenAIApiKey(tokens.idToken);
				useApiKey = true;
			} catch {
				log.info(
					'ℹ️  API key not available (no OpenAI Platform org). Using OAuth tokens.',
				);
			}

			if (useApiKey && apiKey) {
				await setAuth(
					'openai',
					{ type: 'api', key: apiKey },
					cfg.projectRoot,
					'global',
				);
				log.success('API key saved!');
			} else {
				await setAuth(
					'openai',
					{
						type: 'oauth',
						refresh: tokens.refresh,
						access: tokens.access,
						expires: tokens.expires,
						accountId: tokens.accountId,
						idToken: tokens.idToken,
					},
					cfg.projectRoot,
					'global',
				);
				log.success(
					`OAuth tokens saved!${tokens.accountId ? ` (Account: ${tokens.accountId.slice(0, 8)}...)` : ''}`,
				);
			}

			log.info(
				'\n💡 You can now use GPT-5.x Codex models with your ChatGPT subscription!',
			);

			if (wantLocal)
				log.warn(
					'Local credential storage is disabled; saved to secure global location.',
				);

			await finalizeSuccessfulLogin('openai');
			outro('Done');
			return true;
		} catch (error: unknown) {
			const message =
				error instanceof Error ? error.message : 'Unknown error occurred';
			log.error(`Authentication failed: ${message}`);
			outro('Failed');
			return false;
		}
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : String(error);
		log.error(`Failed to initialize authentication: ${message}`);
		outro('Failed');
		return false;
	}
}

function parseXaiAuthorizationCode(input: string): string {
	const trimmed = input.trim().replace(/^['"]|['"]$/g, '');
	try {
		const url = new URL(trimmed);
		return url.searchParams.get('code') || trimmed;
	} catch {}

	try {
		const params = new URLSearchParams(
			trimmed.startsWith('?') ? trimmed.slice(1) : trimmed,
		);
		return params.get('code') || trimmed;
	} catch {}

	return trimmed;
}

async function waitForXaiAuthorizationCode(
	callbackPromise: Promise<string>,
): Promise<string> {
	const controller = new AbortController();
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	const promptPromise = (async () => {
		try {
			while (true) {
				const pasted = await rl.question('Paste xAI authorization code: ', {
					signal: controller.signal,
				});
				const code = parseXaiAuthorizationCode(pasted);
				if (code) return code;
				console.log('Required');
			}
		} catch (error) {
			if (error instanceof Error && error.name === 'AbortError') {
				return new Promise<string>(() => {});
			}
			throw error;
		}
	})();

	try {
		return await Promise.race([callbackPromise, promptPromise]);
	} finally {
		controller.abort();
		rl.close();
	}
}

async function runAuthLoginXai(
	cfg: Awaited<ReturnType<typeof loadConfig>>,
	wantLocal: boolean,
): Promise<boolean> {
	try {
		const grokCliAuth = readGrokCliAuth();
		const options: Array<{ value: XaiLoginMethod; label: string }> = [
			{
				value: 'oauth',
				label: 'SuperGrok / X Premium+ OAuth (no API key)',
			},
			{ value: 'key', label: 'Manually enter XAI_API_KEY' },
		];
		if (grokCliAuth?.access && grokCliAuth.refresh) {
			options.unshift({
				value: 'grok-cli',
				label: 'Reuse existing official Grok CLI login',
			});
		}

		const authMethod = (await select({
			message: 'Select xAI authentication method',
			options,
		})) as XaiLoginMethod | symbol;

		if (isCancel(authMethod)) {
			cancel('Cancelled');
			return false;
		}

		if (authMethod === 'key') {
			const meta = PROVIDER_LINKS.xai;
			log.info(`Open in browser: ${meta.url}`);
			const key = await password({
				message: `Paste ${meta.env} here`,
				validate: (v) =>
					v && String(v).trim().length > 0 ? undefined : 'Required',
			});
			if (isCancel(key)) {
				cancel('Cancelled');
				return false;
			}
			await setAuth(
				'xai',
				{ type: 'api', key: String(key) },
				cfg.projectRoot,
				'global',
			);
			if (wantLocal)
				log.warn(
					'Local credential storage is disabled; saved to secure global location.',
				);
			await finalizeSuccessfulLogin('xai');
			log.success('Saved');
			log.info(`Tip: you can also set ${meta.env} in your environment.`);
			outro('Done');
			return true;
		}

		if (
			authMethod === 'grok-cli' &&
			grokCliAuth?.access &&
			grokCliAuth.refresh
		) {
			await setAuth(
				'xai',
				{
					type: 'oauth',
					refresh: grokCliAuth.refresh,
					access: grokCliAuth.access,
					expires: grokCliAuth.expires,
					idToken: grokCliAuth.idToken,
					scopes: grokCliAuth.scopes,
				},
				cfg.projectRoot,
				'global',
			);
			if (wantLocal)
				log.warn(
					'Local credential storage is disabled; saved to secure global location.',
				);
			await finalizeSuccessfulLogin('xai');
			log.success('Reused Grok CLI OAuth credentials!');
			outro('Done');
			return true;
		}

		log.info('Starting xAI OAuth flow...');
		log.info(
			'⚠️  If the official Grok CLI is logging in, stop it first (both use port 56121).\n',
		);

		const oauthResult = await authorizeXai();

		log.info('Opening browser for xAI authorization...');
		log.info(`URL: ${oauthResult.url}\n`);

		const opened = await openXaiAuthUrl(oauthResult.url);
		if (!opened) {
			log.warn(
				'⚠️  Could not open browser automatically. Please visit the URL above manually.\n',
			);
		}

		log.info('Waiting for xAI authorization callback...');
		log.info('(Complete the login in your browser)\n');

		try {
			const callbackPromise = oauthResult.waitForCallback();
			const code = await waitForXaiAuthorizationCode(callbackPromise);

			oauthResult.close();

			log.info('🔄 Exchanging xAI authorization code for tokens...');
			const tokens = await exchangeXai(code, oauthResult.verifier);

			await setAuth(
				'xai',
				{
					type: 'oauth',
					refresh: tokens.refresh,
					access: tokens.access,
					expires: tokens.expires,
					idToken: tokens.idToken,
					scopes: tokens.scopes,
				},
				cfg.projectRoot,
				'global',
			);

			if (wantLocal)
				log.warn(
					'Local credential storage is disabled; saved to secure global location.',
				);

			await finalizeSuccessfulLogin('xai');
			log.success('xAI OAuth tokens saved!');
			log.info(
				'💡 If inference returns 403, your subscription tier may not be allowlisted for OAuth API access. Use XAI_API_KEY as a fallback.',
			);
			outro('Done');
			return true;
		} catch (error: unknown) {
			oauthResult.close();
			const message =
				error instanceof Error ? error.message : 'Unknown error occurred';
			log.error(`Authentication failed: ${message}`);
			outro('Failed');
			return false;
		}
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : String(error);
		log.error(`Failed to initialize xAI authentication: ${message}`);
		outro('Failed');
		return false;
	}
}

async function runAuthLoginAnthropic(
	cfg: Awaited<ReturnType<typeof loadConfig>>,
	wantLocal: boolean,
): Promise<boolean> {
	try {
		const authMethod = (await select({
			message: 'Select authentication method',
			options: [
				{ value: 'max', label: 'Claude Pro/Max (Free with subscription)' },
				{ value: 'console', label: 'Create API Key (Console OAuth)' },
				{ value: 'manual', label: 'Manually enter API Key' },
			],
		})) as 'max' | 'console' | 'manual' | symbol;

		if (isCancel(authMethod)) {
			cancel('Cancelled');
			return false;
		}

		if (authMethod === 'manual') {
			const meta = PROVIDER_LINKS.anthropic;
			log.info(`Open in browser: ${meta.url}`);
			const key = await password({
				message: `Paste ${meta.env} here`,
				validate: (v) =>
					v && String(v).trim().length > 0 ? undefined : 'Required',
			});
			if (isCancel(key)) {
				cancel('Cancelled');
				return false;
			}
			await setAuth(
				'anthropic',
				{ type: 'api', key: String(key) },
				cfg.projectRoot,
				'global',
			);
			if (wantLocal)
				log.warn(
					'Local credential storage is disabled; saved to secure global location.',
				);
			await finalizeSuccessfulLogin('anthropic');
			log.success('Saved');
			log.info(
				`Tip: you can also set ${PROVIDER_LINKS.anthropic.env} in your environment.`,
			);
			outro('Done');
			return true;
		}

		const oauthMode: 'max' | 'console' =
			authMethod === 'console' ? 'console' : 'max';
		const { url, verifier } = await authorize(oauthMode);

		log.info('Opening browser for authorization...');
		log.info(`URL: ${url}\n`);

		const opened = await openAuthUrl(url);
		if (!opened) {
			log.warn(
				'⚠️  Could not open browser automatically. Please visit the URL above manually.\n',
			);
		}

		log.info("After authorizing, you'll be redirected to a URL like:");
		log.info(
			'https://console.anthropic.com/oauth/code/callback?code=ABC123#XYZ789&state=...\n',
		);

		const code = await text({
			message: 'Paste the full code (including the part after #):',
			validate: (v) =>
				v && String(v).includes('#') ? undefined : 'Code must include #',
		});

		if (isCancel(code) || !code) {
			cancel('Cancelled');
			return false;
		}

		log.info('\n🔄 Exchanging authorization code for tokens...');

		try {
			const tokens = await exchange(String(code), verifier);

			if (oauthMode === 'console') {
				log.info('🔑 Creating API key...');
				const apiKey = await createApiKey(tokens.access);
				await setAuth(
					'anthropic',
					{ type: 'api', key: apiKey },
					cfg.projectRoot,
					'global',
				);
				log.success('API key created and saved!');
			} else {
				await setAuth(
					'anthropic',
					{
						type: 'oauth',
						refresh: tokens.refresh,
						access: tokens.access,
						expires: tokens.expires,
					},
					cfg.projectRoot,
					'global',
				);
				log.success('OAuth tokens saved!');
				log.info(`Token expires: ${new Date(tokens.expires).toLocaleString()}`);
			}

			if (wantLocal)
				log.warn(
					'Local credential storage is disabled; saved to secure global location.',
				);

			await finalizeSuccessfulLogin('anthropic');
			outro('Done');
			return true;
		} catch (error: unknown) {
			const message =
				error instanceof Error ? error.message : 'Unknown error occurred';
			log.error(`Authentication failed: ${message}`);
			outro('Failed');
			return false;
		}
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : String(error);
		log.error(`Failed to initialize authentication: ${message}`);
		outro('Failed');
		return false;
	}
}

async function runAuthLoginOttoRouter(
	cfg: Awaited<ReturnType<typeof loadConfig>>,
	wantLocal: boolean,
): Promise<boolean> {
	log.info('OttoRouter uses a Solana wallet for authentication.');

	const authMethod = (await select({
		message: 'Select wallet option',
		options: [
			{ value: 'create', label: 'Create new wallet' },
			{ value: 'import', label: 'Import existing wallet' },
		],
	})) as 'create' | 'import' | symbol;

	if (isCancel(authMethod)) {
		cancel('Cancelled');
		return false;
	}

	let privateKeyBase58: string;
	let publicKey: string;

	if (authMethod === 'create') {
		const wallet = generateWallet();
		privateKeyBase58 = wallet.privateKey;
		publicKey = wallet.publicKey;
		log.info('Generated new Solana wallet');
	} else {
		const key = await password({
			message: `Paste ${PROVIDER_LINKS.ottorouter.env} (base58 private key)`,
			validate: (v) =>
				v && String(v).trim().length > 0
					? undefined
					: 'Private key is required',
		});
		if (isCancel(key)) {
			cancel('Cancelled');
			return false;
		}
		try {
			const wallet = importWallet(String(key));
			privateKeyBase58 = wallet.privateKey;
			publicKey = wallet.publicKey;
		} catch {
			log.error(
				'Invalid private key format. Please provide a valid base58 encoded private key.',
			);
			return false;
		}
	}

	await setAuth(
		'ottorouter',
		{ type: 'wallet', secret: privateKeyBase58 },
		cfg.projectRoot,
		'global',
	);
	if (wantLocal)
		log.warn(
			'Local credential storage is disabled; saved to secure global location.',
		);
	await finalizeSuccessfulLogin('ottorouter');
	log.success('Saved');
	console.log(`  Wallet Public Key: ${colors.cyan(publicKey)}`);
	console.log(
		`  Tip: you can also set ${PROVIDER_LINKS.ottorouter.env} in your environment.`,
	);
	outro('Done');
	return true;
}

async function runAuthLoginCopilot(
	cfg: Awaited<ReturnType<typeof loadConfig>>,
	wantLocal: boolean,
	args: string[],
): Promise<boolean> {
	try {
		const methodArg = getCopilotLoginMethodArg(args);
		const authMethod = methodArg
			? methodArg
			: ((await select({
					message: 'Select Copilot authentication method',
					options: [
						{ value: 'oauth', label: 'OAuth device flow (GitHub login)' },
						{ value: 'token', label: 'Paste GitHub token manually' },
						{ value: 'gh', label: 'Import token from gh CLI' },
					],
				})) as CopilotLoginMethod | symbol);

		if (isCancel(authMethod)) {
			cancel('Cancelled');
			return false;
		}

		let token = '';
		if (authMethod === 'oauth') {
			log.info('Starting GitHub Copilot device flow...');
			const deviceData = await authorizeCopilot();

			log.info(`Opening browser: ${deviceData.verificationUri}`);
			log.info(`Enter code: ${colors.cyan(deviceData.userCode)}\n`);

			const opened = await openCopilotAuthUrl(deviceData.verificationUri);
			if (!opened) {
				log.warn(
					'Could not open browser automatically. Please visit the URL above manually.\n',
				);
			}

			log.info('Waiting for authorization...');
			log.info('(Complete the login in your browser)\n');

			token = await pollForCopilotToken(
				deviceData.deviceCode,
				deviceData.interval,
			);
		} else if (authMethod === 'token') {
			const pasted = await password({
				message:
					'Paste GitHub token (gho_... / github_pat_...) with Copilot access',
				validate: (v) =>
					v && String(v).trim().length > 0 ? undefined : 'Token is required',
			});
			if (isCancel(pasted)) {
				cancel('Cancelled');
				return false;
			}
			token = String(pasted).trim();
		} else {
			const version = spawnSync('gh', ['--version'], {
				encoding: 'utf8',
				stdio: ['ignore', 'pipe', 'pipe'],
			});
			if (version.status !== 0) {
				log.error('GitHub CLI (gh) is not installed.');
				outro('Failed');
				return false;
			}

			const ghStatus = spawnSync('gh', ['auth', 'status', '-h', 'github.com'], {
				encoding: 'utf8',
				stdio: ['ignore', 'pipe', 'pipe'],
			});
			if (ghStatus.status !== 0) {
				log.error('GitHub CLI is not authenticated. Run `gh auth login`.');
				outro('Failed');
				return false;
			}

			token = execFileSync('gh', ['auth', 'token'], {
				encoding: 'utf8',
				stdio: ['ignore', 'pipe', 'pipe'],
			}).trim();
			if (!token) {
				log.error('GitHub CLI returned an empty token.');
				outro('Failed');
				return false;
			}
		}

		const models = await fetchCopilotModels(token);
		if (!models.ok) {
			log.error(`Copilot token validation failed: ${models.message}`);
			outro('Failed');
			return false;
		}

		await setAuth(
			'copilot',
			{
				type: 'oauth',
				refresh: token,
				access: token,
				expires: 0,
			},
			cfg.projectRoot,
			'global',
		);

		if (wantLocal)
			log.warn(
				'Local credential storage is disabled; saved to secure global location.',
			);

		await finalizeSuccessfulLogin('copilot');
		log.success('GitHub Copilot authorized!');
		logCopilotTokenSummary(models.models);
		log.info(
			'You can also use env vars: COPILOT_GITHUB_TOKEN / GH_TOKEN / GITHUB_TOKEN',
		);
		outro('Done');
		return true;
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : String(error);
		log.error(`Authentication failed: ${message}`);
		outro('Failed');
		return false;
	}
}

export async function runAuthLogout(_args: string[]) {
	const cfg = await loadConfig(process.cwd());
	const wantLocal = _args.includes('--local');
	const all = await getAllAuth(cfg.projectRoot);
	const entries = Object.keys(all) as ProviderId[];
	intro('Remove credential');
	if (!entries.length) {
		log.info('No stored credentials');
		return outro('');
	}
	const selected = (await select({
		message: 'Select provider',
		options: entries.map((id) => ({
			value: id,
			label: PROVIDER_LINKS[id].name,
		})),
	})) as ProviderId | symbol;
	if (isCancel(selected)) return cancel('Cancelled');
	await removeAuth(selected as ProviderId, cfg.projectRoot, 'global');
	if (wantLocal)
		log.warn(
			'Local credential storage is disabled; removed from secure global location.',
		);
	log.success('Removed');
	outro('');
}

async function ensureGlobalConfigDefaults(provider: ProviderId) {
	// Determine global config path (XDG config)
	const base = getGlobalConfigDir();
	const path = getGlobalConfigPath();
	// If a global config already exists, do not overwrite
	const f = Bun.file(path);
	if (await f.exists()) return;
	const models = isBuiltInProviderId(provider)
		? (catalog[provider]?.models ?? [])
		: [];
	const defaultModel =
		(provider === 'xai' ? 'grok-4.3' : undefined) ||
		models[0]?.id ||
		(provider === 'anthropic'
			? 'claude-3-haiku'
			: provider === 'openai'
				? 'gpt-4o-mini'
				: provider === 'ollama-cloud'
					? 'gpt-oss:120b'
					: provider === 'google'
						? 'gemini-1.5-flash'
						: 'anthropic/claude-3.5-sonnet');
	const content = {
		defaults: { agent: 'build', provider, model: defaultModel },
		providers: {
			openai: { enabled: provider === 'openai' },
			anthropic: { enabled: provider === 'anthropic' },
			google: { enabled: provider === 'google' },
			baseten: { enabled: provider === 'baseten' },
			huggingface: { enabled: provider === 'huggingface' },
			openrouter: { enabled: provider === 'openrouter' },
			opencode: { enabled: provider === 'opencode' },
			copilot: { enabled: provider === 'copilot' },
			ottorouter: { enabled: provider === 'ottorouter' },
			xai: { enabled: provider === 'xai' },
			zai: { enabled: provider === 'zai' },
			'zai-coding': { enabled: provider === 'zai-coding' },
			deepseek: { enabled: provider === 'deepseek' },
			kimi: { enabled: provider === 'kimi' },
			minimax: { enabled: provider === 'minimax' },
		},
	};
	// Ensure directory and write file
	try {
		const { promises: fs } = await import('node:fs');
		await fs.mkdir(base, { recursive: true }).catch(() => {});
	} catch {}
	await Bun.write(path, JSON.stringify(content, null, 2));
	try {
		const { promises: fs } = await import('node:fs');
		await fs.chmod(path, 0o600).catch(() => {});
	} catch {}
}
