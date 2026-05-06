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
	exchangeOpenAI,
	openOpenAIAuthUrl,
	obtainOpenAIApiKey,
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
	moonshot: {
		name: 'Moonshot AI (Kimi)',
		url: 'https://platform.moonshot.ai/console/api-keys',
		env: 'MOONSHOT_API_KEY',
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

type CopilotLoginMethod = 'oauth' | 'token' | 'gh';

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
	const providerAlias = _args.includes('ollama') ? 'ollama-cloud' : undefined;
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
				{ value: 'openrouter', label: PROVIDER_LINKS.openrouter.name },
				{ value: 'opencode', label: PROVIDER_LINKS.opencode.name },
				{ value: 'copilot', label: PROVIDER_LINKS.copilot.name },
				{ value: 'ottorouter', label: PROVIDER_LINKS.ottorouter.name },
				{ value: 'xai', label: PROVIDER_LINKS.xai.name },
				{ value: 'zai', label: PROVIDER_LINKS.zai.name },
				{ value: 'zai-coding', label: PROVIDER_LINKS['zai-coding'].name },
				{ value: 'moonshot', label: PROVIDER_LINKS.moonshot.name },
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
		return runAuthLoginSetu(cfg, wantLocal);
	}

	if (provider === 'copilot') {
		return runAuthLoginCopilot(cfg, wantLocal, _args);
	}

	const meta = PROVIDER_LINKS[provider];
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

		log.info('Starting OpenAI OAuth flow...');
		log.info(
			'⚠️  If the official Codex CLI is running, please stop it first (both use port 1455).\n',
		);

		const oauthResult = await authorizeOpenAI();

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

		try {
			const code = await oauthResult.waitForCallback();
			oauthResult.close();

			log.info('🔄 Exchanging authorization code for tokens...');

			const tokens = await exchangeOpenAI(code, oauthResult.verifier);

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
			oauthResult.close();
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

async function runAuthLoginSetu(
	cfg: Awaited<ReturnType<typeof loadConfig>>,
	wantLocal: boolean,
): Promise<boolean> {
	log.info('Setu uses a Solana wallet for authentication.');

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
			openrouter: { enabled: provider === 'openrouter' },
			opencode: { enabled: provider === 'opencode' },
			copilot: { enabled: provider === 'copilot' },
			ottorouter: { enabled: provider === 'ottorouter' },
			xai: { enabled: provider === 'xai' },
			zai: { enabled: provider === 'zai' },
			'zai-coding': { enabled: provider === 'zai-coding' },
			moonshot: { enabled: provider === 'moonshot' },
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
