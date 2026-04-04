type ApprovalTargetInput = {
	conversationId: string;
	senderId?: string;
	approvalAllowFrom: string[];
};

type ApprovalDeliveryModeInput = {
	dmPolicy?: string;
};

export type CfApprovalNativeDeliveryMode = "dm" | "channel" | "both";

export type CfApprovalTarget = {
	kind: "origin" | "approver-dm";
	conversationId: string;
	to?: string;
};

export function resolveOriginApprovalTarget(input: ApprovalTargetInput): CfApprovalTarget {
	return {
		kind: "origin",
		conversationId: input.conversationId,
	};
}

export function resolveApproverApprovalTargets(input: ApprovalTargetInput): CfApprovalTarget[] {
	const targets = input.approvalAllowFrom
		.filter((entry) => entry !== "*")
		.map((entry) => ({
			kind: "approver-dm" as const,
			conversationId: input.conversationId,
			to: entry,
		}));

	if (targets.length > 0) {
		return targets;
	}

	if (input.senderId) {
		return [
			{
				kind: "approver-dm",
				conversationId: input.conversationId,
				to: input.senderId,
			},
		];
	}

	return [];
}

export function resolveApprovalNativeDeliveryMode(
	input: ApprovalDeliveryModeInput,
): CfApprovalNativeDeliveryMode {
	const mode = input.dmPolicy?.trim().toLowerCase();
	if (mode === "channel" || mode === "origin-only") {
		return "channel";
	}
	if (mode === "both") {
		return "both";
	}
	return "dm";
}
