import { memo, useEffect, useState, useRef } from 'react';
import {
	Copy,
	Check,
	CreditCard,
	X,
	Key,
	ExternalLink,
	LogOut,
	ArrowRight,
	RefreshCw,
	Pencil,
	Plus,
	ChevronRight,
	Laptop,
	Globe,
	Search,
} from 'lucide-react';
import { ProviderLogo } from '../../common/ProviderLogo';
import { StableSpinner } from '../../ui/StableSpinner';
import type { AuthStatus } from '../../../stores/onboardingStore';
import { useOttoRouterStore } from '../../../stores/ottorouterStore';
import { useOttoRouterBalance } from '../../../hooks/useOttoRouterBalance';
import { openUrl } from '../../../lib/open-url';
import { apiClient } from '../../../lib/api-client';
import type {
	DiscoveredProviderModel,
	ProviderModelSettings,
	ProviderModelSettingsMap,
} from '../../../lib/api-client/config';

type CustomProviderCompatibility =
	| 'openai-compatible'
	| 'openai'
	| 'anthropic'
	| 'google'
	| 'openrouter'
	| 'ollama';

const CUSTOM_PROVIDER_COMPATIBILITY_OPTIONS: Array<{
	value: CustomProviderCompatibility;
	label: string;
}> = [
	{ value: 'openai-compatible', label: 'OpenAI-compatible' },
	{ value: 'openai', label: 'OpenAI' },
	{ value: 'anthropic', label: 'Anthropic' },
	{ value: 'google', label: 'Google' },
	{ value: 'openrouter', label: 'OpenRouter' },
	{ value: 'ollama', label: 'Ollama' },
];

