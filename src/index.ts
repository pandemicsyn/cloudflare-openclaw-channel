import { DurableObject } from "cloudflare:workers";

import {
	DEFAULT_ACCOUNT_ID,
	buildBridgeWebSocketPath,
	parseConversationIdFromTarget,
	buildConversationMessagesPath,
	createMessageId,
	normalizeConversationId,
	type BridgeSocketEnvelope,
	type BridgeSocketRole,
	type ChannelMessage,
	type ClientActionEvent,
	type ClientEvent,
	type ProviderActionEvent,
	type ProviderEvent,
	type ProviderInboundEvent,
	type ServerEvent,
} from "../packages/channel-contract/src/index.js";
import {
	authorizeClientRequest,
	authorizeServiceRequest,
	issueClientJwtFromCredential,
} from "./auth.js";
import type { WorkerEnv } from "./env.js";
import { badRequest, corsPreflight, JsonRequestError, json, readJson } from "./http.js";
import {
	clientEventSchema,
	issueTokenRequestSchema,
	outboundRestRequestSchema,
	outboundStatusRequestSchema,
	providerEventSchema,
	type IssueTokenRequest,
	type OutboundRestRequest,
	type OutboundStatusRequest,
} from "./schemas.js";

type SocketAttachment = {
	role: BridgeSocketRole;
	accountId: string;
	conversationId?: string;
	clientId?: string;
	userSubject?: string;
	userName?: string;
	connectedAt: string;
};

function buildServerError(conversationId: string, error: string): ServerEvent {
	return {
		type: "server.error",
		conversationId,
		error,
	};
}

function buildServerAck(conversationId: string, messageId: string): ServerEvent {
	return {
		type: "server.ack",
		conversationId,
		messageId,
	};
}

function buildServerStatus(
	conversationId: string,
	status: {
		kind: "queued" | "typing" | "working" | "approval_required" | "approval_resolved" | "final";
		message?: string;
		referenceId?: string;
		approvalId?: string;
		approvalKind?: "exec" | "plugin" | "pairing";
		details?: Record<string, unknown>;
	},
): ServerEvent {
	return {
		type: "server.status",
		conversationId,
		status,
		timestamp: new Date().toISOString(),
	};
}

function parseBridgeRole(raw: string | null): BridgeSocketRole {
	return raw === "provider" ? "provider" : "client";
}

function parseClientConversationId(raw: string | null): string {
	try {
		return normalizeConversationId(raw ?? "");
	} catch (error) {
		const message = error instanceof Error ? error.message : "conversation id is invalid";
		throw new JsonRequestError(message);
	}
}

function normalizeProviderConversationId(raw: string): {
	conversationId: string;
	legacyFallbackApplied: boolean;
} {
	try {
		return { conversationId: normalizeConversationId(raw), legacyFallbackApplied: false };
	} catch {
		return {
			conversationId: parseConversationIdFromTarget(raw),
			legacyFallbackApplied: true,
		};
	}
}

function parseConversationMessageRoute(pathname: string): { conversationId: string } | null {
	const match = /^\/v1\/conversations\/([^/]+)\/messages$/.exec(pathname);
	if (!match) {
		return null;
	}
	return {
		conversationId: normalizeConversationId(decodeURIComponent(match[1])),
	};
}

function parseConversationStatusRoute(pathname: string): { conversationId: string } | null {
	const match = /^\/v1\/conversations\/([^/]+)\/status$/.exec(pathname);
	if (!match) {
		return null;
	}
	return {
		conversationId: normalizeConversationId(decodeURIComponent(match[1])),
	};
}

function countUniqueConversations(attachments: SocketAttachment[]): number {
	return new Set(
		attachments
			.map((attachment) => attachment.conversationId?.trim())
			.filter((value): value is string => Boolean(value)),
	).size;
}

function isWorkerDebugEnabled(env: WorkerEnv): boolean {
	const record = env as Record<string, unknown>;
	const value = record.CHANNEL_DEBUG ?? record.CF_DO_CHANNEL_DEBUG;
	return value === "1" || value === "true";
}

