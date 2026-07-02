import { useEffect, useMemo, useRef } from 'react';
import { useConfig, useUpdateDefaults } from '../../hooks/useConfig';
import { useAgentDetails } from '../../hooks/useAgents';
import { Modal } from '../ui/Modal';
import {
	UnifiedModelSelector,
	type UnifiedModelSelectorRef,
} from './UnifiedModelSelector';
import {
	UnifiedAgentSelector,
	type UnifiedAgentSelectorRef,
} from './UnifiedAgentSelector';
import { ReasoningTabs, type ReasoningLevel } from './ReasoningTabs';

interface ConfigModalProps {
	isOpen: boolean;
	onClose: () => void;
	initialFocus?: 'agent' | 'model' | null;
	chatInputRef?: React.RefObject<{ focus: () => void }>;
	agent: string;
	provider: string;
	model: string;
	modelSupportsReasoning?: boolean;
	onAgentChange: (agent: string) => void;
	onProviderChange: (provider: string) => void;
	onModelChange: (model: string) => void;
	onModelSelectorChange?: (provider: string, model: string) => void;
	modalPosition?: 'fixed' | 'absolute';
	/** Hides the agent picker (e.g. otto sessions, where the agent is fixed). */
	hideAgentSelector?: boolean;
}

export function ConfigModal({
	isOpen,
	onClose,
	initialFocus,
	chatInputRef,
	agent,
	provider,
	model,
	modelSupportsReasoning,
	onAgentChange,
	onProviderChange,
	onModelChange,
	onModelSelectorChange,
	modalPosition = 'fixed',
	hideAgentSelector = false,
}: ConfigModalProps) {
	const { data: config, isLoading: configLoading } = useConfig();
	const { data: agentDetails } = useAgentDetails({ enabled: true });
	const updateDefaults = useUpdateDefaults();
	const reasoningEnabled = config?.defaults?.reasoningText ?? true;
	const reasoningLevel = config?.defaults?.reasoningLevel ?? 'high';
	const agentNames = useMemo(
		() =>
			(agentDetails?.agents.length
				? agentDetails.agents.map((agentDetail) => agentDetail.name)
				: (config?.agents ?? [])
			).filter((name) => name !== 'looper'),
		[agentDetails?.agents, config?.agents],
	);
	const agentSelectorRef = useRef<UnifiedAgentSelectorRef>(null);
	const modelSelectorRef = useRef<UnifiedModelSelectorRef>(null);

	useEffect(() => {
		if (isOpen && initialFocus) {
			setTimeout(() => {
				if (initialFocus === 'agent') {
					agentSelectorRef.current?.openAndFocus();
				} else if (initialFocus === 'model') {
					modelSelectorRef.current?.openAndFocus();
				}
			}, 100);
		}
	}, [isOpen, initialFocus]);

	const handleClose = () => {
		onClose();
		setTimeout(() => {
			chatInputRef?.current?.focus();
		}, 100);
	};

	const handleModelChange = (
		selectedProvider: string,
		selectedModel: string,
	) => {
		if (onModelSelectorChange) {
			onModelSelectorChange(selectedProvider, selectedModel);
		} else {
			onProviderChange(selectedProvider);
			onModelChange(selectedModel);
		}
	};

	return (
		<Modal
			isOpen={isOpen}
			onClose={handleClose}
			title="Configuration"
			closeOnEscape={true}
			closeOnBackdropClick={true}
			maxWidth="lg"
			position={modalPosition}
		>
			{configLoading ? (
				<div className="text-center text-muted-foreground py-8">
					Loading configuration...
				</div>
			) : config ? (
				<div className="space-y-4">
					{modelSupportsReasoning && (
						<div className="space-y-3">
							<div className="flex items-center justify-between">
								<div className="text-sm font-medium text-foreground">
									Extended Thinking
								</div>
								<button
									type="button"
									role="switch"
									aria-checked={reasoningEnabled}
									onClick={() =>
										updateDefaults.mutate({
											reasoningText: !reasoningEnabled,
											scope: 'global',
										})
									}
									className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 ${
										reasoningEnabled ? 'bg-primary' : 'bg-muted'
									}`}
								>
									<span
										className={`inline-block h-4 w-4 transform rounded-full transition-transform ${
											reasoningEnabled ? 'translate-x-6' : 'translate-x-1'
										} ${reasoningEnabled ? 'bg-primary-foreground' : 'bg-foreground'}`}
									/>
								</button>
							</div>
							<ReasoningTabs
								value={reasoningLevel as ReasoningLevel}
								onChange={(level) =>
									updateDefaults.mutate({
										reasoningLevel: level,
										scope: 'global',
									})
								}
								disabled={!reasoningEnabled}
							/>
						</div>
					)}

					{!hideAgentSelector && (
						<div>
							<div className="block text-sm font-medium text-foreground mb-2">
								Agent
							</div>
							<UnifiedAgentSelector
								ref={agentSelectorRef}
								agent={agent}
								agents={agentNames}
								onChange={onAgentChange}
							/>
						</div>
					)}

					<div>
						<div className="block text-sm font-medium text-foreground mb-2">
							Provider / Model
						</div>
						<UnifiedModelSelector
							ref={modelSelectorRef}
							provider={provider}
							model={model}
							onChange={handleModelChange}
							dropdownMode="inline"
						/>
					</div>
				</div>
			) : null}
		</Modal>
	);
}
