import { useLayoutEffect, useRef, useState } from 'react';

export type ReasoningLevel =
	| 'minimal'
	| 'low'
	| 'medium'
	| 'high'
	| 'max'
	| 'xhigh';

export const REASONING_LEVELS: { value: ReasoningLevel; label: string }[] = [
	{ value: 'minimal', label: 'Minimal' },
	{ value: 'low', label: 'Low' },
	{ value: 'medium', label: 'Medium' },
	{ value: 'high', label: 'High' },
	{ value: 'max', label: 'Max' },
	{ value: 'xhigh', label: 'X-High' },
];

interface ReasoningTabsProps {
	value: ReasoningLevel;
	onChange: (level: ReasoningLevel) => void;
	disabled?: boolean;
}

export function ReasoningTabs({
	value,
	onChange,
	disabled = false,
}: ReasoningTabsProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const [pillStyle, setPillStyle] = useState({ left: 0, width: 0 });

	useLayoutEffect(() => {
		if (!containerRef.current) return;
		const activeIndex = REASONING_LEVELS.findIndex(
			(level) => level.value === value,
		);
		const buttons =
			containerRef.current.querySelectorAll<HTMLButtonElement>('[data-tab]');
		const activeBtn = buttons[activeIndex];
		if (activeBtn) {
			setPillStyle({
				left: activeBtn.offsetLeft,
				width: activeBtn.offsetWidth,
			});
		}
	}, [value]);

	return (
		<div
			ref={containerRef}
			className={`relative flex rounded-full bg-muted p-1 ${disabled ? 'opacity-40 pointer-events-none' : ''}`}
		>
			<div
				className="absolute top-1 bottom-1 rounded-full bg-foreground shadow-md"
				style={{
					left: pillStyle.left,
					width: pillStyle.width,
					transition: 'left 200ms ease, width 200ms ease',
				}}
			/>
			{REASONING_LEVELS.map((level) => (
				<button
					key={level.value}
					data-tab
					type="button"
					onClick={() => onChange(level.value)}
					disabled={disabled}
					className={`relative z-10 flex-1 px-3 py-1.5 text-xs font-medium rounded-full transition-colors duration-200 ${
						value === level.value
							? 'text-background'
							: 'text-muted-foreground hover:text-foreground'
					}`}
				>
					{level.label}
				</button>
			))}
		</div>
	);
}
