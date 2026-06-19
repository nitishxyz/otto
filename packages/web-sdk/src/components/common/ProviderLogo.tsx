import { memo } from 'react';

import {
	anthropicLogo,
	openaiLogo,
	googleLogo,
	ollamaCloudLogo,
	openrouterLogo,
	groqLogo,
	deepseekLogo,
	xaiLogo,
	zaiLogo,
	ottorouterLogo,
	minimaxLogo,
	kimiLogo,
	opencodeLogo,
	huggingfaceLogo,
	copilotLogo,
} from '../../assets/provider-logos';

const providerLogos: Record<string, string> = {
	anthropic: anthropicLogo,
	openai: openaiLogo,
	google: googleLogo,
	ollama: ollamaCloudLogo,
	'ollama-cloud': ollamaCloudLogo,
	openrouter: openrouterLogo,
	groq: groqLogo,
	deepseek: deepseekLogo,
	xai: xaiLogo,
	zai: zaiLogo,
	'zai-coding': zaiLogo,
	ottorouter: ottorouterLogo,
	minimax: minimaxLogo,
	kimi: kimiLogo,
	opencode: opencodeLogo,
	huggingface: huggingfaceLogo,
	copilot: copilotLogo,
};

interface ProviderLogoProps {
	provider: string;
	className?: string;
	size?: number;
}

export const ProviderLogo = memo(function ProviderLogo({
	provider,
	className = '',
	size = 16,
}: ProviderLogoProps) {
	const normalizedProvider = provider.toLowerCase();
	const logoSvg =
		providerLogos[normalizedProvider] ??
		(normalizedProvider.includes('ollama') ? ollamaCloudLogo : undefined);

	if (!logoSvg) {
		return (
			<span
				className={`inline-flex items-center justify-center text-[10px] font-medium text-muted-foreground uppercase ${className}`}
				style={{ width: size, height: size }}
				title={provider}
			>
				{provider.slice(0, 2)}
			</span>
		);
	}

	return (
		<span
			className={`inline-flex items-center justify-center text-foreground/70 dark:text-foreground/80 ${className}`}
			style={{ width: size, height: size }}
			title={provider}
			// biome-ignore lint/security/noDangerouslySetInnerHtml: SVG logos are hardcoded trusted content
			dangerouslySetInnerHTML={{
				__html: logoSvg.replace(
					/<svg/,
					`<svg width="${size}" height="${size}" style="width:${size}px;height:${size}px"`,
				),
			}}
		/>
	);
});
