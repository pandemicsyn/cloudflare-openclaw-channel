import { createRequire } from "node:module";

import type { OpenClawConfig } from "openclaw/plugin-sdk/core";

import type {
	ApprovalDecision,
	ChannelUi,
} from "../../channel-contract/src/index.js";

type ApprovalCapabilityDeps = {
	channel: string;
	channelLabel: string;
	listAccountIds: (cfg: OpenClawConfig) => string[];
	resolveApprovalAllowFrom: (cfg: OpenClawConfig) => string[];
	isExecAuthorizedSender: (params: {
		cfg: OpenClawConfig;
		accountId?: string | null;
		senderId?: string | null;
	}) => boolean;
	authorizeActorAction?: (params: {
		cfg: OpenClawConfig;
		accountId?: string | null;
		senderId?: string | null;
		action: "approve";
		approvalKind: "exec" | "plugin";
	}) => { authorized: boolean; reason?: string };
	resolveApprovalTargets?: (params: {
		conversationId: string;
		senderId?: string;
		cfg: OpenClawConfig;
	}) => {
		origin: unknown;
		approvers: unknown[];
	};
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
	const require = createRequire(import.meta.url);
	const {
		createApproverRestrictedNativeApprovalCapability,
		createChannelApprovalCapability,
	} = require("openclaw/plugin-sdk/approval-runtime") as {
		createApproverRestrictedNativeApprovalCapability: (params: any) => any;
		createChannelApprovalCapability: (params: any) => any;
	};

	const native = createApproverRestrictedNativeApprovalCapability({
		channel: deps.channel,
		channelLabel: deps.channelLabel,
		listAccountIds: deps.listAccountIds,
		hasApprovers: ({ cfg }: { cfg: OpenClawConfig }) => deps.resolveApprovalAllowFrom(cfg).length > 0,
		isExecAuthorizedSender: ({
			cfg,
			accountId,
			senderId,
		}: {
			cfg: OpenClawConfig;
			accountId?: string | null;
			senderId?: string | null;
		}) => deps.isExecAuthorizedSender({ cfg, accountId, senderId }),
		isNativeDeliveryEnabled: () => false,
		resolveNativeDeliveryMode: () => "channel",
	});

	const compatibilityRender = {
		exec: {
			buildPendingPayload: ({ request, nowMs }: { request: any; nowMs: number }) => {
				void nowMs;
				const text = deps.buildExecApprovalPendingText(request);
				const ui = deps.buildApprovalUi({
					title: "Exec Approval Required",
					body: text,
					approvalId: request.id,
					approvalKind: "exec",
				});
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
							ui,
						},
					},
				};
			},
			buildResolvedPayload: ({ resolved }: { resolved: any }) => {
				const text = deps.buildExecApprovalResolvedText(resolved);
				return {
					text,
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
								body: text,
								badge: resolved.decision,
							},
						},
					},
				};
			},
		},
	};

	return createChannelApprovalCapability({
		authorizeActorAction: deps.authorizeActorAction as any,
		approvals: {
			delivery: {
				hasConfiguredDmRoute: ({ cfg }: { cfg: OpenClawConfig }) =>
					deps.resolveApprovalAllowFrom(cfg).length > 0,
				shouldSuppressForwardingFallback: ({ cfg, request }: { cfg: OpenClawConfig; target: any; request: any }) => {
					if (deps.resolveApprovalTargets) {
						void deps.resolveApprovalTargets({
							conversationId: request?.conversationId ?? "unknown",
							senderId: request?.requestedBy,
							cfg,
						});
					}
					return false;
				},
			},
			render: compatibilityRender as any,
			native: native.native,
		},
	});
}
