import { createFileRoute } from '@tanstack/react-router';
import { SessionsLayout } from '../components/sessions/SessionsLayout';

export const Route = createFileRoute('/otto/$sessionId')({
	component: OttoSessionRoute,
});

function OttoSessionRoute() {
	const { sessionId } = Route.useParams();
	return <SessionsLayout view="otto" sessionId={sessionId} />;
}
