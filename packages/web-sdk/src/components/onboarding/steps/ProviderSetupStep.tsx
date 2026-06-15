import { memo, useEffect, useState, useRef } from 'react';
import {
	Copy,
	Check,
	CreditCard,
	X,
	Key,
	ExternalLink,
	ArrowRight,
	RefreshCw,
	Plus,
	ChevronRight,
	Laptop,
	Globe,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { ProviderLogo } from '../../common/ProviderLogo';
import { StableSpinner } from '../../ui/StableSpinner';
import type { AuthStatus } from '../../../stores/onboardingStore';
import { useOttoRouterStore } from '../../../stores/ottorouterStore';
import { useOttoRouterBalance } from '../../../hooks/useOttoRouterBalance';
import { openUrl } from '../../../lib/open-url';
import { apiClient } from '../../../lib/api-client';
import type { DiscoveredProviderModel } from '../../../lib/api-client/config';

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

interface ProviderSetupStepProps {
	authStatus: AuthStatus;
	onSetupWallet: () => Promise<unknown>;
	onImportWallet: (privateKey: string) => Promise<unknown>;
	onAddProvider: (provider: string, apiKey: string) => Promise<unknown>;
	onAddCustomProvider: (data: {
		id: string;
		label: string;
		baseURL: string;
		apiKey?: string;
		compatibility: CustomProviderCompatibility;
		models: string[];
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
	onSetupWallet,
	onImportWallet,
	onAddProvider,
	onAddCustomProvider,
	onRemoveProvider,
	onStartOAuth,
	onStartOAuthManual,
	onExchangeOAuthCode,
	onStartOpenAIDeviceFlow,
	onPollOpenAIDeviceFlow,
	onOpenTopup,
	onNext,
	manageMode = false,
	onClose,
	hideHeader = false,
	onStartCopilotDeviceFlow,
	onPollCopilotDeviceFlow,
	onStartKimiDeviceFlow,
	onPollKimiDeviceFlow,
	onGetCopilotAuthMethods,
	onSaveCopilotToken,
	onImportCopilotTokenFromGh,
	onGetCopilotDiagnostics,
}: ProviderSetupStepProps) {
	const [copied, setCopied] = useState(false);
	const [isSettingUp, setIsSettingUp] = useState(false);
	const [isImportModalOpen, setIsImportModalOpen] = useState(false);
	const [importPrivateKey, setImportPrivateKey] = useState('');
	const [isImportingWallet, setIsImportingWallet] = useState(false);
	const [importWalletError, setImportWalletError] = useState<string | null>(
		null,
	);
	const [addingProvider, setAddingProvider] = useState<string | null>(null);
	const [apiKeyInput, setApiKeyInput] = useState('');
	const [isCustomProviderModalOpen, setIsCustomProviderModalOpen] =
		useState(false);
	const [customProviderId, setCustomProviderId] = useState('');
	const [customProviderLabel, setCustomProviderLabel] = useState('');
	const [customProviderBaseURL, setCustomProviderBaseURL] = useState('');
	const [customProviderApiKey, setCustomProviderApiKey] = useState('');
	const [customProviderModels, setCustomProviderModels] = useState('');
	const [customProviderCompatibility, setCustomProviderCompatibility] =
		useState<CustomProviderCompatibility>('openai-compatible');
	const [customProviderAllowAnyModel, setCustomProviderAllowAnyModel] =
		useState(true);
	const [isAddingCustomProvider, setIsAddingCustomProvider] = useState(false);
	const [customProviderError, setCustomProviderError] = useState<string | null>(
		null,
	);
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
	const kimiPollRef = useRef<ReturnType<typeof setTimeout>>(undefined);
	const kimiCancelledRef = useRef(false);
	const kimiPollFnRef = useRef(onPollKimiDeviceFlow);
	kimiPollFnRef.current = onPollKimiDeviceFlow;
	const balance = useOttoRouterStore((s) => s.balance);
	const usdcBalance = useOttoRouterStore((s) => s.usdcBalance);
	const payg = useOttoRouterStore((s) => s.payg);
	const subscription = useOttoRouterStore((s) => s.subscription);
	const isBalanceLoading = useOttoRouterStore((s) => s.isLoading);
	const apiKeyInputRef = useRef<HTMLInputElement>(null);
	const oauthCodeInputRef = useRef<HTMLInputElement>(null);
	const importPrivateKeyRef = useRef<HTMLTextAreaElement>(null);
	const isTopupModalOpen = useOttoRouterStore((s) => s.isTopupModalOpen);
	const prevTopupModalOpen = useRef(false);
	const { fetchBalance } = useOttoRouterBalance('ottorouter');
	const effectivePayg = payg?.effectiveSpendableUsd ?? balance ?? 0;
	const ottorouterStatusLabel = subscription?.active
		? `GO ${(subscription.creditsRemaining ?? 0).toFixed(1)} credits`
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
		if (!authStatus.ottorouter.configured && !isSettingUp) {
			setIsSettingUp(true);
			onSetupWallet().finally(() => setIsSettingUp(false));
		}
	}, [authStatus.ottorouter.configured, onSetupWallet, isSettingUp]);

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
		if (isImportModalOpen && importPrivateKeyRef.current) {
			importPrivateKeyRef.current.focus();
		}
	}, [isImportModalOpen]);

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

	const handleCopy = async () => {
		if (authStatus.ottorouter.publicKey) {
			await navigator.clipboard.writeText(authStatus.ottorouter.publicKey);
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		}
	};

	const truncateAddress = (addr: string) =>
		`${addr.slice(0, 8)}...${addr.slice(-6)}`;

	const handleAddProvider = async (providerId: string) => {
		if (!apiKeyInput.trim()) return;
		try {
			await onAddProvider(providerId, apiKeyInput.trim());
			setAddingProvider(null);
			setApiKeyInput('');
		} catch {}
	};

	const resetCustomProviderForm = () => {
		setCustomProviderId('');
		setCustomProviderLabel('');
		setCustomProviderBaseURL('');
		setCustomProviderApiKey('');
		setCustomProviderModels('');
		setCustomProviderCompatibility('openai-compatible');
		setCustomProviderAllowAnyModel(true);
		setCustomProviderError(null);
		setDiscoveredCustomModels([]);
		setCustomProviderDiscoveryMessage(null);
	};

	const handleCloseCustomProviderModal = () => {
		if (isAddingCustomProvider) return;
		setIsCustomProviderModalOpen(false);
		resetCustomProviderForm();
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
				setCustomProviderModels(
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
		const models = customProviderModels
			.split(/[\n,]/)
			.map((model) => model.trim())
			.filter(Boolean);

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
				err instanceof Error ? err.message : 'Failed to add custom provider',
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
			setOauthSession({ provider: providerId, sessionId: null, mode });
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

	const handleOpenImportWallet = () => {
		setImportWalletError(null);
		setImportPrivateKey('');
		setIsImportModalOpen(true);
	};

	const handleCloseImportWallet = () => {
		if (isImportingWallet) return;
		setIsImportModalOpen(false);
		setImportWalletError(null);
		setImportPrivateKey('');
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
					setCustomProviderModels('');
					setCustomProviderCompatibility('openai-compatible');
					setCustomProviderAllowAnyModel(true);
					setCustomProviderError(null);
					setDiscoveredCustomModels([]);
					setCustomProviderDiscoveryMessage(null);
				}
				return;
			}

			if (isImportModalOpen) {
				markHandled();
				if (!isImportingWallet) {
					setIsImportModalOpen(false);
					setImportWalletError(null);
					setImportPrivateKey('');
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
		isImportingWallet,
		isImportModalOpen,
		isOpeningPopup,
		kimiLoading,
		kimiModalOpen,
		oauthSession,
	]);

	const handleImportWallet = async () => {
		if (!importPrivateKey.trim() || isImportingWallet) return;
		setIsImportingWallet(true);
		setImportWalletError(null);
		try {
			await onImportWallet(importPrivateKey.trim());
			setIsImportModalOpen(false);
			setImportPrivateKey('');
			fetchBalance();
		} catch (err) {
			setImportWalletError(
				err instanceof Error ? err.message : 'Failed to import wallet',
			);
		} finally {
			setIsImportingWallet(false);
		}
	};

	const configuredProviders = Object.entries(authStatus.providers).filter(
		([id, info]) => info.configured && id !== 'ottorouter',
	);
	const unconfiguredProviders = Object.entries(authStatus.providers).filter(
		([id, info]) => !info.configured && id !== 'ottorouter',
	);

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
				<div className="max-w-7xl mx-auto">
					{/* Header */}
					<div className="mb-10">
						<h1 className="text-2xl sm:text-3xl lg:text-4xl font-semibold text-foreground mb-3">
							{manageMode ? 'Manage Providers' : 'Welcome to otto'}
						</h1>
						<p className="text-lg text-muted-foreground max-w-2xl">
							{manageMode
								? 'Add or remove AI providers. Your changes are saved automatically.'
								: 'OttoRouter is your default AI provider. GO plan credits are applied automatically.'}
						</p>
					</div>

					<div className="grid grid-cols-1 sm:grid-cols-3 gap-6 sm:gap-8">
						{/* Left Column - Wallet */}
						<div>
							<div className="bg-card rounded-2xl border border-border p-5">
								{authStatus.ottorouter.configured &&
								authStatus.ottorouter.publicKey ? (
									<div className="flex flex-col h-full">
										{/* OttoRouter Default Provider Badge */}
										<div className="flex items-center gap-2 px-3 py-2 bg-green-500/10 border border-green-500/20 rounded-lg">
											<ProviderLogo provider="ottorouter" size={16} />
											<span className="text-sm font-medium text-green-600 dark:text-green-400">
												OttoRouter
											</span>
											<span className="text-xs text-green-600/60 dark:text-green-500/60 ml-auto">
												Default Provider
											</span>
										</div>

										<div className="flex justify-center py-4 mt-4">
											<div className="bg-white p-2 rounded-lg">
												<QRCodeSVG
													value={authStatus.ottorouter.publicKey}
													size={140}
													level="M"
												/>
											</div>
										</div>

										<div className="space-y-2 mt-4">
											<button
												type="button"
												onClick={handleCopy}
												className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-muted hover:bg-muted/80 rounded-lg text-xs font-mono text-muted-foreground transition-colors"
											>
												{truncateAddress(authStatus.ottorouter.publicKey)}
												{copied ? (
													<Check className="w-3.5 h-3.5 text-green-500" />
												) : (
													<Copy className="w-3.5 h-3.5 text-muted-foreground" />
												)}
											</button>

											<div className="space-y-1.5 px-3 py-2 bg-muted/50 rounded-lg">
												<div className="flex items-center justify-between gap-2">
													<div className="flex items-center gap-1.5 min-w-0">
														<span className="font-mono text-xs sm:text-sm text-foreground truncate">
															{ottorouterStatusLabel}
														</span>
													</div>
													<button
														type="button"
														onClick={fetchBalance}
														disabled={isBalanceLoading}
														className="p-0.5 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
													>
														{isBalanceLoading ? (
															<StableSpinner
																size="xs"
																title="Refreshing balance"
															/>
														) : (
															<RefreshCw className="w-3 h-3" />
														)}
													</button>
												</div>
												<span className="text-[10px] text-muted-foreground font-mono">
													Balance ${(balance ?? 0).toFixed(2)} • On-chain{' '}
													{(usdcBalance ?? 0).toFixed(2)} USDC
												</span>
											</div>
										</div>

										{/* OR Divider */}
										<div className="flex items-center gap-4 py-4">
											<div className="flex-1 h-px bg-border" />
											<span className="text-xs text-muted-foreground font-medium">
												OR
											</span>
											<div className="flex-1 h-px bg-border" />
										</div>

										<button
											type="button"
											onClick={onOpenTopup}
											className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
										>
											<CreditCard className="w-4 h-4" />
											Top Up with Card
										</button>

										<button
											type="button"
											onClick={handleOpenImportWallet}
											className="w-full mt-2 flex items-center justify-center gap-2 px-4 py-2.5 border border-border text-foreground rounded-lg text-sm font-medium hover:bg-muted/50 transition-colors"
										>
											<Key className="w-4 h-4" />
											Import Wallet
										</button>
									</div>
								) : (
									<div className="flex items-center justify-center py-16">
										<StableSpinner
											size="xl"
											className="text-muted-foreground"
											title="Loading OttoRouter wallet"
										/>
									</div>
								)}
							</div>
						</div>

						{/* Right Column - Providers */}
						<div className="sm:col-span-2 space-y-6">
							{/* Connected Providers */}
							<div>
								<div className="flex items-center justify-between mb-4">
									<h2 className="font-semibold text-foreground">
										Connected Providers
									</h2>
									{configuredProviders.length > 0 && (
										<span className="text-sm text-muted-foreground">
											{configuredProviders.length} active
										</span>
									)}
								</div>

								{configuredProviders.length === 0 ? (
									<div className="text-sm text-muted-foreground py-4">
										No providers connected yet. Add one below.
									</div>
								) : (
									<div className="flex flex-wrap gap-2">
										{configuredProviders.map(([id, info]) => (
											<div
												key={id}
												className={`flex items-center gap-2 pl-3 pr-2 py-2 rounded-full transition-all duration-200 ${
													confirmingDelete === id
														? 'bg-destructive/10 border border-destructive/30'
														: 'group bg-green-500/10 border border-green-500/20'
												}`}
											>
												<ProviderLogo provider={id} size={16} />
												<span
													className={`text-sm font-medium transition-colors ${
														confirmingDelete === id
															? 'text-destructive'
															: 'text-green-600 dark:text-green-400'
													}`}
												>
													{info.label}
												</span>
												{confirmingDelete !== id && (
													<span className="text-xs text-green-600/60 dark:text-green-500/60">
														{info.type === 'oauth' ? 'OAuth' : 'API'}
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
														<button
															type="button"
															onClick={() => handleRemoveProvider(id)}
															className="ml-1 p-1 text-green-600/40 dark:text-green-500/40 hover:text-green-600/80 dark:hover:text-green-500/80 opacity-0 group-hover:opacity-100 transition-opacity"
														>
															<X className="w-3 h-3" />
														</button>
													)
												)}
											</div>
										))}
									</div>
								)}
							</div>

							{/* Add Providers */}
							<div>
								<h2 className="font-semibold text-foreground mb-4">
									Add Providers
								</h2>
								<div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-start">
									{unconfiguredProviders.map(([id, info]) => (
										<div key={id}>
											{addingProvider === id ? (
												<div className="flex items-center gap-2 p-3 bg-card border border-ring rounded-xl overflow-hidden">
													<div className="shrink-0">
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
								</div>
							</div>
						</div>
					</div>
				</div>
			</div>

			{/* Bottom Bar */}
			<div className="fixed bottom-0 left-0 right-0 px-4 sm:px-6 py-4 border-t border-border bg-background">
				<div className="max-w-7xl mx-auto flex items-center justify-between">
					{!manageMode && (
						<div className="text-xs sm:text-sm text-muted-foreground hidden sm:block">
							You can add more providers later in settings
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
							className="flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 transition-colors"
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
								<Plus className="w-4 h-4" />
							</span>
							<h3 className="text-lg font-semibold">Add Custom Provider</h3>
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
										className="w-full h-11 px-4 bg-muted/50 border border-border rounded-lg text-foreground placeholder:text-muted-foreground outline-none focus:border-foreground/30 transition-colors font-mono text-sm"
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

							{discoveredCustomModels.length > 0 && (
								<div className="space-y-2 max-h-44 overflow-y-auto border border-border rounded-lg p-2">
									{discoveredCustomModels.map((model) => (
										<div
											key={model.id}
											className="flex items-center justify-between gap-3 p-2 bg-card rounded-md"
										>
											<div className="min-w-0">
												<div className="text-sm font-medium text-foreground truncate">
													{model.label}
												</div>
												<div className="text-xs text-muted-foreground font-mono truncate">
													{model.id}
												</div>
											</div>
											<div className="flex flex-wrap justify-end gap-1 shrink-0">
												{model.contextWindow && (
													<span className="text-[10px] px-1.5 py-0.5 bg-blue-600/20 text-blue-400 rounded">
														{formatTokenCount(model.contextWindow)} ctx
													</span>
												)}
												{model.maxOutputTokens && (
													<span className="text-[10px] px-1.5 py-0.5 bg-cyan-600/20 text-cyan-400 rounded">
														{formatTokenCount(model.maxOutputTokens)} out
													</span>
												)}
												{model.toolCall && (
													<span className="text-[10px] px-1.5 py-0.5 bg-green-600/20 text-green-400 rounded">
														Tools
													</span>
												)}
												{model.reasoningText && (
													<span className="text-[10px] px-1.5 py-0.5 bg-purple-600/20 text-purple-400 rounded">
														Reasoning
													</span>
												)}
												{model.vision && (
													<span className="text-[10px] px-1.5 py-0.5 bg-orange-600/20 text-orange-400 rounded">
														Vision
													</span>
												)}
											</div>
										</div>
									))}
								</div>
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
										placeholder="Optional"
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

							<label className="space-y-2 block">
								<span className="text-sm font-medium text-foreground">
									Models
								</span>
								<textarea
									value={customProviderModels}
									onChange={(e) => setCustomProviderModels(e.target.value)}
									placeholder="gpt-4o, claude-sonnet-4-5, llama3.3"
									className="w-full min-h-[90px] px-4 py-3 bg-muted/50 border border-border rounded-lg text-foreground placeholder:text-muted-foreground outline-none focus:border-foreground/30 transition-colors font-mono text-sm resize-y"
								/>
								<span className="text-xs text-muted-foreground">
									Comma or newline separated. Leave blank to allow any model.
								</span>
							</label>

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
										isAddingCustomProvider
									}
									className="flex-1 h-11 px-4 bg-foreground text-background rounded-lg font-medium hover:bg-foreground/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
								>
									{isAddingCustomProvider ? (
										<StableSpinner title="Adding provider" />
									) : (
										'Add Provider'
									)}
								</button>
							</div>
						</div>
					</div>
				</div>
			)}

			{isImportModalOpen && (
				<div
					data-otto-nested-modal="true"
					className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm"
				>
					<div className="bg-background border border-border rounded-xl w-full max-w-lg mx-6 shadow-2xl">
						<div className="flex items-center gap-3 p-6 border-b border-border">
							<ProviderLogo provider="ottorouter" size={24} />
							<h3 className="text-lg font-semibold">
								Import OttoRouter Wallet
							</h3>
						</div>
						<div className="p-6">
							<p className="text-sm text-muted-foreground mb-4">
								Paste your base58 private key to replace the current wallet used
								for OttoRouter.
							</p>
							<textarea
								ref={importPrivateKeyRef}
								value={importPrivateKey}
								onChange={(e) => setImportPrivateKey(e.target.value)}
								placeholder="Enter private key"
								className="w-full min-h-[110px] px-4 py-3 bg-muted/50 border border-border rounded-lg text-foreground placeholder:text-muted-foreground outline-none focus:border-foreground/30 transition-colors font-mono text-xs resize-y"
								onKeyDown={(e) => {
									if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
										e.preventDefault();
										handleImportWallet();
									}
									if (e.key === 'Escape') handleCloseImportWallet();
								}}
							/>
							{importWalletError && (
								<p className="text-sm text-red-500 mt-3">{importWalletError}</p>
							)}
							<div className="flex gap-3 mt-5">
								<button
									type="button"
									onClick={handleCloseImportWallet}
									disabled={isImportingWallet}
									className="flex-1 h-11 px-4 bg-transparent border border-border text-foreground rounded-lg font-medium hover:bg-muted/50 transition-colors disabled:opacity-50"
								>
									Cancel
								</button>
								<button
									type="button"
									onClick={handleImportWallet}
									disabled={!importPrivateKey.trim() || isImportingWallet}
									className="flex-1 h-11 px-4 bg-foreground text-background rounded-lg font-medium hover:bg-foreground/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
								>
									{isImportingWallet ? (
										<StableSpinner title="Importing wallet" />
									) : (
										'Import Wallet'
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
									to authorize access. After authorizing, copy the code and
									return here.
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
									placeholder="Paste code here..."
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
