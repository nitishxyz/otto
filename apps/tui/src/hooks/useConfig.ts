import { useState, useCallback, useEffect } from 'react';
import { getConfig, updateDefaults as apiUpdateDefaults } from '@ottocode/api';

interface Config {
	agents: string[];
	providers: string[];
	defaults: {
		agent: string;
		provider: string;
		model: string;
		toolApproval?: 'auto' | 'dangerous' | 'all' | 'yolo';
		reasoningText?: boolean;
		reasoningLevel?: 'minimal' | 'low' | 'medium' | 'high' | 'max' | 'xhigh';
		theme?: string;
	};
}

export function useConfig() {
	const [config, setConfig] = useState<Config>({
		agents: [],
		providers: [],
		defaults: {
			agent: 'build',
			provider: 'anthropic',
			model: 'claude-sonnet-4-20250514',
			toolApproval: 'auto',
			reasoningText: true,
			reasoningLevel: 'high',
		},
	});
	const [isLoaded, setIsLoaded] = useState(false);

	const loadConfig = useCallback(async () => {
		try {
			const response = await getConfig();
			const data = response.data as unknown as Config;
			if (data) setConfig(data);
			return data;
		} catch {
			return null;
		} finally {
			setIsLoaded(true);
		}
	}, []);

	const updateDefaults = useCallback(
		async (changes: {
			provider?: string;
			model?: string;
			agent?: string;
			toolApproval?: 'auto' | 'dangerous' | 'all' | 'yolo';
			reasoningText?: boolean;
			reasoningLevel?: 'minimal' | 'low' | 'medium' | 'high' | 'max' | 'xhigh';
			theme?: string;
		}) => {
			try {
				const response = await apiUpdateDefaults({
					body: { ...changes, scope: 'global' } as never,
				});
				const result = response.data as unknown as {
					defaults: Config['defaults'];
				};
				if (result?.defaults) {
					setConfig((prev) => ({ ...prev, defaults: result.defaults }));
				}
			} catch {}
		},
		[],
	);

	// biome-ignore lint/correctness/useExhaustiveDependencies: intentionally empty deps — loadConfig is stable but including it caused an infinite fetch loop (config was in its dependency chain)
	useEffect(() => {
		loadConfig();
	}, []);

	return { config, isLoaded, loadConfig, updateDefaults };
}