function logWorkerDebug(env: WorkerEnv, event: string, details?: Record<string, unknown>): void {
	if (!isWorkerDebugEnabled(env)) {
		return;
	}
	const prefix = `[cf-do-worker][${new Date().toISOString()}] ${event}`;
	if (!details) {
		console.log(prefix);
		return;
	}
	console.log(prefix, details);
}

function summarizeServerEvent(event: ServerEvent): Record<string, unknown> {
	if (event.type === "server.message") {
		const metadata =
			event.message.metadata && typeof event.message.metadata === "object"
				? (event.message.metadata as Record<string, unknown>)
				: undefined;
		const channelData =
			metadata?.channelData && typeof metadata.channelData === "object"
				? (metadata.channelData as Record<string, unknown>)
				: undefined;
		const rawCfDoChannel = (metadata?.cfDoChannel ?? channelData?.cfDoChannel) as unknown;
		const rawExecApproval = (metadata?.execApproval ?? channelData?.execApproval) as unknown;
		return {
			type: event.type,
			conversationId: event.conversationId,
			messageId: event.message.id,
			role: event.message.role,
			uiKind: event.message.ui?.kind,
			approvalId:
				event.message.ui?.kind === "approval"
					? event.message.ui.approvalId
					: event.message.ui?.kind === "notice"
						? undefined
						: undefined,
			metadataKeys: metadata ? Object.keys(metadata) : [],
			channelDataKeys: channelData ? Object.keys(channelData) : [],
			metadataCfDoUiKind:
				rawCfDoChannel &&
				typeof rawCfDoChannel === "object" &&
				(rawCfDoChannel as { ui?: unknown }).ui &&
				typeof (rawCfDoChannel as { ui?: unknown }).ui === "object"
					? ((rawCfDoChannel as { ui?: { kind?: unknown } }).ui?.kind ?? undefined)
					: undefined,
			metadataExecApproval:
				rawExecApproval && typeof rawExecApproval === "object"
					? {
							approvalId: (rawExecApproval as { approvalId?: unknown }).approvalId,
							approvalKind: (rawExecApproval as { approvalKind?: unknown }).approvalKind,
							allowedDecisions: (rawExecApproval as { allowedDecisions?: unknown }).allowedDecisions,
						}
					: undefined,
			textPreview: event.message.text.slice(0, 180),
		};
	}
	if (event.type === "server.status") {
		return {
			type: event.type,
			conversationId: event.conversationId,
			kind: event.status.kind,
			approvalId: event.status.approvalId,
			approvalKind: event.status.approvalKind,
			referenceId: event.status.referenceId,
			message: event.status.message,
		};
	}
	if (event.type === "server.error") {
		return {
			type: event.type,
			conversationId: event.conversationId,
			error: event.error,
		};
	}
	return {
		type: event.type,
		conversationId: event.conversationId,
		messageId: event.messageId,
	};
}

