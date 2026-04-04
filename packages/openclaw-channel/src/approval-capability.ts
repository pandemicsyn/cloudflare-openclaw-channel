import type { OpenClawConfig } from "openclaw/plugin-sdk/core";

import type { ApprovalDecision, ChannelUi } from "../../channel-contract/src/index.js";

type ApprovalCapabilityDeps = {
	resolveApprovalAllowFrom: (cfg: OpenClawConfig) => string[];
	buildExecApprovalPendingText: (request: Record<string, unknown>) => string;
	buildExecApprovalResolvedText: (resolved: { decision?: string; resolvedBy?: string }) => string;
	buildApprovalUi: (params: {
		title: string;
		body: string;
		approvalId: string;
		approvalKind: "exec" | "plugin";
		allowedDecisions?: ApprovalDecision[];
	}) => ChannelUi;
};

export function createApprovalCapability(deps: ApprovalCapabilityDeps) {
	return {
		delivery: {
			hasConfiguredDmRoute: ({ cfg }: { cfg: OpenClawConfig }) =>
				deps.resolveApprovalAllowFrom(cfg).length > 0,
			shouldSuppressForwardingFallback: () => false,
		},
		render: {
			exec: {
				buildPendingPayload: ({ request, nowMs }: { request: any; nowMs: number }) => {
					void nowMs;
					const text = deps.buildExecApprovalPendingText(request);
					return {
						text,
						channelData: {
							execApproval: {
								approvalId: request.id,
								approvalSlug: request.id.slice(0, 8),
								approvalKind: "exec",
								status: "required",
								allowedDecisions: ["allow-once", "allow-always", "deny"],
							},
							cfDoChannel: {
								ui: deps.buildApprovalUi({
									title: "Exec Approval Required",
									body: text,
									approvalId: request.id,
									approvalKind: "exec",
								}),
							},
						},
					};
				},
				buildResolvedPayload: ({ resolved }: { resolved: any }) => ({
					text: deps.buildExecApprovalResolvedText(resolved),
					channelData: {
						execApproval: {
							approvalId: resolved.id,
							approvalSlug: String(resolved.id ?? "").slice(0, 8),
							approvalKind: "exec",
							status: "resolved",
							allowedDecisions: [],
						},
						cfDoChannel: {
							ui: {
								kind: "notice",
								title: "Approval Resolved",
								body: deps.buildExecApprovalResolvedText(resolved),
								badge: resolved.decision,
							},
						},
					},
				}),
			},
		},
	};
}
