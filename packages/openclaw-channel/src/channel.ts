import {
	createChatChannelPlugin,
	type OpenClawConfig,
} from "openclaw/plugin-sdk/core";

import {
	buildConversationMessagesPath,
	parseConversationIdFromTarget,
	DEFAULT_ACCOUNT_ID,
	DEFAULT_CHANNEL_ID,
	type ApprovalDecision,
	type ChannelUi,
	type OutboundSendRequest,
} from "../../channel-contract/src/index.js";
import {
	clearBridgeManager,
	getBridgeManager,
	registerBridgeManager,
} from "./bridge-manager.js";
import { createApprovalCapability } from "./approval-capability.js";
import {
	createApprovalAuthorizeActorAction,
	isApproverAllowed,
	resolveApprovalAllowFrom,
} from "./approval-auth.js";
import {
	resolveApproverApprovalTargets,
	resolveApprovalNativeDeliveryMode,
	resolveOriginApprovalTarget,
} from "./approval-targets.js";
import { readSenderBinding } from "./binding-store.js";
import { clearThreadBindingAdapter, ensureThreadBindingAdapter } from "./thread-bindings.js";

const PAIRING_APPROVED_MESSAGE = "✅ OpenClaw access approved. Send a message to start chatting.";

function readProcessEnv(key: string): string | undefined {
	const processValue = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
	return processValue?.env?.[key];
}

const channelDebugEnabled =
	readProcessEnv("OPENCLAW_CF_DO_DEBUG") === "1" || readProcessEnv("CF_DO_CHANNEL_DEBUG") === "1";

function logChannelDebug(event: string, details?: Record<string, unknown>): void {
	if (!channelDebugEnabled) {
		return;
	}
	const prefix = `[cf-do-channel][${new Date().toISOString()}] ${event}`;
	if (!details) {
		console.log(prefix);
		return;
	}
	console.log(prefix, details);
}

type ResolvedAccount = {
	accountId: string | null;
	baseUrl: string;
	serviceToken: string;
	defaultTo?: string;
	dmPolicy?: string;
	allowFrom: string[];
	approvalAllowFrom: string[];
};

function normalizeConversationTarget(value?: string): string | undefined {
	const trimmed = value?.trim();
	if (!trimmed) {
		return undefined;
	}
	return parseConversationIdFromTarget(trimmed);
}

function normalizeOutboundConversationId(value: string): string {
	return normalizeConversationTarget(value) ?? value.trim();
}

