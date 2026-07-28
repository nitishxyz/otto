import {
	GetStartedSection,
	HeroSection,
	ProvidersSection,
	SurfacesSection,
	UseCasesSection,
} from './home';

export function Landing() {
	return (
		<main className="w-full overflow-x-clip">
			<HeroSection />
			<UseCasesSection />
			<SurfacesSection />
			<ProvidersSection />
			<GetStartedSection />
		</main>
	);
}
