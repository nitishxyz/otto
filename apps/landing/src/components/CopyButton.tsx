import { useState, useCallback } from 'react';

export function CopyButton({
	text,
	className = '',
	eventName,
	eventProps,
}: {
	text: string;
	className?: string;
	eventName?: string;
	eventProps?: string;
}) {
	const [copied, setCopied] = useState(false);

	const copy = useCallback(() => {
		navigator.clipboard.writeText(text).then(() => {
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		});
	}, [text]);

	return (
		<button
			type="button"
			onClick={copy}
			className={`p-1.5 rounded-sm text-otto-dim hover:text-otto-text hover:bg-otto-card transition-colors ${className}`}
			title="Copy to clipboard"
			data-s-event={eventName}
			data-s-event-props={eventProps}
		>
			{copied ? (
				<svg
					aria-hidden="true"
					className="w-3.5 h-3.5 text-emerald-500"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="2"
					strokeLinecap="round"
					strokeLinejoin="round"
				>
					<path d="M20 6 9 17l-5-5" />
				</svg>
			) : (
				<svg
					aria-hidden="true"
					className="w-3.5 h-3.5"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="2"
					strokeLinecap="round"
					strokeLinejoin="round"
				>
					<rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
					<path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
				</svg>
			)}
		</button>
	);
}
