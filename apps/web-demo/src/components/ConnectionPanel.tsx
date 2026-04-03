import type { ChannelClientStatus } from "@pandemicsyn/cf-do-channel-client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { ConnectionFormState } from "../demo-state";

type ConnectionPanelProps = {
	config: ConnectionFormState;
	connection: ChannelClientStatus;
	runtimeError: string | null;
	onConfigChange: (field: keyof ConnectionFormState, value: string) => void;
	onConnect: () => void;
	onDisconnect: () => void;
};

export function ConnectionPanel(props: ConnectionPanelProps) {
	return (
		<Card className="frame control-panel">
			<CardHeader className="panel-heading">
				<CardTitle>Signal Input</CardTitle>
				<CardDescription>Credentialed demo access through the Worker token endpoint. The thread ID is the stable chat key, not the full session model.</CardDescription>
			</CardHeader>
			<CardContent>

			<label className="field">
				<span>Worker base URL</span>
				<Input
					value={props.config.baseUrl}
					onChange={(event) => props.onConfigChange("baseUrl", event.target.value)}
					placeholder="https://your-worker.example.workers.dev"
				/>
			</label>
			<label className="field">
				<span>Thread ID</span>
				<Input
					value={props.config.conversationId}
					onChange={(event) => props.onConfigChange("conversationId", event.target.value)}
				/>
			</label>
			<label className="field">
				<span>Client ID</span>
				<Input
					value={props.config.clientId}
					onChange={(event) => props.onConfigChange("clientId", event.target.value)}
				/>
			</label>
			<label className="field">
				<span>Client Secret</span>
				<Input
					type="password"
					value={props.config.clientSecret}
					onChange={(event) => props.onConfigChange("clientSecret", event.target.value)}
				/>
			</label>

			<div className="button-row">
				<Button
					className="btn btn-primary"
					onClick={props.onConnect}
					disabled={
						props.connection.connection === "connecting" ||
						props.connection.connection === "reconnecting"
					}
				>
					Connect
				</Button>
				<Button variant="outline" className="btn btn-secondary" onClick={props.onDisconnect}>
					Disconnect
				</Button>
			</div>

			{props.runtimeError ? <div className="error-banner">{props.runtimeError}</div> : null}
			</CardContent>
		</Card>
	);
}
