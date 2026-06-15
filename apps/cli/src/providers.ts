import {
	cancel,
	confirm,
	intro,
	isCancel,
	log,
	outro,
	select,
	text,
} from '@clack/prompts';
import {
	discoverOllamaModels,
	getConfiguredProviderIds,
	getProviderDefinition,
	isProviderAuthorized,
	loadConfig,
	normalizeOllamaBaseURL,
	removeProviderSettings,
	setConfig,
	writeProviderSettings,
	type ProviderCompatibility,
	type ModelInfo,
	type ProviderPromptFamily,
} from '@ottocode/sdk';
import { colors, table } from './ui.ts';

const COMPATIBILITY_OPTIONS: Array<{
	value: ProviderCompatibility;
	label: string;
}> = [
	{ value: 'ollama', label: 'Ollama (native API)' },
	{ value: 'openai-compatible', label: 'OpenAI-compatible' },
	{ value: 'openai', label: 'OpenAI' },
	{ value: 'anthropic', label: 'Anthropic' },
	{ value: 'google', label: 'Google' },
	{ value: 'openrouter', label: 'OpenRouter' },
];

const FAMILY_OPTIONS: Array<{ value: ProviderPromptFamily; label: string }> = [
	{ value: 'default', label: 'Default' },
	{ value: 'openai', label: 'OpenAI' },
	{ value: 'anthropic', label: 'Anthropic' },
	{ value: 'google', label: 'Google' },
	{ value: 'kimi', label: 'Kimi' },
	{ value: 'glm', label: 'GLM' },
	{ value: 'minimax', label: 'MiniMax' },
];

function defaultFamilyForCompatibility(
	compatibility: ProviderCompatibility,
): ProviderPromptFamily {
	switch (compatibility) {
		case 'openai':
			return 'openai';
		case 'anthropic':
			return 'anthropic';
		case 'google':
			return 'google';
		default:
			return 'default';
	}
}

function parseModelsCsv(input: string): string[] {
	return input
		.split(',')
		.map((part) => part.trim())
		.filter(Boolean);
}

type ProvidersListOptions = {
	verbose?: boolean;
	showModels?: boolean;
};

function summarizeModels(args: {
	allowAnyModel: boolean;
	modelIds: string[];
	showModels?: boolean;
}): string {
	const { allowAnyModel, modelIds, showModels } = args;
	if (allowAnyModel) return 'any';
	if (!modelIds.length) return '0';
	if (!showModels) return String(modelIds.length);
	const preview = modelIds.slice(0, 3).join(', ');
	return modelIds.length > 3 ? `${preview} +${modelIds.length - 3}` : preview;
}

function providerStatus(args: {
	id: string;
	defaultProvider: string;
	source: 'built-in' | 'custom';
	authorized: boolean;
	enabled: boolean;
}): string {
	const { id, defaultProvider, source, authorized, enabled } = args;
	const base =
		source === 'built-in'
			? authorized
				? colors.green('ready')
				: colors.dim('not configured')
			: enabled
				? authorized
					? colors.green('enabled')
					: colors.yellow('needs auth')
				: colors.dim('disabled');
	return id === defaultProvider
		? `${colors.yellow('default')} · ${base}`
		: base;
}