function resolveSection(cfg: OpenClawConfig): Record<string, unknown> {
	const value = ((cfg.channels ?? {}) as Record<string, unknown>)[DEFAULT_CHANNEL_ID];
	return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
	const value = record[key];
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readStringList(record: Record<string, unknown>, key: string): string[] {
	const value = record[key];
	return Array.isArray(value)
		? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
		: [];
}

function getExecApprovalReplyMetadataCompat(payload: {
	channelData?: unknown;
}): {
	approvalId: string;
	approvalSlug: string;
	allowedDecisions?: readonly ApprovalDecision[];
} | null {
	const channelData =
		payload &&
		typeof payload === "object" &&
		"channelData" in payload &&
		payload.channelData &&
		typeof payload.channelData === "object" &&
		!Array.isArray(payload.channelData)
			? (payload.channelData as Record<string, unknown>)
			: null;
	const execApproval =
		channelData &&
		channelData.execApproval &&
		typeof channelData.execApproval === "object" &&
		!Array.isArray(channelData.execApproval)
			? (channelData.execApproval as {
					approvalId?: unknown;
					approvalSlug?: unknown;
					allowedDecisions?: unknown;
				})
			: null;
	const approvalId =
		typeof execApproval?.approvalId === "string" ? execApproval.approvalId.trim() : "";
	const approvalSlug =
		typeof execApproval?.approvalSlug === "string" ? execApproval.approvalSlug.trim() : "";
	if (!approvalId || !approvalSlug) {
		return null;
	}
	const allowedDecisionsRaw = execApproval?.allowedDecisions;
	const allowedDecisions = Array.isArray(allowedDecisionsRaw)
		? allowedDecisionsRaw.filter(
				(value): value is ApprovalDecision =>
					value === "allow-once" || value === "allow-always" || value === "deny",
			)
		: undefined;
	return {
		approvalId,
		approvalSlug,
		allowedDecisions,
	};
}

function resolveAccount(cfg: OpenClawConfig, accountId?: string | null): ResolvedAccount {
	const section = resolveSection(cfg) ?? {};
	const baseUrl = readString(section, "baseUrl");
	const serviceToken = readString(section, "serviceToken");
	if (!baseUrl) {
		throw new Error("cf-do-channel: channels.cf-do-channel.baseUrl is required");
	}
	if (!serviceToken) {
		throw new Error("cf-do-channel: channels.cf-do-channel.serviceToken is required");
	}
	return {
		accountId: accountId ?? DEFAULT_ACCOUNT_ID,
		baseUrl,
		serviceToken,
		defaultTo: readString(section, "defaultTo"),
		dmPolicy: readString(section, "dmPolicy"),
		allowFrom: readStringList(section, "allowFrom"),
		approvalAllowFrom: readStringList(section, "approvalAllowFrom"),
	};
}

function buildApprovalButtons(
	approvalId: string,
	allowedDecisions: ApprovalDecision[] = ["allow-once", "allow-always", "deny"],
) {
	const buttons: Array<{
		id: string;
		label: string;
		style: "primary" | "success" | "danger";
		action: {
			type: "approval.resolve";
			approvalId: string;
			decision: ApprovalDecision;
		};
	}> = [];
	for (const decision of allowedDecisions) {
		buttons.push({
			id: `${approvalId}:${decision}`,
			label:
				decision === "allow-once"
					? "Allow once"
					: decision === "allow-always"
						? "Always allow"
						: "Deny",
			style:
				decision === "deny"
					? "danger"
					: decision === "allow-always"
						? "primary"
						: "success",
			action: {
				type: "approval.resolve",
				approvalId,
				decision,
			},
		});
	}
	return buttons;
}

function summarizeValue(value: unknown): string | undefined {
	if (typeof value === "string") {
		return value.trim() || undefined;
	}
	if (Array.isArray(value)) {
		const joined = value
			.map((entry) => (typeof entry === "string" ? entry.trim() : ""))
			.filter(Boolean)
			.join(" ");
		return joined || undefined;
	}
	return undefined;
}

function buildExecApprovalPendingText(request: Record<string, unknown>): string {
	const command =
		summarizeValue(request.commandDisplay) ??
		summarizeValue(request.command) ??
		summarizeValue(request.argv);
	const reason = summarizeValue(request.reason);
	if (command && reason) {
		return `Exec approval required for ${command}. ${reason}`;
	}
	if (command) {
		return `Exec approval required for ${command}.`;
	}
	if (reason) {
		return `Exec approval required. ${reason}`;
	}
	return "Exec approval required.";
}

function buildPluginApprovalPendingText(request: Record<string, unknown>): string {
	const title =
		summarizeValue(request.title) ??
		summarizeValue(request.plugin) ??
		summarizeValue(request.name) ??
		summarizeValue(request.kind);
	const reason = summarizeValue(request.reason) ?? summarizeValue(request.summary);
	if (title && reason) {
		return `Plugin approval required for ${title}. ${reason}`;
	}
	if (title) {
		return `Plugin approval required for ${title}.`;
	}
	if (reason) {
		return `Plugin approval required. ${reason}`;
	}
	return "Plugin approval required.";
}

function buildApprovalUi(params: {
	title: string;
	body: string;
	approvalId: string;
	approvalKind: "exec" | "plugin";
	allowedDecisions?: ApprovalDecision[];
}): ChannelUi {
	return {
		kind: "approval",
		title: params.title,
		body: params.body,
		approvalId: params.approvalId,
		approvalKind: params.approvalKind,
		allowedDecisions: params.allowedDecisions,
		buttons: buildApprovalButtons(params.approvalId, params.allowedDecisions),
	};
}

function extractUiFromPayload(payload: {
	text?: string;
	channelData?: Record<string, unknown>;
}): ChannelUi | undefined {
	const channelData =
		payload.channelData && typeof payload.channelData === "object" && !Array.isArray(payload.channelData)
			? payload.channelData
			: undefined;
	if (!channelData) {
		return undefined;
	}
	const cfDoChannel =
		channelData.cfDoChannel &&
		typeof channelData.cfDoChannel === "object" &&
		!Array.isArray(channelData.cfDoChannel)
			? (channelData.cfDoChannel as { ui?: ChannelUi })
			: undefined;
	if (cfDoChannel?.ui) {
		return cfDoChannel.ui;
	}
	const execApproval =
		channelData.execApproval &&
		typeof channelData.execApproval === "object" &&
		!Array.isArray(channelData.execApproval)
			? (channelData.execApproval as { approvalId?: string; allowedDecisions?: unknown[] })
			: undefined;
	const approvalId = execApproval?.approvalId?.trim();
	if (approvalId && execApproval) {
		const decisions = execApproval.allowedDecisions;
		const allowedDecisions = Array.isArray(decisions)
			? decisions.filter(
					(value): value is ApprovalDecision =>
						value === "allow-once" || value === "allow-always" || value === "deny",
				)
			: [];
		if (allowedDecisions.length > 0) {
			const approvalKind = approvalId.startsWith("plugin:") ? "plugin" : "exec";
			return buildApprovalUi({
				title: approvalKind === "plugin" ? "Plugin Approval Required" : "Exec Approval Required",
				body: payload.text?.trim() || "Approval required.",
				approvalId,
				approvalKind,
				allowedDecisions,
			});
		}
	}
	return undefined;
}

async function sendOutboundMessage(account: ResolvedAccount, to: string, request: OutboundSendRequest) {
	const url = new URL(buildConversationMessagesPath(to), account.baseUrl).toString();
	const response = await fetch(url, {
		method: "POST",
		headers: {
			authorization: `Bearer ${account.serviceToken}`,
			"content-type": "application/json",
		},
		body: JSON.stringify(request),
	});
	if (!response.ok) {
		const detail = await response.text();
		throw new Error(`cf-do-channel outbound failed (${response.status}): ${detail}`);
	}
	const payload = (await response.json()) as { message?: { id?: string } };
	return {
		channel: DEFAULT_CHANNEL_ID,
		messageId: payload.message?.id ?? request.messageId ?? `plugin_${Date.now()}`,
	};
}

function buildExecApprovalResolvedText(resolved: {
	decision?: string;
	resolvedBy?: string;
}): string {
	const action =
		resolved.decision === "allow-once"
			? "Allowed once"
			: resolved.decision === "allow-always"
				? "Always allowed"
				: "Denied";
	return resolved.resolvedBy ? `Approval resolved: ${action} by ${resolved.resolvedBy}.` : `Approval resolved: ${action}.`;
}

function buildPluginApprovalResolvedText(resolved: {
	decision?: string;
	resolvedBy?: string;
}): string {
	const action =
		resolved.decision === "allow-once"
			? "Allowed once"
			: resolved.decision === "allow-always"
				? "Always allowed"
				: resolved.decision === "deny"
					? "Denied"
					: "Resolved";
	return resolved.resolvedBy ? `Plugin approval resolved: ${action} by ${resolved.resolvedBy}.` : `Plugin approval resolved: ${action}.`;
}

export const cloudflareDoChannelPlugin = createChatChannelPlugin<ResolvedAccount>({
	base: {
		id: DEFAULT_CHANNEL_ID,
		meta: {
			id: DEFAULT_CHANNEL_ID,
			label: "Cloudflare Durable Object Channel",
			selectionLabel: "Cloudflare Durable Object Channel",
			docsPath: "/channels/cloudflare-openclaw-channel",
			docsLabel: "cloudflare-openclaw-channel",
			blurb: "Bridge OpenClaw through a Cloudflare Worker-backed persistent channel.",
		},
		capabilities: {
			chatTypes: ["direct"],
			media: true,
			blockStreaming: true,
		},
		setup: {
			applyAccountConfig: ({ cfg }: { cfg: OpenClawConfig }) => cfg,
		},
		config: {
			listAccountIds: () => [DEFAULT_ACCOUNT_ID],
			resolveAccount,
			inspectAccount(cfg: OpenClawConfig) {
				const section = resolveSection(cfg) ?? {};
				return {
					enabled: Boolean(readString(section, "baseUrl") && readString(section, "serviceToken")),
					configured: Boolean(
						readString(section, "baseUrl") && readString(section, "serviceToken"),
					),
				};
			},
			isConfigured: (account: ResolvedAccount) => Boolean(account.baseUrl && account.serviceToken),
		},
		messaging: {
			normalizeTarget: (target: string) => normalizeConversationTarget(target),
			targetResolver: {
				looksLikeId: (id: string) => Boolean(id?.trim()),
				hint: "<conversation-id>",
			},
		},
		approvals: createApprovalCapability({
			channel: DEFAULT_CHANNEL_ID,
			channelLabel: "Cloudflare Durable Object Channel",
			listAccountIds: () => [DEFAULT_ACCOUNT_ID],
			isExecAuthorizedSender: ({ cfg, senderId }) => {
				if (!senderId) {
					return false;
				}
				const allowFrom = resolveApprovalAllowFrom(cfg, (source) =>
					readStringList(resolveSection(source), "approvalAllowFrom"),
				);
				return isApproverAllowed(senderId, allowFrom);
			},
			authorizeActorAction: createApprovalAuthorizeActorAction({
				channelLabel: "Cloudflare Durable Object Channel",
				readAllowFrom: (source) => readStringList(resolveSection(source), "approvalAllowFrom"),
				resolveDefaultTo: (source) => readString(resolveSection(source), "defaultTo"),
			}),
			resolveApprovalTargets: ({ conversationId, senderId, cfg }) => {
				const allowFrom = resolveApprovalAllowFrom(cfg, (source) =>
					readStringList(resolveSection(source), "approvalAllowFrom"),
				);
				return {
					origin: resolveOriginApprovalTarget({ conversationId, senderId, approvalAllowFrom: allowFrom }),
					approvers: resolveApproverApprovalTargets({
						conversationId,
						senderId,
						approvalAllowFrom: allowFrom,
					}),
				};
			},
			resolveNativeDeliveryMode: ({ cfg }) =>
				resolveApprovalNativeDeliveryMode({
					dmPolicy: readString(resolveSection(cfg), "dmPolicy"),
				}),
			resolveApprovalAllowFrom: (cfg) =>
				resolveApprovalAllowFrom(cfg, (source) => readStringList(resolveSection(source), "approvalAllowFrom")),
			buildExecApprovalPendingText,
			buildExecApprovalResolvedText,
			buildApprovalUi,
		}),
		status: {
			buildAccountSnapshot: ({ account }: { account: ResolvedAccount }) => ({
				accountId: account.accountId ?? DEFAULT_ACCOUNT_ID,
				enabled: true,
				configured: Boolean(account.baseUrl && account.serviceToken),
				extra: {
					baseUrl: account.baseUrl,
					approvalAllowFrom: account.approvalAllowFrom,
				},
			}),
			probeAccount: async ({ account }: { account: ResolvedAccount }) => {
				const url = new URL("/v1/bridge/status", account.baseUrl);
				url.searchParams.set("accountId", account.accountId ?? DEFAULT_ACCOUNT_ID);
				const response = await fetch(url.toString(), {
					headers: {
						authorization: `Bearer ${account.serviceToken}`,
					},
				});
				const body = await response.json().catch(() => null);
				return {
					ok: response.ok,
					status: response.status,
					body,
				};
			},
		},
		gateway: {
			startAccount: async (ctx) => {
				ensureThreadBindingAdapter(ctx.accountId);
				const manager = registerBridgeManager({
					cfg: ctx.cfg,
					account: ctx.account,
					abortSignal: ctx.abortSignal,
					log: ctx.log,
					setStatus: (next) =>
						ctx.setStatus({
							accountId: ctx.accountId,
							...next,
						}),
					channelRuntime: ctx.channelRuntime,
					authorizeApprovalActorAction: createApprovalAuthorizeActorAction({
						channelLabel: "Cloudflare Durable Object Channel",
						readAllowFrom: (source) => readStringList(resolveSection(source), "approvalAllowFrom"),
						resolveDefaultTo: (source) => readString(resolveSection(source), "defaultTo"),
					}),
				});
				await manager.run();
			},
			stopAccount: async (ctx: { accountId: string }) => {
				clearBridgeManager(ctx.accountId);
				clearThreadBindingAdapter(ctx.accountId);
			},
		},
	},
	security: {
		dm: {
			channelKey: DEFAULT_CHANNEL_ID,
			resolvePolicy: (account: ResolvedAccount) => account.dmPolicy,
			resolveAllowFrom: (account: ResolvedAccount) => account.allowFrom,
			defaultPolicy: "allowlist",
		},
	},
	pairing: {
		text: {
			idLabel: "channel id",
			message: PAIRING_APPROVED_MESSAGE,
			notify: async ({
				cfg,
				id,
				accountId,
				message,
			}: {
				cfg: OpenClawConfig;
				id: string;
				accountId?: string;
				message: string;
			}) => {
				const resolvedAccount = resolveAccount(cfg, accountId ?? DEFAULT_ACCOUNT_ID);
				const binding = await readSenderBinding({
					accountId: resolvedAccount.accountId ?? DEFAULT_ACCOUNT_ID,
					senderId: id,
				});
				if (!binding) {
					throw new Error(
						`cf-do-channel: no conversation binding found for approved sender ${id}`,
					);
				}
				const manager = getBridgeManager(resolvedAccount.accountId);
				if (manager) {
					await manager.sendProviderStatus({
						conversationId: binding.conversationId,
						kind: "approval_resolved",
						approvalId: id,
						approvalKind: "pairing",
						message: "Pairing approved.",
						details: { ok: true },
					});
					await manager.sendProviderMessage({
						conversationId: binding.conversationId,
						text: message,
						participantId: id,
						role: "system",
						ui: {
							kind: "notice",
							title: "Pairing Approved",
							body: "You can start chatting in this conversation now.",
							badge: "approved",
						},
					});
					return;
				}
				await sendOutboundMessage(resolvedAccount, binding.conversationId, {
					role: "system",
					text: message,
					participantId: id,
				});
			},
		},
	},
	threading: {
		topLevelReplyToMode: "reply",
	},
	outbound: {
		base: {
			deliveryMode: "direct",
			resolveTarget: ({
				to,
				cfg,
				accountId,
			}: {
				to?: string;
				cfg?: OpenClawConfig;
				accountId?: string | null;
			}) => {
				const normalized = normalizeConversationTarget(to);
				if (normalized) {
					return { ok: true as const, to: normalized };
				}
				if (cfg) {
					const account = resolveAccount(cfg, accountId);
					const defaultTarget = normalizeConversationTarget(account.defaultTo);
					if (defaultTarget) {
						return { ok: true as const, to: defaultTarget };
					}
				}
				return { ok: false as const, error: new Error("cf-do-channel target is required") };
			},
			sendPayload: async ({
				cfg,
				to,
				payload,
				accountId,
			}: {
				cfg: OpenClawConfig;
				to: string;
				payload: {
					text?: string;
					channelData?: Record<string, unknown>;
					mediaUrls?: string[];
					mediaUrl?: string;
				};
				accountId?: string | null;
			}) => {
				const account = resolveAccount(cfg, accountId);
				const manager = getBridgeManager(account.accountId);
				const conversationId = normalizeOutboundConversationId(to);
				const text = [
					payload.text?.trim() ?? "",
					payload.mediaUrl,
					...(payload.mediaUrls ?? []),
				]
					.filter((entry): entry is string => Boolean(entry?.trim()))
					.join("\n\n");
				const ui = extractUiFromPayload(payload);
				logChannelDebug("sendPayload.received", {
					accountId: account.accountId ?? DEFAULT_ACCOUNT_ID,
					to: conversationId,
					managerPresent: Boolean(manager),
					managerConnected: manager?.isConnected ?? false,
					uiKind: ui?.kind,
					textPreview: text.slice(0, 180),
					channelDataKeys:
						payload.channelData && typeof payload.channelData === "object"
							? Object.keys(payload.channelData)
							: [],
				});
				if (manager) {
					if (payload.channelData && typeof payload.channelData === "object") {
						const execApproval = (payload.channelData as Record<string, unknown>).execApproval;
						if (execApproval && typeof execApproval === "object" && !Array.isArray(execApproval)) {
							const approval = execApproval as { approvalId?: string; allowedDecisions?: ApprovalDecision[] };
							logChannelDebug("sendPayload.execApproval.status", {
								to: conversationId,
								approvalId: approval.approvalId,
								allowedDecisions: approval.allowedDecisions,
							});
							await manager.sendProviderStatus({
								conversationId,
								kind:
									Array.isArray(approval.allowedDecisions) && approval.allowedDecisions.length > 0
										? "approval_required"
										: "approval_resolved",
								approvalId: approval.approvalId,
								approvalKind: String(approval.approvalId ?? "").startsWith("plugin:")
									? "plugin"
									: "exec",
								message: text || (ui?.kind === "notice" ? ui.body : undefined),
							});
						}
					}
					logChannelDebug("sendPayload.providerMessage", {
						to: conversationId,
						managerConnected: manager.isConnected,
						uiKind: ui?.kind,
					});
					await manager.sendProviderMessage({
						conversationId,
						text,
						role: "assistant",
						ui,
						metadata: payload.channelData,
					});
					return {
						channel: DEFAULT_CHANNEL_ID,
						messageId: `provider_${Date.now()}`,
					};
				}
				logChannelDebug("sendPayload.restFallback", {
					to: conversationId,
					uiKind: ui?.kind,
				});
				return await sendOutboundMessage(account, conversationId, {
					role: "assistant",
					text,
					metadata: payload.channelData,
					ui,
				});
			},
		},
		attachedResults: {
			channel: DEFAULT_CHANNEL_ID,
			sendText: async (params: {
				cfg: OpenClawConfig;
				to: string;
				text: string;
				accountId?: string | null;
			}) => {
				const account = resolveAccount(params.cfg, params.accountId);
				const manager = getBridgeManager(account.accountId);
				const conversationId = normalizeOutboundConversationId(params.to);
				if (manager) {
					await manager.sendProviderMessage({
						conversationId,
						text: params.text,
						role: "assistant",
					});
					await manager.sendProviderStatus({
						conversationId,
						kind: "final",
						message: "Reply complete.",
					});
					return {
						messageId: `provider_${Date.now()}`,
					};
				}
				const result = await sendOutboundMessage(account, conversationId, {
					role: "assistant",
					text: params.text,
				});
				return {
					messageId: result.messageId,
				};
			},
			sendMedia: async (params: {
				cfg: OpenClawConfig;
				to: string;
				text: string;
				accountId?: string | null;
				mediaUrl?: string;
			}) => {
				const account = resolveAccount(params.cfg, params.accountId);
				const text = params.mediaUrl ? `${params.text}\n\n${params.mediaUrl}`.trim() : params.text;
				const manager = getBridgeManager(account.accountId);
				const conversationId = normalizeOutboundConversationId(params.to);
				if (manager) {
					await manager.sendProviderMessage({
						conversationId,
						text,
						role: "assistant",
						metadata: params.mediaUrl ? { mediaUrl: params.mediaUrl } : undefined,
					});
					return {
						messageId: `provider_${Date.now()}`,
					};
				}
				const result = await sendOutboundMessage(account, conversationId, {
					role: "assistant",
					text,
					metadata: params.mediaUrl ? { mediaUrl: params.mediaUrl } : undefined,
				});
				return {
					messageId: result.messageId,
				};
			},
		},
	},
});
