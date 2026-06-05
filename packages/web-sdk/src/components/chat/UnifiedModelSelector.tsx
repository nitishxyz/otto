import {
	useState,
	useEffect,
	useRef,
	useMemo,
	useImperativeHandle,
	forwardRef,
	useLayoutEffect,
	type CSSProperties,
	type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Search } from 'lucide-react';
import Fuse from 'fuse.js';
import { useAllModels, useModels } from '../../hooks/useConfig';
import { apiClient } from '../../lib/api-client';
import type { AllModelsResponse, ProviderModels } from '../../types/api';

interface UnifiedModelSelectorProps {
	provider: string;
	model: string;
	onChange: (provider: string, model: string) => void;
	disabled?: boolean;
	dropdownMode?: 'absolute' | 'inline' | 'portal';
	placeholder?: string;
}

interface FlattenedModel {
	providerKey: string;
	providerLabel: string;
	modelId: string;
	modelLabel: string;
	toolCall?: boolean;
	reasoningText?: boolean;
	contextWindow?: number;
	maxOutputTokens?: number;
	available?: boolean;
	unavailableReason?: string;
}

export interface UnifiedModelSelectorRef {
	openAndFocus: () => void;
}

export const UnifiedModelSelector = forwardRef<
	UnifiedModelSelectorRef,
	UnifiedModelSelectorProps
