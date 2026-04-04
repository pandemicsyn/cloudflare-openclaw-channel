import {
	DEFAULT_ACCOUNT_ID,
	DEFAULT_CHANNEL_ID,
	buildBridgeWebSocketPath,
	buildChannelAddress,
	buildConversationMessagesPath,
	buildConversationStatusPath,
	createMessageId,
	type ChannelMessage,
	type ChannelStatusKind,
	type ChannelUi,
	type ProviderActionEvent,
	type ProviderEvent,
	type ProviderInboundEvent,
	type ProviderMessageEvent,
	type ProviderStatusEvent,
	type ThreadAgentDescriptor,
	type ThreadRouteCatalog,
	type ThreadRouteState,
} from "../../channel-contract/src/index.js";
import { createChannelPairingChallengeIssuer } from "openclaw/plugin-sdk/channel-pairing";
import { dispatchInboundDirectDmWithRuntime } from "openclaw/plugin-sdk/channel-inbound";
import { resolveInboundDirectDmAccessWithRuntime } from "openclaw/plugin-sdk/command-auth";
import type { OpenClawConfig } from "openclaw/plugin-sdk/core";
import { ApprovalGatewayClient } from "./approval-client.js";
import { isApproverAllowed } from "./approval-auth.js";
import { recordSenderBinding } from "./binding-store.js";
import {
	configureConversationThreadRoute,
	resolveConversationRoute,
} from "./thread-bindings.js";

type ResolvedAccount = {
	accountId: string | null;
	baseUrl: string;
	serviceToken: string;
	defaultTo?: string;
	dmPolicy?: string;
	allowFrom: string[];
	approvalAllowFrom: string[];
};

type GatewayContext = {
	cfg: OpenClawConfig;
	account: ResolvedAccount;
	abortSignal: AbortSignal;
	log?: {
		info?: (message: string) => void;
		warn?: (message: string) => void;
		error?: (message: string) => void;
		debug?: (message: string) => void;
	};
	setStatus?: (next: Record<string, unknown>) => void;
	channelRuntime?: any;
};

const activeManagers = new Map<string, BridgeConnectionManager>();

function managerKey(accountId?: string | null): string {
	return accountId ?? DEFAULT_ACCOUNT_ID;
}

function normalizeBaseWsUrl(baseUrl: string): URL {
	const url = new URL(baseUrl);
	url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
	return url;
}


function buildPairingUi(params: { senderId: string; code?: string }): ChannelUi {
	return {
		kind: "approval",
		title: "Pairing Required",
		body: params.code
			? `An operator must approve this chat before messages can run. Pairing code: ${params.code}`
			: `An operator must approve this chat before messages can run. Your channel id is ${params.senderId}.`,
		approvalId: params.code ?? params.senderId,
		approvalKind: "pairing",
	};
}

function buildThreadRouteNoticeBody(route: ThreadRouteState): string {
	if (route.mode === "agent" && route.agentId) {
		return `Thread pinned to agent ${route.agentId}. Resolved session ${route.resolvedSessionKey ?? "unknown"}.`;
	}
	if (route.mode === "session" && route.targetSessionKey) {
		return `Thread pinned to session ${route.targetSessionKey}.`;
	}
	if (route.source === "configured") {
		return `Thread follows configured routing to ${route.resolvedAgentId ?? "the configured target"}.`;
	}
	return `Thread uses automatic routing via ${route.resolvedAgentId ?? "the default agent"}.`;
}

function buildThreadRouteUi(route: ThreadRouteState): ChannelUi {
	return {
		kind: "notice",
		title: route.mode === "auto" ? "Thread Route" : "Thread Route Updated",
		body: buildThreadRouteNoticeBody(route),
		badge: route.mode === "auto" ? route.source : route.mode,
	};
}

