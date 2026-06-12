import {
	intro,
	outro,
	select,
	multiselect,
	text,
	isCancel,
	cancel,
} from '@clack/prompts';
import { loadConfig } from '@ottocode/sdk';
import {
	catalog,
	isBuiltInProviderId,
	type ModelInfo,
	type ProviderId,
} from '@ottocode/sdk';

export async function runSetup(projectRoot?: string) {
	const cfg = await loadConfig(projectRoot);
	intro('otto setup');

	const providersPicked = (await multiselect({
		message: 'Enable providers:',
		options: [
			{ value: 'openai', label: 'OpenAI' },
			{ value: 'anthropic', label: 'Anthropic' },
			{ value: 'google', label: 'Google (Gemini)' },
			{ value: 'ollama-cloud', label: 'Ollama Cloud' },
			{ value: 'openrouter', label: 'OpenRouter' },
			{ value: 'opencode', label: 'OpenCode' },
			{ value: 'ottorouter', label: 'OttoRouter' },
			{ value: 'xai', label: 'xAI' },
			{ value: 'zai', label: 'Z.AI (GLM)' },
			{ value: 'zai-coding', label: 'Z.AI Coding Plan' },
			{ value: 'moonshot', label: 'Kimi' },
			{ value: 'minimax', label: 'MiniMax' },
		],
		initialValues: Object.entries(cfg.providers)
			.filter(([, v]) => v.enabled)
			.map(([k]) => k),
	})) as ProviderId[] | symbol;
	if (isCancel(providersPicked)) return cancel('Setup cancelled');

	const providers: Record<ProviderId, { enabled: boolean; apiKey?: string }> = {
		openai: { enabled: false },
		anthropic: { enabled: false },
		google: { enabled: false },
		'ollama-cloud': { enabled: false },
		openrouter: { enabled: false },
		opencode: { enabled: false },
		copilot: { enabled: false },
		ottorouter: { enabled: false },
		xai: { enabled: false },
		zai: { enabled: false },
		'zai-coding': { enabled: false },
		moonshot: { enabled: false },
		minimax: { enabled: false },
	};
	for (const p of providersPicked as ProviderId[]) providers[p].enabled = true;

	// Collect API keys for enabled providers
	for (const p of Object.keys(providers) as ProviderId[]) {
		if (!providers[p].enabled) continue;
		const keyLabel =
			p === 'openai'
				? 'OPENAI_API_KEY'
				: p === 'anthropic'
					? 'ANTHROPIC_API_KEY'
					: p === 'google'
						? 'GOOGLE_GENERATIVE_AI_API_KEY'
						: p === 'ollama-cloud'
							? 'OLLAMA_API_KEY'
							: p === 'openrouter'
								? 'OPENROUTER_API_KEY'
								: p === 'opencode'
									? 'OPENCODE_API_KEY'
									: p === 'ottorouter'
										? 'OTTOROUTER_PRIVATE_KEY'
										: p === 'xai'
											? 'XAI_API_KEY'
											: p === 'zai'
												? 'ZAI_API_KEY'
												: p === 'zai-coding'
													? 'ZAI_CODING_API_KEY'
													: p === 'moonshot'
														? 'KIMI_API_KEY'
														: 'MINIMAX_API_KEY';
		const key = await text({
			message: `Enter ${keyLabel} (leave empty to skip)`,
			initialValue: '',
		});
		if (isCancel(key)) return cancel('Setup cancelled');
		if (String(key).trim()) providers[p].apiKey = String(key).trim();
	}

	// Choose default provider
	const defaultProvider = (await select({
		message: 'Default provider:',
		options: (Object.keys(providers) as ProviderId[]).map((p) => ({
			value: p,
			label: `${p}${providers[p].enabled ? '' : ' (disabled)'}`,
		})),
		initialValue: cfg.defaults.provider,
	})) as ProviderId | symbol;
	if (isCancel(defaultProvider)) return cancel('Setup cancelled');

	// Choose default model from catalog for that provider
	const selectedProvider = defaultProvider as ProviderId;
	const models = isBuiltInProviderId(selectedProvider)
		? (catalog[selectedProvider]?.models ?? [])
		: [];
	const defaultModel =
		models.length > 0
			? ((await select({
					message: `Default model for ${String(defaultProvider)}:`,
					options: models.map((m: ModelInfo) => ({
						value: m.id,
						label: m.label ? `${m.label} (${m.id})` : m.id,
					})),
					initialValue: cfg.defaults.model,
				})) as string | symbol)
			: ((await text({
					message: `Default model for ${String(defaultProvider)}:`,
					placeholder: 'e.g. gpt-oss:120b',
					initialValue: cfg.defaults.model,
				})) as string | symbol);
	if (isCancel(defaultModel)) return cancel('Setup cancelled');

	// Choose default agent
	const defaultAgent = (await select({
		message: 'Default agent:',
		options: [
			{ value: 'general', label: 'general' },
			{ value: 'build', label: 'build' },
			{ value: 'plan', label: 'plan' },
		],
		initialValue: cfg.defaults.agent,
	})) as string | symbol;
	if (isCancel(defaultAgent)) return cancel('Setup cancelled');

	const next = {
		projectRoot: cfg.projectRoot,
		defaults: {
			agent: String(defaultAgent),
			provider: defaultProvider as ProviderId,
			model: String(defaultModel),
		},
		providers: {
			openai: providers.openai,
			anthropic: providers.anthropic,
			google: providers.google,
			'ollama-cloud': providers['ollama-cloud'],
			openrouter: providers.openrouter,
			opencode: providers.opencode,
			copilot: providers.copilot,
			ottorouter: providers.ottorouter,
			xai: providers.xai,
			zai: providers.zai,
			'zai-coding': providers['zai-coding'],
			moonshot: providers.moonshot,
			minimax: providers.minimax,
		},
		paths: cfg.paths,
	};

	const configPath =
		cfg.paths.projectConfigPath || `${cfg.paths.dataDir}/config.json`;
	await Bun.write(configPath, JSON.stringify(next, null, 2));

	outro(`Saved configuration to ${configPath}`);
}
