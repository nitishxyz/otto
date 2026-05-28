import { CopyButton } from './CopyButton';

export function TerminalBlock({
	children,
	title,
	copyText,
	copyEventName,
	copyEventProps,
}: {
	children: React.ReactNode;
	title?: string;
	copyText?: string;
	copyEventName?: string;
	copyEventProps?: string;
}) {
	return (
		<div className="relative bg-otto-surface border border-otto-border rounded-lg overflow-hidden group/term">
			<div className="flex items-center gap-2 px-4 py-2.5 border-b border-otto-border relative">
				<div className="w-2.5 h-2.5 rounded-full bg-[#ff5f57]" />
				<div className="w-2.5 h-2.5 rounded-full bg-[#febc2e]" />
				<div className="w-2.5 h-2.5 rounded-full bg-[#28c840]" />
				{title && (
					<span className="ml-1.5 text-otto-dim text-[11px]">{title}</span>
				)}
				{copyText && (
					<CopyButton
						text={copyText}
						className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover/term:opacity-100"
						eventName={copyEventName}
						eventProps={copyEventProps}
					/>
				)}
			</div>
			<div className="p-4 text-[13px] leading-relaxed font-mono">
				{children}
			</div>
		</div>
	);
}