function buildThreadRouteCatalog(cfg: OpenClawConfig): ThreadRouteCatalog | undefined {
	const agents = Array.isArray(cfg.agents?.list) ? cfg.agents.list : [];
	const descriptors: ThreadAgentDescriptor[] = [];
	for (const entry of agents) {
		if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
			continue;
		}
		const id = typeof entry.id === "string" ? entry.id.trim() : "";
		if (!id) {
			continue;
		}
		descriptors.push({
			id,
			name: typeof entry.name === "string" ? entry.name.trim() || undefined : undefined,
			workspace: typeof entry.workspace === "string" ? entry.workspace.trim() || undefined : undefined,
			default: entry.default === true ? true : undefined,
		});
	}
	if (descriptors.length === 0) {
		return undefined;
	}
	const explicitDefault = descriptors.find((entry) => entry.default)?.id;
	return {
		agents: descriptors,
		defaultAgentId: explicitDefault ?? (descriptors.length === 1 ? descriptors[0]?.id : undefined),
		updatedAt: new Date().toISOString(),
	};
}

function buildThreadRouteMetadata(cfg: OpenClawConfig, route: ThreadRouteState): Record<string, unknown> {
	return {
		cfDoChannel: {
			threadRoute: route,
			threadCatalog: buildThreadRouteCatalog(cfg),
		},
	};
}

async function postFallbackMessage(
	account: ResolvedAccount,
	conversationId: string,
	message: ChannelMessage,
): Promise<void> {
	const url = new URL(buildConversationMessagesPath(conversationId), account.baseUrl).toString();
	const response = await fetch(url, {
		method: "POST",
		headers: {
			authorization: `Bearer ${account.serviceToken}`,
			"content-type": "application/json",
		},
		body: JSON.stringify({
			messageId: message.id,
			role: message.role,
			text: message.text,
			participantId: message.participantId,
			metadata: message.metadata,
			ui: message.ui,
		}),
	});
	if (!response.ok) {
		throw new Error(`bridge fallback failed (${response.status}): ${await response.text()}`);
	}
}

async function postFallbackStatus(
	account: ResolvedAccount,
	conversationId: string,
	status: {
		kind: ChannelStatusKind;
		message?: string;
		referenceId?: string;
		approvalId?: string;
		approvalKind?: "exec" | "plugin" | "pairing";
		details?: Record<string, unknown>;
	},
): Promise<void> {
	const url = new URL(buildConversationStatusPath(conversationId), account.baseUrl).toString();
	const response = await fetch(url, {
		method: "POST",
		headers: {
			authorization: `Bearer ${account.serviceToken}`,
			"content-type": "application/json",
		},
		body: JSON.stringify(status),
	});
	if (!response.ok) {
		throw new Error(`bridge status fallback failed (${response.status}): ${await response.text()}`);
	}
}

export class BridgeConnectionManager {
	private socket: WebSocket | null = null;
	private connected = false;
	private stopped = false;
	private reconnectDelayMs = 1_000;
	private approvalClient: ApprovalGatewayClient | null = null;

	constructor(private readonly ctx: GatewayContext) {}

	get isConnected(): boolean {
		return this.connected;
	}

