import { OttoWordmark } from './OttoWordmark';

/** `isHome` switches on the homepage-only NeoPop rule. Other pages are untouched. */
export function Footer({ isHome = false }: { isHome?: boolean }) {
	return (
		<footer
			className={`bg-otto-bg ${
				isHome ? 'np-edge-t' : 'border-t border-otto-border'
			}`}
		>
			<div
				className={`mx-auto px-6 py-10 ${
					isHome ? 'max-w-[1080px] sm:px-8 lg:px-12' : 'max-w-4xl'
				}`}
			>
				<div className="flex flex-col sm:flex-row justify-between items-start gap-8">
					<div>
						<OttoWordmark height={14} className="text-otto-dim mb-3" />
						<p className="text-otto-dim text-xs">Open source. MIT license.</p>
					</div>

					<div className="flex gap-10 text-xs">
						<div className="space-y-2">
							<a
								href="/docs"
								className="block text-otto-dim hover:text-otto-muted transition-colors"
							>
								Docs
							</a>
							<a
								href="/docs/usage"
								className="block text-otto-dim hover:text-otto-muted transition-colors"
							>
								Usage
							</a>
							<a
								href="/docs/agents-tools"
								className="block text-otto-dim hover:text-otto-muted transition-colors"
							>
								Agents
							</a>
							<a
								href="/docs/architecture"
								className="block text-otto-dim hover:text-otto-muted transition-colors"
							>
								Architecture
							</a>
						</div>
						<div className="space-y-2">
							<a
								href="https://github.com/nitishxyz/otto"
								target="_blank"
								rel="noopener noreferrer"
								className="block text-otto-dim hover:text-otto-muted transition-colors"
							>
								GitHub
							</a>
							<a
								href="https://github.com/nitishxyz/otto/issues"
								target="_blank"
								rel="noopener noreferrer"
								className="block text-otto-dim hover:text-otto-muted transition-colors"
							>
								Issues
							</a>
							<a
								href="https://www.npmjs.com/package/@ottocode/install"
								target="_blank"
								rel="noopener noreferrer"
								className="block text-otto-dim hover:text-otto-muted transition-colors"
							>
								npm
							</a>
						</div>
					</div>
				</div>
			</div>
		</footer>
	);
}
