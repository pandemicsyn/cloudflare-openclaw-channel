import type { RefObject } from "react";
import type { ApprovalDecision, ChannelSessionState } from "@pandemicsyn/cf-do-channel-client";

import { buildTranscriptEntries, formatTime } from "../demo-state";
import { ApprovalCard } from "./ApprovalCard";

type TranscriptPanelProps = {
	state: Pick<ChannelSessionState, "messages" | "pendingSends" | "approvals">;
	onResolveApproval: (approvalId: string, decision: ApprovalDecision) => void;
	transcriptRef: RefObject<HTMLDivElement | null>;
};

export function TranscriptPanel(props: TranscriptPanelProps) {
	const entries = buildTranscriptEntries(props.state);
	const activeApprovals = props.state.approvals.filter((approval) => approval.status === "required");

	return (
		<section className="frame transcript-panel">
			<div className="panel-heading">
				<h2>Live Transcript</h2>
				<p>Messages, pending sends, and approval prompts driven directly from the SDK session.</p>
			</div>

			<div className="transcript" ref={props.transcriptRef}>
				{entries.length === 0 ? (
					<div className="empty-state">
						<div className="empty-grid" />
						<p>Connect the demo and fire a message into the neon void.</p>
					</div>
				) : null}

				{entries.map((entry) => (
					<article
						key={entry.id}
						className={`message-card role-${entry.role} ${entry.kind === "pending" ? "message-pending" : ""}`}
					>
						<div className="message-meta">
							<span>{entry.kind === "pending" ? `${entry.role} · ${entry.pendingStatus}` : entry.role}</span>
							<span>{formatTime(entry.timestamp)}</span>
						</div>
						<p className="message-body">{entry.text}</p>
						{entry.kind === "pending" && entry.error ? (
							<div className="message-error">{entry.error}</div>
						) : null}
						{entry.kind === "message" && entry.ui?.kind === "notice" ? (
							<div className="notice-chip">{entry.ui.title}</div>
						) : null}
					</article>
				))}
			</div>

			<div className="approval-dock">
				<div className="panel-heading">
					<h2>Approval Dock</h2>
					<p>First-class approvals sourced from session state, not scraped from transcript text.</p>
				</div>
				{activeApprovals.length === 0 ? (
					<div className="status-empty">No active approvals.</div>
				) : (
					<div className="approval-stack">
						{activeApprovals.map((approval) => (
							<ApprovalCard
								key={approval.approvalId}
								approval={approval}
								onResolveApproval={props.onResolveApproval}
							/>
						))}
					</div>
				)}
			</div>
		</section>
	);
}
