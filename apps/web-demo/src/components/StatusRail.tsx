import type { ChannelSessionState } from "@pandemicsyn/cf-do-channel-client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatTime, statusTone } from "../demo-state";

type StatusRailProps = {
	statuses: ChannelSessionState["statuses"];
};

export function StatusRail(props: StatusRailProps) {
	return (
		<Card className="frame status-panel">
			<CardHeader className="panel-heading">
				<CardTitle>Status Rail</CardTitle>
				<CardDescription>Transport-level events from the bridge, not presentation guesses.</CardDescription>
			</CardHeader>
			<CardContent>
			<div className="status-stack">
				{props.statuses.length === 0 ? (
					<div className="status-empty">No status pulses yet.</div>
				) : (
					props.statuses
						.slice()
						.reverse()
						.map((status) => (
							<div
								key={`${status.status.kind}:${status.timestamp}:${status.status.referenceId ?? status.status.approvalId ?? "status"}`}
								className={`status-chip tone-${statusTone(status.status.kind)}`}
							>
								<div className="status-line">
									<Badge variant="outline">{status.status.kind.replaceAll("_", " ")}</Badge>
									<span>{formatTime(status.timestamp)}</span>
								</div>
								{status.status.message ? <p>{status.status.message}</p> : null}
								{status.status.approvalId ? <code>{status.status.approvalId}</code> : null}
							</div>
						))
				)}
			</div>
			</CardContent>
		</Card>
	);
}