export async function runProvidersList(
	projectRoot?: string,
	options: ProvidersListOptions = {},
) {
	const cfg = await loadConfig(projectRoot);
	const ids = getConfiguredProviderIds(cfg, { includeDisabled: true });
	if (!ids.length) {
		log.info('No configured providers found.');
		return;
	}

	const rows: Array<{
		sortKey: [number, number, string];
		cells: string[];
	}> = [];
	const verboseRows: Array<{ title: string; lines: string[] }> = [];

	for (const id of ids) {
		const definition = getProviderDefinition(cfg, id);
		if (!definition) continue;
		const setting = cfg.providers[id];
		const enabled = setting?.enabled !== false;
		const authorized = await isProviderAuthorized(cfg, id);
		const label = definition.label === id ? '—' : definition.label;
		const modelIds = definition.models.map((model) => model.id);
		const notes: string[] = [];
		if (
			definition.apiKeyEnv &&
			definition.apiKeyEnv !== 'undefined' &&
			definition.apiKeyEnv !== 'null'
		) {
			notes.push(`env:${definition.apiKeyEnv}`);
		}
		if (definition.baseURL) notes.push(`url:${definition.baseURL}`);

		rows.push({
			sortKey: [id === cfg.defaults.provider ? 0 : 1, enabled ? 0 : 1, id],
			cells: [
				id,
				label,
				providerStatus({
					id,
					defaultProvider: cfg.defaults.provider,
					source: definition.source,
					authorized,
					enabled,
				}),
				definition.source,
				definition.compatibility,
				summarizeModels({
					allowAnyModel: definition.allowAnyModel,
					modelIds,
					showModels: options.showModels,
				}),
				notes.join(' · ') || '—',
			],
		});

		if (options.verbose) {
			const lines: string[] = [];
			if (definition.family) lines.push(`family: ${definition.family}`);
			if (definition.baseURL) lines.push(`baseURL: ${definition.baseURL}`);
			if (definition.apiKeyEnv)
				lines.push(`apiKeyEnv: ${definition.apiKeyEnv}`);
			lines.push(
				`models: ${definition.allowAnyModel ? 'any' : modelIds.length.toString()}`,
			);
			if (options.showModels && modelIds.length) {
				lines.push(`model ids: ${modelIds.join(', ')}`);
			}
			verboseRows.push({
				title: `${id} (${definition.source})`,
				lines,
			});
		}
	}

	rows.sort((a, b) => {
		if (a.sortKey[0] !== b.sortKey[0]) return a.sortKey[0] - b.sortKey[0];
		if (a.sortKey[1] !== b.sortKey[1]) return a.sortKey[1] - b.sortKey[1];
		return a.sortKey[2].localeCompare(b.sortKey[2]);
	});

	table(
		['provider', 'label', 'status', 'kind', 'compat', 'models', 'notes'],
		rows.map((row) => row.cells),
	);

	if (!options.verbose && !options.showModels) {
		log.info(
			'Tip: use --verbose for details or --models to preview model ids.',
		);
	}

	if (options.verbose) {
		for (const entry of verboseRows) {
			log.info(`\n${colors.bold(entry.title)}`);
			for (const line of entry.lines) {
				log.info(`  ${line}`);
			}
		}
	}
}