>(function UnifiedModelSelector(
	{
		provider,
		model,
		onChange,
		disabled = false,
		dropdownMode = 'absolute',
		placeholder,
	},
	ref,
) {
	const { data: allModels } = useAllModels();
	const { data: currentProviderModels, isLoading: isCurrentProviderLoading } =
		useModels(provider);
	const [isOpen, setIsOpen] = useState(false);
	const [searchQuery, setSearchQuery] = useState('');
	const [highlightedIndex, setHighlightedIndex] = useState(0);
	const [loadedModels, setLoadedModels] = useState<AllModelsResponse>({});
	const [loadingProviders, setLoadingProviders] = useState<
		Record<string, boolean>
	>({});
	const [hydratedProviders, setHydratedProviders] = useState<
		Record<string, boolean>
	>({});
	const dropdownRef = useRef<HTMLDivElement>(null);
	const searchInputRef = useRef<HTMLInputElement>(null);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const menuRef = useRef<HTMLDivElement>(null);
	const [menuStyle, setMenuStyle] = useState<CSSProperties>({});
	const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

	useEffect(() => {
		if (!allModels) return;
		setLoadedModels((prev) => {
			const next: AllModelsResponse = { ...prev };
			for (const [providerId, providerData] of Object.entries(allModels)) {
				next[providerId] = {
					...providerData,
					models: hydratedProviders[providerId]
						? (prev[providerId]?.models ?? providerData.models)
						: providerData.models,
				};
			}
			return next;
		});
	}, [allModels, hydratedProviders]);

	const configuredProviders = useMemo(() => {
		const providers = Object.keys(allModels ?? {});
		if (!provider || providers.includes(provider)) {
			return providers;
		}
		return [provider, ...providers];
	}, [allModels, provider]);

	useEffect(() => {
		if (!provider || !currentProviderModels) return;
		setLoadedModels((prev) => ({
			...prev,
			[provider]: {
				...(prev[provider] ?? {}),
				label: currentProviderModels.label || provider,
				models: currentProviderModels.models,
			},
		}));
		setHydratedProviders((prev) => ({ ...prev, [provider]: true }));
	}, [currentProviderModels, provider]);

	useEffect(() => {
		if (!isOpen || !configuredProviders.length) return;

		for (const providerId of configuredProviders) {
			const providerData = loadedModels[providerId] ?? allModels?.[providerId];
			if (
				!providerData?.dynamicModels ||
				hydratedProviders[providerId] ||
				loadingProviders[providerId]
			) {
				continue;
			}

			setLoadingProviders((prev) => ({ ...prev, [providerId]: true }));

			void apiClient
				.getModels(providerId)
				.then((data) => {
					setLoadedModels((prev) => ({
						...prev,
						[providerId]: {
							...(prev[providerId] ?? allModels?.[providerId] ?? {}),
							label: data.label || providerId,
							models: data.models,
							allowAnyModel: data.allowAnyModel,
							dynamicModels: true,
						} satisfies ProviderModels,
					}));
					setHydratedProviders((prev) => ({ ...prev, [providerId]: true }));
				})
				.catch(() => {
					setHydratedProviders((prev) => ({ ...prev, [providerId]: true }));
				})
				.finally(() => {
					setLoadingProviders((prev) => ({
						...prev,
						[providerId]: false,
					}));
				});
		}
	}, [
		allModels,
		configuredProviders,
		hydratedProviders,
		isOpen,
		loadedModels,
		loadingProviders,
	]);

	useImperativeHandle(ref, () => ({
		openAndFocus: () => {
			setIsOpen(true);
		},
	}));

	const flattenedModels = useMemo(() => {
		const flattened: FlattenedModel[] = [];
		for (const [providerKey, providerData] of Object.entries(loadedModels)) {
			for (const modelItem of providerData.models) {
				flattened.push({
					providerKey,
					providerLabel: providerData.label,
					modelId: modelItem.id,
					modelLabel: modelItem.label,
					toolCall: modelItem.toolCall,
					reasoningText: modelItem.reasoningText,
					contextWindow: modelItem.contextWindow,
					maxOutputTokens: modelItem.maxOutputTokens,
					available: modelItem.available,
					unavailableReason: modelItem.unavailableReason,
				});
			}
		}
		return flattened;
	}, [loadedModels]);

	const fuse = useMemo(() => {
		return new Fuse(flattenedModels, {
			keys: [
				{ name: 'modelLabel', weight: 2 },
				{ name: 'modelId', weight: 1 },
				{ name: 'providerLabel', weight: 0.5 },
			],
			threshold: 0.3,
			ignoreLocation: true,
			includeScore: true,
			distance: 100,
			minMatchCharLength: 1,
		});
	}, [flattenedModels]);

	const filteredModels = useMemo(() => {
		if (!searchQuery.trim()) return loadedModels;

		const results = fuse.search(searchQuery);

		const sortedResults = results.sort((a, b) => {
			const scoreA = a.score ?? 1;
			const scoreB = b.score ?? 1;
			if (Math.abs(scoreA - scoreB) < 0.001) {
				const labelA = a.item.modelLabel.toLowerCase();
				const labelB = b.item.modelLabel.toLowerCase();
				const query = searchQuery.toLowerCase();
				const indexA = labelA.indexOf(query);
				const indexB = labelB.indexOf(query);
				if (indexA >= 0 && indexB < 0) return -1;
				if (indexB >= 0 && indexA < 0) return 1;
				if (indexA >= 0 && indexB >= 0) return indexA - indexB;
			}
			return scoreA - scoreB;
		});

		const filtered: AllModelsResponse = {};

		for (const result of sortedResults) {
			const item = result.item;

			if (!filtered[item.providerKey]) {
				filtered[item.providerKey] = {
					label: item.providerLabel,
					models: [],
				};
			}

			const existingModel = filtered[item.providerKey].models.find(
				(m) => m.id === item.modelId,
			);
			if (!existingModel) {
				filtered[item.providerKey].models.push({
					id: item.modelId,
					label: item.modelLabel,
					toolCall: item.toolCall,
					reasoningText: item.reasoningText,
					contextWindow: item.contextWindow,
					maxOutputTokens: item.maxOutputTokens,
					available: item.available,
					unavailableReason: item.unavailableReason,
				});
			}
		}

		return filtered;
	}, [loadedModels, searchQuery, fuse]);

	const filteredFlatList = useMemo(() => {
		const list: FlattenedModel[] = [];
		for (const [providerKey, providerData] of Object.entries(filteredModels)) {
			for (const modelItem of providerData.models) {
				list.push({
					providerKey,
					providerLabel: providerData.label,
					modelId: modelItem.id,
					modelLabel: modelItem.label,
					toolCall: modelItem.toolCall,
					reasoningText: modelItem.reasoningText,
					contextWindow: modelItem.contextWindow,
					maxOutputTokens: modelItem.maxOutputTokens,
					available: modelItem.available,
					unavailableReason: modelItem.unavailableReason,
				});
			}
		}
		return list;
	}, [filteredModels]);

	useEffect(() => {
		if (isOpen) {
			setHighlightedIndex(0);
		}
	}, [isOpen]);

	useEffect(() => {
		if (
			isOpen &&
			highlightedIndex >= 0 &&
			highlightedIndex < itemRefs.current.length
		) {
			itemRefs.current[highlightedIndex]?.scrollIntoView({
				block: 'nearest',
				behavior: 'smooth',
			});
		}
	}, [highlightedIndex, isOpen]);

	useEffect(() => {
		const handleClickOutside = (event: MouseEvent) => {
			if (
				dropdownRef.current &&
				!dropdownRef.current.contains(event.target as Node) &&
				(!menuRef.current || !menuRef.current.contains(event.target as Node))
			) {
				setIsOpen(false);
			}
		};

		const handleEscape = (event: KeyboardEvent) => {
			const target = event.target as HTMLElement;
			const isInInput =
				target.tagName === 'INPUT' ||
				target.tagName === 'TEXTAREA' ||
				target.isContentEditable;
			if (event.key === 'Escape' || (event.key === 'q' && !isInInput)) {
				setIsOpen(false);
			}
		};

		if (isOpen) {
			document.addEventListener('mousedown', handleClickOutside);
			document.addEventListener('keydown', handleEscape);
			setTimeout(() => searchInputRef.current?.focus(), 0);
		}

		return () => {
			document.removeEventListener('mousedown', handleClickOutside);
			document.removeEventListener('keydown', handleEscape);
		};
	}, [isOpen]);

	useLayoutEffect(() => {
		if (!isOpen || dropdownMode !== 'portal') return;
		const update = () => {
			const el = triggerRef.current;
			if (!el) return;
			const rect = el.getBoundingClientRect();
			const margin = 8;
			const maxPanel = 320;
			const spaceBelow = window.innerHeight - rect.bottom - margin;
			const spaceAbove = rect.top - margin;
			const openUp =
				spaceBelow < Math.min(maxPanel, 240) && spaceAbove > spaceBelow;
			setMenuStyle({
				position: 'fixed',
				left: rect.left,
				width: rect.width,
				maxHeight: Math.max(
					160,
					Math.min(maxPanel, openUp ? spaceAbove : spaceBelow),
				),
				...(openUp
					? { bottom: window.innerHeight - rect.top + 4 }
					: { top: rect.bottom + 4 }),
			});
		};
		update();
		window.addEventListener('resize', update);
		window.addEventListener('scroll', update, true);
		return () => {
			window.removeEventListener('resize', update);
			window.removeEventListener('scroll', update, true);
		};
	}, [isOpen, dropdownMode]);

	const handleSelect = (
		selectedProvider: string,
		selectedModel: string,
		available?: boolean,
	) => {
		if (available === false) return;
		onChange(selectedProvider, selectedModel);
		setIsOpen(false);
		setSearchQuery('');
	};

	const handleSearchKeyDown = (event: React.KeyboardEvent) => {
		if (filteredFlatList.length === 0) return;

		if (event.key === 'ArrowDown' || (event.ctrlKey && event.key === 'j')) {
			event.preventDefault();
			setHighlightedIndex((prev) =>
				prev < filteredFlatList.length - 1 ? prev + 1 : 0,
			);
		} else if (
			event.key === 'ArrowUp' ||
			(event.ctrlKey && event.key === 'k')
		) {
			event.preventDefault();
			setHighlightedIndex((prev) =>
				prev > 0 ? prev - 1 : filteredFlatList.length - 1,
			);
		} else if (event.key === 'Enter') {
			event.preventDefault();
			const highlighted = filteredFlatList[highlightedIndex];
			if (highlighted && highlighted.available !== false) {
				handleSelect(
					highlighted.providerKey,
					highlighted.modelId,
					highlighted.available,
				);
			}
		}
	};

	const currentProviderLabel =
		loadedModels[provider]?.label || currentProviderModels?.label || provider;
	const currentModelLabel =
		loadedModels[provider]?.models.find((m) => m.id === model)?.label ||
		currentProviderModels?.models.find((m) => m.id === model)?.label ||
		model;
	const displayedProviderKeys = searchQuery.trim()
		? Object.keys(filteredModels)
		: configuredProviders;
	const dropdownPositionClass =
		dropdownMode === 'inline' ? 'relative' : 'absolute z-50';

	const wrapDropdown = (children: ReactNode) =>
		dropdownMode === 'portal' ? (
			createPortal(
				<div
					ref={menuRef}
					style={menuStyle}
					className="z-[10000] bg-[hsl(var(--popover))] border border-[hsl(var(--border))] rounded-md shadow-lg overflow-hidden flex flex-col"
				>
					{children}
				</div>,
				document.body,
			)
		) : (
			<div
				className={`${dropdownPositionClass} mt-1 w-full bg-[hsl(var(--popover))] border border-[hsl(var(--border))] rounded-md shadow-lg max-h-80 overflow-hidden flex flex-col`}
			>
				{children}
			</div>
		);

	return (
		<div ref={dropdownRef} className="relative w-full">
			<button
				type="button"
				ref={triggerRef}
				onClick={() => !disabled && setIsOpen(!isOpen)}
				disabled={disabled}
				className="w-full flex items-center justify-between px-3 py-2 bg-[hsl(var(--secondary))] border border-[hsl(var(--border))] rounded-md hover:bg-[hsl(var(--accent))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
			>
				<span className="flex items-center gap-2 text-sm truncate">
					{!provider && !model && placeholder ? (
						<span className="text-[hsl(var(--muted-foreground))]">
							{placeholder}
						</span>
					) : (
						<>
							<span className="text-[hsl(var(--muted-foreground))]">
								{currentProviderLabel}
							</span>
							<span className="text-[hsl(var(--muted-foreground))]/50">/</span>
							<span className="text-[hsl(var(--foreground))]">
								{currentModelLabel}
							</span>
						</>
					)}
				</span>
				<ChevronDown
					className={`w-4 h-4 text-[hsl(var(--muted-foreground))] transition-transform ${isOpen ? 'rotate-180' : ''}`}
				/>
			</button>
			{isOpen &&
				wrapDropdown(
					<>
						<div className="p-2 border-b border-[hsl(var(--border))]">
							<div className="relative">
								<Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[hsl(var(--muted-foreground))]" />
								<input
									ref={searchInputRef}
									type="text"
									value={searchQuery}
									onChange={(e) => setSearchQuery(e.target.value)}
									onKeyDown={handleSearchKeyDown}
									placeholder="Search providers and models..."
									className="w-full pl-9 pr-3 py-2 bg-[hsl(var(--secondary))] border border-[hsl(var(--border))] rounded text-sm text-[hsl(var(--foreground))] placeholder-[hsl(var(--muted-foreground))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]"
								/>
							</div>
						</div>

						<div className="overflow-y-auto">
							{displayedProviderKeys.length === 0 ? (
								<div className="p-4 text-center text-[hsl(var(--muted-foreground))] text-sm">
									{isCurrentProviderLoading
										? 'Loading models...'
										: 'No models found'}
								</div>
							) : (
								displayedProviderKeys.map((providerKey) => {
									const providerData = filteredModels[providerKey];
									const isProviderLoading =
										loadingProviders[providerKey] ||
										(providerKey === provider &&
											isCurrentProviderLoading &&
											!providerData);

									return (
										<div
											key={providerKey}
											className="border-b border-[hsl(var(--border))] last:border-0"
										>
											<div className="sticky top-0 px-3 py-2 text-xs font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-wider bg-[hsl(var(--muted))] z-10">
												{providerData?.label || providerKey}
											</div>
											<div>
												{isProviderLoading ? (
													<div className="px-4 py-2 text-sm text-[hsl(var(--muted-foreground))]">
														Loading models...
													</div>
												) : providerData?.models.length ? (
													providerData.models.map((modelItem) => {
														const isSelected =
															providerKey === provider &&
															modelItem.id === model;
														const flatIndex = filteredFlatList.findIndex(
															(item) =>
																item.providerKey === providerKey &&
																item.modelId === modelItem.id,
														);
														const isHighlighted =
															flatIndex === highlightedIndex;
														const isAvailable = modelItem.available !== false;

														return (
															<button
																key={modelItem.id}
																ref={(el) => {
																	if (flatIndex >= 0) {
																		itemRefs.current[flatIndex] = el;
																	}
																}}
																type="button"
																disabled={!isAvailable}
																title={modelItem.unavailableReason}
																onClick={() =>
																	handleSelect(
																		providerKey,
																		modelItem.id,
																		modelItem.available,
																	)
																}
																onMouseEnter={() =>
																	setHighlightedIndex(flatIndex)
																}
																className={`w-full text-left px-4 py-2 text-sm flex items-center justify-between transition-colors ${
																	isHighlighted
																		? 'bg-[hsl(var(--accent))]'
																		: 'hover:bg-[hsl(var(--accent))]'
																} ${
																	isSelected
																		? 'text-[hsl(var(--accent-foreground))] font-medium'
																		: 'text-[hsl(var(--foreground))]'
																} ${
																	!isAvailable
																		? 'opacity-60 cursor-not-allowed'
																		: ''
																}`}
															>
																<span className="truncate">
																	{modelItem.label}
																</span>
																{(!isAvailable ||
																	modelItem.toolCall ||
																	modelItem.reasoningText) && (
																	<div className="flex gap-1 ml-2 flex-shrink-0">
																		{!isAvailable && (
																			<span className="text-[10px] px-1.5 py-0.5 bg-red-600/20 text-red-400 rounded">
																				Unavailable
																			</span>
																		)}
																		{modelItem.toolCall && (
																			<span className="text-[10px] px-1.5 py-0.5 bg-green-600/20 text-green-400 rounded">
																				Tools
																			</span>
																		)}
																		{modelItem.reasoningText && (
																			<span className="text-[10px] px-1.5 py-0.5 bg-purple-600/20 text-purple-400 rounded">
																				Reasoning
																			</span>
																		)}
																	</div>
																)}
															</button>
														);
													})
												) : (
													<div className="px-4 py-2 text-sm text-[hsl(var(--muted-foreground))]">
														No models available
													</div>
												)}
											</div>
										</div>
									);
								})
							)}
						</div>
					</>,
				)}
		</div>
	);
});
