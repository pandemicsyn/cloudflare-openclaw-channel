import { createRequire } from "node:module";

import type { OpenClawConfig } from "openclaw/plugin-sdk/core";

export function resolveApprovalAllowFrom(
	cfg: OpenClawConfig,
	read: (cfg: OpenClawConfig) => string[],
): string[] {
	return read(cfg);
}

export function resolveApprovalApproverIds(params: {
	cfg: OpenClawConfig;
	accountId?: string | null;
	readAllowFrom: (cfg: OpenClawConfig) => string[];
	defaultTo?: string;
}): string[] {
	const require = createRequire(import.meta.url);
	const { resolveApprovalApprovers } = require("openclaw/plugin-sdk/approval-runtime") as {
		resolveApprovalApprovers: (input: {
			allowFrom?: readonly (string | number)[] | null;
			defaultTo?: string | null;
			normalizeApprover: (value: string | number) => string | undefined;
			normalizeDefaultTo?: (value: string) => string | undefined;
		}) => string[];
	};
	const allowFrom = resolveApprovalAllowFrom(params.cfg, params.readAllowFrom);
	return resolveApprovalApprovers({
		allowFrom,
		defaultTo: params.defaultTo,
		normalizeApprover: (value: string | number) =>
			typeof value === "string" ? value.trim() || undefined : undefined,
		normalizeDefaultTo: (value: string) => value.trim() || undefined,
	});
}

export function createApprovalAuthorizeActorAction(params: {
	channelLabel: string;
	readAllowFrom: (cfg: OpenClawConfig) => string[];
	resolveDefaultTo?: (cfg: OpenClawConfig, accountId?: string | null) => string | undefined;
}) {
	const require = createRequire(import.meta.url);
	const { createResolvedApproverActionAuthAdapter } = require("openclaw/plugin-sdk/approval-runtime") as {
		createResolvedApproverActionAuthAdapter: (input: {
			channelLabel: string;
			resolveApprovers: (params: { cfg: OpenClawConfig; accountId?: string | null }) => string[];
			normalizeSenderId?: (value: string) => string | undefined;
		}) => {
			authorizeActorAction: (params: {
				cfg: OpenClawConfig;
				accountId?: string | null;
				senderId?: string | null;
				action: "approve";
				approvalKind: "exec" | "plugin";
			}) => { authorized: boolean; reason?: string };
		};
	};
	const adapter = createResolvedApproverActionAuthAdapter({
		channelLabel: params.channelLabel,
		resolveApprovers: ({ cfg, accountId }) =>
			resolveApprovalApproverIds({
				cfg,
				accountId,
				readAllowFrom: params.readAllowFrom,
				defaultTo: params.resolveDefaultTo?.(cfg, accountId),
			}),
		normalizeSenderId: (value) => value.trim() || undefined,
	});
	return adapter.authorizeActorAction;
}

export function isApproverAllowed(senderId: string, allowFrom: string[]): boolean {
	return allowFrom.includes("*") || allowFrom.includes(senderId);
}
