import {
	NeoBadge,
	NeoBox,
	NeoButton,
	NeoEyebrow,
	NeoReveal,
	NeoSection,
} from '../../components/neopop';
import { ProviderLogo } from '../../components/ProviderLogo';
import { PlugIcon } from './icons';

const PROVIDERS = [
	{ id: 'anthropic', name: 'Anthropic' },
	{ id: 'openai', name: 'OpenAI' },
	{ id: 'google', name: 'Google' },
	{ id: 'ottorouter', name: 'OttoRouter' },
	{ id: 'openrouter', name: 'OpenRouter' },
	{ id: 'copilot', name: 'Copilot' },
	{ id: 'opencode', name: 'OpenCode' },
	{ id: 'deepseek', name: 'DeepSeek' },
	{ id: 'zai', name: 'Z.AI' },
	{ id: 'zai-coding', name: 'Z.AI Coding' },
	{ id: 'kimi', name: 'Kimi' },
	{ id: 'minimax', name: 'MiniMax' },
	{ id: 'meta', name: 'Meta' },
	{ id: 'baseten', name: 'Baseten' },
	{ id: 'huggingface', name: 'Hugging Face' },
	{ id: 'wafer', name: 'Wafer' },
	{ id: 'ollama-cloud', name: 'Ollama Cloud' },
	{ id: 'xai', name: 'xAI' },
];

export function ProvidersSection() {
	return (
		<NeoSection id="models" aria-labelledby="models-title">
			<div className="py-16 sm:py-20">
				<div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_1fr] lg:items-start lg:gap-12">
					<NeoReveal>
						<NeoEyebrow>Your models, your keys</NeoEyebrow>
						<h2
							id="models-title"
							className="np-title mt-4 max-w-[15ch] text-otto-text"
						>
							Bring the model you already pay for.
						</h2>
						<p className="mt-5 max-w-[46ch] text-[14px] leading-relaxed text-otto-muted">
							Sign in with an existing Claude or ChatGPT subscription, paste an
							API key, or use GitHub Copilot. Keys stay on your machine and you
							can switch models mid-session.
						</p>

						<div className="mt-6 flex flex-wrap gap-2">
							<NeoBadge tone="lime" size="sm">
								Subscription OAuth
							</NeoBadge>
							<NeoBadge tone="yellow" size="sm">
								API keys
							</NeoBadge>
							<NeoBadge outline size="sm">
								Local only
							</NeoBadge>
						</div>
					</NeoReveal>

					<NeoReveal delay={90}>
						<ul className="grid grid-cols-2 gap-px border-2 border-otto-border bg-otto-border sm:grid-cols-3 rounded-[3px] overflow-hidden">
							{PROVIDERS.map((p) => (
								<li
									key={p.id}
									className="flex items-center gap-2 bg-otto-surface px-3 py-2.5"
								>
									<ProviderLogo
										provider={p.id}
										size={16}
										className="shrink-0 text-otto-text"
									/>
									<span className="truncate text-[12px] text-otto-muted">
										{p.name}
									</span>
								</li>
							))}
						</ul>
						<p className="mt-2 text-[11px] text-otto-dim">
							Plus any OpenAI-compatible endpoint and local Ollama models.
						</p>

						<NeoBox
							tone="surface"
							elevation="sm"
							className="mt-4 flex flex-col gap-4 p-4 sm:flex-row sm:items-center"
						>
							<span className="flex h-9 w-9 shrink-0 items-center justify-center border-2 border-otto-border bg-np-blue text-np-blue-on rounded-[3px]">
								<PlugIcon className="h-4 w-4" />
							</span>
							<div className="min-w-0 flex-1">
								<p className="text-[13px] font-semibold text-otto-text">
									No subscription? Use OttoRouter.
								</p>
								<p className="mt-0.5 text-[12px] leading-relaxed text-otto-muted">
									Pay-per-request access to leading models, no monthly plan.
								</p>
							</div>
							<NeoButton
								href="https://ottorouter.org"
								tone="blue"
								size="sm"
								className="shrink-0"
								data-s-event="Click OttoRouter CTA"
								data-s-event-props="source=models"
							>
								OttoRouter
							</NeoButton>
						</NeoBox>
					</NeoReveal>
				</div>
			</div>
		</NeoSection>
	);
}
