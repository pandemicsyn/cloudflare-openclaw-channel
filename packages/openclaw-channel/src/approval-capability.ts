import { createRequire } from "node:module";

import type { OpenClawConfig } from "openclaw/plugin-sdk/core";

import type {
	ApprovalDecision,
	ChannelUi,
} from "../../channel-contract/src/index.js";
import type { CfApprovalNativeDeliveryMode } from "./approval-targets.js";

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
	resolveNativeDeliveryMode?: (params: {
		cfg: OpenClawConfig;
		accountId?: string | null;
	}) => CfApprovalNativeDeliveryMode;
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
		isNativeDeliveryEnabled: () => Boolean(deps.resolveApprovalTargets),
		resolveNativeDeliveryMode: ({ cfg, accountId }: { cfg: OpenClawConfig; accountId?: string | null }) =>
			deps.resolveNativeDeliveryMode?.({ cfg, accountId }) ?? "dm",
		resolveOriginTarget: ({ cfg, request }: { cfg: OpenClawConfig; request: any }) => {
			const conversationId = request?.request?.turnSourceTo?.trim();
			if (!conversationId || !deps.resolveApprovalTargets) {
				return null;
			}
			const targets = deps.resolveApprovalTargets({
				conversationId,
				senderId: undefined,
				cfg,
			});
			const origin =
				targets.origin &&
				typeof targets.origin === "object" &&
				"conversationId" in (targets.origin as Record<string, unknown>)
					? (targets.origin as { conversationId?: unknown })
					: null;
			return typeof origin?.conversationId === "string" ? { to: origin.conversationId } : null;
		},
		resolveApproverDmTargets: ({ cfg, request }: { cfg: OpenClawConfig; request: any }) => {
			const conversationId = request?.request?.turnSourceTo?.trim();
			if (!conversationId || !deps.resolveApprovalTargets) {
				return [];
			}
			const targets = deps.resolveApprovalTargets({
				conversationId,
				senderId: undefined,
				cfg,
			});
			return Array.isArray(targets.approvers)
				? targets.approvers
						.map((entry) => {
							if (!entry || typeof entry !== "object") {
								return null;
							}
							const target = entry as { to?: unknown };
							return typeof target.to === "string" ? { to: target.to } : null;
						})
						.filter((entry): entry is { to: string } => Boolean(entry))
				: [];
		},
		notifyOriginWhenDmOnly: true,
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
			delivery: native.delivery,
			render: compatibilityRender as any,
			native: native.native,
		},
	});
}
