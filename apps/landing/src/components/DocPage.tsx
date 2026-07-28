import { useRef, type ReactNode } from 'react';
import { CopyMarkdownButton } from './CopyMarkdownButton';

export function DocPage({ children }: { children: ReactNode }) {
	const ref = useRef<HTMLDivElement>(null);
	return (
		<div>
			<div className="mb-6 flex justify-end">
				<CopyMarkdownButton contentRef={ref} />
			</div>
			<div ref={ref}>{children}</div>
		</div>
	);
}
