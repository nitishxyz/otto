import { useEffect } from 'react';
import { Outlet, createRootRoute } from '@tanstack/react-router';
import {
	OnboardingModal,
	OttoRouterTopupModal,
	useAuthStatus,
} from '@ottocode/web-sdk';

export const Route = createRootRoute({
	component: RootComponent,
});

function RootComponent() {
	const { checkOnboarding } = useAuthStatus();

	useEffect(() => {
		checkOnboarding();
	}, [checkOnboarding]);

	return (
		<>
			<Outlet />
			<OnboardingModal />
			<OttoRouterTopupModal />
		</>
	);
}
