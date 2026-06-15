import type {
	ProviderId,
	ProviderConfig,
	ProviderApiFormat,
} from '../types.ts';
import { ottorouterCatalog } from '../catalog.ts';

const OWNER_API_FORMAT: Record<string, ProviderApiFormat> = {
	openai: 'openai-responses',
	anthropic: 'anthropic-messages',
	google: 'google-native',
	minimax: 'anthropic-messages',
	kimi: 'openai-chat',
	qwen: 'openai-chat',
	openrouter: 'openrouter-chat',
	zai: 'openai-chat',
	xai: 'xai-chat',
};

const PREFIX_API_FORMAT: Array<{
	prefix: string;
	providerId: ProviderId;
	apiFormat: ProviderApiFormat;
}> = [{ prefix: 'qwen', providerId: 'qwen', apiFormat: 'openai-chat' }];

export class ProviderRegistry {
	private configs: ProviderConfig[];
	private modelMap: Record<string, ProviderId>;

	constructor(
		customProviders?: ProviderConfig[],
		modelMap?: Record<string, ProviderId>,
	) {
		this.configs = [...(customProviders ?? [])];
		this.modelMap = modelMap ?? {};
	}

	resolve(
		modelId: string,
	): { providerId: ProviderId; apiFormat: ProviderApiFormat } | null {
		if (this.modelMap[modelId]) {
			const providerId = this.modelMap[modelId];
			const config = this.configs.find((c) => c.id === providerId);
			return {
				providerId,
				apiFormat: config?.apiFormat ?? 'openai-chat',
			};
		}

		for (const config of this.configs) {
			if (config.models?.includes(modelId)) {
				return { providerId: config.id, apiFormat: config.apiFormat };
			}
		}

		for (const config of this.configs) {
			if (config.modelPrefix && modelId.startsWith(config.modelPrefix)) {
				return { providerId: config.id, apiFormat: config.apiFormat };
			}
		}

		const entry = ottorouterCatalog.models.find((m) => m.id === modelId);
		if (entry) {
			const providerId = entry.owned_by as ProviderId;
			const apiFormat = OWNER_API_FORMAT[providerId] ?? 'openai-chat';
			return { providerId, apiFormat };
		}

		const prefixMatch = PREFIX_API_FORMAT.find(({ prefix }) =>
			modelId.toLowerCase().startsWith(prefix),
		);
		if (prefixMatch) {
			return {
				providerId: prefixMatch.providerId,
				apiFormat: prefixMatch.apiFormat,
			};
		}

		return null;
	}

	register(config: ProviderConfig): void {
		this.configs.push(config);
	}

	mapModel(modelId: string, providerId: ProviderId): void {
		this.modelMap[modelId] = providerId;
	}
}
