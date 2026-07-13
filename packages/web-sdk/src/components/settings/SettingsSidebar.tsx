import { memo, useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { normalizeThemeId, themeList, type ThemeId } from '@ottocode/themes';
import {
	Settings,
	ChevronRight,
	CreditCard,
	Cpu,
	Zap,
	User,
	ChevronDown,
	RefreshCw,
	LogOut,
	Plus,
	Pencil,
	Check,
	Type,
	Brain,
	BarChart3,
	Mic,
	Bell,
	ChefHat,
	Puzzle,
	BookOpen,
	X,
} from 'lucide-react';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { OttoMark } from '../common/OttoOIcon';
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
import { DictationSettings } from './DictationSettings';
import { RecipesSettings } from './RecipesSettings';
import { PluginsSettings } from './PluginsSettings';
import { ReferencesSettings } from './ReferencesSettings';
import { useOttoRouterBalance } from '../../hooks/useOttoRouterBalance';
import { useTopupCallback } from '../../hooks/useTopupCallback';
import { usePanelWidthStore } from '../../stores/panelWidthStore';
import { ResizeHandle } from '../ui/ResizeHandle';
import {
	hasPlatformSystemFonts,
	listPlatformSystemFonts,
	isPlatformDesktop,
} from '../../lib/platform';
import {
	getBrowserNotificationPermission,
	requestBrowserNotificationPermission,
} from '../../lib/notifications';
import { toast } from '../../stores/toastStore';
import { ReasoningTabs, type ReasoningLevel } from '../chat/ReasoningTabs';

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

interface PrefSectionProps {
	title: string;
	children: React.ReactNode;
}

const PrefSection = memo(function PrefSection({
	title,
	children,
}: PrefSectionProps) {
	return (
		<section className="pt-4 first:pt-1">
			<h3 className="pb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
				{title}
			</h3>
			<div className="divide-y divide-border/60">{children}</div>
		</section>
	);
});

interface ToggleRowProps {
	label: string;
	checked: boolean;
	onChange: (checked: boolean) => void;
	description?: string;
}

const ToggleRow = memo(function ToggleRow({
	label,
	checked,
	onChange,
	description,
}: ToggleRowProps) {
	return (
		<div className="flex min-w-0 items-center justify-between gap-4 py-2 text-sm">
			<div className="min-w-0 flex-1">
				<div className="truncate font-medium text-foreground">{label}</div>
				{description ? (
					<p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
						{description}
					</p>
				) : null}
			</div>
			<button
				type="button"
				role="switch"
				aria-checked={checked}
				onClick={() => onChange(!checked)}
				className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1 focus:ring-offset-background ${
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
	description?: string;
}

const SelectRow = memo(function SelectRow({
	label,
	value,
	options,
	onChange,
	disabled,
	description,
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
		<div className="flex items-center justify-between gap-4 text-sm">
			<div className="min-w-0 flex-1">
				<span
					className={
						description
							? 'font-medium text-foreground'
							: 'text-muted-foreground'
					}
				>
					{label}
				</span>
				{description ? (
					<p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
						{description}
					</p>
				) : null}
			</div>
			<div className="relative shrink-0">
				<button
					ref={buttonRef}
					type="button"
					onClick={() => !disabled && setIsOpen(!isOpen)}
					disabled={disabled}
					className="flex items-center gap-1 px-2 py-1 text-xs font-mono bg-muted hover:bg-muted/80 rounded border border-border transition-colors disabled:opacity-50"
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

type PreferencesTab =
	| 'editor'
	| 'notifications'
	| 'automation'
	| 'reasoning'
	| 'dictation'
	| 'recipes'
	| 'references'
	| 'plugins';

interface PreferenceTabConfig {
	id: PreferencesTab;
	label: string;
	description: string;
	icon: React.ReactNode;
}

const PREFERENCE_GROUPS: Array<{
	label: string;
	tabs: PreferenceTabConfig[];
}> = [
	{
		label: 'General',
		tabs: [
			{
				id: 'editor',
				label: 'Editor',
				description: 'Input, layout, and appearance',
				icon: <Type className="h-3.5 w-3.5" />,
			},
			{
				id: 'notifications',
				label: 'Notifications',
				description: 'Background update alerts',
				icon: <Bell className="h-3.5 w-3.5" />,
			},
			{
				id: 'automation',
				label: 'Automation',
				description: 'Tool approvals and auto-compaction',
				icon: <Zap className="h-3.5 w-3.5" />,
			},
			{
				id: 'reasoning',
				label: 'Reasoning',
				description: 'Model thinking and effort level',
				icon: <Brain className="h-3.5 w-3.5" />,
			},
			{
				id: 'dictation',
				label: 'Dictation',
				description: 'Voice input and local models',
				icon: <Mic className="h-3.5 w-3.5" />,
			},
		],
	},
	{
		label: 'Library',
		tabs: [
			{
				id: 'recipes',
				label: 'Recipes',
				description: 'Reusable project slash commands',
				icon: <ChefHat className="h-3.5 w-3.5" />,
			},
			{
				id: 'references',
				label: 'References',
				description: 'Repositories and directories Otto can consult',
				icon: <BookOpen className="h-3.5 w-3.5" />,
			},
			{
				id: 'plugins',
				label: 'Plugins',
				description: 'Installed capability packs and registry plugins',
				icon: <Puzzle className="h-3.5 w-3.5" />,
			},
		],
	},
];

function PreferencesModal({ isOpen, onClose }: PreferencesModalProps) {
	const { data: config } = useConfig();
	const { preferences, updatePreferences } = usePreferences();
	const updateDefaults = useUpdateDefaults();
	const isDesktop = isPlatformDesktop();
	const [activeTab, setActiveTab] = useState<PreferencesTab>('editor');
	const isFullBleedTab =
		activeTab === 'recipes' ||
		activeTab === 'references' ||
		activeTab === 'plugins';
	const [notificationPermission, setNotificationPermission] = useState(() =>
		getBrowserNotificationPermission(),
	);
	const notificationDescription = useMemo(() => {
		if (isDesktop) {
			return 'Show native desktop notifications when sessions update in the background.';
		}
		if (notificationPermission === 'granted') {
			return 'Show browser notifications when sessions update in the background.';
		}
		if (notificationPermission === 'denied') {
			return 'Browser notifications are blocked. Re-enable them in browser settings first.';
		}
		if (notificationPermission === 'unsupported') {
			return 'Browser notifications are not supported in this browser.';
		}
		return 'Ask for browser permission, then notify when sessions update in the background.';
	}, [isDesktop, notificationPermission]);

	useEffect(() => {
		if (!isOpen) return;
		setNotificationPermission(getBrowserNotificationPermission());
	}, [isOpen]);

	const handleNotificationsEnabledChange = useCallback(
		async (checked: boolean) => {
			if (!checked) {
				updatePreferences({ notificationsEnabled: false });
				return;
			}

			if (isDesktop) {
				updatePreferences({ notificationsEnabled: true });
				toast.success('Desktop notifications enabled.');
				return;
			}

			const permission = getBrowserNotificationPermission();
			setNotificationPermission(permission);
			if (permission === 'unsupported') {
				updatePreferences({ notificationsEnabled: false });
				toast.info('Browser notifications are not supported here.');
				return;
			}
			if (permission === 'denied') {
				updatePreferences({ notificationsEnabled: false });
				toast.error('Browser notifications are blocked in browser settings.');
				return;
			}
			if (permission === 'granted') {
				updatePreferences({ notificationsEnabled: true });
				toast.success('Browser notifications enabled.');
				return;
			}

			const nextPermission = await requestBrowserNotificationPermission();
			setNotificationPermission(nextPermission);
			if (nextPermission === 'granted') {
				updatePreferences({ notificationsEnabled: true });
				toast.success('Browser notifications enabled.');
				return;
			}

			updatePreferences({ notificationsEnabled: false });
			toast.info('Browser notifications were not enabled.');
		},
		[isDesktop, updatePreferences],
	);

	const themeOptions = useMemo(
		() =>
			themeList.map((theme) => ({ id: theme.id, label: theme.displayName })),
		[],
	);

	const handleThemeChange = useCallback(
		(theme: string) => {
			updateDefaults.mutate({
				theme: normalizeThemeId(theme) as ThemeId,
				scope: 'global',
			});
		},
		[updateDefaults],
	);

	const renderActiveTab = () => {
		switch (activeTab) {
			case 'editor':
				return (
					<div className="pb-2">
						<PrefSection title="Input">
							<ToggleRow
								label="Vim Mode"
								description="Use modal keybindings in the chat input."
								checked={preferences.vimMode}
								onChange={(checked) => updatePreferences({ vimMode: checked })}
							/>
						</PrefSection>
						<PrefSection title="Layout">
							<ToggleRow
								label="Compact Thread"
								description="Reduce spacing between messages for a denser view."
								checked={preferences.compactThread}
								onChange={(checked) =>
									updatePreferences({ compactThread: checked })
								}
							/>
							<ToggleRow
								label="Full Width Content"
								description="Let messages span the full width of the window."
								checked={preferences.fullWidthContent}
								onChange={(checked) =>
									updatePreferences({ fullWidthContent: checked })
								}
							/>
							<ToggleRow
								label="Thread Navigator Rail"
								description="Show the quick-jump rail beside message threads."
								checked={preferences.threadNavigatorRail}
								onChange={(checked) =>
									updatePreferences({ threadNavigatorRail: checked })
								}
							/>
							{isDesktop ? (
								<ToggleRow
									label="Smart Sidebar Edges"
									description="Snap sidebars to window edges automatically."
									checked={preferences.smartEdges}
									onChange={(checked) =>
										updatePreferences({ smartEdges: checked })
									}
								/>
							) : null}
						</PrefSection>
						<PrefSection title="Appearance">
							<div className="py-2.5">
								<SelectRow
									label="Theme"
									value={normalizeThemeId(config?.defaults?.theme)}
									options={themeOptions}
									onChange={handleThemeChange}
									disabled={updateDefaults.isPending}
									description="Choose the color theme for web and desktop."
								/>
							</div>
							<div className="py-2.5">
								<FontPickerRow
									value={preferences.fontFamily}
									onChange={(fontFamily) => updatePreferences({ fontFamily })}
								/>
							</div>
						</PrefSection>
					</div>
				);
			case 'notifications':
				return (
					<div className="pb-2">
						<PrefSection title="Alerts">
							<ToggleRow
								label="System Notifications"
								description={notificationDescription}
								checked={preferences.notificationsEnabled}
								onChange={handleNotificationsEnabledChange}
							/>
							{!isDesktop ? (
								<div className="py-2.5">
									<SettingRow
										label="Browser permission"
										value={notificationPermission}
									/>
								</div>
							) : null}
						</PrefSection>
					</div>
				);
			case 'automation':
				return (
					<div className="pb-2">
						<PrefSection title="Tool Approvals">
							<div className="py-2.5">
								<SelectRow
									label="Tool Approval"
									description="Choose which tool calls require manual confirmation."
									value={config?.defaults?.toolApproval ?? 'dangerous'}
									options={[
										{ id: 'auto', label: 'Auto' },
										{ id: 'dangerous', label: 'Dangerous only' },
										{ id: 'yolo', label: 'YOLO' },
										{ id: 'all', label: 'All tools' },
									]}
									onChange={(value) =>
										updateDefaults.mutate({
											toolApproval: value as
												| 'auto'
												| 'dangerous'
												| 'all'
												| 'yolo',
											scope: 'global',
										})
									}
									disabled={updateDefaults.isPending}
								/>
							</div>
							<ToggleRow
								label="Guided Mode"
								description="Walk through steps with extra prompts and checkpoints."
								checked={config?.defaults?.guidedMode ?? false}
								onChange={(checked) =>
									updateDefaults.mutate({
										guidedMode: checked,
										scope: 'global',
									})
								}
							/>
						</PrefSection>
						<PrefSection title="Sessions">
							<div className="py-2.5">
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
									hint="Summarize the thread once it grows past this many tokens."
									disabled={updateDefaults.isPending}
								/>
							</div>
							<ToggleRow
								label="Otto Commit Co-author"
								description="Add the ottocode bot as a co-author on commits made through Otto."
								checked={config?.defaults?.coAuthorCommits ?? false}
								onChange={(checked) =>
									updateDefaults.mutate({
										coAuthorCommits: checked,
										scope: 'global',
									})
								}
							/>
						</PrefSection>
					</div>
				);
			case 'reasoning':
				return (
					<div className="pb-2">
						<PrefSection title="Model Thinking">
							<ToggleRow
								label="Show Reasoning"
								description="Display the model's thinking alongside responses."
								checked={config?.defaults?.reasoningText ?? true}
								onChange={(checked) =>
									updateDefaults.mutate({
										reasoningText: checked,
										scope: 'global',
									})
								}
							/>
							<div className="space-y-2.5 py-3">
								<div>
									<div className="text-sm font-medium text-foreground">
										Reasoning Level
									</div>
									<p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
										Higher levels think longer but cost more tokens.
									</p>
								</div>
								<ReasoningTabs
									value={
										(config?.defaults?.reasoningLevel ??
											'high') as ReasoningLevel
									}
									onChange={(level) =>
										updateDefaults.mutate({
											reasoningLevel: level,
											scope: 'global',
										})
									}
									disabled={updateDefaults.isPending}
								/>
							</div>
						</PrefSection>
					</div>
				);
			case 'dictation':
				return (
					<div className="pb-2">
						<PrefSection title="Voice Input">
							<ToggleRow
								label="Release to Send"
								description="Send the message automatically when dictation ends."
								checked={preferences.releaseToSend}
								onChange={(checked) =>
									updatePreferences({ releaseToSend: checked })
								}
							/>
						</PrefSection>
						<DictationSettings embedded />
					</div>
				);
			case 'recipes':
				return <RecipesSettings />;
			case 'references':
				return <ReferencesSettings />;
			case 'plugins':
				return <PluginsSettings />;
		}
	};

	return (
		<Modal
			isOpen={isOpen}
			onClose={onClose}
			maxWidth="5xl"
			showCloseButton={false}
		>
			<div className="relative -m-6 flex h-[clamp(460px,72vh,600px)] flex-col overflow-hidden sm:flex-row">
				<button
					type="button"
					onClick={onClose}
					aria-label="Close preferences"
					className="absolute right-2 top-2 z-20 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
				>
					<X className="h-4 w-4" />
				</button>
				<nav className="flex w-full shrink-0 items-center gap-0.5 overflow-x-auto border-b border-sidebar-border bg-sidebar py-1.5 pl-2 pr-11 sm:w-52 sm:flex-col sm:items-stretch sm:gap-0 sm:overflow-y-auto sm:border-b-0 sm:border-r sm:px-0 sm:py-1.5">
					{PREFERENCE_GROUPS.map((group) => (
						<div
							key={group.label}
							className="flex shrink-0 items-center gap-0.5 sm:block sm:shrink"
						>
							<div className="hidden px-4 pb-1 pt-4 text-[10px] font-medium uppercase tracking-wider text-sidebar-muted-foreground/70 first:pt-2 sm:block">
								{group.label}
							</div>
							{group.tabs.map((tab) => {
								const isActive = activeTab === tab.id;
								return (
									<button
										key={tab.id}
										type="button"
										onClick={() => setActiveTab(tab.id)}
										title={tab.description}
										className={`relative flex w-auto shrink-0 items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[13px] transition-colors duration-150 sm:w-full sm:rounded-none sm:px-4 sm:py-2 ${
											isActive
												? 'bg-black/[0.08] font-medium text-sidebar-foreground dark:bg-white/[0.08]'
												: 'font-normal text-sidebar-muted-foreground hover:bg-black/[0.05] hover:text-sidebar-foreground dark:hover:bg-white/[0.055]'
										}`}
									>
										{isActive ? (
											<motion.span
												layoutId="preferences-nav-indicator"
												className="absolute inset-y-0 left-0 hidden w-0.5 bg-primary sm:block"
												transition={{ duration: 0.15, ease: 'easeOut' }}
											/>
										) : null}
										<span
											className={
												isActive
													? 'text-sidebar-foreground'
													: 'text-sidebar-muted-foreground'
											}
										>
											{tab.icon}
										</span>
										{tab.label}
									</button>
								);
							})}
						</div>
					))}
				</nav>

				<section className="flex min-h-0 min-w-0 flex-1 flex-col">
					<div className="min-h-0 flex-1 overflow-hidden">
						<AnimatePresence mode="wait">
							<motion.div
								key={activeTab}
								className="h-full min-h-0"
								initial={{ opacity: 0, y: 6 }}
								animate={{ opacity: 1, y: 0 }}
								exit={{ opacity: 0, y: -6 }}
								transition={{ duration: 0.15, ease: 'easeOut' }}
							>
								{isFullBleedTab ? (
									renderActiveTab()
								) : (
									<div className="h-full min-h-0 overflow-y-auto px-4 py-3 sm:px-5">
										{renderActiveTab()}
									</div>
								)}
							</motion.div>
						</AnimatePresence>
					</div>
				</section>
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
	return isExpanded ? (
		<SettingsSidebarContent onOpenDashboard={onOpenDashboard} />
	) : null;
});

const SettingsSidebarContent = memo(function SettingsSidebarContent({
	onOpenDashboard,
}: SettingsSidebarProps = {}) {
	const collapseSidebar = useSettingsStore((state) => state.collapseSidebar);
	const [isPreferencesOpen, setIsPreferencesOpen] = useState(false);
	const panelWidth = usePanelWidthStore(
		(s) => s.widths[SETTINGS_PANEL_KEY] ?? SETTINGS_DEFAULT_WIDTH,
	);

	const { data: config } = useConfig();
	const { data: allModels } = useAllModels();
	const updateDefaults = useUpdateDefaults();
	const [isSigningOutOttoRouter, setIsSigningOutOttoRouter] = useState(false);
	const ottorouterBalance = useOttoRouterStore((s) => s.balance);
	const ottorouterLoading = useOttoRouterStore((s) => s.isLoading);
	const openTopupModal = useOttoRouterStore((s) => s.openTopupModal);
	const setOttoRouterBalance = useOttoRouterStore((s) => s.setBalance);
	const setOttoRouterScope = useOttoRouterStore((s) => s.setScope);
	const setOttoRouterPayg = useOttoRouterStore((s) => s.setPayg);
	const setOttoRouterSubscription = useOttoRouterStore(
		(s) => s.setSubscription,
	);
	const setOttoRouterLimits = useOttoRouterStore((s) => s.setLimits);

	// Handle topup success callback from Polar checkout redirect
	useTopupCallback();

	const hasOttoRouter = config?.providers?.includes('ottorouter');
	const { fetchBalance: refreshOttoRouterBalance } = useOttoRouterBalance(
		hasOttoRouter ? 'ottorouter' : undefined,
	);

	const setOnboardingOpen = useOnboardingStore((s) => s.setOpen);
	const setStep = useOnboardingStore((s) => s.setStep);
	const setManageMode = useOnboardingStore((s) => s.setManageMode);
	const { fetchAuthStatus, removeProvider } = useAuthStatus();

	const handleSignOutOttoRouter = useCallback(async () => {
		setIsSigningOutOttoRouter(true);
		try {
			await removeProvider('ottorouter');
			setOttoRouterBalance(null);
			setOttoRouterScope(null);
			setOttoRouterPayg(null);
			setOttoRouterSubscription(null);
			setOttoRouterLimits(null);
		} finally {
			setIsSigningOutOttoRouter(false);
		}
	}, [
		removeProvider,
		setOttoRouterBalance,
		setOttoRouterScope,
		setOttoRouterPayg,
		setOttoRouterSubscription,
		setOttoRouterLimits,
	]);

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

	const themeOptions = useMemo(
		() =>
			themeList.map((theme) => ({ id: theme.id, label: theme.displayName })),
		[],
	);

	const handleThemeChange = (theme: string) => {
		updateDefaults.mutate({
			theme: normalizeThemeId(theme) as ThemeId,
			scope: 'global',
		});
	};

	const handleOpenPreferences = useCallback(() => {
		setIsPreferencesOpen(true);
	}, []);

	const handleClosePreferences = useCallback(() => {
		setIsPreferencesOpen(false);
	}, []);

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
						title="Appearance"
						icon={<Type className="w-4 h-4 text-muted-foreground" />}
					>
						<SelectRow
							label="Theme"
							value={normalizeThemeId(config?.defaults?.theme)}
							options={themeOptions}
							onChange={handleThemeChange}
							disabled={updateDefaults.isPending}
						/>
					</SettingsSection>

					<SettingsSection
						title="Providers"
						icon={<OttoMark className="w-4 h-4 text-muted-foreground" />}
						action={
							<button
								type="button"
								onClick={() => {
									setStep('wallet');
									setManageMode(true);
									setOnboardingOpen(true);
									fetchAuthStatus();
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
						<OttoRouterWalletSection
							ottorouterBalance={ottorouterBalance}
							ottorouterLoading={ottorouterLoading}
							refreshOttoRouterBalance={refreshOttoRouterBalance}
							openTopupModal={openTopupModal}
							onSignOut={handleSignOutOttoRouter}
							isSigningOut={isSigningOutOttoRouter}
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
					onClick={handleOpenPreferences}
					title="Open preferences"
					className="group shrink-0 w-full h-12 px-3 flex items-center gap-2 bg-muted/20 hover:bg-muted/60 border-t border-border transition-colors text-left cursor-pointer"
				>
					<User className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors" />
					<span className="text-sm flex-1 text-muted-foreground group-hover:text-foreground transition-colors">
						Preferences
					</span>
					<ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground group-hover:translate-x-0.5 transition-all" />
				</button>

				{isPreferencesOpen ? (
					<PreferencesModal isOpen onClose={handleClosePreferences} />
				) : null}
			</div>
		</div>
	);
});

function OttoRouterSubscriptionInfo() {
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

interface OttoRouterWalletSectionProps {
	ottorouterBalance: number | null;
	ottorouterLoading: boolean;
	refreshOttoRouterBalance: () => void;
	openTopupModal: () => void;
	onSignOut: () => Promise<void>;
	isSigningOut: boolean;
}

const OttoRouterWalletSection = memo(function OttoRouterWalletSection({
	ottorouterBalance,
	ottorouterLoading,
	refreshOttoRouterBalance,
	openTopupModal,
	onSignOut,
	isSigningOut,
}: OttoRouterWalletSectionProps) {
	const hasActiveSubscription = useOttoRouterStore(
		(s) => !!s.subscription?.active,
	);

	const formatBalance = (balance: number | null) => {
		if (balance === null) return '—';
		return `$${balance.toFixed(4)}`;
	};

	return (
		<SettingsSection
			title="OttoRouter Credits"
			icon={<CreditCard className="w-4 h-4 text-muted-foreground" />}
			action={
				<button
					type="button"
					onClick={refreshOttoRouterBalance}
					disabled={ottorouterLoading}
					className="p-1 hover:bg-muted rounded transition-colors disabled:opacity-50"
					title="Refresh balance"
				>
					{ottorouterLoading ? (
						<StableSpinner
							size="sm"
							className="text-muted-foreground"
							title="Refreshing balance"
						/>
					) : (
						<RefreshCw className="w-3.5 h-3.5 text-muted-foreground" />
					)}
				</button>
			}
		>
			<div className="space-y-3">
				<div className="rounded-lg border border-border bg-muted/30 p-3">
					<div className="text-sm font-medium text-foreground">
						OAuth account connected
					</div>
					<div className="mt-1 text-xs text-muted-foreground">
						Credits and top-ups apply to your OttoRouter account.
					</div>
				</div>
				<OttoRouterSubscriptionInfo />
				{!hasActiveSubscription && (
					<SettingRow
						label="Balance"
						value={formatBalance(ottorouterBalance)}
					/>
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
					onClick={onSignOut}
					disabled={isSigningOut}
					className="w-full gap-2 text-red-500 hover:text-red-500 hover:bg-red-500/10"
				>
					{isSigningOut ? (
						<StableSpinner size="sm" title="Signing out" />
					) : (
						<LogOut className="w-4 h-4" />
					)}
					{isSigningOut ? 'Signing out...' : 'Sign Out'}
				</Button>
			</div>
		</SettingsSection>
	);
});