export class ChannelBridgeObject extends DurableObject<WorkerEnv> {
	constructor(ctx: DurableObjectState, env: WorkerEnv) {
		super(ctx, env);
		this.ctx.setHibernatableWebSocketEventTimeout(15_000);
	}

	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);
		const accountId =
			(url.searchParams.get("accountId") ?? DEFAULT_ACCOUNT_ID).trim() || DEFAULT_ACCOUNT_ID;

		if (url.pathname === "/ws") {
			return this.handleWebSocketUpgrade(request, accountId);
		}
			if (url.pathname === "/messages" && request.method === "POST") {
				const conversationId = normalizeConversationId(url.searchParams.get("conversationId") ?? "");
				let rawBody: unknown;
				try {
					rawBody = await readJson<unknown>(request);
				} catch (error) {
					if (error instanceof JsonRequestError) {
						return badRequest(error.message);
					}
					throw error;
				}
				const parsedBody = outboundRestRequestSchema.safeParse(rawBody);
				if (!parsedBody.success) {
					return badRequest("invalid outbound message payload");
				}
				const body = parsedBody.data;
				return await this.handleRestOutbound(conversationId, body);
			}
			if (url.pathname === "/status" && request.method === "POST") {
				const conversationId = normalizeConversationId(url.searchParams.get("conversationId") ?? "");
				let rawBody: unknown;
				try {
					rawBody = await readJson<unknown>(request);
				} catch (error) {
					if (error instanceof JsonRequestError) {
						return badRequest(error.message);
					}
					throw error;
				}
				const parsedBody = outboundStatusRequestSchema.safeParse(rawBody);
				if (!parsedBody.success) {
					return badRequest("invalid outbound status payload");
				}
				const body = parsedBody.data;
				return await this.handleRestStatus(conversationId, body);
			}
			if (url.pathname === "/health") {
				return json(this.buildBridgeStatus(accountId));
			}

		return badRequest("route not found", 404);
	}

	private async handleWebSocketUpgrade(request: Request, accountId: string): Promise<Response> {
		if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
			return badRequest("websocket upgrade required", 426);
		}
		const url = new URL(request.url);
		const role = parseBridgeRole(url.searchParams.get("role"));
		const conversationId =
			role === "client" ? parseClientConversationId(url.searchParams.get("conversationId")) : undefined;
		const clientId = url.searchParams.get("clientId")?.trim() || undefined;
		const userSubject = url.searchParams.get("userSub")?.trim() || undefined;
		const userName = url.searchParams.get("userName")?.trim() || undefined;

		const webSocketPair = new WebSocketPair();
		const [client, server] = Object.values(webSocketPair);
		const tags =
			role === "provider"
				? ["role:provider", `account:${accountId}`]
				: ["role:client", `account:${accountId}`, `conversation:${conversationId}`];

		this.ctx.acceptWebSocket(server, tags);
		server.serializeAttachment({
			role,
			accountId,
			conversationId,
			clientId,
			userSubject,
			userName,
			connectedAt: new Date().toISOString(),
		} satisfies SocketAttachment);

		if (role === "client" && conversationId) {
			const providerConnected = this.getProviderSockets().length > 0;
			server.send(
				JSON.stringify(
					buildServerStatus(conversationId, {
						kind: "working",
						message: providerConnected
							? "Bridge connected. Waiting for messages."
							: "Bridge connected. Waiting for OpenClaw provider connection.",
						details: {
							providerConnected,
							roomPresence: this.ctx.getWebSockets(`conversation:${conversationId}`).length + 1,
						},
					}),
				),
			);
		}

		return new Response(null, {
			status: 101,
			webSocket: client,
		});
	}

		async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
			const attachment = this.readAttachment(ws);
			const raw = typeof message === "string" ? message : new TextDecoder().decode(message);
			let envelope: unknown;
			try {
				envelope = JSON.parse(raw) as BridgeSocketEnvelope;
			} catch {
				ws.send(
					JSON.stringify(
						buildServerError(attachment.conversationId ?? "bridge", "invalid json message"),
					),
				);
				return;
			}

			if (attachment.role === "provider") {
				const parsedProviderEvent = providerEventSchema.safeParse(envelope);
				if (!parsedProviderEvent.success) {
					ws.send(
						JSON.stringify(
							buildServerError(attachment.conversationId ?? "bridge", "invalid provider event payload"),
						),
					);
					return;
				}
				await this.handleProviderEnvelope(parsedProviderEvent.data as ProviderEvent, ws, attachment);
				return;
			}
			const parsedClientEvent = clientEventSchema.safeParse(envelope);
			if (!parsedClientEvent.success) {
				ws.send(
					JSON.stringify(
						buildServerError(attachment.conversationId ?? "bridge", "invalid client event payload"),
					),
				);
				return;
			}
			await this.handleClientEnvelope(parsedClientEvent.data as ClientEvent, ws, attachment);
		}

	private async handleClientEnvelope(
		envelope: ClientEvent,
		ws: WebSocket,
		attachment: SocketAttachment,
	): Promise<void> {
		const conversationId = attachment.conversationId!;
		if (envelope.type === "client.ping") {
			ws.send(JSON.stringify(buildServerAck(conversationId, "ping")));
			return;
		}
		if (envelope.type === "client.hello") {
			ws.send(JSON.stringify(buildServerAck(conversationId, "hello")));
			return;
		}
		if (envelope.type === "client.action") {
			await this.handleClientAction(envelope, ws, attachment);
			return;
		}
		if (envelope.type !== "client.message" || !envelope.text?.trim()) {
			ws.send(JSON.stringify(buildServerError(conversationId, "unsupported client event")));
			return;
		}

		const inboundMessage: ChannelMessage = {
			id: envelope.messageId?.trim() || createMessageId("client"),
			role: "user",
			text: envelope.text.trim(),
			timestamp: new Date().toISOString(),
			participantId: attachment.userSubject,
			metadata: {
				...(attachment.userName ? { userName: attachment.userName } : {}),
				...(envelope.metadata ?? {}),
			},
		};

		await this.broadcastToConversation(conversationId, {
			type: "server.message",
			conversationId,
			message: inboundMessage,
		});
		await this.broadcastToConversation(
			conversationId,
			buildServerStatus(conversationId, {
				kind: "queued",
				referenceId: inboundMessage.id,
				message: "Message queued for OpenClaw.",
			}),
		);
		await this.forwardToProviders({
			type: "provider.inbound",
			conversationId,
			senderId: attachment.userSubject ?? conversationId,
			senderName: attachment.userName,
			event: {
				...envelope,
				messageId: inboundMessage.id,
			},
		});
		ws.send(JSON.stringify(buildServerAck(conversationId, inboundMessage.id)));
	}

	private async handleClientAction(
		envelope: ClientActionEvent,
		ws: WebSocket,
		attachment: SocketAttachment,
	): Promise<void> {
		const conversationId = attachment.conversationId!;
		const actionId = envelope.actionId?.trim() || createMessageId("action");
		await this.broadcastToConversation(
			conversationId,
			buildServerStatus(conversationId, {
				kind: "working",
				referenceId: actionId,
				approvalId:
					envelope.action.type === "approval.resolve" ? envelope.action.approvalId : undefined,
				message:
					envelope.action.type === "approval.resolve"
						? "Submitting approval decision to OpenClaw."
						: envelope.action.type === "thread.inspect"
							? "Loading thread route."
							: "Updating thread route.",
			}),
		);
		await this.forwardToProviders({
			type: "provider.action",
			conversationId,
			senderId: attachment.userSubject ?? conversationId,
			senderName: attachment.userName,
			actionId,
			action: envelope.action,
			metadata: envelope.metadata,
		} satisfies ProviderActionEvent);
		ws.send(JSON.stringify(buildServerAck(conversationId, actionId)));
	}

	private async handleProviderEnvelope(
		envelope: ProviderEvent,
		ws: WebSocket,
		attachment: SocketAttachment,
	): Promise<void> {
		if (envelope.type === "provider.hello") {
			ws.send(JSON.stringify(buildServerAck("bridge", `provider:${attachment.accountId}`)));
			return;
		}
		if (envelope.type === "provider.status") {
			const normalized = normalizeProviderConversationId(envelope.conversationId);
			const conversationId = normalized.conversationId;
			if (normalized.legacyFallbackApplied) {
				logWorkerDebug(this.env, "provider.conversationId.legacy_fallback", {
					accountId: attachment.accountId,
					rawConversationId: envelope.conversationId,
					normalizedConversationId: conversationId,
				});
			}
			logWorkerDebug(this.env, "provider.status", {
				accountId: attachment.accountId,
				conversationId,
				originalConversationId: envelope.conversationId,
				kind: envelope.status.kind,
				approvalId: envelope.status.approvalId,
				approvalKind: envelope.status.approvalKind,
			});
			await this.broadcastToConversation(
				conversationId,
				buildServerStatus(conversationId, envelope.status),
			);
			return;
		}
		if (envelope.type !== "provider.message" || !envelope.message?.text?.trim()) {
			return;
		}
		const normalized = normalizeProviderConversationId(envelope.conversationId);
		const conversationId = normalized.conversationId;
		if (normalized.legacyFallbackApplied) {
			logWorkerDebug(this.env, "provider.conversationId.legacy_fallback", {
				accountId: attachment.accountId,
				rawConversationId: envelope.conversationId,
				normalizedConversationId: conversationId,
			});
		}
		logWorkerDebug(this.env, "provider.message", {
			accountId: attachment.accountId,
			conversationId,
			originalConversationId: envelope.conversationId,
			role: envelope.message.role,
			uiKind: envelope.message.ui?.kind,
			approvalId:
				envelope.message.ui?.kind === "approval" ? envelope.message.ui.approvalId : undefined,
			hasMetadata: Boolean(envelope.message.metadata),
		});
		await this.broadcastToConversation(conversationId, {
			type: "server.message",
			conversationId,
			message: envelope.message,
		});
	}

	async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
		ws.close(code, reason);
	}

	private async handleRestOutbound(
		conversationId: string,
		body: OutboundRestRequest,
	): Promise<Response> {
		if (!body.text?.trim()) {
			return badRequest("text is required");
		}
		const message: ChannelMessage = {
			id: body.messageId?.trim() || createMessageId("rest"),
			role: body.role ?? "assistant",
			text: body.text.trim(),
			timestamp: new Date().toISOString(),
			participantId: body.participantId?.trim() || undefined,
			metadata: body.metadata,
			ui: body.ui,
		};
		await this.broadcastToConversation(conversationId, {
			type: "server.message",
			conversationId,
			message,
		});
		return json({ ok: true, message });
	}

	private async handleRestStatus(
		conversationId: string,
		body: OutboundStatusRequest,
	): Promise<Response> {
		const statusEvent = buildServerStatus(conversationId, body);
		await this.broadcastToConversation(conversationId, statusEvent);
		return json({ ok: true, status: statusEvent });
	}

	private readAttachment(ws: WebSocket): SocketAttachment {
		const value = ws.deserializeAttachment();
		if (!value || typeof value !== "object") {
			throw new Error("missing websocket attachment");
		}
		const attachment = value as Partial<SocketAttachment>;
		if (!attachment.role || !attachment.accountId) {
			throw new Error("invalid websocket attachment");
		}
		return {
			role: attachment.role,
			accountId: attachment.accountId,
			conversationId: attachment.conversationId,
			clientId: attachment.clientId,
			userSubject: attachment.userSubject,
			userName: attachment.userName,
			connectedAt: attachment.connectedAt ?? new Date().toISOString(),
		};
	}

	private getProviderSockets(): WebSocket[] {
		return this.ctx.getWebSockets("role:provider");
	}

	private readAllAttachments(): SocketAttachment[] {
		return this.ctx.getWebSockets().map((socket) => this.readAttachment(socket));
	}

	private buildBridgeStatus(accountId: string) {
		const attachments = this.readAllAttachments();
		const clients = attachments.filter((attachment) => attachment.role === "client");
		const providers = attachments.filter((attachment) => attachment.role === "provider");
		const rooms = [...new Set(clients.map((attachment) => attachment.conversationId).filter(Boolean))].map(
			(conversationId) => ({
				conversationId,
				clientCount: clients.filter((attachment) => attachment.conversationId === conversationId).length,
			}),
		);
		return {
			ok: true,
			accountId,
			providerConnected: providers.length > 0,
			providerCount: providers.length,
			clientCount: clients.length,
			roomCount: countUniqueConversations(clients),
			rooms,
		};
	}

	private async forwardToProviders(event: ProviderInboundEvent | ProviderActionEvent): Promise<void> {
		const payload = JSON.stringify(event);
		const providers = this.getProviderSockets();
		if (providers.length === 0) {
			await this.broadcastToConversation(
				event.conversationId,
				buildServerError(event.conversationId, "no provider connected"),
			);
			return;
		}
		for (const socket of providers) {
			try {
				socket.send(payload);
			} catch {
				socket.close(1011, "provider send failed");
			}
		}
	}

	private async broadcastToConversation(conversationId: string, event: ServerEvent): Promise<void> {
		logWorkerDebug(this.env, "broadcast.outbound", summarizeServerEvent(event));
		const payload = JSON.stringify(event);
		for (const socket of this.ctx.getWebSockets(`conversation:${conversationId}`)) {
			try {
				socket.send(payload);
			} catch {
				socket.close(1011, "broadcast failed");
			}
		}
	}
}

