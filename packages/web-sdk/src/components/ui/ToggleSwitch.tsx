import { memo } from 'react';
import { StableSpinner } from './StableSpinner';

export const ToggleSwitch = memo(function ToggleSwitch({
	checked,
	loading,
	onChange,
	disabled,
}: {
	checked: boolean;
	loading?: boolean;
	onChange: () => void;
	disabled?: boolean;
}) {
	return (
		<button
			type="button"
			role="switch"
			aria-checked={checked}
			disabled={disabled || loading}
			onClick={(event) => {
				event.stopPropagation();
				onChange();
			}}
			className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors duration-200 focus-visible:outline-none disabled:opacity-50 disabled:cursor-not-allowed ${
				checked ? 'bg-green-500' : 'bg-muted-foreground/30'
			}`}
		>
			<span
				className={`inline-block h-3.5 w-3.5 rounded-full transition-transform duration-200 ${
					checked ? 'translate-x-[18px]' : 'translate-x-[3px]'
				} ${loading ? 'bg-transparent' : 'bg-white'}`}
			>
				{loading ? (
					<StableSpinner size="sm" className="text-white" title="Updating" />
				) : null}
			</span>
		</button>
	);
});
