import {
	createChannelPluginBase,
	createChatChannelPlugin,
	type OpenClawConfig,
} from "openclaw/plugin-sdk/core";
import {
	buildExecApprovalPendingReplyPayload,
	buildPluginApprovalRequestMessage,
	buildPluginApprovalResolvedMessage,
} from "openclaw/plugin-sdk/approval-runtime";

import {
	buildConversationMessagesPath,
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
import { readSenderBinding } from "./binding-store.js";

const PAIRING_APPROVED_MESSAGE = "✅ OpenClaw access approved. Send a message to start chatting.";

type ResolvedAccount = {
	accountId: string | null;
	baseUrl: string;
	serviceToken: string;
	defaultTo?: string;
	dmPolicy?: string;
	allowFrom: string[];
	approvalAllowFrom: string[];
};

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
		messageId: payload.message?.id ?? request.messageId ?? `plugin_${Date.now()}`,
	};
}

function buildExecApprovalResolvedText(resolved: {
	decision: string;
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

export const cloudflareDoChannelPlugin = createChatChannelPlugin<ResolvedAccount>({
	base: createChannelPluginBase({
		id: DEFAULT_CHANNEL_ID,
		meta: {
			label: "Cloudflare Durable Object Channel",
			blurb: "Bridge OpenClaw through a Cloudflare Worker-backed persistent channel.",
		},
		setup: {
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
		},
	}),
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
	messaging: {
		normalizeTarget: (target: string) => target.trim() || undefined,
		targetResolver: {
			looksLikeId: (id: string) => Boolean(id?.trim()),
			hint: "<conversation-id>",
		},
	},
	execApprovals: {
		getInitiatingSurfaceState: ({ cfg, accountId }: { cfg: OpenClawConfig; accountId?: string | null }) => {
			const account = resolveAccount(cfg, accountId ?? DEFAULT_ACCOUNT_ID);
			return account.approvalAllowFrom.length > 0 ? { kind: "enabled" } : { kind: "disabled" };
		},
		shouldSuppressLocalPrompt: ({ cfg, accountId }: { cfg: OpenClawConfig; accountId?: string | null }) => {
			const account = resolveAccount(cfg, accountId ?? DEFAULT_ACCOUNT_ID);
			return account.approvalAllowFrom.length > 0;
		},
		hasConfiguredDmRoute: ({ cfg }: { cfg: OpenClawConfig }) =>
			resolveAccount(cfg, DEFAULT_ACCOUNT_ID).approvalAllowFrom.length > 0,
		buildPendingPayload: ({ request, nowMs }: { request: any; nowMs: number }) => {
			const payload = buildExecApprovalPendingReplyPayload({
				request,
				nowMs,
			}) as { text?: string };
			return {
				text: payload.text ?? "Exec approval required.",
				channelData: {
					execApproval: {
						approvalId: request.id,
						approvalSlug: request.id.slice(0, 8),
						allowedDecisions: ["allow-once", "allow-always", "deny"],
					},
					cfDoChannel: {
						ui: buildApprovalUi({
							title: "Exec Approval Required",
							body: payload.text ?? "A tool action needs approval.",
							approvalId: request.id,
							approvalKind: "exec",
						}),
					},
				},
			};
		},
		buildResolvedPayload: ({ resolved }: { resolved: any }) => ({
			text: buildExecApprovalResolvedText(resolved),
			channelData: {
				execApproval: {
					approvalId: resolved.id,
					approvalSlug: String(resolved.id ?? "").slice(0, 8),
					allowedDecisions: [],
				},
				cfDoChannel: {
					ui: {
						kind: "notice",
						title: "Approval Resolved",
						body: buildExecApprovalResolvedText(resolved),
						badge: resolved.decision,
					},
				},
			},
		}),
		buildPluginPendingPayload: ({ request, nowMs }: { request: any; nowMs: number }) => ({
			text: buildPluginApprovalRequestMessage(request, nowMs),
			channelData: {
				execApproval: {
					approvalId: request.id,
					approvalSlug: request.id.slice(0, 8),
					allowedDecisions: ["allow-once", "allow-always", "deny"],
				},
				cfDoChannel: {
					ui: buildApprovalUi({
						title: "Plugin Approval Required",
						body: buildPluginApprovalRequestMessage(request, nowMs),
						approvalId: request.id,
						approvalKind: "plugin",
					}),
				},
			},
		}),
		buildPluginResolvedPayload: ({ resolved }: { resolved: any }) => ({
			text: buildPluginApprovalResolvedMessage(resolved),
			channelData: {
				execApproval: {
					approvalId: resolved.id,
					approvalSlug: String(resolved.id ?? "").slice(0, 8),
					allowedDecisions: [],
				},
				cfDoChannel: {
					ui: {
						kind: "notice",
						title: "Plugin Approval Resolved",
						body: buildPluginApprovalResolvedMessage(resolved),
						badge: resolved.decision,
					},
				},
			},
		}),
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
				const trimmed = to?.trim();
				if (trimmed) {
					return { ok: true as const, to: trimmed };
				}
				if (cfg) {
					const account = resolveAccount(cfg, accountId);
					if (account.defaultTo) {
						return { ok: true as const, to: account.defaultTo };
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
				const text = [
					payload.text?.trim() ?? "",
					payload.mediaUrl,
					...(payload.mediaUrls ?? []),
				]
					.filter((entry): entry is string => Boolean(entry?.trim()))
					.join("\n\n");
				const ui = extractUiFromPayload(payload);
				if (manager) {
					if (payload.channelData && typeof payload.channelData === "object") {
						const execApproval = (payload.channelData as Record<string, unknown>).execApproval;
						if (execApproval && typeof execApproval === "object" && !Array.isArray(execApproval)) {
							const approval = execApproval as { approvalId?: string; allowedDecisions?: ApprovalDecision[] };
							await manager.sendProviderStatus({
								conversationId: to,
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
					await manager.sendProviderMessage({
						conversationId: to,
						text,
						role: "assistant",
						ui,
						metadata: payload.channelData,
					});
					return { messageId: `provider_${Date.now()}` };
				}
				return await sendOutboundMessage(account, to, {
					role: "assistant",
					text,
					metadata: payload.channelData,
					ui,
				});
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
				if (manager) {
					await manager.sendProviderMessage({
						conversationId: params.to,
						text,
						role: "assistant",
						metadata: params.mediaUrl ? { mediaUrl: params.mediaUrl } : undefined,
					});
					return { messageId: `provider_${Date.now()}` };
				}
				return await sendOutboundMessage(account, params.to, {
					role: "assistant",
					text,
					metadata: params.mediaUrl ? { mediaUrl: params.mediaUrl } : undefined,
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
				if (manager) {
					await manager.sendProviderMessage({
						conversationId: params.to,
						text: params.text,
						role: "assistant",
					});
					await manager.sendProviderStatus({
						conversationId: params.to,
						kind: "final",
						message: "Reply complete.",
					});
					return { messageId: `provider_${Date.now()}` };
				}
				return await sendOutboundMessage(account, params.to, {
					role: "assistant",
					text: params.text,
				});
			},
		},
	},
	status: {
		buildAccountSnapshot: ({ account }: { account: ResolvedAccount }) => ({
			accountId: account.accountId,
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
		startAccount: async (ctx: {
			cfg: OpenClawConfig;
			accountId: string;
			account: ResolvedAccount;
			abortSignal: AbortSignal;
			log?: {
				info?: (message: string) => void;
				warn?: (message: string) => void;
				error?: (message: string) => void;
				debug?: (message: string) => void;
			};
			setStatus: (next: Record<string, unknown>) => void;
			channelRuntime?: unknown;
		}) => {
			const manager = registerBridgeManager({
				cfg: ctx.cfg,
				account: ctx.account,
				abortSignal: ctx.abortSignal,
				log: ctx.log,
				setStatus: ctx.setStatus,
				channelRuntime: ctx.channelRuntime,
			});
			await manager.run();
		},
		stopAccount: async (ctx: { accountId: string }) => {
			clearBridgeManager(ctx.accountId);
		},
	},
});
