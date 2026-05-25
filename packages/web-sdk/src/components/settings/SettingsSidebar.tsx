import { memo, useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
	Settings,
	ChevronRight,
	Wallet,
	Cpu,
	Zap,
	User,
	ChevronDown,
	RefreshCw,
	Plus,
	Pencil,
	Copy,
	Check,
	Key,
	Type,
	Sparkles,
	BarChart3,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { SidebarHeader } from '../ui/SidebarHeader';
import { StableSpinner } from '../ui/StableSpinner';
import { useSettingsStore } from '../../stores/settingsStore';
import { useOnboardingStore } from '../../stores/onboardingStore';
import { useAuthStatus } from '../../hooks/useAuthStatus';
import {
	useConfig,
	useAllModels,
	useUpdateDefaults,
} from '../../hooks/useConfig';
import { usePreferences } from '../../hooks/usePreferences';
import { useOttoRouterStore } from '../../stores/ottorouterStore';
import { OttoRouterTopupModal } from './OttoRouterTopupModal';
import { useOttoRouterBalance } from '../../hooks/useOttoRouterBalance';
import { useTopupCallback } from '../../hooks/useTopupCallback';
import { usePanelWidthStore } from '../../stores/panelWidthStore';
import { ResizeHandle } from '../ui/ResizeHandle';
import { apiClient } from '../../lib/api-client';
import {
	hasPlatformSystemFonts,
	listPlatformSystemFonts,
	isPlatformDesktop,
} from '../../lib/platform';

const SETTINGS_PANEL_KEY = 'settings';
const SETTINGS_DEFAULT_WIDTH = 320;
const SETTINGS_MIN_WIDTH = 320;
const SETTINGS_MAX_WIDTH = 500;
const DEFAULT_FONT_FAMILY = 'IBM Plex Mono';
const COMMON_SYSTEM_FONTS = [
	DEFAULT_FONT_FAMILY,
	'System UI',
	'Arial',
	'Avenir',
	'BlinkMacSystemFont',
	'Courier New',
	'Fira Code',
	'Georgia',
	'Helvetica',
	'Inter',
	'Menlo',
	'Monaco',
	'SF Mono',
	'Segoe UI',
	'Times New Roman',
	'Ubuntu',
	'Verdana',
];

interface LocalFontData {
	family: string;
}

interface LocalFontWindow extends Window {
	queryLocalFonts?: () => Promise<LocalFontData[]>;
}

interface SystemFontsResultMessage {
	type: 'otto-system-fonts-result';
	requestId: string;
	fonts?: string[];
	error?: string;
}

function requestDesktopSystemFonts(): Promise<string[] | null> {
	const platformFonts = listPlatformSystemFonts();
	if (platformFonts) return platformFonts;

	if (typeof window === 'undefined' || window.self === window.top) {
		return Promise.resolve(null);
	}

	return new Promise((resolve, reject) => {
		const requestId = crypto.randomUUID();
		const timeout = window.setTimeout(() => {
			window.removeEventListener('message', handleMessage);
			resolve(null);
		}, 3000);

		function handleMessage(event: MessageEvent<SystemFontsResultMessage>) {
			if (
				event.data?.type !== 'otto-system-fonts-result' ||
				event.data.requestId !== requestId
			) {
				return;
			}

			window.clearTimeout(timeout);
			window.removeEventListener('message', handleMessage);

			if (event.data.error) {
				reject(new Error(event.data.error));
				return;
			}

			resolve(event.data.fonts ?? null);
		}

		window.addEventListener('message', handleMessage);
		window.parent.postMessage(
			{ type: 'otto-list-system-fonts', requestId },
			'*',
		);
	});
}

interface SettingsSectionProps {
	title: string;
	icon: React.ReactNode;
	children: React.ReactNode;
	action?: React.ReactNode;
}

const SettingsSection = memo(function SettingsSection({
	title,
	icon,
	children,
	action,
}: SettingsSectionProps) {
	return (
		<div className="border-b border-border">
			<div className="px-4 py-3 flex items-center gap-2 bg-muted/30">
				{icon}
				<span className="text-sm font-medium flex-1">{title}</span>
				{action}
			</div>
			<div className="px-4 py-3 space-y-3">{children}</div>
		</div>
	);
});

interface SettingRowProps {
	label: string;
	value: React.ReactNode;
}

const SettingRow = memo(function SettingRow({ label, value }: SettingRowProps) {
	return (
		<div className="flex items-center justify-between text-sm">
			<span className="text-muted-foreground">{label}</span>
			<span className="font-mono text-foreground">{value}</span>
		</div>
	);
});

interface ToggleRowProps {
	label: string;
	checked: boolean;
	onChange: (checked: boolean) => void;
}

const ToggleRow = memo(function ToggleRow({
	label,
	checked,
	onChange,
}: ToggleRowProps) {
	return (
		<div className="flex min-w-0 items-center justify-between gap-3 text-sm">
			<span className="min-w-0 flex-1 truncate text-muted-foreground">
				{label}
			</span>
			<button
				type="button"
				role="switch"
				aria-checked={checked}
				onClick={() => onChange(!checked)}
				className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 ${
					checked ? 'bg-primary' : 'bg-muted'
				}`}
			>
				<span
					className={`inline-block h-4 w-4 transform rounded-full transition-transform ${
						checked ? 'translate-x-6' : 'translate-x-1'
					} ${checked ? 'bg-primary-foreground' : 'bg-foreground'}`}
				/>
			</button>
		</div>
	);
});

interface SelectRowProps {
	label: string;
	value: string;
	options: Array<{ id: string; label: string }>;
	onChange: (value: string) => void;
	disabled?: boolean;
}

const SelectRow = memo(function SelectRow({
	label,
	value,
	options,
	onChange,
	disabled,
}: SelectRowProps) {
	const [isOpen, setIsOpen] = useState(false);
	const [menuStyle, setMenuStyle] = useState<{
		top: number;
		left: number;
		width: number;
	} | null>(null);
	const buttonRef = useRef<HTMLButtonElement | null>(null);
	const selectedOption = options.find((o) => o.id === value);

	useEffect(() => {
		if (!isOpen || !buttonRef.current) return;
		const update = () => {
			const rect = buttonRef.current?.getBoundingClientRect();
			if (!rect) return;
			const width = Math.max(rect.width, 160);
			setMenuStyle({
				top: rect.bottom + 4,
				left: rect.right - width,
				width,
			});
		};
		update();
		window.addEventListener('scroll', update, true);
		window.addEventListener('resize', update);
		return () => {
			window.removeEventListener('scroll', update, true);
			window.removeEventListener('resize', update);
		};
	}, [isOpen]);

	return (
		<div className="flex items-center justify-between text-sm">
			<span className="text-muted-foreground">{label}</span>
			<div className="relative">
				<button
					ref={buttonRef}
					type="button"
					onClick={() => !disabled && setIsOpen(!isOpen)}
					disabled={disabled}
					className="flex items-center gap-1 px-2 py-1 text-xs font-mono bg-muted hover:bg-muted/80 rounded border border-border disabled:opacity-50"
				>
					<span className="max-w-[120px] truncate">
						{selectedOption?.label || value || 'Select...'}
					</span>
					<ChevronDown className="w-3 h-3" />
				</button>
				{isOpen &&
					menuStyle &&
					typeof document !== 'undefined' &&
					createPortal(
						<>
							{/* biome-ignore lint/a11y/noStaticElementInteractions: click-away backdrop pattern */}
							<div
								className="fixed inset-0 z-[10000]"
								onClick={() => setIsOpen(false)}
								role="presentation"
							/>
							<div
								className="fixed z-[10001] max-h-[240px] overflow-y-auto bg-popover border border-border rounded-md shadow-lg"
								style={{
									top: menuStyle.top,
									left: menuStyle.left,
									minWidth: menuStyle.width,
								}}
							>
								{options.map((option) => (
									<button
										key={option.id}
										type="button"
										onClick={() => {
											onChange(option.id);
											setIsOpen(false);
										}}
										className={`w-full px-3 py-2 text-left text-xs font-mono hover:bg-muted truncate ${
											option.id === value ? 'bg-muted/50' : ''
										}`}
									>
										{option.label}
									</button>
								))}
							</div>
						</>,
						document.body,
					)}
			</div>
		</div>
	);
});

interface FontPickerRowProps {
	value: string;
	onChange: (value: string) => void;
}

const FontPickerRow = memo(function FontPickerRow({
	value,
	onChange,
}: FontPickerRowProps) {
	const [isOpen, setIsOpen] = useState(false);
	const [search, setSearch] = useState('');
	const [localFonts, setLocalFonts] = useState<string[]>([]);
	const [isLoadingFonts, setIsLoadingFonts] = useState(false);
	const [fontError, setFontError] = useState<string | null>(null);
	const canQueryLocalFonts =
		typeof window !== 'undefined' &&
		typeof (window as LocalFontWindow).queryLocalFonts === 'function';
	const canRequestDesktopFonts =
		hasPlatformSystemFonts() ||
		(typeof window !== 'undefined' && window.self !== window.top);

	const fontOptions = useMemo(() => {
		return Array.from(
			new Set([value, ...localFonts, ...COMMON_SYSTEM_FONTS].filter(Boolean)),
		).sort((a, b) => a.localeCompare(b));
	}, [localFonts, value]);

	const filteredFonts = useMemo(() => {
		const query = search.trim().toLowerCase();
		if (!query) return fontOptions;
		return fontOptions.filter((font) => font.toLowerCase().includes(query));
	}, [fontOptions, search]);

	const loadLocalFonts = useCallback(async () => {
		if (isLoadingFonts || localFonts.length > 0) return;
		const queryLocalFonts = (window as LocalFontWindow).queryLocalFonts;

		setIsLoadingFonts(true);
		setFontError(null);
		try {
			if (queryLocalFonts) {
				const fonts = await queryLocalFonts();
				setLocalFonts(
					Array.from(new Set(fonts.map((font) => font.family).filter(Boolean))),
				);
				return;
			}

			const desktopFonts = await requestDesktopSystemFonts();
			if (desktopFonts?.length) {
				setLocalFonts(desktopFonts);
				return;
			}

			setFontError('Local font access is not supported in this browser');
		} catch (error) {
			setFontError(
				error instanceof Error ? error.message : 'Unable to load local fonts',
			);
		} finally {
			setIsLoadingFonts(false);
		}
	}, [isLoadingFonts, localFonts.length]);

	const openPicker = () => {
		setIsOpen(true);
		void loadLocalFonts();
	};

	return (
		<div className="space-y-2 text-sm">
			<div className="flex items-center justify-between gap-3">
				<span className="text-muted-foreground">UI Font</span>
				<div className="relative min-w-0">
					<button
						type="button"
						onClick={() => (isOpen ? setIsOpen(false) : openPicker())}
						className="flex max-w-[170px] items-center gap-1 rounded border border-border bg-muted px-2 py-1 text-xs hover:bg-muted/80"
					>
						<span className="truncate" style={{ fontFamily: value }}>
							{value || DEFAULT_FONT_FAMILY}
						</span>
						<ChevronDown className="h-3 w-3 shrink-0" />
					</button>
					{isOpen && (
						<>
							{/* biome-ignore lint/a11y/noStaticElementInteractions: click-away backdrop pattern */}
							<div
								className="fixed inset-0 z-40"
								onClick={() => setIsOpen(false)}
								role="presentation"
							/>
							<div className="absolute right-0 top-full z-50 mt-1 w-72 rounded-md border border-border bg-popover shadow-lg">
								<div className="border-b border-border p-2">
									<input
										type="search"
										value={search}
										onChange={(event) => setSearch(event.target.value)}
										placeholder="Search system fonts..."
										className="w-full rounded border border-border bg-background px-2 py-1.5 text-xs outline-none placeholder:text-muted-foreground/70 focus:border-primary"
									/>
								</div>
								<div className="max-h-64 overflow-y-auto py-1">
									{filteredFonts.map((font) => (
										<button
											key={font}
											type="button"
											onClick={() => {
												onChange(font);
												setIsOpen(false);
												setSearch('');
											}}
											className={`w-full px-3 py-2 text-left text-xs hover:bg-muted ${
												font === value ? 'bg-muted/50' : ''
											}`}
											style={{ fontFamily: font }}
										>
											{font}
										</button>
									))}
									{filteredFonts.length === 0 && (
										<div className="px-3 py-2 text-xs text-muted-foreground">
											No fonts found
										</div>
									)}
								</div>
								<div className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
									{isLoadingFonts
										? 'Loading local fonts...'
										: fontError
											? fontError
											: localFonts.length > 0
												? `${localFonts.length} local fonts found`
												: canQueryLocalFonts
													? 'Choose a font or allow local font access if prompted'
													: canRequestDesktopFonts
														? 'Loading desktop system fonts if available'
														: 'Showing common system fonts'}
								</div>
							</div>
						</>
					)}
				</div>
			</div>
		</div>
	);
});

interface NumberInputRowProps {
	label: string;
	value: number | null | undefined;
	onCommit: (value: number | null) => void;
	placeholder?: string;
	hint?: string;
	disabled?: boolean;
}

const NumberInputRow = memo(function NumberInputRow({
	label,
	value,
	onCommit,
	placeholder,
	hint,
	disabled,
}: NumberInputRowProps) {
	const [draft, setDraft] = useState(
		value !== null && value !== undefined ? String(value) : '',
	);

	useEffect(() => {
		setDraft(value !== null && value !== undefined ? String(value) : '');
	}, [value]);

	const persistedValue =
		value !== null && value !== undefined ? String(value) : '';
	const trimmedDraft = draft.trim();
	const parsedDraft = trimmedDraft
		? Number(trimmedDraft.replaceAll(',', ''))
		: null;
	const normalizedDraft =
		parsedDraft !== null && Number.isFinite(parsedDraft) && parsedDraft > 0
			? String(Math.floor(parsedDraft))
			: trimmedDraft === ''
				? ''
				: null;
	const hasChanges =
		normalizedDraft !== null && normalizedDraft !== persistedValue;

	const commit = useCallback(() => {
		if (normalizedDraft === null || normalizedDraft === persistedValue) {
			return;
		}

		setDraft(normalizedDraft);
		onCommit(normalizedDraft === '' ? null : Number(normalizedDraft));
	}, [normalizedDraft, onCommit, persistedValue]);

	return (
		<div className="space-y-1.5">
			<div className="flex min-w-0 items-center justify-between gap-3 text-sm">
				<span className="min-w-0 flex-1 truncate whitespace-nowrap text-muted-foreground">
					{label}
				</span>
				<div className="flex shrink-0 items-center gap-1 rounded border border-border bg-muted px-2 py-1 text-xs font-mono transition-colors focus-within:border-primary">
					<input
						type="text"
						inputMode="numeric"
						value={draft}
						onChange={(event) => setDraft(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === 'Enter') {
								event.preventDefault();
								commit();
							}
							if (event.key === 'Escape') {
								setDraft(persistedValue);
								event.currentTarget.blur();
							}
						}}
						placeholder={placeholder}
						disabled={disabled}
						className="w-24 bg-transparent text-right outline-none placeholder:text-muted-foreground/70 disabled:opacity-50"
					/>
					<button
						type="button"
						onClick={commit}
						disabled={disabled || !hasChanges}
						className="inline-flex items-center justify-center text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
						aria-label={`Save ${label}`}
					>
						<Check className="h-4 w-4" />
					</button>
				</div>
			</div>
			{hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
		</div>
	);
});

interface PreferencesModalProps {
	isOpen: boolean;
	onClose: () => void;
}

function PreferencesModal({ isOpen, onClose }: PreferencesModalProps) {
	const { data: config } = useConfig();
	const { preferences, updatePreferences } = usePreferences();
	const updateDefaults = useUpdateDefaults();
	const isDesktop = isPlatformDesktop();

	return (
		<Modal isOpen={isOpen} onClose={onClose} title="Preferences" maxWidth="lg">
			<div className="-m-6">
				<SettingsSection
					title="Editor"
					icon={<Type className="w-4 h-4 text-muted-foreground" />}
				>
					<ToggleRow
						label="Vim Mode"
						checked={preferences.vimMode}
						onChange={(checked) => updatePreferences({ vimMode: checked })}
					/>
					<ToggleRow
						label="Compact Thread"
						checked={preferences.compactThread}
						onChange={(checked) =>
							updatePreferences({ compactThread: checked })
						}
					/>
					<ToggleRow
						label="Full Width Content"
						checked={preferences.fullWidthContent}
						onChange={(checked) =>
							updatePreferences({ fullWidthContent: checked })
						}
					/>
					{isDesktop ? (
						<ToggleRow
							label="Smart Sidebar Edges"
							checked={preferences.smartEdges}
							onChange={(checked) => updatePreferences({ smartEdges: checked })}
						/>
					) : null}
					<FontPickerRow
						value={preferences.fontFamily}
						onChange={(fontFamily) => updatePreferences({ fontFamily })}
					/>
				</SettingsSection>

				<SettingsSection
					title="Automation"
					icon={<Zap className="w-4 h-4 text-muted-foreground" />}
				>
					<NumberInputRow
						label="Auto Compact"
						value={config?.defaults?.autoCompactThresholdTokens}
						onCommit={(value) =>
							updateDefaults.mutate({
								autoCompactThresholdTokens: value,
								scope: 'global',
							})
						}
						placeholder="Tokens"
						disabled={updateDefaults.isPending}
					/>
					<SelectRow
						label="Tool Approval"
						value={config?.defaults?.toolApproval ?? 'dangerous'}
						options={[
							{ id: 'auto', label: 'Auto (no approval)' },
							{ id: 'dangerous', label: 'Dangerous only' },
							{ id: 'yolo', label: 'YOLO (hard blocks only)' },
							{ id: 'all', label: 'All tools' },
						]}
						onChange={(value) =>
							updateDefaults.mutate({
								toolApproval: value as 'auto' | 'dangerous' | 'all' | 'yolo',
								scope: 'global',
							})
						}
						disabled={updateDefaults.isPending}
					/>
					<ToggleRow
						label="Guided Mode"
						checked={config?.defaults?.guidedMode ?? false}
						onChange={(checked) =>
							updateDefaults.mutate({
								guidedMode: checked,
								scope: 'global',
							})
						}
					/>
				</SettingsSection>

				<SettingsSection
					title="Reasoning"
					icon={<Sparkles className="w-4 h-4 text-muted-foreground" />}
				>
					<ToggleRow
						label="Show Reasoning"
						checked={config?.defaults?.reasoningText ?? true}
						onChange={(checked) =>
							updateDefaults.mutate({
								reasoningText: checked,
								scope: 'global',
							})
						}
					/>
					<SelectRow
						label="Reasoning Level"
						value={config?.defaults?.reasoningLevel ?? 'high'}
						options={[
							{ id: 'minimal', label: 'Minimal' },
							{ id: 'low', label: 'Low' },
							{ id: 'medium', label: 'Medium' },
							{ id: 'high', label: 'High' },
							{ id: 'max', label: 'Max' },
							{ id: 'xhigh', label: 'Extra High' },
						]}
						onChange={(value) =>
							updateDefaults.mutate({
								reasoningLevel: value as
									| 'minimal'
									| 'low'
									| 'medium'
									| 'high'
									| 'max'
									| 'xhigh',
								scope: 'global',
							})
						}
						disabled={updateDefaults.isPending}
					/>
				</SettingsSection>
			</div>
		</Modal>
	);
}

interface SettingsSidebarProps {
	/**
	 * Override navigation for the "Usage Dashboard" button. When provided,
	 * this is called instead of `window.location.assign('/dashboard')` so
	 * embedders (e.g. the Tauri desktop app, which has no URL routing) can
	 * render the dashboard inline.
	 */
	onOpenDashboard?: () => void;
}

export const SettingsSidebar = memo(function SettingsSidebar({
	onOpenDashboard,
}: SettingsSidebarProps = {}) {
	const isExpanded = useSettingsStore((state) => state.isExpanded);
	const collapseSidebar = useSettingsStore((state) => state.collapseSidebar);
	const [isPreferencesOpen, setIsPreferencesOpen] = useState(false);
	const panelWidth = usePanelWidthStore(
		(s) => s.widths[SETTINGS_PANEL_KEY] ?? SETTINGS_DEFAULT_WIDTH,
	);

	const { data: config } = useConfig();
	const { data: allModels } = useAllModels();
	const updateDefaults = useUpdateDefaults();
	const ottorouterBalance = useOttoRouterStore((s) => s.balance);
	const ottorouterWallet = useOttoRouterStore((s) => s.walletAddress);
	const ottorouterUsdcBalance = useOttoRouterStore((s) => s.usdcBalance);
	const ottorouterLoading = useOttoRouterStore((s) => s.isLoading);
	const openTopupModal = useOttoRouterStore((s) => s.openTopupModal);

	// Handle topup success callback from Polar checkout redirect
	useTopupCallback();

	const hasSetu = config?.providers?.includes('ottorouter');
	const { fetchBalance: refreshSetuBalance } = useOttoRouterBalance(
		hasSetu ? 'ottorouter' : undefined,
	);

	const setOnboardingOpen = useOnboardingStore((s) => s.setOpen);
	const setStep = useOnboardingStore((s) => s.setStep);
	const setManageMode = useOnboardingStore((s) => s.setManageMode);
	const { fetchAuthStatus } = useAuthStatus();

	const exportSetuPrivateKey = useCallback(async () => {
		return await apiClient.exportOttoRouterWallet();
	}, []);

	const providerOptions = useMemo(() => {
		if (!config?.providers || !allModels) return [];
		return config.providers
			.filter((p) => allModels[p])
			.map((p) => ({
				id: p,
				label: allModels[p]?.label || p,
			}));
	}, [config?.providers, allModels]);

	const modelOptions = useMemo(() => {
		const provider = config?.defaults?.provider;
		if (!provider || !allModels?.[provider]) return [];
		return allModels[provider].models.map((m) => ({
			id: m.id,
			label: m.label,
		}));
	}, [config?.defaults?.provider, allModels]);

	const agentOptions = useMemo(() => {
		if (!config?.agents) return [];
		return config.agents.map((a) => ({ id: a, label: a }));
	}, [config?.agents]);

	if (!isExpanded) return null;

	const handleProviderChange = (provider: string) => {
		const firstModel = allModels?.[provider]?.models?.[0]?.id;
		updateDefaults.mutate({
			provider,
			model: firstModel || config?.defaults?.model,
			scope: 'global',
		});
	};

	const handleModelChange = (model: string) => {
		updateDefaults.mutate({ model, scope: 'global' });
	};

	const handleAgentChange = (agent: string) => {
		updateDefaults.mutate({ agent, scope: 'global' });
	};

	return (
		<div
			className="border-l border-sidebar-border sidebar-fade-in flex h-full relative"
			style={{ width: panelWidth }}
		>
			<ResizeHandle
				panelKey={SETTINGS_PANEL_KEY}
				side="right"
				minWidth={SETTINGS_MIN_WIDTH}
				maxWidth={SETTINGS_MAX_WIDTH}
				defaultWidth={SETTINGS_DEFAULT_WIDTH}
			/>
			<div className="flex-1 flex flex-col h-full min-w-0">
				<SidebarHeader
					icon={<Settings className="size-[15px]" />}
					title="Settings"
					onClose={collapseSidebar}
				/>

				<div className="flex-1 overflow-y-auto">
					<SettingsSection
						title="Default Model"
						icon={<Cpu className="w-4 h-4 text-muted-foreground" />}
					>
						<SelectRow
							label="Provider"
							value={config?.defaults?.provider ?? ''}
							options={providerOptions}
							onChange={handleProviderChange}
							disabled={updateDefaults.isPending}
						/>
						<SelectRow
							label="Model"
							value={config?.defaults?.model ?? ''}
							options={modelOptions}
							onChange={handleModelChange}
							disabled={updateDefaults.isPending}
						/>
						<SelectRow
							label="Agent"
							value={config?.defaults?.agent ?? ''}
							options={agentOptions}
							onChange={handleAgentChange}
							disabled={updateDefaults.isPending}
						/>
					</SettingsSection>

					<SettingsSection
						title="Providers"
						icon={<Zap className="w-4 h-4 text-muted-foreground" />}
						action={
							<button
								type="button"
								onClick={() => {
									fetchAuthStatus().then(() => {
										setStep('wallet');
										setManageMode(true);
										setOnboardingOpen(true);
									});
								}}
								className="p-1 hover:bg-muted rounded transition-colors"
								title="Manage providers"
							>
								<Pencil className="w-3.5 h-3.5 text-muted-foreground" />
							</button>
						}
					>
						<div className="flex flex-wrap gap-2">
							{config?.providers?.map((provider) => (
								<span
									key={provider}
									className="px-2 py-1 text-xs bg-muted rounded-md font-mono"
								>
									{provider}
								</span>
							)) ?? <span className="text-muted-foreground text-sm">None</span>}
						</div>
					</SettingsSection>

					{config?.providers?.includes('ottorouter') && (
						<SetuWalletSection
							ottorouterWallet={ottorouterWallet}
							ottorouterBalance={ottorouterBalance}
							ottorouterUsdcBalance={ottorouterUsdcBalance}
							ottorouterLoading={ottorouterLoading}
							refreshSetuBalance={refreshSetuBalance}
							openTopupModal={openTopupModal}
							onExportPrivateKey={exportSetuPrivateKey}
						/>
					)}

					<OttoRouterTopupModal />
				</div>

				<button
					type="button"
					onClick={() => {
						if (onOpenDashboard) {
							onOpenDashboard();
							return;
						}
						if (typeof window === 'undefined') return;
						const basePathRaw =
							(globalThis as { OTTO_ROUTER_BASEPATH?: string })
								.OTTO_ROUTER_BASEPATH ?? '/';
						const basePath = basePathRaw.replace(/\/+$/, '');
						const target = `${basePath}/dashboard`.replace(/\/+/g, '/');
						window.location.assign(target || '/dashboard');
					}}
					title="Open usage dashboard"
					className="group shrink-0 w-full h-12 px-3 flex items-center gap-2 bg-muted/20 hover:bg-muted/60 border-t border-border transition-colors text-left cursor-pointer"
				>
					<BarChart3 className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors" />
					<span className="text-sm flex-1 text-muted-foreground group-hover:text-foreground transition-colors">
						Usage Dashboard
					</span>
					<ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground group-hover:translate-x-0.5 transition-all" />
				</button>

				<button
					type="button"
					onClick={() => setIsPreferencesOpen(true)}
					title="Open preferences"
					className="group shrink-0 w-full h-12 px-3 flex items-center gap-2 bg-muted/20 hover:bg-muted/60 border-t border-border transition-colors text-left cursor-pointer"
				>
					<User className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors" />
					<span className="text-sm flex-1 text-muted-foreground group-hover:text-foreground transition-colors">
						Preferences
					</span>
					<ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground group-hover:translate-x-0.5 transition-all" />
				</button>

				<PreferencesModal
					isOpen={isPreferencesOpen}
					onClose={() => setIsPreferencesOpen(false)}
				/>
			</div>
		</div>
	);
});

function SetuSubscriptionInfo() {
	const subscription = useOttoRouterStore((s) => s.subscription);
	const payg = useOttoRouterStore((s) => s.payg);

	if (!subscription?.active) return null;

	return (
		<>
			<SettingRow label="Plan" value={subscription.tierName ?? 'GO'} />
			{subscription.usageWindows && (
				<>
					<SettingRow
						label="5h"
						value={`${Math.round(subscription.usageWindows.fiveHour.percentUsed)}%`}
					/>
					<SettingRow
						label="Week"
						value={`${Math.round(subscription.usageWindows.weekly.percentUsed)}%`}
					/>
				</>
			)}
			{payg && payg.effectiveSpendableUsd > 0 && (
				<SettingRow
					label="Credits"
					value={`$${payg.effectiveSpendableUsd.toFixed(2)}`}
				/>
			)}
			{subscription.periodEnd && (
				<SettingRow
					label="Renews"
					value={new Date(subscription.periodEnd)
						.toLocaleDateString('en-US', {
							month: 'short',
							day: 'numeric',
							year: 'numeric',
						})
						.replace(',', '')}
				/>
			)}
		</>
	);
}

interface SetuWalletSectionProps {
	ottorouterWallet: string | null;
	ottorouterBalance: number | null;
	ottorouterUsdcBalance: number | null;
	ottorouterLoading: boolean;
	refreshSetuBalance: () => void;
	openTopupModal: () => void;
	onExportPrivateKey: () => Promise<{
		success: boolean;
		publicKey: string;
		privateKey: string;
	}>;
}

const SetuWalletSection = memo(function SetuWalletSection({
	ottorouterWallet,
	ottorouterBalance,
	ottorouterUsdcBalance,
	ottorouterLoading,
	refreshSetuBalance,
	openTopupModal,
	onExportPrivateKey,
}: SetuWalletSectionProps) {
	const hasActiveSubscription = useOttoRouterStore(
		(s) => !!s.subscription?.active,
	);
	const [copied, setCopied] = useState(false);
	const [isExportModalOpen, setIsExportModalOpen] = useState(false);
	const [exportPrivateKey, setExportPrivateKey] = useState<string | null>(null);
	const [isExportingPrivateKey, setIsExportingPrivateKey] = useState(false);
	const [exportPrivateKeyError, setExportPrivateKeyError] = useState<
		string | null
	>(null);
	const [privateKeyCopied, setPrivateKeyCopied] = useState(false);

	const handleCopy = useCallback(async () => {
		if (!ottorouterWallet) return;
		await navigator.clipboard.writeText(ottorouterWallet);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	}, [ottorouterWallet]);

	const handleOpenExportPrivateKey = async () => {
		setIsExportModalOpen(true);
		setPrivateKeyCopied(false);
		setExportPrivateKey(null);
		setExportPrivateKeyError(null);
		setIsExportingPrivateKey(true);
		try {
			const result = await onExportPrivateKey();
			setExportPrivateKey(result.privateKey);
		} catch (err) {
			setExportPrivateKeyError(
				err instanceof Error ? err.message : 'Failed to export private key',
			);
		} finally {
			setIsExportingPrivateKey(false);
		}
	};

	const handleCloseExportPrivateKey = () => {
		if (isExportingPrivateKey) return;
		setIsExportModalOpen(false);
		setPrivateKeyCopied(false);
		setExportPrivateKey(null);
		setExportPrivateKeyError(null);
	};

	const handleCopyPrivateKey = async () => {
		if (!exportPrivateKey) return;
		await navigator.clipboard.writeText(exportPrivateKey);
		setPrivateKeyCopied(true);
		setTimeout(() => setPrivateKeyCopied(false), 2000);
	};

	const truncateWallet = (address: string | null) => {
		if (!address) return 'Not configured';
		return `${address.slice(0, 4)}...${address.slice(-4)}`;
	};

	const formatBalance = (balance: number | null) => {
		if (balance === null) return '—';
		return `$${balance.toFixed(4)}`;
	};

	const formatUsdcBalance = (balance: number | null) => {
		if (balance === null) return '—';
		return `${balance.toFixed(2)} USDC`;
	};

	const isLoaded = ottorouterWallet !== null;

	return (
		<SettingsSection
			title="Setu Credits"
			icon={<Wallet className="w-4 h-4 text-muted-foreground" />}
			action={
				<button
					type="button"
					onClick={refreshSetuBalance}
					disabled={ottorouterLoading}
					className="p-1 hover:bg-muted rounded transition-colors disabled:opacity-50"
					title="Refresh balances"
				>
					{ottorouterLoading ? (
						<StableSpinner
							size="sm"
							className="text-muted-foreground"
							title="Refreshing balances"
						/>
					) : (
						<RefreshCw className="w-3.5 h-3.5 text-muted-foreground" />
					)}
				</button>
			}
		>
			{isLoaded ? (
				<>
					<div className="flex justify-center pb-3">
						<div className="p-2 bg-white rounded-lg">
							<QRCodeSVG
								value={ottorouterWallet}
								size={120}
								level="M"
								includeMargin={false}
							/>
						</div>
					</div>
					<div className="flex items-center justify-between text-sm">
						<span className="text-muted-foreground">Address</span>
						<button
							type="button"
							onClick={handleCopy}
							className="flex items-center gap-1.5 font-mono text-foreground hover:text-muted-foreground transition-colors"
							title="Copy address"
						>
							{truncateWallet(ottorouterWallet)}
							{copied ? (
								<Check className="w-3 h-3 text-green-500" />
							) : (
								<Copy className="w-3 h-3 text-muted-foreground" />
							)}
						</button>
					</div>
					<SetuSubscriptionInfo />
					{!hasActiveSubscription && (
						<>
							<SettingRow
								label="Balance"
								value={formatBalance(ottorouterBalance)}
							/>
							<SettingRow
								label="USDC"
								value={formatUsdcBalance(ottorouterUsdcBalance)}
							/>
						</>
					)}
				</>
			) : (
				<>
					<div className="flex justify-center pb-3">
						<div className="w-[136px] h-[136px] bg-muted rounded-lg animate-pulse" />
					</div>
					<div className="flex items-center justify-between text-sm">
						<span className="text-muted-foreground">Address</span>
						<div className="w-24 h-4 bg-muted rounded animate-pulse" />
					</div>
					<div className="flex items-center justify-between text-sm">
						<span className="text-muted-foreground">Balance</span>
						<div className="w-16 h-4 bg-muted rounded animate-pulse" />
					</div>
					<div className="flex items-center justify-between text-sm">
						<span className="text-muted-foreground">USDC</span>
						<div className="w-20 h-4 bg-muted rounded animate-pulse" />
					</div>
				</>
			)}
			<Button
				variant="secondary"
				size="sm"
				onClick={openTopupModal}
				className="w-full mt-2 gap-2"
			>
				<Plus className="w-4 h-4" />
				Top Up Balance
			</Button>
			<Button
				variant="ghost"
				size="sm"
				onClick={handleOpenExportPrivateKey}
				className="w-full gap-2"
			>
				<Key className="w-4 h-4" />
				Export Private Key
			</Button>

			{isExportModalOpen && (
				<div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm">
					<div className="bg-background border border-border rounded-xl w-full max-w-lg mx-6 shadow-2xl">
						<div className="flex items-center gap-3 p-6 border-b border-border">
							<Key className="w-5 h-5 text-muted-foreground" />
							<h3 className="text-lg font-semibold">Export Setu Private Key</h3>
						</div>
						<div className="p-6">
							<p className="text-sm text-muted-foreground mb-4">
								Keep this private key secret. Anyone with this key can spend
								funds from your Setu wallet.
							</p>

							{isExportingPrivateKey && (
								<div className="flex items-center gap-2 text-sm text-muted-foreground">
									<StableSpinner title="Exporting private key" />
									Exporting private key...
								</div>
							)}

							{!isExportingPrivateKey && exportPrivateKey && (
								<div className="space-y-3">
									<textarea
										readOnly
										value={exportPrivateKey}
										className="w-full min-h-[110px] px-4 py-3 bg-muted/50 border border-border rounded-lg text-foreground outline-none font-mono text-xs resize-y"
									/>
									<Button
										variant="secondary"
										size="sm"
										onClick={handleCopyPrivateKey}
										className="w-full gap-2"
									>
										{privateKeyCopied ? (
											<Check className="w-4 h-4 text-green-500" />
										) : (
											<Copy className="w-4 h-4" />
										)}
										{privateKeyCopied ? 'Copied' : 'Copy Private Key'}
									</Button>
								</div>
							)}

							{!isExportingPrivateKey && exportPrivateKeyError && (
								<p className="text-sm text-red-500 mt-3">
									{exportPrivateKeyError}
								</p>
							)}
							<div className="flex gap-3 mt-5">
								<button
									type="button"
									onClick={handleCloseExportPrivateKey}
									disabled={isExportingPrivateKey}
									className="flex-1 h-11 px-4 bg-transparent border border-border text-foreground rounded-lg font-medium hover:bg-muted/50 transition-colors disabled:opacity-50"
								>
									Close
								</button>
							</div>
						</div>
					</div>
				</div>
			)}
		</SettingsSection>
	);
});