export async function runProvidersAdd(projectRoot?: string) {
	const cfg = await loadConfig(projectRoot);
	intro('Add custom provider');

	const id = await text({
		message: 'Provider id',
		placeholder: 'e.g. my-ollama, gpu-box, internal-gateway',
	});
	if (isCancel(id)) return cancel('Cancelled');
	const providerId = String(id).trim();
	if (!providerId) return cancel('Provider id is required');

	const label = await text({
		message: 'Label',
		initialValue: providerId,
	});
	if (isCancel(label)) return cancel('Cancelled');

	const compatibility = (await select({
		message: 'Compatibility',
		initialValue: 'ollama',
		options: COMPATIBILITY_OPTIONS,
	})) as ProviderCompatibility | symbol;
	if (isCancel(compatibility)) return cancel('Cancelled');

	const family = (await select({
		message: 'Prompt family',
		initialValue: defaultFamilyForCompatibility(compatibility),
		options: FAMILY_OPTIONS,
	})) as ProviderPromptFamily | symbol;
	if (isCancel(family)) return cancel('Cancelled');

	const baseURL = await text({
		message: 'Base URL',
		placeholder:
			compatibility === 'ollama'
				? 'http://127.0.0.1:11434 or https://host/ollama'
				: 'http://127.0.0.1:11434/v1',
	});
	if (isCancel(baseURL)) return cancel('Cancelled');
	if (!String(baseURL).trim()) return cancel('Base URL is required');

	const apiKeyEnv = await text({
		message: 'API key env var (optional)',
		placeholder: 'e.g. OLLAMA_API_KEY',
	});
	if (isCancel(apiKeyEnv)) return cancel('Cancelled');
	const apiKeyEnvName = String(apiKeyEnv).trim() || undefined;
	const configuredBaseURL =
		compatibility === 'ollama'
			? normalizeOllamaBaseURL(String(baseURL).trim())
			: String(baseURL).trim();

	let discoveredModels: ModelInfo[] = [];
	let manualModelIds: string[] = [];
	if (compatibility === 'ollama') {
		const shouldDiscover = (await confirm({
			message: 'Discover Ollama models and capabilities automatically?',
			initialValue: true,
		})) as boolean | symbol;
		if (isCancel(shouldDiscover)) return cancel('Cancelled');
		if (shouldDiscover) {
			try {
				const discovery = await discoverOllamaModels({
					baseURL: configuredBaseURL,
					apiKey: apiKeyEnvName ? process.env[apiKeyEnvName] : undefined,
				});
				discoveredModels = discovery.models;
				log.success(
					`Discovered ${discoveredModels.length} Ollama model${discoveredModels.length === 1 ? '' : 's'}.`,
				);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				log.info(`Could not auto-discover models: ${message}`);
			}
		}
	}

	if (!discoveredModels.length) {
		const modelsCsv = await text({
			message: 'Static models (comma-separated, optional)',
			placeholder: 'e.g. qwen2.5-coder:14b, deepseek-r1:32b',
		});
		if (isCancel(modelsCsv)) return cancel('Cancelled');
		manualModelIds = parseModelsCsv(String(modelsCsv));
	}
	const models = discoveredModels.length ? discoveredModels : manualModelIds;

	const allowAnyModel = (await confirm({
		message: 'Allow arbitrary model ids?',
		initialValue: models.length === 0,
	})) as boolean | symbol;
	if (isCancel(allowAnyModel)) return cancel('Cancelled');

	await writeProviderSettings(
		'global',
		providerId,
		{
			enabled: true,
			custom: true,
			label: String(label).trim() || providerId,
			compatibility,
			family,
			baseURL: configuredBaseURL,
			apiKeyEnv: apiKeyEnvName,
			models,
			allowAnyModel,
			modelDiscovery:
				compatibility === 'ollama' ? { type: 'ollama' } : undefined,
		},
		projectRoot,
	);

	const setAsDefault = (await confirm({
		message: 'Set as the default provider?',
		initialValue: cfg.defaults.provider === providerId,
	})) as boolean | symbol;
	if (isCancel(setAsDefault)) return cancel('Cancelled');
	if (setAsDefault) {
		const defaultModel =
			(typeof models[0] === 'string' ? models[0] : models[0]?.id) ||
			(await text({
				message: 'Default model id',
				initialValue: cfg.defaults.model,
			}));
		if (isCancel(defaultModel)) return cancel('Cancelled');
		await setConfig(
			'global',
			{
				provider: providerId,
				model: String(defaultModel).trim(),
			},
			projectRoot,
		);
	}

	outro(`Saved provider ${providerId}`);
}

export async function runProvidersRemove(
	provider: string,
	projectRoot?: string,
	_scope?: 'local' | 'global',
) {
	const cfg = await loadConfig(projectRoot);
	const definition = getProviderDefinition(cfg, provider);
	if (!definition) {
		log.error(`Provider not found: ${provider}`);
		return;
	}
	const confirmed = await confirm({
		message: `Remove provider override for ${provider} from global config?`,
		initialValue: false,
	});
	if (isCancel(confirmed) || !confirmed) return cancel('Cancelled');
	await removeProviderSettings('global', provider, projectRoot);
	outro(`Removed provider ${provider} from global config`);
}
