import { useEffect } from 'react';
import { Outlet, createRootRoute } from '@tanstack/react-router';
import {
	OnboardingModal,
	OttoRouterTopupModal,
	useAuthStatus,
} from '@ottocode/web-sdk';
import { isHostedApp } from '../lib/hosted-app';

export const Route = createRootRoute({
	component: RootComponent,
});

function RootComponent() {
	const { checkOnboarding } = useAuthStatus();

	useEffect(() => {
		if (isHostedApp() && window.location.pathname === '/') {
			return;
		}
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
