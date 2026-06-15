import {
	intro,
	outro,
	select,
	isCancel,
	cancel,
	log,
	text,
} from '@clack/prompts';
import {
	getProviders,
	getProviderModels,
	getConfig,
	updateDefaults,
} from '@ottocode/api';
import { runAuth } from './auth.ts';

type ModelOption = {
	id: string;
	label: string;
	toolCall?: boolean;
	reasoningText?: boolean;
};

export async function runModels(
	opts: { project?: string; local?: boolean } = {},
) {
	const projectRoot = opts.project ?? process.cwd();

	const { data: providersData } = await getProviders({
		query: { project: projectRoot },
	});

	let allowed: string[] =
		(providersData as { providers: string[] })?.providers ?? [];

	const { data: configData } = await getConfig({
		query: { project: projectRoot },
	});
	const defaults = (
		configData as {
			defaults: { agent: string; provider: string; model: string };
		}
	)?.defaults ?? {
		agent: 'coder',
		provider: '',
		model: '',
	};

	intro('Select provider and model');
	if (!allowed.length) {
		log.info('No providers configured. Launching auth…');
		await runAuth(['login']);
		const { data: providersData2 } = await getProviders({
			query: { project: projectRoot },
		});
		allowed = (providersData2 as { providers: string[] })?.providers ?? [];
		if (!allowed.length) {
			log.error('No credentials added. Aborting.');
			return outro('');
		}
	}

	const initialProvider = defaults.provider;
	const provider = (await select({
		message: 'Provider',
		options: allowed.map((p) => ({
			value: p,
			label: p === 'kimi' ? 'Kimi' : p,
		})),
		initialValue: initialProvider,
	})) as string | symbol;
	if (isCancel(provider)) return cancel('Cancelled');

	const { data: modelsData } = await getProviderModels({
		path: { provider: String(provider) } as never,
		query: { project: projectRoot },
	});

	const modelsResponse = modelsData as {
		models: ModelOption[];
		default?: string;
		allowAnyModel?: boolean;
		label?: string;
	};
	const models = modelsResponse?.models ?? [];
	const allowAnyModel = modelsResponse?.allowAnyModel === true;

	if (!models.length && !allowAnyModel) {
		log.error('No models available for this provider.');
		return outro('');
	}

	const uniq: ModelOption[] = [];
	const seen = new Set<string>();
	for (const m of models) {
		if (seen.has(m.id)) continue;
		seen.add(m.id);
		uniq.push(m);
	}
	uniq.sort((a, b) => {
		const la = (a.label || a.id).toLowerCase();
		const lb = (b.label || b.id).toLowerCase();
		return la < lb ? -1 : la > lb ? 1 : 0;
	});

	let filtered = uniq;
	if (uniq.length > 50) {
		const browseMode = (await select({
			message: `This provider has ${uniq.length} models`,
			initialValue: 'full',
			options: [
				{ value: 'full', label: 'Browse full list' },
				{ value: 'filter', label: 'Filter by text' },
			],
		})) as 'full' | 'filter' | symbol;
		if (isCancel(browseMode)) return cancel('Cancelled');
		if (browseMode === 'filter') {
			const q = await text({
				message: `Filter ${uniq.length} models (leave blank for all)`,
				placeholder: 'e.g., claude, gpt-4o, reasoning',
			});
			if (!isCancel(q)) {
				const needle = String(q || '')
					.trim()
					.toLowerCase();
				if (needle.length) {
					filtered = uniq.filter((m) => {
						const label = (m.label || '').toLowerCase();
						const id = m.id.toLowerCase();
						return label.includes(needle) || id.includes(needle);
					});
					if (!filtered.length) {
						log.info('No matches for that filter. Showing full list.');
						filtered = uniq;
					}
				}
			}
		} else {
			filtered = uniq;
		}
	}

	const options = filtered.map((m) => ({
		value: m.id,
		label: m.label ? `${m.label} (${m.id})` : m.id,
	}));
	if (allowAnyModel) {
		options.unshift({
			value: '__custom__',
			label: 'Enter a custom model id',
		});
	}
	const initial = options.some((o) => o.value === defaults.model)
		? (defaults.model as string)
		: undefined;

	async function pagedSelect(
		items: Array<{ value: string; label: string }>,
		message: string,
		pageSize = 6,
		initialValue?: string,
	): Promise<string | symbol> {
		const total = items.length;
		if (total <= pageSize) {
			return (await select({ message, options: items, initialValue })) as
				| string
				| symbol;
		}
		const lastIndex = Math.max(
			0,
			items.findIndex((i) => i.value === initialValue),
		);
		let page = lastIndex > -1 ? Math.floor(lastIndex / pageSize) : 0;
		const totalPages = Math.ceil(total / pageSize);
		while (true) {
			const start = page * pageSize;
			const pageItems = items.slice(start, start + pageSize);
			const hasPrev = page > 0;
			const hasNext = page < totalPages - 1;
			const nav: Array<{ value: string; label: string }> = [];
			if (hasPrev) nav.push({ value: '__prev__', label: '‹ Previous' });
			nav.push(...pageItems.map((x) => ({ value: x.value, label: x.label })));
			if (hasNext) nav.push({ value: '__next__', label: 'Next ›' });
			const initOnPage = pageItems.some((i) => i.value === initialValue)
				? initialValue
				: undefined;
			const choice = (await select({
				message: `${message} (${page + 1}/${totalPages})`,
				options: nav,
				initialValue: initOnPage,
			})) as string | symbol;
			if (isCancel(choice)) return choice;
			if (choice === '__prev__') {
				page = Math.max(0, page - 1);
				continue;
			}
			if (choice === '__next__') {
				page = Math.min(totalPages - 1, page + 1);
				continue;
			}
			return choice;
		}
	}

	const model = (await pagedSelect(
		options,
		`Model for ${modelsResponse?.label || String(provider)}`,
		6,
		initial,
	)) as string | symbol;
	if (isCancel(model)) return cancel('Cancelled');

	const resolvedModel =
		model === '__custom__'
			? await text({
					message: `Enter model id for ${String(provider)}`,
					initialValue: defaults.model,
				})
			: model;
	if (isCancel(resolvedModel)) return cancel('Cancelled');
	if (!String(resolvedModel).trim()) {
		log.error('Model id is required.');
		return outro('');
	}

	const targetLocal = !!opts.local;

	await updateDefaults({
		body: {
			provider: String(provider),
			model: String(resolvedModel),
			scope: targetLocal ? 'local' : 'global',
		},
		query: { project: projectRoot },
	});

	log.success(
		`Set default (${targetLocal ? 'local' : 'global'}) provider=${String(
			provider,
		)} model=${String(resolvedModel)}`,
	);
	outro('Done');
}
