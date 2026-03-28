import type { ChannelSessionState } from "@pandemicsyn/cf-do-channel-client";

import { formatTime, statusTone } from "../demo-state";

type StatusRailProps = {
	statuses: ChannelSessionState["statuses"];
};

export function StatusRail(props: StatusRailProps) {
	return (
		<aside className="frame status-panel">
			<div className="panel-heading">
				<h2>Status Rail</h2>
				<p>Transport-level events from the bridge, not presentation guesses.</p>
			</div>

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
									<span>{status.status.kind.replaceAll("_", " ")}</span>
									<span>{formatTime(status.timestamp)}</span>
								</div>
								{status.status.message ? <p>{status.status.message}</p> : null}
								{status.status.approvalId ? <code>{status.status.approvalId}</code> : null}
							</div>
						))
				)}
			</div>
		</aside>
	);
}
