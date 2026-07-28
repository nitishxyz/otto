import { CopyButton } from './CopyButton';

export function CodeBlock({ children }: { children: string }) {
	return (
		<div className="relative group/code">
			<CopyButton
				text={children}
				className="absolute right-2.5 top-2.5 np-edge bg-otto-bg opacity-0 group-hover/code:opacity-100"
			/>
			<pre>
				<code>{children}</code>
			</pre>
		</div>
	);
}
