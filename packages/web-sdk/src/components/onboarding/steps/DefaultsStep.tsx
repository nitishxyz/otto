import { memo, useState, useEffect, useId, useRef } from 'react';
import { ArrowLeft, Sparkles, ChevronDown } from 'lucide-react';
import { apiClient } from '../../../lib/api-client';
import type { AuthStatus } from '../../../stores/onboardingStore';
import { ProviderLogo } from '../../common/ProviderLogo';
import { StableSpinner } from '../../ui/StableSpinner';

interface DefaultsStepProps {
	authStatus: AuthStatus;
	onComplete: () => Promise<void>;
	onBack: () => void;
	hideHeader?: boolean;
}

interface ConfigData {
	agents: string[];
	providers: string[];
	defaults: {
		agent: string;
		provider: string;
		model: string;
		toolApproval?: 'auto' | 'dangerous' | 'all' | 'yolo';
		guidedMode?: boolean;
		fullWidthContent?: boolean;
	};
}

type AllModels = Record<
	string,
	{
		label: string;
		models: Array<{ id: string; label: string }>;
	}
>;

export const DefaultsStep = memo(function DefaultsStep({
	authStatus,
	onComplete,
	onBack,
	hideHeader = false,
}: DefaultsStepProps) {
	const [config, setConfig] = useState<ConfigData | null>(null);
	const [allModels, setAllModels] = useState<AllModels | null>(null);
	const [isLoading, setIsLoading] = useState(true);
	const [isSaving, setIsSaving] = useState(false);

	const [selectedProvider, setSelectedProvider] = useState('ottorouter');
	const [selectedModel, setSelectedModel] = useState('kimi-k2.5');
	const [selectedAgent, setSelectedAgent] = useState(
		authStatus.defaults.agent || 'build',
	);
	const [selectedApproval, setSelectedApproval] = useState<
		'auto' | 'dangerous' | 'all' | 'yolo'
	>(authStatus.defaults.toolApproval || 'dangerous');
	const [guidedMode, setGuidedMode] = useState(false);
	const hasUserChangedProvider = useRef(false);

	const providerId = useId();
	const modelId = useId();
	const agentId = useId();
	const approvalId = useId();

	useEffect(() => {
		const loadConfig = async () => {
			try {
				const [configData, modelsData] = await Promise.all([
					apiClient.getConfig(),
					apiClient.getAllModels(),
				]);
				setConfig(configData);
				setAllModels(modelsData);
				const cfgProvider = configData?.defaults?.provider || 'ottorouter';
				const cfgModel = configData?.defaults?.model || 'kimi-k2.5';
				const providerHasModels = modelsData?.[cfgProvider]?.models?.length > 0;
				const resolvedProvider = providerHasModels ? cfgProvider : 'ottorouter';
				const resolvedModel =
					providerHasModels &&
					modelsData[cfgProvider].models.some(
						(m: { id: string }) => m.id === cfgModel,
					)
						? cfgModel
						: modelsData?.[resolvedProvider]?.models?.[0]?.id || 'kimi-k2.5';
				setSelectedProvider(resolvedProvider);
				setSelectedModel(resolvedModel);
				if (configData?.defaults?.agent) {
					setSelectedAgent(configData.defaults.agent);
				}
				if (configData?.defaults?.toolApproval) {
					setSelectedApproval(configData.defaults.toolApproval);
				}
				if (configData?.defaults?.guidedMode) {
					setGuidedMode(configData.defaults.guidedMode);
				}
			} catch {
			} finally {
				setIsLoading(false);
			}
		};
		loadConfig();
	}, []);

	useEffect(() => {
		if (config?.agents?.length) {
			const agents = config.agents;
			if (!selectedAgent || !agents.includes(selectedAgent)) {
				setSelectedAgent(agents.includes('build') ? 'build' : agents[0]);
			}
		}
	}, [config, selectedAgent]);

	useEffect(() => {
		if (allModels?.[selectedProvider] && hasUserChangedProvider.current) {
			const providerModels = allModels[selectedProvider];
			if (!providerModels.models.some((m) => m.id === selectedModel)) {
				setSelectedModel(providerModels.models[0]?.id || '');
			}
		}
	}, [selectedProvider, allModels, selectedModel]);

	const handleFinish = async () => {
		setIsSaving(true);
		try {
			await apiClient.updateDefaults({
				provider: selectedProvider,
				model: selectedModel,
				agent: selectedAgent,
				toolApproval: selectedApproval,
				guidedMode,
				fullWidthContent: config?.defaults?.fullWidthContent ?? true,
				scope: 'global',
			});
			await onComplete();
		} catch {
		} finally {
			setIsSaving(false);
		}
	};

	if (isLoading) {
		return (
			<div className="min-h-screen flex items-center justify-center">
				<StableSpinner
					size="xl"
					className="text-muted-foreground"
					title="Loading defaults"
				/>
			</div>
		);
	}

	const availableProviders = config?.providers.filter(
		(p) =>
			(authStatus.providers[p]?.configured || p === 'ottorouter') &&
			allModels?.[p]?.models?.length > 0,
	) || ['ottorouter'];

	const currentProviderModels = allModels?.[selectedProvider]?.models || [];

	return (
		<div className="min-h-screen flex flex-col">
			{!hideHeader && (
				<div className="flex items-center justify-between px-6 py-4 border-b border-border">
					<div className="flex items-center gap-3">
						<ProviderLogo provider="ottorouter" size={24} />
						<span className="font-semibold text-foreground">otto</span>
					</div>
					<div className="flex items-center gap-2 text-sm text-muted-foreground">
						<span className="w-2 h-2 rounded-full bg-blue-500" />
						Step 2 of 2
					</div>
				</div>
			)}

			{/* Main Content */}
			<div
				className={`flex-1 px-4 sm:px-6 lg:px-12 pb-32 ${hideHeader ? 'pt-8 sm:pt-10 lg:pt-14' : 'pt-6 sm:pt-8 lg:pt-12'}`}
			>
				<div className="max-w-7xl mx-auto">
					{/* Header */}
					<div className="mb-10">
						<h1 className="text-3xl lg:text-4xl font-semibold text-foreground mb-3">
							Configure Defaults
						</h1>
						<p className="text-lg text-muted-foreground">
							Set your preferences. You can change these anytime in settings.
						</p>
					</div>

					{/* Form */}
					<div className="grid grid-cols-1 md:grid-cols-2 gap-6">
						{/* Provider */}
						<div className="md:col-span-2">
							<label
								htmlFor={providerId}
								className="block text-sm font-medium text-muted-foreground mb-2"
							>
								Default Provider
							</label>
							<div className="relative">
								<select
									id={providerId}
									value={selectedProvider}
									onChange={(e) => {
										hasUserChangedProvider.current = true;
										setSelectedProvider(e.target.value);
									}}
									className="w-full px-4 py-3 bg-card border border-border rounded-xl text-foreground appearance-none cursor-pointer focus:outline-none focus:border-ring transition-colors"
								>
									{availableProviders.map((p) => (
										<option key={p} value={p}>
											{authStatus.providers[p]?.label || p}
										</option>
									))}
								</select>
								<ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground pointer-events-none" />
							</div>
						</div>

						{/* Model */}
						<div className="md:col-span-2">
							<label
								htmlFor={modelId}
								className="block text-sm font-medium text-muted-foreground mb-2"
							>
								Default Model
							</label>
							<div className="relative">
								<select
									id={modelId}
									value={selectedModel}
									onChange={(e) => setSelectedModel(e.target.value)}
									className="w-full px-4 py-3 bg-card border border-border rounded-xl text-foreground appearance-none cursor-pointer focus:outline-none focus:border-ring transition-colors"
								>
									{currentProviderModels.map((m) => (
										<option key={m.id} value={m.id}>
											{m.label || m.id}
										</option>
									))}
								</select>
								<ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground pointer-events-none" />
							</div>
						</div>

						{/* Agent */}
						<div>
							<label
								htmlFor={agentId}
								className="block text-sm font-medium text-muted-foreground mb-2"
							>
								Default Agent
							</label>
							<div className="relative">
								<select
									id={agentId}
									value={selectedAgent}
									onChange={(e) => setSelectedAgent(e.target.value)}
									className="w-full px-4 py-3 bg-card border border-border rounded-xl text-foreground appearance-none cursor-pointer focus:outline-none focus:border-ring transition-colors"
								>
									{(config?.agents || ['build']).map((a) => (
										<option key={a} value={a}>
											{a}
										</option>
									))}
								</select>
								<ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground pointer-events-none" />
							</div>
						</div>

						{/* Tool Approval */}
						<div>
							<label
								htmlFor={approvalId}
								className="block text-sm font-medium text-muted-foreground mb-2"
							>
								Tool Approval
							</label>
							<div className="relative">
								<select
									id={approvalId}
									value={selectedApproval}
									onChange={(e) =>
										setSelectedApproval(
											e.target.value as 'auto' | 'dangerous' | 'all' | 'yolo',
										)
									}
									className="w-full px-4 py-3 bg-card border border-border rounded-xl text-foreground appearance-none cursor-pointer focus:outline-none focus:border-ring transition-colors"
								>
									<option value="auto">Auto - run without asking</option>
									<option value="dangerous">
										Dangerous - approve writes only
									</option>
									<option value="yolo">
										YOLO - skip approvals except hard safety blocks
									</option>
									<option value="all">All - approve every tool</option>
								</select>
								<ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground pointer-events-none" />
							</div>
							<p className="mt-2 text-sm text-muted-foreground">
								Controls when tool executions need approval. YOLO still blocks
								extreme destructive commands.
							</p>
						</div>

						{/* Guided Mode */}
						<div className="md:col-span-2">
							<div className="flex items-center justify-between px-4 py-3 bg-card border border-border rounded-xl">
								<div>
									<span className="text-sm font-medium text-foreground">
										Guided Mode
									</span>
									<p className="text-sm text-muted-foreground mt-0.5">
										AI will run commands and manage services for you instead of
										giving instructions
									</p>
								</div>
								<button
									type="button"
									role="switch"
									aria-checked={guidedMode}
									onClick={() => setGuidedMode(!guidedMode)}
									className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 ${
										guidedMode ? 'bg-primary' : 'bg-muted'
									}`}
								>
									<span
										className={`inline-block h-4 w-4 transform rounded-full transition-transform ${
											guidedMode ? 'translate-x-6' : 'translate-x-1'
										} ${guidedMode ? 'bg-primary-foreground' : 'bg-foreground'}`}
									/>
								</button>
							</div>
						</div>
					</div>
				</div>
			</div>

			{/* Bottom Bar */}
			<div className="fixed bottom-0 left-0 right-0 px-4 sm:px-6 py-4 border-t border-border bg-background">
				<div className="max-w-7xl mx-auto flex items-center justify-between">
					<button
						type="button"
						onClick={onBack}
						className="flex items-center gap-2 px-4 py-3 text-muted-foreground hover:text-foreground transition-colors"
					>
						<ArrowLeft className="w-4 h-4" />
						Back
					</button>
					<button
						type="button"
						onClick={handleFinish}
						disabled={isSaving}
						className="flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
					>
						{isSaving ? (
							<>
								<StableSpinner title="Setting up defaults" />
								Setting up...
							</>
						) : (
							<>
								Start Using otto
								<Sparkles className="w-4 h-4" />
							</>
						)}
					</button>
				</div>
			</div>
		</div>
	);
});
