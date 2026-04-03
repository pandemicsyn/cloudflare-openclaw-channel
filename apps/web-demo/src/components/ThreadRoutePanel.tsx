import type { ThreadRouteCatalog, ThreadRouteState } from "@pandemicsyn/cf-do-channel-client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ConnectionFormState } from "../demo-state";

type ThreadRoutePanelProps = {
	config: ConnectionFormState;
	threadRoute?: ThreadRouteState;
	threadCatalog?: ThreadRouteCatalog;
	isConnected: boolean;
	onConfigChange: (field: keyof ConnectionFormState, value: string) => void;
	onApply: () => void;
	onRefresh: () => void;
};

function summarizeRoute(route?: ThreadRouteState): string {
	if (!route) {
		return "No route snapshot yet. Connect and refresh to inspect this thread.";
	}
	if (route.mode === "agent" && route.agentId) {
		return `Pinned to agent ${route.agentId}.`;
	}
	if (route.mode === "session" && route.targetSessionKey) {
		return "Pinned to an explicit session target.";
	}
	if (route.source === "configured") {
		return "Following configured channel binding.";
	}
	return "Using automatic routing.";
}

export function ThreadRoutePanel(props: ThreadRoutePanelProps) {
	const { config, threadRoute, threadCatalog } = props;
	const showAgentField = config.threadRouteMode === "agent";
	const showSessionField = config.threadRouteMode === "session";
	const suggestedAgents = threadCatalog?.agents ?? [];

	return (
		<Card className="frame route-panel">
			<CardHeader className="panel-heading route-panel-heading">
				<div>
					<CardTitle>Thread Route</CardTitle>
					<CardDescription>Keep the thread key stable, then decide whether this thread auto-routes, pins to an agent, or binds to a specific session.</CardDescription>
				</div>
				<Badge className={`route-badge route-badge-${threadRoute?.source ?? "idle"}`} variant="outline">
					{threadRoute?.source ?? "unknown"}
				</Badge>
			</CardHeader>
			<CardContent>

			<div className="route-summary-card">
				<strong>{summarizeRoute(threadRoute)}</strong>
				<div className="route-summary-grid">
					<div>
						<span>Resolved agent</span>
						<code>{threadRoute?.resolvedAgentId ?? "not loaded"}</code>
					</div>
					<div>
						<span>Resolved session</span>
						<code>{threadRoute?.resolvedSessionKey ?? "not loaded"}</code>
					</div>
				</div>
			</div>

			{suggestedAgents.length > 0 ? (
				<div className="route-catalog-card">
					<div className="route-catalog-heading">
						<strong>Configured agents</strong>
						<span>{threadCatalog?.defaultAgentId ? `default ${threadCatalog.defaultAgentId}` : "catalog loaded"}</span>
					</div>
					<div className="route-chip-grid">
						{suggestedAgents.map((agent) => (
							<Button
								key={agent.id}
								type="button"
								variant="outline"
								className={`route-chip ${config.agentId === agent.id ? "route-chip-active" : ""}`}
								onClick={() => {
									props.onConfigChange("threadRouteMode", "agent");
									props.onConfigChange("agentId", agent.id);
								}}
								title={agent.workspace ?? agent.id}
							>
								<span>{agent.name ?? agent.id}</span>
								<small>{agent.default ? "default" : agent.id}</small>
							</Button>
						))}
					</div>
				</div>
			) : null}

			<label className="field">
				<span>Route mode</span>
				<Select
					value={config.threadRouteMode}
					onValueChange={(value) => props.onConfigChange("threadRouteMode", value)}
				>
					<SelectTrigger className="w-full">
						<SelectValue placeholder="Select route mode" />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="auto">Auto route</SelectItem>
						<SelectItem value="agent">Pin agent</SelectItem>
						<SelectItem value="session">Bind session</SelectItem>
					</SelectContent>
				</Select>
			</label>

			{showAgentField ? (
				<label className="field">
					<span>Agent ID</span>
					<Input
						list="thread-route-agent-options"
						value={config.agentId}
						onChange={(event) => props.onConfigChange("agentId", event.target.value)}
						placeholder="codex"
					/>
					<datalist id="thread-route-agent-options">
						{suggestedAgents.map((agent) => (
							<option key={agent.id} value={agent.id}>
								{agent.name ?? agent.id}
							</option>
						))}
					</datalist>
				</label>
			) : null}

			{showSessionField ? (
				<label className="field">
					<span>Session key</span>
					<Input
						value={config.sessionKey}
						onChange={(event) => props.onConfigChange("sessionKey", event.target.value)}
						placeholder="agent:codex:cf-do-channel:default:demo-room4"
					/>
				</label>
			) : null}

			<label className="field">
				<span>Thread label</span>
				<Input
					value={config.threadLabel}
					onChange={(event) => props.onConfigChange("threadLabel", event.target.value)}
					placeholder="optional routing note"
				/>
			</label>

			<div className="button-row">
				<Button className="btn btn-primary" disabled={!props.isConnected} onClick={props.onApply}>
					Apply Route
				</Button>
				<Button variant="outline" className="btn btn-secondary" disabled={!props.isConnected} onClick={props.onRefresh}>
					Refresh
				</Button>
			</div>
			</CardContent>
		</Card>
	);
}