function formatTokenCount(tokens: number): string {
	if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
	if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`;
	return String(tokens);
}

function buildCustomProviderModelMap(
	modelIds: string[],
	discoveredModels: DiscoveredProviderModel[],
): ProviderModelSettingsMap {
	const discoveredById = new Map(
		discoveredModels.map((model) => [model.id, model]),
	);
	const models: ProviderModelSettingsMap = {};

	for (const modelId of modelIds) {
		const id = modelId.trim();
		if (!id || models[id]) continue;

		const discovered = discoveredById.get(id);
		const entry: ProviderModelSettings = {
			id,
			label: discovered?.label || id,
		};

		if (discovered?.toolCall !== undefined) {
			entry.toolCall = discovered.toolCall;
		}
		if (discovered?.reasoningText !== undefined) {
			entry.reasoningText = discovered.reasoningText;
		}
		if (discovered?.attachment !== undefined) {
			entry.attachment = discovered.attachment;
		}
		if (
			discovered?.contextWindow !== undefined ||
			discovered?.maxOutputTokens !== undefined
		) {
			entry.limit = {
				context: discovered.contextWindow,
				output: discovered.maxOutputTokens,
			};
		}

		models[id] = entry;
	}

	return models;
}

interface ProviderSetupStepProps {
	authStatus: AuthStatus;
	onAddProvider: (provider: string, apiKey: string) => Promise<unknown>;
	onAddCustomProvider: (data: {
		id: string;
		label: string;
		baseURL: string;
		apiKey?: string;
		compatibility: CustomProviderCompatibility;
		models: ProviderModelSettingsMap;
		allowAnyModel: boolean;
	}) => Promise<unknown>;
	onRemoveProvider: (provider: string) => Promise<unknown>;
	onStartOAuth: (provider: string, mode?: string) => Window | null;
	onStartOAuthManual: (
		provider: string,
		mode?: string,
	) => Promise<{ popup: Window | null; sessionId: string }>;
	onExchangeOAuthCode: (
		provider: string,
		code: string,
		sessionId: string,
	) => Promise<boolean>;
	onStartOpenAIDeviceFlow?: () => Promise<{
		sessionId: string;
		userCode: string;
		verificationUri: string;
		interval: number;
	}>;
	onPollOpenAIDeviceFlow?: (
		sessionId: string,
	) => Promise<{ status: 'complete' | 'pending' | 'error'; error?: string }>;
	onStartXaiDeviceFlow?: () => Promise<{
		sessionId: string;
		userCode: string;
		verificationUri: string;
		interval: number;
	}>;
	onPollXaiDeviceFlow?: (
		sessionId: string,
	) => Promise<{ status: 'complete' | 'pending' | 'error'; error?: string }>;
	onOpenTopup: () => void;
	onNext: () => void;
	manageMode?: boolean;
	onClose?: () => void;
	hideHeader?: boolean;
	onStartCopilotDeviceFlow?: () => Promise<{
		sessionId: string;
		userCode: string;
		verificationUri: string;
		interval: number;
	}>;
	onPollCopilotDeviceFlow?: (
		sessionId: string,
	) => Promise<{ status: 'complete' | 'pending' | 'error'; error?: string }>;
	onStartKimiDeviceFlow?: () => Promise<{
		sessionId: string;
		userCode: string;
		verificationUri: string;
		interval: number;
	}>;
	onPollKimiDeviceFlow?: (
		sessionId: string,
	) => Promise<{ status: 'complete' | 'pending' | 'error'; error?: string }>;
	onStartOttoRouterDeviceFlow?: () => Promise<{
		sessionId: string;
		userCode: string;
		verificationUri: string;
		interval: number;
	}>;
	onPollOttoRouterDeviceFlow?: (
		sessionId: string,
	) => Promise<{ status: 'complete' | 'pending' | 'error'; error?: string }>;
	onGetCopilotAuthMethods?: () => Promise<{
		oauth: boolean;
		token: boolean;
		ghImport: { available: boolean; authenticated: boolean; reason?: string };
	}>;
	onSaveCopilotToken?: (token: string) => Promise<{
		success: boolean;
		provider: string;
		source: 'token';
		modelCount: number;
		hasGpt52Codex: boolean;
		sampleModels: string[];
	}>;
	onImportCopilotTokenFromGh?: () => Promise<{
		success: boolean;
		provider: string;
		source: 'gh';
		modelCount: number;
		hasGpt52Codex: boolean;
		sampleModels: string[];
	}>;
	onGetCopilotDiagnostics?: () => Promise<{
		tokenSources: Array<{
			source: 'env' | 'stored';
			configured: boolean;
			modelCount?: number;
			hasGpt52Codex?: boolean;
			restrictedByOrgPolicy?: boolean;
			restrictedOrg?: string;
			error?: string;
		}>;
		methods: {
			oauth: boolean;
			token: boolean;
			ghImport: { available: boolean; authenticated: boolean; reason?: string };
		};
	}>;
}

export const ProviderSetupStep = memo(function ProviderSetupStep({
	authStatus,
	onAddProvider,
	onAddCustomProvider,
	onRemoveProvider,
	onStartOAuth,
	onStartOAuthManual,
	onExchangeOAuthCode,
	onStartOpenAIDeviceFlow,
	onPollOpenAIDeviceFlow,
	onStartXaiDeviceFlow,
	onPollXaiDeviceFlow,
	onOpenTopup,
	onNext,
	manageMode = false,
	onClose,
	hideHeader = false,
	onStartCopilotDeviceFlow,
	onPollCopilotDeviceFlow,
	onStartKimiDeviceFlow,
	onPollKimiDeviceFlow,
	onStartOttoRouterDeviceFlow,
	onPollOttoRouterDeviceFlow,
	onGetCopilotAuthMethods,
	onSaveCopilotToken,
	onImportCopilotTokenFromGh,
	onGetCopilotDiagnostics,
}: ProviderSetupStepProps) {
	const [isSettingUp, setIsSettingUp] = useState(false);
	const [addingProvider, setAddingProvider] = useState<string | null>(null);
	const [apiKeyInput, setApiKeyInput] = useState('');
	const [providerSearch, setProviderSearch] = useState('');
	const [isCustomProviderModalOpen, setIsCustomProviderModalOpen] =
		useState(false);
	const [customProviderId, setCustomProviderId] = useState('');
	const [customProviderLabel, setCustomProviderLabel] = useState('');
	const [customProviderBaseURL, setCustomProviderBaseURL] = useState('');
	const [customProviderApiKey, setCustomProviderApiKey] = useState('');
	const [customProviderModels, setCustomProviderModels] = useState<string[]>(
		[],
	);
	const [customProviderModelInput, setCustomProviderModelInput] = useState('');
	const [customProviderCompatibility, setCustomProviderCompatibility] =
		useState<CustomProviderCompatibility>('openai-compatible');
	const [customProviderAllowAnyModel, setCustomProviderAllowAnyModel] =
		useState(true);
	const [isAddingCustomProvider, setIsAddingCustomProvider] = useState(false);
	const [customProviderError, setCustomProviderError] = useState<string | null>(
		null,
	);
	const [editingCustomProvider, setEditingCustomProvider] = useState<
		string | null
	>(null);
	const [isLoadingCustomProviderEdit, setIsLoadingCustomProviderEdit] =
		useState(false);
	const [isDiscoveringCustomModels, setIsDiscoveringCustomModels] =
		useState(false);
	const [discoveredCustomModels, setDiscoveredCustomModels] = useState<
		DiscoveredProviderModel[]
	>([]);
	const [customProviderDiscoveryMessage, setCustomProviderDiscoveryMessage] =
		useState<string | null>(null);
	const [removingProvider, setRemovingProvider] = useState<string | null>(null);
	const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
	const [oauthSession, setOauthSession] = useState<{
		provider: string;
		sessionId: string | null;
		mode?: string;
		wasConfigured?: boolean;
	} | null>(null);
	const [oauthCodeInput, setOauthCodeInput] = useState('');
	const [isExchangingCode, setIsExchangingCode] = useState(false);
	const [isOpeningPopup, setIsOpeningPopup] = useState(false);
	const [openAIDevice, setOpenAIDevice] = useState<{
		sessionId: string;
		userCode: string;
		verificationUri: string;
		interval: number;
	} | null>(null);
	const [openAIPolling, setOpenAIPolling] = useState(false);
	const [openAIError, setOpenAIError] = useState<string | null>(null);
	const [openAICodeCopied, setOpenAICodeCopied] = useState(false);
	const [openAIModalOpen, setOpenAIModalOpen] = useState(false);
	const [openAIAuthMode, setOpenAIAuthMode] = useState<'choice' | 'device'>(
		'choice',
	);
	const [openAILoading, setOpenAILoading] = useState(false);
	const [xaiDevice, setXaiDevice] = useState<{
		sessionId: string;
		userCode: string;
		verificationUri: string;
		interval: number;
	} | null>(null);
	const [xaiPolling, setXaiPolling] = useState(false);
	const [xaiError, setXaiError] = useState<string | null>(null);
	const [xaiCodeCopied, setXaiCodeCopied] = useState(false);
	const [xaiModalOpen, setXaiModalOpen] = useState(false);
	const [xaiLoading, setXaiLoading] = useState(false);
	const [copilotDevice, setCopilotDevice] = useState<{
		sessionId: string;
		userCode: string;
		verificationUri: string;
		interval: number;
	} | null>(null);
	const [copilotPolling, setCopilotPolling] = useState(false);
	const [copilotError, setCopilotError] = useState<string | null>(null);
	const [copilotAuthMode, setCopilotAuthMode] = useState<'oauth' | 'token'>(
		'oauth',
	);
	const [copilotTokenInput, setCopilotTokenInput] = useState('');
	const [copilotTokenSaving, setCopilotTokenSaving] = useState(false);
	const [copilotGhImporting, setCopilotGhImporting] = useState(false);
	const [copilotAuthMethods, setCopilotAuthMethods] = useState<{
		oauth: boolean;
		token: boolean;
		ghImport: { available: boolean; authenticated: boolean; reason?: string };
	} | null>(null);
	const [copilotDiagnostics, setCopilotDiagnostics] = useState<{
		tokenSources: Array<{
			source: 'env' | 'stored';
			configured: boolean;
			modelCount?: number;
			hasGpt52Codex?: boolean;
			restrictedByOrgPolicy?: boolean;
			restrictedOrg?: string;
			error?: string;
		}>;
	} | null>(null);
	const [copilotCodeCopied, setCopilotCodeCopied] = useState(false);
	const [copilotModalOpen, setCopilotModalOpen] = useState(false);
	const [copilotLoading, setCopilotLoading] = useState(false);
	const [kimiDevice, setKimiDevice] = useState<{
		sessionId: string;
		userCode: string;
		verificationUri: string;
		interval: number;
	} | null>(null);
	const [kimiPolling, setKimiPolling] = useState(false);
	const [kimiError, setKimiError] = useState<string | null>(null);
	const [kimiCodeCopied, setKimiCodeCopied] = useState(false);
	const [kimiModalOpen, setKimiModalOpen] = useState(false);
	const [kimiLoading, setKimiLoading] = useState(false);
	const copilotPollRef = useRef<ReturnType<typeof setTimeout>>(undefined);
	const copilotCancelledRef = useRef(false);
	const copilotPollFnRef = useRef(onPollCopilotDeviceFlow);
	copilotPollFnRef.current = onPollCopilotDeviceFlow;
	const openAIPollRef = useRef<ReturnType<typeof setTimeout>>(undefined);
	const openAICancelledRef = useRef(false);
	const openAIPollFnRef = useRef(onPollOpenAIDeviceFlow);
	openAIPollFnRef.current = onPollOpenAIDeviceFlow;
	const xaiPollRef = useRef<ReturnType<typeof setTimeout>>(undefined);
	const xaiCancelledRef = useRef(false);
	const xaiPollFnRef = useRef(onPollXaiDeviceFlow);
	xaiPollFnRef.current = onPollXaiDeviceFlow;
	const kimiPollRef = useRef<ReturnType<typeof setTimeout>>(undefined);
	const kimiCancelledRef = useRef(false);
	const kimiPollFnRef = useRef(onPollKimiDeviceFlow);
	kimiPollFnRef.current = onPollKimiDeviceFlow;
	const balance = useOttoRouterStore((s) => s.balance);
	const payg = useOttoRouterStore((s) => s.payg);
	const subscription = useOttoRouterStore((s) => s.subscription);
	const isBalanceLoading = useOttoRouterStore((s) => s.isLoading);
	const setOttoRouterBalance = useOttoRouterStore((s) => s.setBalance);
	const setOttoRouterScope = useOttoRouterStore((s) => s.setScope);
	const setOttoRouterPayg = useOttoRouterStore((s) => s.setPayg);
	const setOttoRouterSubscription = useOttoRouterStore(
		(s) => s.setSubscription,
	);
	const setOttoRouterLimits = useOttoRouterStore((s) => s.setLimits);
	const apiKeyInputRef = useRef<HTMLInputElement>(null);
	const oauthCodeInputRef = useRef<HTMLInputElement>(null);
	const isTopupModalOpen = useOttoRouterStore((s) => s.isTopupModalOpen);
	const prevTopupModalOpen = useRef(false);
	const { fetchBalance } = useOttoRouterBalance('ottorouter');
	const effectivePayg = payg?.effectiveSpendableUsd ?? balance ?? 0;
	const ottorouterStatusLabel = subscription?.active
		? `Starter ${(subscription.creditsRemaining ?? 0).toFixed(1)} credits`
		: `$${effectivePayg.toFixed(2)}`;

	// Refetch balance when topup modal closes
	useEffect(() => {
		if (prevTopupModalOpen.current && !isTopupModalOpen) {
			// Modal was closed, refresh balance
			fetchBalance();
		}
		prevTopupModalOpen.current = isTopupModalOpen;
	}, [isTopupModalOpen, fetchBalance]);

	useEffect(() => {
		if (addingProvider && apiKeyInputRef.current) {
			apiKeyInputRef.current.focus();
		}
	}, [addingProvider]);

	useEffect(() => {
		if (oauthSession && oauthCodeInputRef.current) {
			oauthCodeInputRef.current.focus();
		}
	}, [oauthSession]);

	useEffect(() => {
		if (!oauthSession) return;
		if (oauthSession.wasConfigured) return;
		if (authStatus.providers[oauthSession.provider]?.configured) {
			setOauthSession(null);
			setOauthCodeInput('');
		}
	}, [authStatus.providers, oauthSession]);

	useEffect(() => {
		if (!copilotPolling || !copilotDevice || !copilotPollFnRef.current) return;
		copilotCancelledRef.current = false;
		const pollIntervalMs = Math.max(
			(copilotDevice.interval || 5) * 1000 + 2000,
			7000,
		);
		const schedulePoll = () => {
			copilotPollRef.current = setTimeout(async () => {
				if (copilotCancelledRef.current) return;
				try {
					const pollFn = copilotPollFnRef.current;
					if (!pollFn) return;
					const result = await pollFn(copilotDevice.sessionId);
					if (copilotCancelledRef.current) return;
					if (result.status === 'complete') {
						setCopilotDevice(null);
						setCopilotPolling(false);
						setCopilotError(null);
						setCopilotModalOpen(false);
					} else if (result.status === 'error') {
						setCopilotError(result.error || 'Authorization failed');
						setCopilotPolling(false);
					} else {
						schedulePoll();
					}
				} catch {
					if (!copilotCancelledRef.current) schedulePoll();
				}
			}, pollIntervalMs);
		};
		schedulePoll();
		const timeout = setTimeout(() => {
			setCopilotPolling(false);
			setCopilotError('Authorization timed out. Please try again.');
		}, 300000);
		return () => {
			copilotCancelledRef.current = true;
			if (copilotPollRef.current) clearTimeout(copilotPollRef.current);
			clearTimeout(timeout);
		};
	}, [copilotPolling, copilotDevice]);

	useEffect(() => {
		if (!openAIPolling || !openAIDevice || !openAIPollFnRef.current) return;
		openAICancelledRef.current = false;
		const pollIntervalMs = Math.max(
			(openAIDevice.interval || 5) * 1000 + 2000,
			7000,
		);
		const schedulePoll = () => {
			openAIPollRef.current = setTimeout(async () => {
				if (openAICancelledRef.current) return;
				try {
					const pollFn = openAIPollFnRef.current;
					if (!pollFn) return;
					const result = await pollFn(openAIDevice.sessionId);
					if (openAICancelledRef.current) return;
					if (result.status === 'complete') {
						setOpenAIDevice(null);
						setOpenAIPolling(false);
						setOpenAIError(null);
						setOpenAIModalOpen(false);
					} else if (result.status === 'error') {
						setOpenAIError(result.error || 'Authorization failed');
						setOpenAIPolling(false);
					} else {
						schedulePoll();
					}
				} catch {
					if (!openAICancelledRef.current) schedulePoll();
				}
			}, pollIntervalMs);
		};
		schedulePoll();
		const timeout = setTimeout(
			() => {
				setOpenAIPolling(false);
				setOpenAIError('Authorization timed out. Please try again.');
			},
			15 * 60 * 1000,
		);
		return () => {
			openAICancelledRef.current = true;
			if (openAIPollRef.current) clearTimeout(openAIPollRef.current);
			clearTimeout(timeout);
		};
	}, [openAIPolling, openAIDevice]);

	useEffect(() => {
		if (!xaiPolling || !xaiDevice || !xaiPollFnRef.current) return;
		xaiCancelledRef.current = false;
		const pollIntervalMs = Math.max((xaiDevice.interval || 5) * 1000, 5000);
		const schedulePoll = () => {
			xaiPollRef.current = setTimeout(async () => {
				if (xaiCancelledRef.current) return;
				try {
					const pollFn = xaiPollFnRef.current;
					if (!pollFn) return;
					const result = await pollFn(xaiDevice.sessionId);
					if (xaiCancelledRef.current) return;
					if (result.status === 'complete') {
						setXaiDevice(null);
						setXaiPolling(false);
						setXaiError(null);
						setXaiModalOpen(false);
					} else if (result.status === 'error') {
						setXaiError(result.error || 'Authorization failed');
						setXaiPolling(false);
					} else {
						schedulePoll();
					}
				} catch {
					if (!xaiCancelledRef.current) schedulePoll();
				}
			}, pollIntervalMs);
		};
		schedulePoll();
		const timeout = setTimeout(
			() => {
				setXaiPolling(false);
				setXaiError('Authorization timed out. Please try again.');
			},
			15 * 60 * 1000,
		);
		return () => {
			xaiCancelledRef.current = true;
			if (xaiPollRef.current) clearTimeout(xaiPollRef.current);
			clearTimeout(timeout);
		};
	}, [xaiPolling, xaiDevice]);

	useEffect(() => {
		if (!kimiPolling || !kimiDevice || !kimiPollFnRef.current) return;
		kimiCancelledRef.current = false;
		const pollIntervalMs = Math.max(
			(kimiDevice.interval || 5) * 1000 + 2000,
			7000,
		);
		const schedulePoll = () => {
			kimiPollRef.current = setTimeout(async () => {
				if (kimiCancelledRef.current) return;
				try {
					const pollFn = kimiPollFnRef.current;
					if (!pollFn) return;
					const result = await pollFn(kimiDevice.sessionId);
					if (kimiCancelledRef.current) return;
					if (result.status === 'complete') {
						setKimiDevice(null);
						setKimiPolling(false);
						setKimiError(null);
						setKimiModalOpen(false);
					} else if (result.status === 'error') {
						setKimiError(result.error || 'Authorization failed');
						setKimiPolling(false);
					} else {
						schedulePoll();
					}
				} catch {
					if (!kimiCancelledRef.current) schedulePoll();
				}
			}, pollIntervalMs);
		};
		schedulePoll();
		const timeout = setTimeout(
			() => {
				setKimiPolling(false);
				setKimiError('Authorization timed out. Please try again.');
			},
			15 * 60 * 1000,
		);
		return () => {
			kimiCancelledRef.current = true;
			if (kimiPollRef.current) clearTimeout(kimiPollRef.current);
			clearTimeout(timeout);
		};
	}, [kimiPolling, kimiDevice]);

	const handleStartOttoRouterOAuth = async () => {
		if (!onStartOttoRouterDeviceFlow || !onPollOttoRouterDeviceFlow) return;
		setIsSettingUp(true);
		try {
			const device = await onStartOttoRouterDeviceFlow();
			openUrl(device.verificationUri);
			const timeoutAt = Date.now() + 15 * 60 * 1000;
			while (Date.now() < timeoutAt) {
				const result = await onPollOttoRouterDeviceFlow(device.sessionId);
				if (result.status === 'complete') {
					await fetchBalance();
					return;
				}
				if (result.status === 'error') {
					throw new Error(result.error ?? 'OttoRouter OAuth failed');
				}
				await new Promise((resolve) =>
					setTimeout(resolve, Math.max(1, device.interval) * 1000),
				);
			}
			throw new Error('OttoRouter OAuth timed out');
		} finally {
			setIsSettingUp(false);
		}
	};

	const handleAddProvider = async (providerId: string) => {
		if (!apiKeyInput.trim()) return;
		try {
			await onAddProvider(providerId, apiKeyInput.trim());
			setAddingProvider(null);
			setApiKeyInput('');
		} catch {}
	};

	const addCustomProviderModels = (rawValue: string) => {
		const models = rawValue
			.split(/[\n,]/)
			.map((model) => model.trim())
			.filter(Boolean);
		if (models.length === 0) return;
		setCustomProviderModels((current) => {
			const seen = new Set(current);
			const next = [...current];
			for (const model of models) {
				if (seen.has(model)) continue;
				seen.add(model);
				next.push(model);
			}
			return next;
		});
		setCustomProviderModelInput('');
	};

	const removeCustomProviderModel = (modelId: string) => {
		setCustomProviderModels((current) =>
			current.filter((model) => model !== modelId),
		);
	};

	const resetCustomProviderForm = () => {
		setCustomProviderId('');
		setCustomProviderLabel('');
		setCustomProviderBaseURL('');
		setCustomProviderApiKey('');
		setCustomProviderModels([]);
		setCustomProviderModelInput('');
		setCustomProviderCompatibility('openai-compatible');
		setCustomProviderAllowAnyModel(true);
		setCustomProviderError(null);
		setDiscoveredCustomModels([]);
		setCustomProviderDiscoveryMessage(null);
		setEditingCustomProvider(null);
		setIsLoadingCustomProviderEdit(false);
	};

	const handleCloseCustomProviderModal = () => {
		if (isAddingCustomProvider) return;
		setIsCustomProviderModalOpen(false);
		resetCustomProviderForm();
	};

	const handleEditCustomProvider = async (providerId: string) => {
		resetCustomProviderForm();
		setEditingCustomProvider(providerId);
		setIsCustomProviderModalOpen(true);
		setIsLoadingCustomProviderEdit(true);
		setCustomProviderId(providerId);
		setCustomProviderLabel(authStatus.providers[providerId]?.label || '');
		try {
			const [details, models] = await Promise.all([
				apiClient.getProviderDetails(),
				apiClient.getModels(providerId).catch(() => null),
			]);
			const detail = details.find((entry) => entry.id === providerId);
			if (detail?.label) setCustomProviderLabel(detail.label);
			setCustomProviderBaseURL(detail?.baseURL ?? '');
			const compatibility = detail?.compatibility;
			setCustomProviderCompatibility(
				CUSTOM_PROVIDER_COMPATIBILITY_OPTIONS.some(
					(option) => option.value === compatibility,
				)
					? (compatibility as CustomProviderCompatibility)
					: 'openai-compatible',
			);
			setCustomProviderAllowAnyModel(detail?.allowAnyModel ?? true);
			const modelList = models?.models ?? [];
			setCustomProviderModels(modelList.map((model) => model.id));
			setDiscoveredCustomModels(
				modelList.map((model) => ({
					id: model.id,
					label: model.label,
					toolCall: model.toolCall,
					reasoningText: model.reasoningText,
					vision: model.vision,
					attachment: model.attachment,
					contextWindow: model.contextWindow,
					maxOutputTokens: model.maxOutputTokens,
				})),
			);
		} catch (err) {
			setCustomProviderError(
				err instanceof Error ? err.message : 'Failed to load provider settings',
			);
		} finally {
			setIsLoadingCustomProviderEdit(false);
		}
	};

	const handleDiscoverCustomProviderModels = async () => {
		const baseURL = customProviderBaseURL.trim();
		if (!baseURL) {
			setCustomProviderDiscoveryMessage('Enter a base URL first.');
			return;
		}

		setIsDiscoveringCustomModels(true);
		setCustomProviderDiscoveryMessage(null);
		try {
			const result = await apiClient.discoverProviderModels({
				compatibility: customProviderCompatibility,
				baseURL,
				apiKey: customProviderApiKey.trim() || undefined,
			});

			if (result.baseURL) setCustomProviderBaseURL(result.baseURL);
			setDiscoveredCustomModels(result.models);
			if (result.models.length > 0) {
				addCustomProviderModels(
					result.models.map((model) => model.id).join('\n'),
				);
			}
			setCustomProviderDiscoveryMessage(
				result.message ||
					(result.models.length > 0
						? `Fetched ${result.models.length} model${
								result.models.length === 1 ? '' : 's'
							}.`
						: 'No models found.'),
			);
		} catch (err) {
			setDiscoveredCustomModels([]);
			setCustomProviderDiscoveryMessage(
				err instanceof Error ? err.message : 'Failed to fetch models',
			);
		} finally {
			setIsDiscoveringCustomModels(false);
		}
	};

	const handleAddCustomProvider = async () => {
		const id = customProviderId.trim();
		const label = customProviderLabel.trim() || id;
		const baseURL = customProviderBaseURL.trim();
		const apiKey = customProviderApiKey.trim();
		const modelIds = customProviderModels
			.map((model) => model.trim())
			.filter(Boolean);
		const models = buildCustomProviderModelMap(
			modelIds,
			discoveredCustomModels,
		);

		if (!id || !baseURL) {
			setCustomProviderError('Provider ID and base URL are required.');
			return;
		}

		setIsAddingCustomProvider(true);
		setCustomProviderError(null);
		try {
			await onAddCustomProvider({
				id,
				label,
				baseURL,
				apiKey: apiKey || undefined,
				compatibility: customProviderCompatibility,
				models,
				allowAnyModel: customProviderAllowAnyModel,
			});
			setIsCustomProviderModalOpen(false);
			resetCustomProviderForm();
		} catch (err) {
			setCustomProviderError(
				err instanceof Error
					? err.message
					: editingCustomProvider
						? 'Failed to save custom provider'
						: 'Failed to add custom provider',
			);
		} finally {
			setIsAddingCustomProvider(false);
		}
	};

	const handleRemoveProvider = async (providerId: string) => {
		if (confirmingDelete === providerId) {
			setRemovingProvider(providerId);
			try {
				await onRemoveProvider(providerId);
				if (providerId === 'ottorouter') {
					setOttoRouterBalance(null);
					setOttoRouterScope(null);
					setOttoRouterPayg(null);
					setOttoRouterSubscription(null);
					setOttoRouterLimits(null);
				}
			} finally {
				setRemovingProvider(null);
				setConfirmingDelete(null);
			}
		} else {
			setConfirmingDelete(providerId);
		}
	};

	const handleCancelDelete = () => {
		setConfirmingDelete(null);
	};

	const startCopilotDeviceAuthorization = () => {
		if (!onStartCopilotDeviceFlow) return;
		setCopilotLoading(true);
		setCopilotError(null);
		onStartCopilotDeviceFlow()
			.then((data) => {
				setCopilotDevice(data);
				setCopilotLoading(false);
			})
			.catch((err) => {
				setCopilotError(
					err instanceof Error ? err.message : 'Failed to start device flow',
				);
				setCopilotLoading(false);
			});
	};

	const startXaiDeviceAuthorization = () => {
		if (!onStartXaiDeviceFlow) return;
		setXaiLoading(true);
		setXaiError(null);
		onStartXaiDeviceFlow()
			.then((data) => {
				setXaiDevice(data);
				setXaiLoading(false);
			})
			.catch((err) => {
				setXaiError(
					err instanceof Error ? err.message : 'Failed to start device flow',
				);
				setXaiLoading(false);
			});
	};

	const startOpenAIDeviceAuthorization = () => {
		if (!onStartOpenAIDeviceFlow) return;
		setOpenAILoading(true);
		setOpenAIError(null);
		onStartOpenAIDeviceFlow()
			.then((data) => {
				setOpenAIDevice(data);
				setOpenAILoading(false);
			})
			.catch((err) => {
				setOpenAIError(
					err instanceof Error ? err.message : 'Failed to start device flow',
				);
				setOpenAILoading(false);
			});
	};

	const startKimiDeviceAuthorization = () => {
		if (!onStartKimiDeviceFlow) return;
		setKimiLoading(true);
		setKimiError(null);
		onStartKimiDeviceFlow()
			.then((data) => {
				setKimiDevice(data);
				setKimiLoading(false);
			})
			.catch((err) => {
				setKimiError(
					err instanceof Error ? err.message : 'Failed to start device flow',
				);
				setKimiLoading(false);
			});
	};

	const handleStartOAuth = async (providerId: string, mode?: string) => {
		if (providerId === 'anthropic') {
			setOauthSession({
				provider: providerId,
				sessionId: null,
				mode,
				wasConfigured: !!authStatus.providers[providerId]?.configured,
			});
		} else if (providerId === 'xai' && onStartXaiDeviceFlow) {
			setXaiPolling(false);
			setXaiDevice(null);
			setXaiError(null);
			setXaiCodeCopied(false);
			setXaiModalOpen(true);
			startXaiDeviceAuthorization();
		} else if (providerId === 'openai' && onStartOpenAIDeviceFlow) {
			setOpenAIPolling(false);
			setOpenAIDevice(null);
			setOpenAIError(null);
			setOpenAICodeCopied(false);
			setOpenAIAuthMode('choice');
			setOpenAIModalOpen(true);
		} else if (providerId === 'kimi' && onStartKimiDeviceFlow) {
			setKimiPolling(false);
			setKimiDevice(null);
			setKimiError(null);
			setKimiCodeCopied(false);
			setKimiModalOpen(true);
			startKimiDeviceAuthorization();
		} else if (providerId === 'copilot') {
			setCopilotAuthMode('oauth');
			setCopilotTokenInput('');
			setCopilotDiagnostics(null);
			setCopilotAuthMethods(null);
			setCopilotPolling(false);
			setCopilotDevice(null);
			setCopilotError(null);
			setCopilotModalOpen(true);

			if (onGetCopilotAuthMethods) {
				onGetCopilotAuthMethods()
					.then((methods) => setCopilotAuthMethods(methods))
					.catch(() => {});
			}

			if (onGetCopilotDiagnostics) {
				onGetCopilotDiagnostics()
					.then((diagnostics) => setCopilotDiagnostics(diagnostics))
					.catch(() => {});
			}

			startCopilotDeviceAuthorization();
		} else {
			onStartOAuth(providerId, mode);
		}
	};

	const handleOpenPopup = async () => {
		if (!oauthSession) return;
		setIsOpeningPopup(true);
		try {
			const { sessionId } = await onStartOAuthManual(
				oauthSession.provider,
				oauthSession.mode,
			);
			setOauthSession({ ...oauthSession, sessionId });
		} catch (err) {
			console.error('Failed to start OAuth:', err);
		}
		setIsOpeningPopup(false);
	};

	const handleExchangeCode = async () => {
		if (!oauthSession || !oauthSession.sessionId || !oauthCodeInput.trim())
			return;
		setIsExchangingCode(true);
		try {
			await onExchangeOAuthCode(
				oauthSession.provider,
				oauthCodeInput.trim(),
				oauthSession.sessionId,
			);
			setOauthSession(null);
			setOauthCodeInput('');
		} catch {}
		setIsExchangingCode(false);
	};

	const handleCancelOAuth = () => {
		setOauthSession(null);
		setOauthCodeInput('');
	};

	const handleOpenAIOpenAuth = () => {
		if (!openAIDevice) return;
		openUrl(openAIDevice.verificationUri);
		setOpenAIPolling(true);
	};

	const handleOpenAIDeviceChoice = () => {
		setOpenAIAuthMode('device');
		startOpenAIDeviceAuthorization();
	};

	const handleOpenAILocalCallbackChoice = () => {
		handleCancelOpenAI();
		onStartOAuth('openai');
	};

	const handleXaiOpenAuth = () => {
		if (!xaiDevice) return;
		openUrl(xaiDevice.verificationUri);
		setXaiPolling(true);
	};

	const handleXaiCopyCode = async () => {
		if (!xaiDevice) return;
		await navigator.clipboard.writeText(xaiDevice.userCode);
		setXaiCodeCopied(true);
		setTimeout(() => setXaiCodeCopied(false), 2000);
	};

	const handleCancelXai = () => {
		setXaiDevice(null);
		setXaiPolling(false);
		setXaiError(null);
		setXaiCodeCopied(false);
		setXaiModalOpen(false);
		setXaiLoading(false);
		xaiCancelledRef.current = true;
		if (xaiPollRef.current) {
			clearTimeout(xaiPollRef.current);
			xaiPollRef.current = undefined;
		}
	};

	const handleOpenAICopyCode = async () => {
		if (!openAIDevice) return;
		await navigator.clipboard.writeText(openAIDevice.userCode);
		setOpenAICodeCopied(true);
		setTimeout(() => setOpenAICodeCopied(false), 2000);
	};

	const handleCancelOpenAI = () => {
		setOpenAIDevice(null);
		setOpenAIPolling(false);
		setOpenAIError(null);
		setOpenAICodeCopied(false);
		setOpenAIAuthMode('choice');
		setOpenAIModalOpen(false);
		setOpenAILoading(false);
		openAICancelledRef.current = true;
		if (openAIPollRef.current) {
			clearTimeout(openAIPollRef.current);
			openAIPollRef.current = undefined;
		}
	};

	const handleKimiOpenAuth = () => {
		if (!kimiDevice) return;
		openUrl(kimiDevice.verificationUri);
		setKimiPolling(true);
	};

	const handleKimiCopyCode = async () => {
		if (!kimiDevice) return;
		await navigator.clipboard.writeText(kimiDevice.userCode);
		setKimiCodeCopied(true);
		setTimeout(() => setKimiCodeCopied(false), 2000);
	};

	const handleCancelKimi = () => {
		setKimiDevice(null);
		setKimiPolling(false);
		setKimiError(null);
		setKimiCodeCopied(false);
		setKimiModalOpen(false);
		setKimiLoading(false);
		kimiCancelledRef.current = true;
		if (kimiPollRef.current) {
			clearTimeout(kimiPollRef.current);
			kimiPollRef.current = undefined;
		}
	};

	const handleCopilotOpenGithub = () => {
		if (!copilotDevice) return;
		openUrl(copilotDevice.verificationUri);
		setCopilotPolling(true);
	};

	const handleCopilotSwitchMode = (mode: 'oauth' | 'token') => {
		setCopilotAuthMode(mode);
		setCopilotError(null);
		if (mode === 'token') {
			setCopilotPolling(false);
		}
		if (mode === 'oauth' && !copilotDevice && !copilotLoading) {
			startCopilotDeviceAuthorization();
		}
	};

	const handleCopilotSaveToken = async () => {
		if (!copilotTokenInput.trim() || !onSaveCopilotToken) return;
		setCopilotTokenSaving(true);
		setCopilotError(null);
		try {
			await onSaveCopilotToken(copilotTokenInput.trim());
			handleCancelCopilot();
		} catch (err) {
			setCopilotError(
				err instanceof Error ? err.message : 'Failed to save Copilot token',
			);
		} finally {
			setCopilotTokenSaving(false);
		}
	};

	const handleCopilotImportFromGh = async () => {
		if (!onImportCopilotTokenFromGh) return;
		setCopilotGhImporting(true);
		setCopilotError(null);
		try {
			await onImportCopilotTokenFromGh();
			handleCancelCopilot();
		} catch (err) {
			setCopilotError(
				err instanceof Error
					? err.message
					: 'Failed to import token from GitHub CLI',
			);
		} finally {
			setCopilotGhImporting(false);
		}
	};

	const handleCopilotCopyCode = async () => {
		if (!copilotDevice) return;
		await navigator.clipboard.writeText(copilotDevice.userCode);
		setCopilotCodeCopied(true);
		setTimeout(() => setCopilotCodeCopied(false), 2000);
	};

	const handleCancelCopilot = () => {
		setCopilotDevice(null);
		setCopilotPolling(false);
		setCopilotError(null);
		setCopilotTokenInput('');
		setCopilotTokenSaving(false);
		setCopilotGhImporting(false);
		setCopilotAuthMode('oauth');
		setCopilotCodeCopied(false);
		setCopilotModalOpen(false);
		setCopilotLoading(false);
		copilotCancelledRef.current = true;
		if (copilotPollRef.current) {
			clearTimeout(copilotPollRef.current);
			copilotPollRef.current = undefined;
		}
	};

	useEffect(() => {
		const handleNativeBack = (event: Event) => {
			const customEvent = event as CustomEvent<{ handled?: boolean }>;
			if (!customEvent.detail || customEvent.detail.handled) return;

			const markHandled = () => {
				customEvent.detail.handled = true;
				event.preventDefault();
			};

			if (isCustomProviderModalOpen) {
				markHandled();
				if (!isAddingCustomProvider) {
					setIsCustomProviderModalOpen(false);
					setCustomProviderId('');
					setCustomProviderLabel('');
					setCustomProviderBaseURL('');
					setCustomProviderApiKey('');
					setCustomProviderModels([]);
					setCustomProviderModelInput('');
					setCustomProviderCompatibility('openai-compatible');
					setCustomProviderAllowAnyModel(true);
					setCustomProviderError(null);
					setDiscoveredCustomModels([]);
					setCustomProviderDiscoveryMessage(null);
					setEditingCustomProvider(null);
					setIsLoadingCustomProviderEdit(false);
				}
				return;
			}

			if (oauthSession) {
				markHandled();
				if (!isExchangingCode && !isOpeningPopup) {
					setOauthSession(null);
					setOauthCodeInput('');
				}
				return;
			}

			if (copilotModalOpen) {
				markHandled();
				if (!copilotTokenSaving && !copilotGhImporting && !copilotLoading) {
					setCopilotDevice(null);
					setCopilotPolling(false);
					setCopilotError(null);
					setCopilotTokenInput('');
					setCopilotTokenSaving(false);
					setCopilotGhImporting(false);
					setCopilotAuthMode('oauth');
					setCopilotCodeCopied(false);
					setCopilotModalOpen(false);
					setCopilotLoading(false);
					copilotCancelledRef.current = true;
					if (copilotPollRef.current) {
						clearTimeout(copilotPollRef.current);
						copilotPollRef.current = undefined;
					}
				}
				return;
			}

			if (kimiModalOpen) {
				markHandled();
				if (!kimiLoading) {
					setKimiDevice(null);
					setKimiPolling(false);
					setKimiError(null);
					setKimiCodeCopied(false);
					setKimiModalOpen(false);
					setKimiLoading(false);
					kimiCancelledRef.current = true;
					if (kimiPollRef.current) {
						clearTimeout(kimiPollRef.current);
						kimiPollRef.current = undefined;
					}
				}
				return;
			}

			if (addingProvider) {
				markHandled();
				setAddingProvider(null);
				setApiKeyInput('');
				return;
			}

			if (confirmingDelete) {
				markHandled();
				setConfirmingDelete(null);
			}
		};

		window.addEventListener('otto:native-back', handleNativeBack);
		return () =>
			window.removeEventListener('otto:native-back', handleNativeBack);
	}, [
		addingProvider,
		confirmingDelete,
		copilotGhImporting,
		copilotLoading,
		copilotModalOpen,
		copilotTokenSaving,
		isAddingCustomProvider,
		isCustomProviderModalOpen,
		isExchangingCode,
		isOpeningPopup,
		kimiLoading,
		kimiModalOpen,
		oauthSession,
	]);

	const configuredProviders = Object.entries(authStatus.providers).filter(
		([id, info]) =>
			(info.configured || info.custom === true) && id !== 'ottorouter',
	);
	const unconfiguredProviders = Object.entries(authStatus.providers).filter(
		([id, info]) =>
			!info.configured && info.custom !== true && id !== 'ottorouter',
	);
	const providerQuery = providerSearch.trim().toLowerCase();
	const filteredProviders = providerQuery
		? unconfiguredProviders.filter(
				([id, info]) =>
					info.label.toLowerCase().includes(providerQuery) ||
					id.toLowerCase().includes(providerQuery),
			)
		: unconfiguredProviders;
	const showCustomProviderCard =
		!providerQuery || 'custom provider'.includes(providerQuery);
	const canContinue =
		authStatus.ottorouter.configured ||
		Object.values(authStatus.providers).some((provider) => provider.configured);

	return (
		<div className="min-h-screen flex flex-col">
			{!hideHeader && (
				<div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-border">
					<div className="flex items-center gap-3">
						<ProviderLogo provider="ottorouter" size={24} />
						<span className="font-semibold text-foreground">otto</span>
					</div>
					{!manageMode && (
						<div className="flex items-center gap-2 text-sm text-muted-foreground">
							<span className="w-2 h-2 rounded-full bg-green-500" />
							Step 1 of 2
						</div>
					)}
				</div>
			)}
			{/* Main Content */}
			<div
				className={`flex-1 px-4 sm:px-6 lg:px-12 pb-32 ${hideHeader ? 'pt-8 sm:pt-10 lg:pt-14' : 'pt-6 sm:pt-8 lg:pt-12'}`}
			>
				<div className="max-w-5xl mx-auto">
					{/* Header */}
					<div className="mb-8">
						<h1 className="text-2xl sm:text-3xl font-semibold text-foreground mb-2">
							{manageMode ? 'Manage Providers' : 'Welcome to otto'}
						</h1>
						<p className="text-base text-muted-foreground max-w-2xl">
							{manageMode
								? 'Changes are saved automatically.'
								: 'Connect OttoRouter or bring your own API keys.'}
						</p>
					</div>

					{/* OttoRouter Hero */}
					{authStatus.ottorouter.configured ? (
						<div className="rounded-2xl border border-border bg-card mb-10">
							<div className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center gap-4">
								<div className="flex items-center gap-3 flex-1 min-w-0">
									<div className="flex items-center justify-center w-10 h-10 rounded-xl bg-muted shrink-0">
										<ProviderLogo provider="ottorouter" size={22} />
									</div>
									<div className="min-w-0">
										<div className="flex items-center gap-2">
											<span className="text-base font-semibold text-foreground">
												OttoRouter
											</span>
											<span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-green-500/10 text-xs font-medium text-green-600 dark:text-green-400">
												<span className="w-1.5 h-1.5 rounded-full bg-green-500" />
												Connected
											</span>
										</div>
										<button
											type="button"
											onClick={() => openUrl('https://ottorouter.org')}
											className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
										>
											ottorouter.org
											<ExternalLink className="w-3 h-3" />
										</button>
									</div>
								</div>

								<div className="flex items-center gap-2 sm:gap-3 flex-wrap">
									<div className="flex items-center gap-2 px-3 py-2 bg-muted/50 border border-border rounded-lg">
										<span className="font-mono text-sm font-semibold text-foreground">
											{ottorouterStatusLabel}
										</span>
										<button
											type="button"
											onClick={fetchBalance}
											disabled={isBalanceLoading}
											className="p-0.5 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
											aria-label="Refresh balance"
										>
											{isBalanceLoading ? (
												<StableSpinner size="xs" title="Refreshing balance" />
											) : (
												<RefreshCw className="w-3.5 h-3.5" />
											)}
										</button>
									</div>
									<button
										type="button"
										onClick={onOpenTopup}
										className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
									>
										<CreditCard className="w-4 h-4" />
										Top Up
									</button>
									{confirmingDelete === 'ottorouter' ? (
										<div className="flex items-center gap-1.5">
											<button
												type="button"
												onClick={() => handleRemoveProvider('ottorouter')}
												disabled={removingProvider === 'ottorouter'}
												className="flex items-center gap-1.5 px-3 py-2 bg-destructive text-destructive-foreground rounded-lg text-sm font-medium hover:bg-destructive/90 transition-colors disabled:opacity-50"
											>
												{removingProvider === 'ottorouter' ? (
													<StableSpinner size="sm" title="Signing out" />
												) : (
													<LogOut className="w-3.5 h-3.5" />
												)}
												Confirm
											</button>
											<button
												type="button"
												onClick={handleCancelDelete}
												className="px-3 py-2 bg-muted text-muted-foreground rounded-lg text-sm font-medium hover:bg-muted/80 transition-colors"
											>
												Cancel
											</button>
										</div>
									) : (
										<button
											type="button"
											onClick={() => handleRemoveProvider('ottorouter')}
											className="p-2 text-muted-foreground hover:text-red-500 hover:bg-red-500/10 rounded-lg transition-colors"
											aria-label="Sign out of OttoRouter"
											title="Sign out"
										>
											<LogOut className="w-4 h-4" />
										</button>
									)}
								</div>
							</div>
						</div>
					) : (
						<div className="rounded-2xl border border-primary/25 bg-card mb-10">
							<div className="p-5 sm:p-7 flex flex-col lg:flex-row lg:items-center gap-6 lg:gap-10">
								<div className="flex-1 min-w-0">
									<div className="flex flex-wrap items-center gap-2.5 mb-3">
										<ProviderLogo provider="ottorouter" size={22} />
										<span className="text-base font-semibold text-foreground">
											OttoRouter
										</span>
										<span className="px-2.5 py-0.5 rounded-full bg-primary/10 border border-primary/20 text-xs font-medium text-primary">
											Recommended
										</span>
									</div>
									<p className="text-sm text-muted-foreground mb-3 max-w-xl">
										One account for every top model. No API keys needed.
									</p>
									<button
										type="button"
										onClick={() => openUrl('https://ottorouter.org')}
										className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
									>
										Open dashboard
										<ExternalLink className="w-3.5 h-3.5" />
									</button>
								</div>

								<div className="lg:w-72 shrink-0">
									<div className="space-y-2">
										<button
											type="button"
											onClick={handleStartOttoRouterOAuth}
											disabled={
												isSettingUp ||
												!onStartOttoRouterDeviceFlow ||
												!onPollOttoRouterDeviceFlow
											}
											className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-primary text-primary-foreground rounded-xl text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50"
										>
											{isSettingUp ? (
												<StableSpinner
													size="sm"
													title="Connecting OttoRouter"
												/>
											) : (
												<ExternalLink className="w-4 h-4" />
											)}
											Sign in with OttoRouter
										</button>
										<p className="text-xs text-muted-foreground text-center">
											Opens your browser to authorize
										</p>
									</div>
								</div>
							</div>
						</div>
					)}

					{/* Configured Providers */}
					{configuredProviders.length > 0 && (
						<div className="mb-10">
							<div className="flex items-center justify-between mb-4">
								<h2 className="font-semibold text-foreground">
									Configured Providers
								</h2>
								<span className="text-sm text-muted-foreground">
									{configuredProviders.length} configured
								</span>
							</div>
							<div className="flex flex-wrap gap-2">
								{configuredProviders.map(([id, info]) => (
									<div
										key={id}
										className={`flex items-center gap-2 pl-3 pr-2 py-2 rounded-full transition-all duration-200 ${
											confirmingDelete === id
												? 'bg-destructive/10 border border-destructive/30'
												: info.configured
													? 'group bg-green-500/10 border border-green-500/20'
													: 'group bg-amber-500/10 border border-amber-500/20'
										}`}
									>
										<ProviderLogo provider={id} size={16} />
										<span
											className={`text-sm font-medium transition-colors ${
												confirmingDelete === id
													? 'text-destructive'
													: info.configured
														? 'text-green-600 dark:text-green-400'
														: 'text-amber-600 dark:text-amber-400'
											}`}
										>
											{info.label}
										</span>
										{confirmingDelete !== id && (
											<span
												className={`text-xs ${
													info.configured
														? 'text-green-600/60 dark:text-green-500/60'
														: 'text-amber-600/70 dark:text-amber-500/70'
												}`}
											>
												{info.configured
													? info.type === 'oauth'
														? 'OAuth'
														: 'API'
													: 'Needs API key'}
											</span>
										)}
										{confirmingDelete === id ? (
											<div className="flex items-center gap-1 ml-1">
												<span className="text-xs text-destructive/80 mr-1">
													Remove?
												</span>
												<button
													type="button"
													onClick={() => handleRemoveProvider(id)}
													disabled={removingProvider === id}
													className="px-2 py-0.5 text-xs bg-destructive text-destructive-foreground rounded hover:bg-destructive/90 transition-colors disabled:opacity-50"
												>
													{removingProvider === id ? (
														<StableSpinner
															size="xs"
															title="Removing provider"
														/>
													) : (
														'Yes'
													)}
												</button>
												<button
													type="button"
													onClick={handleCancelDelete}
													className="px-2 py-0.5 text-xs bg-muted text-muted-foreground rounded hover:bg-muted/80 transition-colors"
												>
													No
												</button>
											</div>
										) : (
											id !== 'ottorouter' && (
												<div className="flex items-center max-w-0 opacity-0 -translate-x-1 overflow-hidden group-hover:max-w-24 group-hover:opacity-100 group-hover:translate-x-0 group-hover:ml-1 transition-all duration-300 ease-out">
													{info.custom && (
														<button
															type="button"
															onClick={() => handleEditCustomProvider(id)}
															title="Edit provider"
															className="p-1 text-green-600/40 dark:text-green-500/40 hover:text-green-600/80 dark:hover:text-green-500/80 transition-colors"
														>
															<Pencil className="w-3 h-3" />
														</button>
													)}
													{info.type === 'oauth' && info.supportsOAuth && (
														<button
															type="button"
															onClick={() =>
																handleStartOAuth(
																	id,
																	id === 'anthropic' ? 'max' : undefined,
																)
															}
															title="Re-authenticate"
															className="p-1 text-green-600/40 dark:text-green-500/40 hover:text-green-600/80 dark:hover:text-green-500/80 transition-colors"
														>
															<RefreshCw className="w-3 h-3" />
														</button>
													)}
													<button
														type="button"
														onClick={() => handleRemoveProvider(id)}
														title="Remove provider"
														className="p-1 text-green-600/40 dark:text-green-500/40 hover:text-red-500 dark:hover:text-red-400 transition-colors"
													>
														<X className="w-3 h-3" />
													</button>
												</div>
											)
										)}
									</div>
								))}
							</div>
						</div>
					)}

					{/* Add Providers */}
					<div>
						<div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 mb-4">
							<h2 className="font-semibold text-foreground">
								Bring Your Own Keys
							</h2>
							<div className="relative sm:w-64">
								<Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
								<input
									type="text"
									value={providerSearch}
									onChange={(e) => setProviderSearch(e.target.value)}
									placeholder="Search providers..."
									className="w-full h-9 pl-9 pr-3 bg-muted/50 border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground outline-none focus:border-foreground/30 transition-colors"
								/>
							</div>
						</div>

						{filteredProviders.length === 0 && !showCustomProviderCard ? (
							<div className="text-sm text-muted-foreground py-6 text-center border border-dashed border-border rounded-xl">
								No providers match "{providerSearch.trim()}"
							</div>
						) : (
							<div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-start">
								{filteredProviders.map(([id, info]) => (
									<div key={id}>
										{addingProvider === id ? (
											<div className="flex items-center gap-2 p-3 bg-card border border-ring rounded-xl overflow-hidden">
												<div className="shrink-0 flex items-center">
													<ProviderLogo provider={id} size={18} />
												</div>
												<input
													ref={apiKeyInputRef}
													type="password"
													value={apiKeyInput}
													onChange={(e) => setApiKeyInput(e.target.value)}
													placeholder={`${info.label} API key...`}
													className="flex-1 min-w-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground text-foreground"
													onKeyDown={(e) => {
														if (e.key === 'Enter') handleAddProvider(id);
														if (e.key === 'Escape') {
															setAddingProvider(null);
															setApiKeyInput('');
														}
													}}
												/>
												<button
													type="button"
													onClick={() => handleAddProvider(id)}
													disabled={!apiKeyInput.trim()}
													className="shrink-0 px-3 py-1.5 bg-primary text-primary-foreground text-sm font-medium rounded-lg disabled:opacity-50"
												>
													Add
												</button>
												<button
													type="button"
													onClick={() => {
														setAddingProvider(null);
														setApiKeyInput('');
													}}
													className="shrink-0 p-1.5 text-muted-foreground hover:text-foreground"
												>
													<X className="w-4 h-4" />
												</button>
											</div>
										) : (
											<div className="flex items-center justify-between p-3 bg-card border border-border hover:border-border/80 rounded-xl transition-colors gap-2">
												<div className="flex items-center gap-3 min-w-0">
													<ProviderLogo provider={id} size={20} />
													<div className="min-w-0">
														<div className="font-medium text-foreground truncate">
															{info.label}
														</div>
														<div className="text-xs text-muted-foreground">
															{info.modelCount} models
														</div>
													</div>
												</div>
												<div className="flex items-center gap-1">
													{id !== 'copilot' && (
														<button
															type="button"
															onClick={() => setAddingProvider(id)}
															className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors"
														>
															<Key className="w-3.5 h-3.5" />
															API
														</button>
													)}
													{info.supportsOAuth && (
														<button
															type="button"
															onClick={() =>
																handleStartOAuth(
																	id,
																	id === 'anthropic' ? 'max' : undefined,
																)
															}
															className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors"
														>
															<ExternalLink className="w-3.5 h-3.5" />
															{id === 'anthropic'
																? 'Pro'
																: id === 'copilot'
																	? 'Login'
																	: 'OAuth'}
														</button>
													)}
												</div>
											</div>
										)}
									</div>
								))}
								{showCustomProviderCard && (
									<button
										type="button"
										onClick={() => setIsCustomProviderModalOpen(true)}
										className="group flex items-center justify-between p-3 bg-card border border-dashed border-border hover:border-primary/60 hover:bg-primary/5 hover:shadow-sm rounded-xl transition-all gap-2 text-left cursor-pointer"
									>
										<div className="flex items-center gap-3 min-w-0">
											<span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-muted text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary transition-colors">
												<Plus className="w-3.5 h-3.5" />
											</span>
											<div className="min-w-0">
												<div className="font-medium text-foreground truncate">
													Custom Provider
												</div>
												<div className="text-xs text-muted-foreground group-hover:text-foreground/70 transition-colors">
													OpenAI-compatible or Ollama endpoint
												</div>
											</div>
										</div>
										<span className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-muted-foreground group-hover:text-primary group-hover:bg-primary/10 rounded-lg transition-colors">
											<Key className="w-3.5 h-3.5" />
											Add
										</span>
									</button>
								)}
							</div>
						)}
					</div>
				</div>
			</div>
			<div className="fixed bottom-0 left-0 right-0 px-4 sm:px-6 py-4 border-t border-border bg-background/70 backdrop-blur-md">
				<div className="max-w-5xl mx-auto flex items-center justify-between gap-4">
					{!manageMode && (
						<div className="flex items-center gap-2 text-xs sm:text-sm text-muted-foreground min-w-0">
							{canContinue ? (
								<>
									<Check className="w-4 h-4 text-green-500 shrink-0" />
									<span className="truncate">
										You're set — add more providers anytime in settings
									</span>
								</>
							) : (
								<span className="truncate">
									Connect at least one provider to continue
								</span>
							)}
						</div>
					)}
					{manageMode ? (
						<button
							type="button"
							onClick={onClose}
							className="flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 transition-colors ml-auto"
						>
							Done
						</button>
					) : (
						<button
							type="button"
							onClick={onNext}
							disabled={!canContinue}
							className="shrink-0 flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
						>
							Continue
							<ArrowRight className="w-4 h-4" />
						</button>
					)}
				</div>
			</div>

			{isCustomProviderModalOpen && (
				<div
					data-otto-nested-modal="true"
					className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm"
				>
					<div className="bg-background border border-border rounded-xl w-full max-w-2xl mx-6 shadow-2xl max-h-[90vh] overflow-y-auto">
						<div className="flex items-center gap-3 p-6 border-b border-border">
							<span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-muted text-muted-foreground">
								{editingCustomProvider ? (
									<Pencil className="w-3.5 h-3.5" />
								) : (
									<Plus className="w-4 h-4" />
								)}
							</span>
							<h3 className="text-lg font-semibold">
								{editingCustomProvider
									? 'Edit Custom Provider'
									: 'Add Custom Provider'}
							</h3>
							{isLoadingCustomProviderEdit && (
								<StableSpinner size="sm" title="Loading provider settings" />
							)}
						</div>
						<div className="p-6 space-y-4">
							<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
								<label className="space-y-2">
									<span className="text-sm font-medium text-foreground">
										Provider ID
									</span>
									<input
										type="text"
										value={customProviderId}
										onChange={(e) => setCustomProviderId(e.target.value)}
										placeholder="my-provider"
										disabled={!!editingCustomProvider}
										className="w-full h-11 px-4 bg-muted/50 border border-border rounded-lg text-foreground placeholder:text-muted-foreground outline-none focus:border-foreground/30 transition-colors font-mono text-sm disabled:opacity-60"
									/>
								</label>
								<label className="space-y-2">
									<span className="text-sm font-medium text-foreground">
										Display Name
									</span>
									<input
										type="text"
										value={customProviderLabel}
										onChange={(e) => setCustomProviderLabel(e.target.value)}
										placeholder="My Provider"
										className="w-full h-11 px-4 bg-muted/50 border border-border rounded-lg text-foreground placeholder:text-muted-foreground outline-none focus:border-foreground/30 transition-colors text-sm"
									/>
								</label>
							</div>

							<div className="flex items-center justify-between gap-3 p-3 bg-muted/30 border border-border rounded-lg">
								<div className="min-w-0">
									<div className="text-sm font-medium text-foreground">
										Fetch models from provider
									</div>
									<div className="text-xs text-muted-foreground">
										For Ollama, this reads /api/tags and /api/show to include
										context windows.
									</div>
								</div>
								<button
									type="button"
									onClick={handleDiscoverCustomProviderModels}
									disabled={
										!customProviderBaseURL.trim() || isDiscoveringCustomModels
									}
									className="shrink-0 px-3 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center gap-2"
								>
									{isDiscoveringCustomModels && (
										<StableSpinner size="sm" title="Fetching models" />
									)}
									Fetch Models
								</button>
							</div>

							{customProviderDiscoveryMessage && (
								<p className="text-xs text-muted-foreground">
									{customProviderDiscoveryMessage}
								</p>
							)}

							<label className="space-y-2 block">
								<span className="text-sm font-medium text-foreground">
									Base URL
								</span>
								<input
									type="url"
									value={customProviderBaseURL}
									onChange={(e) => setCustomProviderBaseURL(e.target.value)}
									placeholder="https://api.example.com/v1"
									className="w-full h-11 px-4 bg-muted/50 border border-border rounded-lg text-foreground placeholder:text-muted-foreground outline-none focus:border-foreground/30 transition-colors font-mono text-sm"
								/>
							</label>

							<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
								<label className="space-y-2">
									<span className="text-sm font-medium text-foreground">
										API Key
									</span>
									<input
										type="password"
										value={customProviderApiKey}
										onChange={(e) => setCustomProviderApiKey(e.target.value)}
										placeholder={
											editingCustomProvider
												? 'Leave blank to keep existing'
												: 'Optional'
										}
										className="w-full h-11 px-4 bg-muted/50 border border-border rounded-lg text-foreground placeholder:text-muted-foreground outline-none focus:border-foreground/30 transition-colors font-mono text-sm"
									/>
								</label>
								<label className="space-y-2">
									<span className="text-sm font-medium text-foreground">
										Compatibility
									</span>
									<select
										value={customProviderCompatibility}
										onChange={(e) =>
											setCustomProviderCompatibility(
												e.target.value as CustomProviderCompatibility,
											)
										}
										className="w-full h-11 px-4 bg-muted/50 border border-border rounded-lg text-foreground outline-none focus:border-foreground/30 transition-colors text-sm"
									>
										{CUSTOM_PROVIDER_COMPATIBILITY_OPTIONS.map((option) => (
											<option key={option.value} value={option.value}>
												{option.label}
											</option>
										))}
									</select>
								</label>
							</div>

							<div className="space-y-2">
								<div className="flex items-center justify-between gap-2">
									<span className="text-sm font-medium text-foreground">
										Models
									</span>
									<span className="text-xs text-muted-foreground">
										{customProviderModels.length} listed
									</span>
								</div>
								<div className="flex gap-2">
									<input
										type="text"
										value={customProviderModelInput}
										onChange={(e) =>
											setCustomProviderModelInput(e.target.value)
										}
										onKeyDown={(e) => {
											if (e.key !== 'Enter') return;
											e.preventDefault();
											addCustomProviderModels(customProviderModelInput);
										}}
										placeholder="gpt-4o or llama3.3"
										className="flex-1 h-11 px-4 bg-muted/50 border border-border rounded-lg text-foreground placeholder:text-muted-foreground outline-none focus:border-foreground/30 transition-colors font-mono text-sm"
									/>
									<button
										type="button"
										onClick={() =>
											addCustomProviderModels(customProviderModelInput)
										}
										disabled={!customProviderModelInput.trim()}
										className="shrink-0 h-11 px-3 bg-muted text-foreground rounded-lg text-sm font-medium hover:bg-muted/80 transition-colors disabled:opacity-50 flex items-center gap-1.5"
									>
										<Plus className="w-3.5 h-3.5" />
										Add
									</button>
								</div>
								<span className="block text-xs text-muted-foreground">
									Paste comma/newline lists to add multiple. Leave empty to
									allow any model.
								</span>

								<div className="space-y-2 max-h-48 overflow-y-auto border border-border rounded-lg p-2">
									{customProviderModels.length === 0 ? (
										<div className="p-3 text-sm text-muted-foreground bg-card rounded-md">
											No models listed yet. Fetch models or add one manually.
										</div>
									) : (
										customProviderModels.map((modelId) => {
											const discoveredModel = discoveredCustomModels.find(
												(model) => model.id === modelId,
											);
											return (
												<div
													key={modelId}
													className="flex items-center justify-between gap-3 p-2 bg-card rounded-md"
												>
													<div className="min-w-0">
														<div className="text-sm font-medium text-foreground truncate">
															{discoveredModel?.label ?? modelId}
														</div>
														{discoveredModel?.label &&
															discoveredModel.label !== modelId && (
																<div className="text-xs text-muted-foreground font-mono truncate">
																	{modelId}
																</div>
															)}
													</div>
													<div className="flex items-center justify-end gap-2 shrink-0">
														{discoveredModel && (
															<div className="flex flex-wrap justify-end gap-1">
																{discoveredModel.contextWindow && (
																	<span className="text-[10px] px-1.5 py-0.5 bg-blue-600/20 text-blue-400 rounded">
																		{formatTokenCount(
																			discoveredModel.contextWindow,
																		)}{' '}
																		ctx
																	</span>
																)}
																{discoveredModel.maxOutputTokens && (
																	<span className="text-[10px] px-1.5 py-0.5 bg-cyan-600/20 text-cyan-400 rounded">
																		{formatTokenCount(
																			discoveredModel.maxOutputTokens,
																		)}{' '}
																		out
																	</span>
																)}
																{discoveredModel.toolCall && (
																	<span className="text-[10px] px-1.5 py-0.5 bg-green-600/20 text-green-400 rounded">
																		Tools
																	</span>
																)}
																{discoveredModel.reasoningText && (
																	<span className="text-[10px] px-1.5 py-0.5 bg-purple-600/20 text-purple-400 rounded">
																		Reasoning
																	</span>
																)}
																{discoveredModel.vision && (
																	<span className="text-[10px] px-1.5 py-0.5 bg-orange-600/20 text-orange-400 rounded">
																		Vision
																	</span>
																)}
															</div>
														)}
														<button
															type="button"
															onClick={() => removeCustomProviderModel(modelId)}
															className="p-1 text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors"
															aria-label={`Remove ${modelId}`}
														>
															<X className="w-3.5 h-3.5" />
														</button>
													</div>
												</div>
											);
										})
									)}
								</div>
							</div>

							<label className="flex items-center gap-3 text-sm text-muted-foreground">
								<input
									type="checkbox"
									checked={customProviderAllowAnyModel}
									onChange={(e) =>
										setCustomProviderAllowAnyModel(e.target.checked)
									}
									className="h-4 w-4 accent-primary"
								/>
								Allow entering model IDs not listed above
							</label>

							{customProviderError && (
								<p className="text-sm text-red-500">{customProviderError}</p>
							)}

							<div className="flex gap-3 pt-2">
								<button
									type="button"
									onClick={handleCloseCustomProviderModal}
									disabled={isAddingCustomProvider}
									className="flex-1 h-11 px-4 bg-transparent border border-border text-foreground rounded-lg font-medium hover:bg-muted/50 transition-colors disabled:opacity-50"
								>
									Cancel
								</button>
								<button
									type="button"
									onClick={handleAddCustomProvider}
									disabled={
										!customProviderId.trim() ||
										!customProviderBaseURL.trim() ||
										isAddingCustomProvider ||
										isLoadingCustomProviderEdit
									}
									className="flex-1 h-11 px-4 bg-foreground text-background rounded-lg font-medium hover:bg-foreground/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
								>
									{isAddingCustomProvider ? (
										<StableSpinner
											title={
												editingCustomProvider
													? 'Saving provider'
													: 'Adding provider'
											}
										/>
									) : editingCustomProvider ? (
										'Save Changes'
									) : (
										'Add Provider'
									)}
								</button>
							</div>
						</div>
					</div>
				</div>
			)}

			{/* OAuth Code Modal */}
			{oauthSession && (
				<div
					data-otto-nested-modal="true"
					className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm"
				>
					<div className="bg-background border border-border rounded-xl w-full max-w-lg mx-6 shadow-2xl">
						<div className="flex items-center gap-3 p-6 border-b border-border">
							<ProviderLogo provider={oauthSession.provider} size={24} />
							<h3 className="text-lg font-semibold">
								Connect{' '}
								{authStatus.providers[oauthSession.provider]?.label ||
									oauthSession.provider}
							</h3>
						</div>

						{!oauthSession.sessionId ? (
							<div className="p-6">
								<p className="text-sm text-muted-foreground mb-6">
									You'll be redirected to{' '}
									{authStatus.providers[oauthSession.provider]?.label ||
										oauthSession.provider}{' '}
									to authorize access. If it does not return automatically,
									paste the authorization code here.
								</p>
								<div className="flex gap-3">
									<button
										type="button"
										onClick={handleCancelOAuth}
										className="flex-1 h-11 px-4 bg-transparent border border-border text-foreground rounded-lg font-medium hover:bg-muted/50 transition-colors"
									>
										Cancel
									</button>
									<button
										type="button"
										onClick={handleOpenPopup}
										disabled={isOpeningPopup}
										className="flex-1 h-11 px-4 bg-foreground text-background rounded-lg font-medium hover:bg-foreground/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
									>
										{isOpeningPopup ? (
											<StableSpinner title="Opening OAuth popup" />
										) : (
											<>
												Continue
												<ExternalLink className="w-4 h-4" />
											</>
										)}
									</button>
								</div>
							</div>
						) : (
							<div className="p-6">
								<p className="text-sm text-muted-foreground mb-4">
									Paste the authorization code:
								</p>
								<input
									type="text"
									ref={oauthCodeInputRef}
									value={oauthCodeInput}
									onChange={(e) => setOauthCodeInput(e.target.value)}
									placeholder="Paste authorization code..."
									className="w-full h-11 px-4 bg-muted/50 border border-border rounded-lg text-foreground placeholder:text-muted-foreground outline-none focus:border-foreground/30 transition-colors mb-4 font-mono text-sm"
									onKeyDown={(e) => {
										if (e.key === 'Enter') handleExchangeCode();
										if (e.key === 'Escape') handleCancelOAuth();
									}}
								/>
								<div className="flex gap-3">
									<button
										type="button"
										onClick={handleCancelOAuth}
										className="flex-1 h-11 px-4 bg-transparent border border-border text-foreground rounded-lg font-medium hover:bg-muted/50 transition-colors"
									>
										Cancel
									</button>
									<button
										type="button"
										onClick={handleExchangeCode}
										disabled={!oauthCodeInput.trim() || isExchangingCode}
										className="flex-1 h-11 px-4 bg-foreground text-background rounded-lg font-medium hover:bg-foreground/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
									>
										{isExchangingCode ? (
											<StableSpinner title="Connecting provider" />
										) : (
											'Connect'
										)}
									</button>
								</div>
							</div>
						)}
					</div>
				</div>
			)}

			{/* OpenAI Device Flow Modal */}
			{xaiModalOpen && (
				<div
					data-otto-nested-modal="true"
					className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm"
				>
					<div className="bg-background border border-border rounded-xl w-full max-w-lg mx-6 shadow-2xl">
						<div className="flex items-center gap-3 p-6 border-b border-border">
							<ProviderLogo provider="xai" size={24} />
							<h3 className="text-lg font-semibold">Connect xAI</h3>
						</div>
						<div className="p-6 space-y-4">
							<p className="text-sm text-muted-foreground">
								Open the xAI sign-in page, then confirm this one-time code. This
								works from remote browsers, tunnels, and SSH sessions.
							</p>
							<div className="flex items-center justify-center gap-3">
								{xaiLoading ? (
									<div className="bg-muted px-6 py-3 rounded-lg animate-pulse">
										<div className="h-9 w-48 bg-muted-foreground/20 rounded" />
									</div>
								) : xaiDevice ? (
									<>
										<code className="text-3xl font-mono font-bold tracking-widest text-foreground bg-muted px-6 py-3 rounded-lg select-all">
											{xaiDevice.userCode}
										</code>
										<button
											type="button"
											onClick={handleXaiCopyCode}
											className="p-2 text-muted-foreground hover:text-foreground transition-colors"
										>
											{xaiCodeCopied ? (
												<Check className="w-5 h-5 text-green-500" />
											) : (
												<Copy className="w-5 h-5" />
											)}
										</button>
									</>
								) : null}
							</div>

							{xaiError && (
								<p className="text-sm text-red-500 text-center">{xaiError}</p>
							)}

							{xaiPolling && (
								<div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
									<StableSpinner title="Waiting for xAI authorization" />
									Waiting for authorization...
								</div>
							)}

							<div className="flex gap-3">
								<button
									type="button"
									onClick={handleCancelXai}
									className="flex-1 h-11 px-4 bg-transparent border border-border text-foreground rounded-lg font-medium hover:bg-muted/50 transition-colors"
								>
									Cancel
								</button>
								<button
									type="button"
									onClick={handleXaiOpenAuth}
									disabled={xaiPolling || xaiLoading || !xaiDevice}
									className="flex-1 h-11 px-4 bg-foreground text-background rounded-lg font-medium hover:bg-foreground/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
								>
									{xaiPolling || xaiLoading ? (
										<StableSpinner title="Opening xAI" />
									) : (
										<>
											Open xAI
											<ExternalLink className="w-4 h-4" />
										</>
									)}
								</button>
							</div>
						</div>
					</div>
				</div>
			)}

			{/* OpenAI Device Flow Modal */}
			{openAIModalOpen && (
				<div
					data-otto-nested-modal="true"
					className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm"
				>
					<div className="bg-background border border-border rounded-xl w-full max-w-lg mx-6 shadow-2xl">
						<div className="flex items-center gap-3 p-6 border-b border-border">
							<ProviderLogo provider="openai" size={24} />
							<h3 className="text-lg font-semibold">Connect OpenAI</h3>
						</div>
						{openAIAuthMode === 'choice' ? (
							<div className="p-4 space-y-2">
								<button
									type="button"
									onClick={handleOpenAILocalCallbackChoice}
									className="group w-full flex items-center gap-3 p-3 rounded-lg hover:bg-muted/50 transition-colors text-left"
								>
									<div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">
										<Laptop className="w-4 h-4" />
									</div>
									<div className="min-w-0 flex-1">
										<div className="font-medium">Browser callback</div>
										<div className="text-xs text-muted-foreground">
											Same machine as otto
										</div>
									</div>
									<ChevronRight className="w-4 h-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
								</button>
								<button
									type="button"
									onClick={handleOpenAIDeviceChoice}
									className="group w-full flex items-center gap-3 p-3 rounded-lg hover:bg-muted/50 transition-colors text-left"
								>
									<div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">
										<Globe className="w-4 h-4" />
									</div>
									<div className="min-w-0 flex-1">
										<div className="font-medium">Device code</div>
										<div className="text-xs text-muted-foreground">
											Remote, tunnel, or SSH
										</div>
									</div>
									<ChevronRight className="w-4 h-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
								</button>
								<button
									type="button"
									onClick={handleCancelOpenAI}
									className="w-full h-10 mt-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
								>
									Cancel
								</button>
							</div>
						) : (
							<div className="p-6 space-y-4">
								<p className="text-sm text-muted-foreground">
									Open the device sign-in page, then enter this one-time code.
									This works from remote browsers, tunnels, and SSH sessions.
								</p>
								<div className="flex items-center justify-center gap-3">
									{openAILoading ? (
										<div className="bg-muted px-6 py-3 rounded-lg animate-pulse">
											<div className="h-9 w-48 bg-muted-foreground/20 rounded" />
										</div>
									) : openAIDevice ? (
										<>
											<code className="text-3xl font-mono font-bold tracking-widest text-foreground bg-muted px-6 py-3 rounded-lg select-all">
												{openAIDevice.userCode}
											</code>
											<button
												type="button"
												onClick={handleOpenAICopyCode}
												className="p-2 text-muted-foreground hover:text-foreground transition-colors"
											>
												{openAICodeCopied ? (
													<Check className="w-5 h-5 text-green-500" />
												) : (
													<Copy className="w-5 h-5" />
												)}
											</button>
										</>
									) : null}
								</div>

								{openAIError && (
									<p className="text-sm text-red-500 text-center">
										{openAIError}
									</p>
								)}

								{openAIPolling && (
									<div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
										<StableSpinner title="Waiting for OpenAI authorization" />
										Waiting for authorization...
									</div>
								)}

								<div className="flex gap-3">
									<button
										type="button"
										onClick={handleCancelOpenAI}
										className="flex-1 h-11 px-4 bg-transparent border border-border text-foreground rounded-lg font-medium hover:bg-muted/50 transition-colors"
									>
										Cancel
									</button>
									<button
										type="button"
										onClick={handleOpenAIOpenAuth}
										disabled={openAIPolling || openAILoading}
										className="flex-1 h-11 px-4 bg-foreground text-background rounded-lg font-medium hover:bg-foreground/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
									>
										{openAIPolling || openAILoading ? (
											<StableSpinner title="Opening OpenAI" />
										) : (
											<>
												Open OpenAI
												<ExternalLink className="w-4 h-4" />
											</>
										)}
									</button>
								</div>
							</div>
						)}
					</div>
				</div>
			)}

			{/* Kimi Device Flow Modal */}
			{kimiModalOpen && (
				<div
					data-otto-nested-modal="true"
					className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm"
				>
					<div className="bg-background border border-border rounded-xl w-full max-w-lg mx-6 shadow-2xl">
						<div className="flex items-center gap-3 p-6 border-b border-border">
							<ProviderLogo provider="kimi" size={24} />
							<h3 className="text-lg font-semibold">Connect Kimi</h3>
						</div>
						<div className="p-6 space-y-4">
							<p className="text-sm text-muted-foreground">
								Open the Kimi sign-in page, then enter this one-time code. This
								works from remote browsers, tunnels, and SSH sessions.
							</p>
							<div className="flex items-center justify-center gap-3">
								{kimiLoading ? (
									<div className="bg-muted px-6 py-3 rounded-lg animate-pulse">
										<div className="h-9 w-48 bg-muted-foreground/20 rounded" />
									</div>
								) : kimiDevice ? (
									<>
										<code className="text-3xl font-mono font-bold tracking-widest text-foreground bg-muted px-6 py-3 rounded-lg select-all">
											{kimiDevice.userCode}
										</code>
										<button
											type="button"
											onClick={handleKimiCopyCode}
											className="p-2 text-muted-foreground hover:text-foreground transition-colors"
										>
											{kimiCodeCopied ? (
												<Check className="w-5 h-5 text-green-500" />
											) : (
												<Copy className="w-5 h-5" />
											)}
										</button>
									</>
								) : null}
							</div>

							{kimiError && (
								<p className="text-sm text-red-500 text-center">{kimiError}</p>
							)}

							{kimiPolling && (
								<div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
									<StableSpinner title="Waiting for Kimi authorization" />
									Waiting for authorization...
								</div>
							)}

							<div className="flex gap-3">
								<button
									type="button"
									onClick={handleCancelKimi}
									className="flex-1 h-11 px-4 bg-transparent border border-border text-foreground rounded-lg font-medium hover:bg-muted/50 transition-colors"
								>
									Cancel
								</button>
								<button
									type="button"
									onClick={handleKimiOpenAuth}
									disabled={kimiPolling || kimiLoading}
									className="flex-1 h-11 px-4 bg-foreground text-background rounded-lg font-medium hover:bg-foreground/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
								>
									{kimiPolling || kimiLoading ? (
										<StableSpinner title="Opening Kimi" />
									) : (
										<>
											Open Kimi
											<ExternalLink className="w-4 h-4" />
										</>
									)}
								</button>
							</div>
						</div>
					</div>
				</div>
			)}

			{/* Copilot Device Flow Modal */}
			{copilotModalOpen && (
				<div
					data-otto-nested-modal="true"
					className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm"
				>
					<div className="bg-background border border-border rounded-xl w-full max-w-lg mx-6 shadow-2xl">
						<div className="flex items-center gap-3 p-6 border-b border-border">
							<ProviderLogo provider="copilot" size={24} />
							<h3 className="text-lg font-semibold">Connect GitHub Copilot</h3>
						</div>
						<div className="p-6 space-y-4">
							<div className="flex items-center gap-2">
								<button
									type="button"
									onClick={() => handleCopilotSwitchMode('oauth')}
									className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
										copilotAuthMode === 'oauth'
											? 'bg-foreground text-background'
											: 'bg-muted text-muted-foreground hover:text-foreground'
									}`}
								>
									OAuth
								</button>
								<button
									type="button"
									onClick={() => handleCopilotSwitchMode('token')}
									className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
										copilotAuthMode === 'token'
											? 'bg-foreground text-background'
											: 'bg-muted text-muted-foreground hover:text-foreground'
									}`}
								>
									Token
								</button>
							</div>

							{copilotAuthMode === 'oauth' ? (
								<>
									<p className="text-sm text-muted-foreground">
										Enter this code on GitHub to authorize:
									</p>
									<div className="flex items-center justify-center gap-3">
										{copilotLoading ? (
											<div className="bg-muted px-6 py-3 rounded-lg animate-pulse">
												<div className="h-9 w-48 bg-muted-foreground/20 rounded" />
											</div>
										) : copilotDevice ? (
											<>
												<code className="text-3xl font-mono font-bold tracking-widest text-foreground bg-muted px-6 py-3 rounded-lg select-all">
													{copilotDevice.userCode}
												</code>
												<button
													type="button"
													onClick={handleCopilotCopyCode}
													className="p-2 text-muted-foreground hover:text-foreground transition-colors"
												>
													{copilotCodeCopied ? (
														<Check className="w-5 h-5 text-green-500" />
													) : (
														<Copy className="w-5 h-5" />
													)}
												</button>
											</>
										) : null}
									</div>
								</>
							) : (
								<>
									<p className="text-sm text-muted-foreground">
										Paste a GitHub token with Copilot model access.
									</p>
									<input
										type="password"
										value={copilotTokenInput}
										onChange={(e) => setCopilotTokenInput(e.target.value)}
										placeholder="gho_..."
										className="w-full h-11 px-4 bg-muted/50 border border-border rounded-lg text-foreground placeholder:text-muted-foreground outline-none focus:border-foreground/30 transition-colors"
									/>
									{copilotAuthMethods?.ghImport.available && (
										<button
											type="button"
											onClick={handleCopilotImportFromGh}
											disabled={copilotGhImporting}
											className="w-full h-10 px-4 bg-muted text-foreground rounded-lg font-medium hover:bg-muted/80 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
										>
											{copilotGhImporting ? (
												<StableSpinner title="Importing from GH CLI" />
											) : (
												'Import from GH CLI'
											)}
										</button>
									)}
									{copilotAuthMethods?.ghImport.available &&
										!copilotAuthMethods.ghImport.authenticated && (
											<p className="text-xs text-muted-foreground">
												{copilotAuthMethods.ghImport.reason ||
													'GitHub CLI is not authenticated'}
											</p>
										)}
									{copilotAuthMethods &&
										!copilotAuthMethods.ghImport.available &&
										copilotAuthMethods.ghImport.reason && (
											<p className="text-xs text-muted-foreground">
												{copilotAuthMethods.ghImport.reason}
											</p>
										)}
								</>
							)}

							{copilotDiagnostics &&
								copilotDiagnostics.tokenSources.length > 0 && (
									<div className="text-xs text-muted-foreground space-y-1">
										{copilotDiagnostics.tokenSources.map((source) => (
											<div key={source.source}>
												{source.source}:{' '}
												{source.configured
													? source.error
														? source.error
														: `${source.modelCount ?? 0} models visible`
													: 'not configured'}
												{source.restrictedByOrgPolicy && source.restrictedOrg
													? ` (org restriction: ${source.restrictedOrg})`
													: ''}
											</div>
										))}
									</div>
								)}

							{copilotError && (
								<p className="text-sm text-red-500 text-center">
									{copilotError}
								</p>
							)}

							{copilotPolling && copilotAuthMode === 'oauth' && (
								<div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
									<StableSpinner title="Waiting for Copilot authorization" />
									Waiting for authorization...
								</div>
							)}

							<div className="flex gap-3">
								<button
									type="button"
									onClick={handleCancelCopilot}
									className="flex-1 h-11 px-4 bg-transparent border border-border text-foreground rounded-lg font-medium hover:bg-muted/50 transition-colors"
								>
									Cancel
								</button>
								{copilotAuthMode === 'oauth' ? (
									<button
										type="button"
										onClick={handleCopilotOpenGithub}
										disabled={copilotPolling || copilotLoading}
										className="flex-1 h-11 px-4 bg-foreground text-background rounded-lg font-medium hover:bg-foreground/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
									>
										{copilotPolling || copilotLoading ? (
											<StableSpinner title="Opening GitHub" />
										) : (
											<>
												Open GitHub
												<ExternalLink className="w-4 h-4" />
											</>
										)}
									</button>
								) : (
									<button
										type="button"
										onClick={handleCopilotSaveToken}
										disabled={!copilotTokenInput.trim() || copilotTokenSaving}
										className="flex-1 h-11 px-4 bg-foreground text-background rounded-lg font-medium hover:bg-foreground/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
									>
										{copilotTokenSaving ? (
											<StableSpinner title="Saving token" />
										) : (
											'Save token'
										)}
									</button>
								)}
							</div>
						</div>
					</div>
				</div>
			)}
		</div>
	);
});
