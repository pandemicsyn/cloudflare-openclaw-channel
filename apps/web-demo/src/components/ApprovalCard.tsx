import type { ApprovalDecision, ChannelApprovalState } from "@pandemicsyn/cf-do-channel-client";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

type ApprovalCardProps = {
	approval: ChannelApprovalState;
	onResolveApproval: (approvalId: string, decision: ApprovalDecision) => void;
};

const DEFAULT_DECISIONS: ReadonlyArray<{
	decision: ApprovalDecision;
	label: string;
	style: "primary" | "success" | "danger";
}> = [
	{ decision: "allow-once", label: "Allow Once", style: "primary" },
	{ decision: "allow-always", label: "Always Allow", style: "success" },
	{ decision: "deny", label: "Deny", style: "danger" },
];

export function ApprovalCard(props: ApprovalCardProps) {
	const isPairingApproval = props.approval.approvalKind === "pairing";
	const actions =
		props.approval.buttons && props.approval.buttons.length > 0
			? props.approval.buttons
					.flatMap((button) =>
						button.action.type === "approval.resolve"
							? [
									{
										id: button.id,
										label: button.label,
										style: button.style ?? "secondary",
										decision: button.action.decision,
									},
								]
							: [],
					)
			: isPairingApproval
				? []
				: buildDecisionActions(props.approval.allowedDecisions);

	return (
		<Card className="approval-card">
			<CardContent>
			<div className="approval-copy">
				<strong>{props.approval.title ?? "Approval Required"}</strong>
				<span>{props.approval.body ?? "OpenClaw requires an approval decision."}</span>
			</div>
			<div className="approval-id">
				<span>Channel ID</span>
				<code>{props.approval.approvalId}</code>
			</div>
			{isPairingApproval && actions.length === 0 ? (
				<div className="pairing-instructions">
					<span>Approve from your operator channel, or run:</span>
					<code>openclaw pairing list --channel cf-do-channel</code>
					<code>openclaw pairing approve --channel cf-do-channel &lt;PAIRING_CODE&gt; --notify</code>
				</div>
			) : null}
			<div className="button-row">
				{actions.map((item) => (
					<Button
						key={`${props.approval.approvalId}:${item.id}`}
						variant={item.style === "danger" ? "destructive" : item.style === "success" ? "secondary" : "default"}
						className={`btn btn-${item.style}`}
						onClick={() => props.onResolveApproval(props.approval.approvalId, item.decision)}
					>
						{item.label}
					</Button>
				))}
			</div>
			</CardContent>
		</Card>
	);
}

function buildDecisionActions(
	allowedDecisions?: ApprovalDecision[],
): Array<{
	id: string;
	label: string;
	style: "primary" | "secondary" | "success" | "danger";
	decision: ApprovalDecision;
}> {
	const allowed = allowedDecisions && allowedDecisions.length > 0 ? allowedDecisions : DEFAULT_DECISIONS.map((item) => item.decision);
	return DEFAULT_DECISIONS.filter((item) => allowed.includes(item.decision)).map((item) => ({
		id: item.decision,
		label: item.label,
		style: item.style,
		decision: item.decision,
	}));
}
