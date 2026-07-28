import { ProviderLogo } from '../../components/ProviderLogo';
import { Reveal } from '../../components/Reveal';

const PROVIDERS = [
	{
		id: 'anthropic',
		name: 'Anthropic',
		models: 'Claude 4.5 Sonnet, Opus',
		auth: ['API key', 'Pro/Max (OAuth)'],
	},
	{
		id: 'openai',
		name: 'OpenAI',
		models: 'GPT-4o, o1, Codex Mini',
		auth: ['API key', 'Pro/Max (OAuth)'],
	},
	{
		id: 'google',
		name: 'Google',
		models: 'Gemini 2.5 Pro, Flash',
		auth: ['API key'],
	},
	{
		id: 'openrouter',
		name: 'OpenRouter',
		models: '100+ models',
		auth: ['API key'],
	},
	{
		id: 'opencode',
		name: 'OpenCode',
		models: 'Anthropic & OpenAI models',
		auth: ['API key'],
	},
	{
		id: 'copilot',
		name: 'Copilot',
		models: 'GitHub Copilot models',
		auth: ['OAuth'],
	},
	{
		id: 'ottorouter',
		name: 'OttoRouter',
		models: 'Pay-per-use across providers',
		auth: ['OAuth'],
	},
	{ id: 'zai', name: 'Zai', models: 'Zai frontier models', auth: ['API key'] },
	{
		id: 'kimi',
		name: 'Kimi',
		models: 'Kimi models',
		auth: ['API key'],
	},
	{
		id: 'minimax',
		name: 'MiniMax',
		models: 'MiniMax M2.5, M2.1',
		auth: ['API key'],
	},
];

export function ProvidersSection() {
	return (
		<section className="py-28 sm:py-36 px-6 border-t border-otto-border">
			<div className="max-w-[1100px] mx-auto">
				<Reveal>
					<p className="text-otto-dim text-xs uppercase tracking-[0.2em] mb-4">
						Providers
					</p>
					<h2 className="text-2xl sm:text-3xl font-bold mb-16 max-w-sm">
						Every frontier model
					</h2>
				</Reveal>

				<div className="grid grid-cols-2 sm:grid-cols-3 gap-px bg-otto-border rounded-lg overflow-hidden">
					{PROVIDERS.map((p, i) => (
						<Reveal key={p.id} delay={i * 40}>
							<div className="bg-otto-bg p-5 sm:p-6 h-full">
								<div className="flex items-center gap-2.5 mb-2">
									<ProviderLogo
										provider={p.id}
										size={18}
										className="text-otto-text"
									/>
									<span className="text-sm font-medium">{p.name}</span>
								</div>
								<p className="text-otto-dim text-xs mb-3">{p.models}</p>
								<div className="flex flex-wrap gap-1.5">
									{p.auth.map((a) => (
										<span
											key={a}
											className="text-[10px] text-otto-dim bg-otto-surface px-2 py-0.5 rounded border border-otto-border"
										>
											{a}
										</span>
									))}
								</div>
							</div>
						</Reveal>
					))}
					{Array.from({ length: (3 - (PROVIDERS.length % 3)) % 3 }).map(
						(_, i) => (
							<div key={`pad-${i}`} className="bg-otto-bg" />
						),
					)}
				</div>
			</div>
		</section>
	);
}
