import { memo } from 'react';
import { UnifiedModelSelector } from '../chat/UnifiedModelSelector';

interface AgentProviderModelFieldsProps {
	provider: string;
	model: string;
	onProviderChange: (provider: string) => void;
	onModelChange: (model: string) => void;
	disabled?: boolean;
}

export const AgentProviderModelFields = memo(function AgentProviderModelFields({
	provider,
	model,
	onProviderChange,
	onModelChange,
	disabled,
}: AgentProviderModelFieldsProps) {
	const effectiveProvider = provider.trim();
	const effectiveModel = model.trim();
	const hasOverride = Boolean(effectiveProvider || effectiveModel);

	const handleChange = (nextProvider: string, nextModel: string) => {
		onProviderChange(nextProvider);
		onModelChange(nextModel);
	};

	const clearOverride = () => {
		onProviderChange('');
		onModelChange('');
	};

	return (
		<div className="space-y-1.5">
			<div className="flex items-center justify-between gap-2">
				<div>
					<div className="text-sm font-medium text-foreground">
						Model override
					</div>
					<p className="mt-0.5 text-xs text-muted-foreground">
						Optional. Overrides the session default provider and model for this
						agent.
					</p>
				</div>
				{hasOverride ? (
					<button
						type="button"
						onClick={clearOverride}
						disabled={disabled}
						className="shrink-0 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
					>
						Clear
					</button>
				) : null}
			</div>
			<UnifiedModelSelector
				provider={effectiveProvider}
				model={effectiveModel}
				onChange={handleChange}
				disabled={disabled}
				dropdownMode="portal"
				placeholder="Inherit session default"
			/>
		</div>
	);
});