	async run(): Promise<void> {
		while (!this.stopped && !this.ctx.abortSignal.aborted) {
			try {
				await this.connectOnce();
				this.reconnectDelayMs = 1_000;
				await this.waitForSocketClose();
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				this.ctx.log?.warn?.(
					`[${managerKey(this.ctx.account.accountId)}] bridge connection failed: ${message}`,
				);
				this.ctx.setStatus?.({
					accountId: this.ctx.account.accountId,
					connected: false,
					connecting: false,
					lastError: message,
				});
			}
			if (this.stopped || this.ctx.abortSignal.aborted) {
				break;
			}
			await new Promise((resolve) => setTimeout(resolve, this.reconnectDelayMs));
			this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, 15_000);
		}
		this.close();
	}

	close(): void {
		this.stopped = true;
		this.connected = false;
		if (this.socket) {
			try {
				this.socket.close(1000, "shutdown");
			} catch {}
		}
		this.socket = null;
		void this.approvalClient?.close();
		this.approvalClient = null;
	}

	async sendProviderMessage(params: {
		conversationId: string;
		text: string;
		participantId?: string;
		metadata?: Record<string, unknown>;
		role?: "assistant" | "system";
		messageId?: string;
		ui?: ChannelUi;
	}): Promise<void> {
		const message: ChannelMessage = {
			id: params.messageId ?? createMessageId("provider"),
			role: params.role ?? "assistant",
			text: params.text,
			timestamp: new Date().toISOString(),
			participantId: params.participantId,
			metadata: params.metadata,
			ui: params.ui,
		};

		if (this.socket && this.connected) {
			await this.sendProviderEvent({
				type: "provider.message",
				conversationId: params.conversationId,
				message,
			} satisfies ProviderMessageEvent);
			return;
		}

		await postFallbackMessage(this.ctx.account, params.conversationId, message);
	}

	async sendProviderStatus(params: {
		conversationId: string;
		kind: ChannelStatusKind;
		message?: string;
		referenceId?: string;
		approvalId?: string;
		approvalKind?: "exec" | "plugin" | "pairing";
		details?: Record<string, unknown>;
	}): Promise<void> {
		const status = {
			kind: params.kind,
			message: params.message,
			referenceId: params.referenceId,
			approvalId: params.approvalId,
			approvalKind: params.approvalKind,
			details: params.details,
		};
		if (!this.socket || !this.connected) {
			await postFallbackStatus(this.ctx.account, params.conversationId, status);
			return;
		}
		await this.sendProviderEvent({
			type: "provider.status",
			conversationId: params.conversationId,
			status,
		} satisfies ProviderStatusEvent);
	}

	private async sendProviderEvent(event: ProviderEvent): Promise<void> {
		if (!this.socket || !this.connected) {
			throw new Error("provider websocket is not connected");
		}
		this.socket.send(JSON.stringify(event));
	}

	private async connectOnce(): Promise<void> {
		if (!this.ctx.channelRuntime) {
			throw new Error("channelRuntime is required for native provider transport");
		}
		const baseUrl = normalizeBaseWsUrl(this.ctx.account.baseUrl);
		const wsUrl = new URL(
			buildBridgeWebSocketPath({
				accountId: this.ctx.account.accountId ?? DEFAULT_ACCOUNT_ID,
				role: "provider",
				token: this.ctx.account.serviceToken,
			}),
			baseUrl,
		);
		const socket = new WebSocket(wsUrl.toString());
		this.socket = socket;

		await new Promise<void>((resolve, reject) => {
			const fail = () => reject(new Error("provider websocket failed before open"));
			socket.addEventListener("open", () => resolve(), { once: true });
			socket.addEventListener("error", fail, { once: true });
			this.ctx.abortSignal.addEventListener(
				"abort",
				() => {
					this.close();
					reject(new Error("aborted"));
				},
				{ once: true },
			);
		});

		this.connected = true;
		this.ctx.log?.info?.(
			`[${managerKey(this.ctx.account.accountId)}] connected to bridge ${wsUrl.origin}`,
		);
		this.ctx.setStatus?.({
			accountId: this.ctx.account.accountId,
			connected: true,
			connecting: false,
			lastConnectedAt: Date.now(),
			lastError: null,
		});

		socket.send(
			JSON.stringify({
				type: "provider.hello",
				accountId: this.ctx.account.accountId ?? DEFAULT_ACCOUNT_ID,
			}),
		);

		socket.addEventListener("message", (event) => {
			void this.handleSocketMessage(event.data).catch((error) => {
				const message = error instanceof Error ? error.message : String(error);
				this.ctx.log?.error?.(
					`[${managerKey(this.ctx.account.accountId)}] inbound handling failed: ${message}`,
				);
			});
		});
		socket.addEventListener("close", () => {
			this.connected = false;
			this.ctx.setStatus?.({
				accountId: this.ctx.account.accountId,
				connected: false,
				connecting: false,
				lastDisconnectAt: Date.now(),
			});
		});
	}

	private waitForSocketClose(): Promise<void> {
		return new Promise((resolve) => {
			if (!this.socket) {
				resolve();
				return;
			}
			this.socket.addEventListener("close", () => resolve(), { once: true });
			this.ctx.abortSignal.addEventListener(
				"abort",
				() => {
					this.close();
					resolve();
				},
				{ once: true },
			);
		});
	}

	private async handleSocketMessage(raw: unknown): Promise<void> {
		const payload = typeof raw === "string" ? raw : String(raw);
		const envelope = JSON.parse(payload) as
			| ProviderInboundEvent
			| ProviderActionEvent
			| { type: string; error?: string };
		if (envelope.type === "provider.inbound") {
			await this.handleInboundMessage(envelope as ProviderInboundEvent);
			return;
		}
		if (envelope.type === "provider.action") {
			await this.handleAction(envelope as ProviderActionEvent);
			return;
		}
		if ("error" in envelope && envelope.error) {
			throw new Error(envelope.error);
		}
	}

	private async handleAction(envelope: ProviderActionEvent): Promise<void> {
		if (envelope.action.type === "approval.resolve") {
			if (!isApproverAllowed(envelope.senderId, this.ctx.account.approvalAllowFrom)) {
				await this.sendProviderMessage({
					conversationId: envelope.conversationId,
					text: `Approval denied: ${envelope.senderId} is not allowed to approve actions on this channel.`,
					role: "system",
					ui: {
						kind: "notice",
						title: "Approval Not Authorized",
						body: `${envelope.senderId} is not allowed to approve actions on this channel.`,
						badge: "denied",
					},
				});
				return;
			}
			this.approvalClient ??= new ApprovalGatewayClient({
				cfg: this.ctx.cfg,
				log: this.ctx.log,
			});
			await this.sendProviderStatus({
				conversationId: envelope.conversationId,
				kind: "working",
				referenceId: envelope.actionId,
				approvalId: envelope.action.approvalId,
				message: "Submitting approval decision to OpenClaw.",
			});
			try {
				await this.approvalClient.resolveApproval({
					id: envelope.action.approvalId,
					decision: envelope.action.decision,
				});
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				await this.sendProviderMessage({
					conversationId: envelope.conversationId,
					text: `Approval submit failed: ${message}`,
					role: "system",
					ui: {
						kind: "notice",
						title: "Approval Submit Failed",
						body: message,
						badge: "error",
					},
				});
			}
			return;
		}

		if (envelope.action.type === "thread.inspect") {
			try {
				const resolved = await resolveConversationRoute({
					cfg: this.ctx.cfg,
					accountId: this.ctx.account.accountId,
					conversationId: envelope.conversationId,
				});
				await this.sendProviderMessage({
					conversationId: envelope.conversationId,
					text: buildThreadRouteNoticeBody(resolved.threadRoute),
					role: "system",
					ui: buildThreadRouteUi(resolved.threadRoute),
					metadata: buildThreadRouteMetadata(this.ctx.cfg, resolved.threadRoute),
				});
				await this.sendProviderStatus({
					conversationId: envelope.conversationId,
					kind: "final",
					referenceId: envelope.actionId,
					message: "Thread route loaded.",
					details: { ok: true },
				});
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				await this.sendProviderMessage({
					conversationId: envelope.conversationId,
					text: `Thread route inspect failed: ${message}`,
					role: "system",
					ui: {
						kind: "notice",
						title: "Thread Route Inspect Failed",
						body: message,
						badge: "error",
					},
				});
			}
			return;
		}

		if (envelope.action.type === "thread.configure") {
			await this.sendProviderStatus({
				conversationId: envelope.conversationId,
				kind: "working",
				referenceId: envelope.actionId,
				message: "Updating thread route.",
			});
			try {
				const route = await configureConversationThreadRoute({
					cfg: this.ctx.cfg,
					accountId: this.ctx.account.accountId,
					conversationId: envelope.conversationId,
					mode: envelope.action.mode,
					agentId: envelope.action.agentId,
					sessionKey: envelope.action.sessionKey,
					label: envelope.action.label,
					actorId: envelope.senderId,
				});
				await this.sendProviderMessage({
					conversationId: envelope.conversationId,
					text: buildThreadRouteNoticeBody(route),
					role: "system",
					ui: buildThreadRouteUi(route),
					metadata: buildThreadRouteMetadata(this.ctx.cfg, route),
				});
				await this.sendProviderStatus({
					conversationId: envelope.conversationId,
					kind: "final",
					referenceId: envelope.actionId,
					message: "Thread route updated.",
					details: { ok: true },
				});
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				await this.sendProviderMessage({
					conversationId: envelope.conversationId,
					text: `Thread route update failed: ${message}`,
					role: "system",
					ui: {
						kind: "notice",
						title: "Thread Route Update Failed",
						body: message,
						badge: "error",
					},
				});
				await this.sendProviderStatus({
					conversationId: envelope.conversationId,
					kind: "final",
					referenceId: envelope.actionId,
					message: "Thread route update failed.",
					details: { ok: false, error: message },
				});
			}
		}
	}

	private async handleInboundMessage(inbound: ProviderInboundEvent): Promise<void> {
		const conversationId = inbound.conversationId;
		const text = inbound.event.text?.trim();
		if (!text) {
			return;
		}
		const senderId = inbound.senderId?.trim() || conversationId;
		await recordSenderBinding({
			accountId: this.ctx.account.accountId ?? DEFAULT_ACCOUNT_ID,
			senderId,
			conversationId,
		});
		await this.sendProviderStatus({
			conversationId,
			kind: "working",
			referenceId: inbound.event.messageId,
			message: "Checking channel access and pairing state.",
		});
		const resolvedAccountId = this.ctx.account.accountId ?? DEFAULT_ACCOUNT_ID;
		const readAllowFromStore = () =>
			this.ctx.channelRuntime!.pairing.readAllowFromStore({
				channel: DEFAULT_CHANNEL_ID,
				accountId: resolvedAccountId,
			});
		const issuePairingChallenge = createChannelPairingChallengeIssuer({
			channel: DEFAULT_CHANNEL_ID,
			upsertPairingRequest: (input: { id: string; meta?: Record<string, string | undefined> }) =>
				this.ctx.channelRuntime!.pairing.upsertPairingRequest({
					channel: DEFAULT_CHANNEL_ID,
					id: input.id,
					accountId: resolvedAccountId,
					meta: input.meta,
				}),
		});
		const resolvedAccess = await resolveInboundDirectDmAccessWithRuntime({
			cfg: this.ctx.cfg,
			channel: DEFAULT_CHANNEL_ID,
			accountId: resolvedAccountId,
			dmPolicy: this.ctx.account.dmPolicy ?? "pairing",
			allowFrom: this.ctx.account.allowFrom,
			senderId,
			rawBody: text,
			isSenderAllowed: (candidate: string, allowFrom: string[]) =>
				isApproverAllowed(candidate, allowFrom),
			runtime: {
				shouldComputeCommandAuthorized:
					this.ctx.channelRuntime.commands.shouldComputeCommandAuthorized,
				resolveCommandAuthorizedFromAuthorizers:
					this.ctx.channelRuntime.commands.resolveCommandAuthorizedFromAuthorizers,
			},
			readStoreAllowFrom: async () => await readAllowFromStore(),
		});
		if (resolvedAccess.access.decision === "pairing") {
			let pairingReplyText = "";
			await issuePairingChallenge({
				senderId,
				senderIdLine: `Your channel id: ${senderId}`,
				meta: {
					conversationId,
				},
				sendPairingReply: async (challengeText: string) => {
					pairingReplyText = challengeText;
					await this.sendProviderStatus({
						conversationId,
						kind: "approval_required",
						approvalId: senderId,
						approvalKind: "pairing",
						message: "Pairing approval is required before this chat can continue.",
					});
					await this.sendProviderMessage({
						conversationId,
						text: challengeText,
						participantId: senderId,
						role: "system",
						ui: buildPairingUi({ senderId }),
					});
				},
				onCreated: () => {
					this.ctx.log?.debug?.(
						`[${managerKey(this.ctx.account.accountId)}] pairing request sender=${senderId}`,
					);
				},
				onReplyError: (error: unknown) => {
					const message = error instanceof Error ? error.message : String(error);
					this.ctx.log?.warn?.(
						`[${managerKey(this.ctx.account.accountId)}] pairing reply failed for ${senderId}: ${message}`,
					);
				},
			});
			if (!pairingReplyText) {
				await this.sendProviderStatus({
					conversationId,
					kind: "approval_required",
					approvalId: senderId,
					approvalKind: "pairing",
					message: "Pairing approval is required before this chat can continue.",
				});
			}
			return;
		}
		if (resolvedAccess.access.decision !== "allow") {
			this.ctx.log?.warn?.(
				`[${managerKey(this.ctx.account.accountId)}] blocked sender ${senderId} (${resolvedAccess.access.reason})`,
			);
			await this.sendProviderStatus({
				conversationId,
				kind: "final",
				referenceId: inbound.event.messageId,
				message: `Message blocked: ${resolvedAccess.access.reason ?? "not allowed"}.`,
				details: { ok: false, reason: resolvedAccess.access.reason },
			});
			return;
		}

		await this.sendProviderStatus({
			conversationId,
			kind: "typing",
			referenceId: inbound.event.messageId,
			message: "OpenClaw is thinking.",
		});
		const resolvedRoute = await resolveConversationRoute({
			cfg: this.ctx.cfg,
			accountId: this.ctx.account.accountId,
			conversationId,
		});
		await dispatchInboundDirectDmWithRuntime({
			cfg: this.ctx.cfg,
			runtime: {
				channel: {
					...this.ctx.channelRuntime,
					routing: {
						...this.ctx.channelRuntime.routing,
						resolveAgentRoute: () => resolvedRoute.route,
					},
				},
			},
			channel: DEFAULT_CHANNEL_ID,
			channelLabel: "Cloudflare OpenClaw Channel",
			accountId: this.ctx.account.accountId ?? DEFAULT_ACCOUNT_ID,
			peer: {
				kind: "direct",
				id: conversationId,
			},
				senderId,
				senderAddress: buildChannelAddress(senderId),
				recipientAddress: buildChannelAddress(conversationId),
				conversationLabel: conversationId,
			rawBody: text,
			messageId: inbound.event.messageId?.trim() || createMessageId("inbound"),
			timestamp: Date.now(),
			commandAuthorized: resolvedAccess.commandAuthorized,
			deliver: async (reply: {
				text?: string;
				mediaUrl?: string;
				mediaUrls?: string[];
			}) => {
				const parts = [reply.text?.trim(), reply.mediaUrl, ...(reply.mediaUrls ?? [])].filter(
					(value): value is string => Boolean(value?.trim()),
				);
				if (parts.length === 0) {
					return;
				}
				await this.sendProviderStatus({
					conversationId,
					kind: "working",
					referenceId: inbound.event.messageId,
					message: "Delivering reply.",
				});
				await this.sendProviderMessage({
					conversationId,
					text: parts.join("\n\n"),
					participantId: senderId,
					metadata: {
						...(inbound.senderName ? { userName: inbound.senderName } : {}),
						...buildThreadRouteMetadata(this.ctx.cfg, resolvedRoute.threadRoute),
					},
				});
			},
			onRecordError: (error: unknown) => {
				const message = error instanceof Error ? error.message : String(error);
				this.ctx.log?.error?.(
					`[${managerKey(this.ctx.account.accountId)}] record inbound failed: ${message}`,
				);
			},
			onDispatchError: (error: unknown, info: { kind: string }) => {
				const message = error instanceof Error ? error.message : String(error);
				this.ctx.log?.error?.(
					`[${managerKey(this.ctx.account.accountId)}] dispatch ${info.kind} failed: ${message}`,
				);
			},
		});
		await this.sendProviderStatus({
			conversationId,
			kind: "final",
			referenceId: inbound.event.messageId,
			message: "Reply complete.",
			details: { ok: true },
		});
	}
}

export function registerBridgeManager(ctx: GatewayContext): BridgeConnectionManager {
	const key = managerKey(ctx.account.accountId);
	const existing = activeManagers.get(key);
	if (existing) {
		existing.close();
	}
	const manager = new BridgeConnectionManager(ctx);
	activeManagers.set(key, manager);
	return manager;
}

export function getBridgeManager(accountId?: string | null): BridgeConnectionManager | undefined {
	return activeManagers.get(managerKey(accountId));
}

export function clearBridgeManager(accountId?: string | null): void {
	const key = managerKey(accountId);
	const existing = activeManagers.get(key);
	if (existing) {
		existing.close();
		activeManagers.delete(key);
	}
}