function getBridgeStub(env: WorkerEnv, accountId: string) {
	return env.CHANNEL_BRIDGE.getByName(accountId || DEFAULT_ACCOUNT_ID);
}

function buildAuthConfigSummary(env: WorkerEnv) {
	return {
		serviceTokenConfigured: Boolean(env.CHANNEL_SERVICE_TOKEN?.trim()),
		jwtConfigured: Boolean(env.CHANNEL_JWT_SECRET?.trim()),
		publicTokenFallbackConfigured: Boolean(env.CHANNEL_PUBLIC_TOKEN?.trim()),
		staticUserRegistryConfigured: Boolean(env.CHANNEL_USERS_JSON?.trim() && env.CHANNEL_USERS_JSON !== "{}"),
		staticCredentialRegistryConfigured: Boolean(
			env.CHANNEL_CLIENT_CREDENTIALS_JSON?.trim() &&
				env.CHANNEL_CLIENT_CREDENTIALS_JSON !== "{}",
		),
	};
}

export default {
	async fetch(request: Request, env: WorkerEnv): Promise<Response> {
		const url = new URL(request.url);
		if (request.method === "OPTIONS" && url.pathname.startsWith("/v1/")) {
			return corsPreflight();
		}
		if (url.pathname === "/health") {
			return json({
				ok: true,
				channelId: env.CHANNEL_ID ?? "cf-do-channel",
				auth: buildAuthConfigSummary(env),
				bridgeWebSocketExample: buildBridgeWebSocketPath({
					accountId: DEFAULT_ACCOUNT_ID,
					role: "client",
					conversationId: "demo-room",
				}),
				messagePathExample: buildConversationMessagesPath("demo-room"),
			});
		}

		if (url.pathname === "/v1/bridge/status") {
			if (!authorizeServiceRequest(request, env)) {
				return badRequest("unauthorized", 401);
			}
			const accountId =
				(url.searchParams.get("accountId") ?? DEFAULT_ACCOUNT_ID).trim() || DEFAULT_ACCOUNT_ID;
			const stub = getBridgeStub(env, accountId);
			const bridgeHealth = await stub.fetch(
				new Request(new URL(`/health?accountId=${encodeURIComponent(accountId)}`, request.url)),
			);
			const bridge = await bridgeHealth.json();
			return json({
				ok: true,
				channelId: env.CHANNEL_ID ?? "cf-do-channel",
				accountId,
				auth: buildAuthConfigSummary(env),
				bridge,
			});
		}

			if (url.pathname === "/v1/auth/token" && request.method === "POST") {
				let rawBody: unknown;
				try {
					rawBody = await readJson<unknown>(request);
				} catch (error) {
					if (error instanceof JsonRequestError) {
						return badRequest(error.message);
					}
					throw error;
				}
				const parsedBody = issueTokenRequestSchema.safeParse(rawBody);
				if (!parsedBody.success) {
					return badRequest("clientId and clientSecret are required");
				}
				const body: IssueTokenRequest = parsedBody.data;
				const credentialId = body.clientId?.trim();
				const credentialSecret = body.clientSecret?.trim();
			if (!credentialId || !credentialSecret) {
				return badRequest("clientId and clientSecret are required");
			}
			try {
				const issued = await issueClientJwtFromCredential({
					credentialId,
					credentialSecret,
					env,
				});
				return json({
					ok: true,
					token: issued.token,
					sub: issued.subject,
					name: issued.name,
					expiresInSec: issued.expiresInSec,
				});
			} catch (error) {
				const message = error instanceof Error ? error.message : "token issuance failed";
				return json({ ok: false, error: message }, { status: 401 });
			}
		}

		if (url.pathname === "/v1/bridge/ws") {
			try {
				const role = parseBridgeRole(url.searchParams.get("role"));
				if (role === "client") {
					parseClientConversationId(url.searchParams.get("conversationId"));
				}
				const accountId =
					(url.searchParams.get("accountId") ?? DEFAULT_ACCOUNT_ID).trim() || DEFAULT_ACCOUNT_ID;
				if (role === "provider") {
					if (!authorizeServiceRequest(request, env)) {
						return badRequest("unauthorized", 401);
					}
					const stub = getBridgeStub(env, accountId);
					return await stub.fetch(
						new Request(new URL(`/ws?${url.searchParams.toString()}`, request.url), {
							method: request.method,
							headers: request.headers,
						}),
					);
				}
				const identity = await authorizeClientRequest(request, env);
				if (!identity) {
					return badRequest("unauthorized", 401);
				}
				const stub = getBridgeStub(env, accountId);
				const nextParams = new URLSearchParams(url.searchParams);
				nextParams.set("userSub", identity.subject);
				if (identity.name) {
					nextParams.set("userName", identity.name);
				}
				return await stub.fetch(
					new Request(new URL(`/ws?${nextParams.toString()}`, request.url), {
						method: request.method,
						headers: request.headers,
					}),
				);
			} catch (error) {
				if (error instanceof JsonRequestError) {
					return badRequest(error.message);
				}
				if (error instanceof Error) {
					return badRequest(error.message || "unauthorized", 401);
				}
				return badRequest("unauthorized", 401);
			}
		}

			const conversationRoute = parseConversationMessageRoute(url.pathname);
			if (conversationRoute) {
			if (!authorizeServiceRequest(request, env)) {
				return badRequest("unauthorized", 401);
			}
			const accountId =
				(url.searchParams.get("accountId") ?? DEFAULT_ACCOUNT_ID).trim() || DEFAULT_ACCOUNT_ID;
			const stub = getBridgeStub(env, accountId);
			return await stub.fetch(
				new Request(
					new URL(
						`/messages?accountId=${encodeURIComponent(accountId)}&conversationId=${encodeURIComponent(conversationRoute.conversationId)}`,
						request.url,
					),
					{
						method: request.method,
						headers: request.headers,
						body:
							request.method === "GET" || request.method === "HEAD"
								? undefined
								: request.body,
					},
				),
				);
			}

			const statusRoute = parseConversationStatusRoute(url.pathname);
			if (statusRoute) {
				if (!authorizeServiceRequest(request, env)) {
					return badRequest("unauthorized", 401);
				}
				const accountId =
					(url.searchParams.get("accountId") ?? DEFAULT_ACCOUNT_ID).trim() || DEFAULT_ACCOUNT_ID;
				const stub = getBridgeStub(env, accountId);
				return await stub.fetch(
					new Request(
						new URL(
							`/status?accountId=${encodeURIComponent(accountId)}&conversationId=${encodeURIComponent(statusRoute.conversationId)}`,
							request.url,
						),
						{
							method: request.method,
							headers: request.headers,
							body:
								request.method === "GET" || request.method === "HEAD"
									? undefined
									: request.body,
						},
					),
				);
			}

			return badRequest("route not found", 404);
		},
	} satisfies ExportedHandler<WorkerEnv>;
