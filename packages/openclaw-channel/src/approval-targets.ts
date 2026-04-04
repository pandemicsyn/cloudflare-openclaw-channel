type ApprovalTargetInput = {
	conversationId: string;
	senderId?: string;
	approvalAllowFrom: string[];
};

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
