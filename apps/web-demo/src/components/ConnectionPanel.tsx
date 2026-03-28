import type { ChannelClientStatus } from "@pandemicsyn/cf-do-channel-client";

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
		<section className="frame control-panel">
			<div className="panel-heading">
				<h2>Signal Input</h2>
				<p>Credentialed demo access through the Worker token endpoint.</p>
			</div>

			<label className="field">
				<span>Worker base URL</span>
				<input
					value={props.config.baseUrl}
					onChange={(event) => props.onConfigChange("baseUrl", event.target.value)}
					placeholder="https://your-worker.example.workers.dev"
				/>
			</label>
			<label className="field">
				<span>Conversation ID</span>
				<input
					value={props.config.conversationId}
					onChange={(event) => props.onConfigChange("conversationId", event.target.value)}
				/>
			</label>
			<label className="field">
				<span>Client ID</span>
				<input
					value={props.config.clientId}
					onChange={(event) => props.onConfigChange("clientId", event.target.value)}
				/>
			</label>
			<label className="field">
				<span>Client Secret</span>
				<input
					type="password"
					value={props.config.clientSecret}
					onChange={(event) => props.onConfigChange("clientSecret", event.target.value)}
				/>
			</label>

			<div className="button-row">
				<button
					className="btn btn-primary"
					onClick={props.onConnect}
					disabled={
						props.connection.connection === "connecting" ||
						props.connection.connection === "reconnecting"
					}
				>
					Connect
				</button>
				<button className="btn btn-secondary" onClick={props.onDisconnect}>
					Disconnect
				</button>
			</div>

			{props.runtimeError ? <div className="error-banner">{props.runtimeError}</div> : null}
		</section>
	);
}
