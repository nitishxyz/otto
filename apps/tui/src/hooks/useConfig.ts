import { useState, useCallback, useEffect, useMemo } from 'react';
import { getConfig, updateDefaults as apiUpdateDefaults } from '@ottocode/api';
import { getProjectKey, getProjectQuery } from '../api.ts';

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
		tuiTheme?: string;
		coAuthorCommits?: boolean;
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
	const projectKey = getProjectKey();
	const projectQuery = useMemo(() => {
		void projectKey;
		return getProjectQuery();
	}, [projectKey]);

	const loadConfig = useCallback(async () => {
		try {
			const response = await getConfig({ query: projectQuery } as never);
			const data = response.data as unknown as Config;
			if (data) setConfig(data);
			return data;
		} catch {
			return null;
		} finally {
			setIsLoaded(true);
		}
	}, [projectQuery]);

	const updateDefaults = useCallback(
		async (changes: {
			provider?: string;
			model?: string;
			agent?: string;
			toolApproval?: 'auto' | 'dangerous' | 'all' | 'yolo';
			reasoningText?: boolean;
			reasoningLevel?: 'minimal' | 'low' | 'medium' | 'high' | 'max' | 'xhigh';
			theme?: string;
			tuiTheme?: string;
			coAuthorCommits?: boolean;
		}) => {
			try {
				const response = await apiUpdateDefaults({
					query: projectQuery,
					body: { ...changes, scope: 'global' } as never,
				} as never);
				const result = response.data as unknown as {
					defaults: Config['defaults'];
				};
				if (result?.defaults) {
					setConfig((prev) => ({ ...prev, defaults: result.defaults }));
				}
			} catch {}
		},
		[projectQuery],
	);

	useEffect(() => {
		loadConfig();
	}, [loadConfig]);

	return { config, isLoaded, loadConfig, updateDefaults };
}
