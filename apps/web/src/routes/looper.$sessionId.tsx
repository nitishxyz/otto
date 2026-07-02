import { createFileRoute } from '@tanstack/react-router';
import { SessionsLayout } from '../components/sessions/SessionsLayout';

export const Route = createFileRoute('/looper/$sessionId')({
	component: LooperSessionRoute,
});

function LooperSessionRoute() {
	const { sessionId } = Route.useParams();
	return <SessionsLayout view="looper" sessionId={sessionId} />;
}
