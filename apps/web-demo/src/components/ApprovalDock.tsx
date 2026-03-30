import type { ApprovalDecision, ChannelSessionState } from "@pandemicsyn/cf-do-channel-client";

import { ApprovalCard } from "./ApprovalCard";

type ApprovalDockProps = {
	state: Pick<ChannelSessionState, "messages" | "approvals">;
	onResolveApproval: (approvalId: string, decision: ApprovalDecision) => void;
};

export function ApprovalDock(props: ApprovalDockProps) {
	const activeApprovals = props.state.approvals.filter((approval) => {
		if (approval.status !== "required") {
			return false;
		}
		if (approval.approvalKind !== "pairing") {
			return true;
		}
		return !hasApprovedPairingNotice(props.state.messages, approval.updatedAt);
	});

	return (
		<section className="frame control-panel">
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

function hasApprovedPairingNotice(
	messages: Pick<ChannelSessionState, "messages">["messages"],
	approvalUpdatedAt: string,
): boolean {
	const approvalTime = Date.parse(approvalUpdatedAt);
	return messages.some((message) => {
		const messageTime = Date.parse(message.timestamp);
		if (!Number.isFinite(messageTime)) {
			return false;
		}
		if (Number.isFinite(approvalTime) && messageTime < approvalTime) {
			return false;
		}
		if (message.ui?.kind === "notice") {
			const noticeTitle = message.ui.title?.toLowerCase() ?? "";
			const noticeBody = message.ui.body?.toLowerCase() ?? "";
			const noticeBadge = message.ui.badge?.toLowerCase() ?? "";
			if (noticeBadge === "approved") {
				return true;
			}
			if (noticeTitle.includes("pairing approved") || noticeBody.includes("pairing approved")) {
				return true;
			}
		}
		const text = message.text.toLowerCase();
		return text.includes("openclaw access approved");
	});
}
