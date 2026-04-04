import {
	DEFAULT_ACCOUNT_ID,
	buildBridgeWebSocketPath,
	createMessageId,
	type ApprovalDecision,
	type BridgeSocketEnvelope,
	type ChannelMessage,
	type ChannelStatusKind,
	type ChannelUi,
	type ClientActionEvent,
	type ClientEvent,
	type ServerEvent,
	type ServerStatusEvent,
	type ThreadAgentDescriptor,
	type ThreadRouteCatalog,
	type ThreadRouteMode,
	type ThreadRouteSource,
	type ThreadRouteState,
} from "../../channel-contract/src/index.js";

export type {
	ApprovalDecision,
	ChannelMessage,
	ChannelStatusKind,
	ChannelUi,
	ThreadAgentDescriptor,
	ThreadRouteCatalog,
	ThreadRouteMode,
	ThreadRouteSource,
	ThreadRouteState,
} from "../../channel-contract/src/index.js";

export type ChannelClientAuth =
	| {
			kind: "jwt";
			token: string;
	  }
	| {
			kind: "credentials";
			clientId: string;
			clientSecret: string;
	  }
	| {
			kind: "tokenProvider";
			getToken: () => Promise<string>;
	  };

export type ChannelConnectionState = "idle" | "connecting" | "connected" | "reconnecting" | "closed";

export type ChannelConnectionReason =
	| "initial"
	| "connect_called"
	| "connect_succeeded"
	| "connect_failed"
	| "socket_closed"
	| "reconnect_scheduled"
	| "manual_disconnect";

export type ChannelClientStatus = {
	connection: ChannelConnectionState;
	lastError?: string;
	attempt: number;
	reason?: ChannelConnectionReason;
};

export type ChannelClientErrorCategory =
	| "auth"
	| "network"
	| "protocol"
	| "server"
	| "state"
	| "validation";

export type ChannelClientErrorCode =
	| "auth_failed"
	| "token_issue_failed"
	| "token_missing"
	| "connect_failed"
	| "socket_error"
	| "server_error"
	| "invalid_payload"
	| "not_connected"
	| "invalid_message"
	| "invalid_action";

export class ChannelClientError extends Error {
	readonly category: ChannelClientErrorCategory;
	readonly code: ChannelClientErrorCode;
	readonly retryable: boolean;
	readonly status?: number;
	readonly conversationId?: string;
	readonly cause?: unknown;

	constructor(params: {
		message: string;
		category: ChannelClientErrorCategory;
		code: ChannelClientErrorCode;
		retryable?: boolean;
		status?: number;
		conversationId?: string;
		cause?: unknown;
	}) {
		super(params.message);
		this.name = "ChannelClientError";
		this.category = params.category;
		this.code = params.code;
		this.retryable = params.retryable ?? false;
		this.status = params.status;
		this.conversationId = params.conversationId;
		this.cause = params.cause;
	}
}

export type ChannelClientEvents = {
	open: { conversationId: string };
	close: { code: number; reason: string; wasClean: boolean };
	error: { error: ChannelClientError };
	ack: { conversationId: string; messageId: string };
	message: { conversationId: string; message: ChannelMessage };
	status: ServerEvent & { type: "server.status" };
	serverError: { conversationId: string; error: string; details: ChannelClientError };
	connection: ChannelClientStatus;
};

type EventHandler<T> = (event: T) => void;

class TypedEmitter<TEvents extends Record<string, unknown>> {
	private listeners = new Map<keyof TEvents, Set<EventHandler<any>>>();

	on<TKey extends keyof TEvents>(event: TKey, handler: EventHandler<TEvents[TKey]>): () => void {
		const existing = this.listeners.get(event) ?? new Set();
		existing.add(handler);
		this.listeners.set(event, existing);
		return () => {
			existing.delete(handler);
			if (existing.size === 0) {
				this.listeners.delete(event);
			}
		};
	}

	emit<TKey extends keyof TEvents>(event: TKey, payload: TEvents[TKey]): void {
		for (const handler of this.listeners.get(event) ?? []) {
			handler(payload);
		}
	}
}

export type CreateChannelClientOptions = {
	baseUrl: string;
	conversationId: string;
	accountId?: string;
	clientId?: string;
	auth: ChannelClientAuth;
	webSocketFactory?: (url: string) => WebSocket;
	fetchImpl?: typeof fetch;
	reconnect?: {
		enabled?: boolean;
		initialDelayMs?: number;
		maxDelayMs?: number;
	};
};

function createClientError(params: ConstructorParameters<typeof ChannelClientError>[0]): ChannelClientError {
	return new ChannelClientError(params);
}

function normalizeError(
	error: unknown,
	fallback: Omit<ConstructorParameters<typeof ChannelClientError>[0], "message"> & { message?: string },
): ChannelClientError {
	if (error instanceof ChannelClientError) {
		return error;
	}
	if (error instanceof Error) {
		return createClientError({
			...fallback,
			message: error.message || fallback.message || "channel client error",
			cause: error,
		});
	}
	return createClientError({
		...fallback,
		message: fallback.message ?? String(error),
		cause: error,
	});
}

function errorMessage(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}
	return String(error);
}

export async function issueChannelClientJwt(params: {
	baseUrl: string;
	clientId: string;
	clientSecret: string;
	fetchImpl?: typeof fetch;
}): Promise<{ token: string; sub?: string; name?: string; expiresInSec?: number }> {
	const fetchImpl = params.fetchImpl ?? fetch;
	const response = await fetchImpl(new URL("/v1/auth/token", params.baseUrl), {
		method: "POST",
		headers: {
			"content-type": "application/json",
		},
		body: JSON.stringify({
			clientId: params.clientId,
			clientSecret: params.clientSecret,
		}),
	});
	let payload:
		| {
				ok?: boolean;
				token?: string;
				sub?: string;
				name?: string;
				expiresInSec?: number;
				error?: string;
		  }
		| null = null;
	try {
		payload = (await response.json()) as {
			ok?: boolean;
			token?: string;
			sub?: string;
			name?: string;
			expiresInSec?: number;
			error?: string;
		};
	} catch {
		payload = null;
	}
	if (!response.ok) {
		throw createClientError({
			message: payload?.error ?? `token issuance failed (${response.status})`,
			category: response.status === 401 ? "auth" : "network",
			code: "token_issue_failed",
			retryable: response.status >= 500,
			status: response.status,
		});
	}
	if (!payload?.token) {
		throw createClientError({
			message: "token issuance response missing token",
			category: "protocol",
			code: "token_missing",
		});
	}
	return {
		token: payload.token,
		sub: payload.sub,
		name: payload.name,
		expiresInSec: payload.expiresInSec,
	};
}

export class ChannelClient {
	private readonly emitter = new TypedEmitter<ChannelClientEvents>();
	private readonly accountId: string;
	private readonly webSocketFactory: (url: string) => WebSocket;
	private readonly fetchImpl: typeof fetch;
	private readonly reconnectEnabled: boolean;
	private readonly reconnectInitialDelayMs: number;
	private readonly reconnectMaxDelayMs: number;
	private socket: WebSocket | null = null;
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	private connectPromise: Promise<void> | null = null;
	private manuallyClosed = false;
	private reconnectAttempt = 0;
	private connectionState: ChannelClientStatus = {
		connection: "idle",
		attempt: 0,
		reason: "initial",
	};

	constructor(private readonly options: CreateChannelClientOptions) {
		this.accountId = options.accountId?.trim() || DEFAULT_ACCOUNT_ID;
		this.webSocketFactory = options.webSocketFactory ?? ((url) => new WebSocket(url));
		this.fetchImpl = options.fetchImpl ?? fetch;
		this.reconnectEnabled = options.reconnect?.enabled !== false;
		this.reconnectInitialDelayMs = options.reconnect?.initialDelayMs ?? 1_000;
		this.reconnectMaxDelayMs = options.reconnect?.maxDelayMs ?? 15_000;
	}

	on<TKey extends keyof ChannelClientEvents>(
		event: TKey,
		handler: EventHandler<ChannelClientEvents[TKey]>,
	): () => void {
		return this.emitter.on(event, handler);
	}

	get status(): ChannelClientStatus {
		return { ...this.connectionState };
	}

	get connected(): boolean {
		return this.connectionState.connection === "connected";
	}

	async connect(): Promise<void> {
		if (this.connectPromise) {
			return await this.connectPromise;
		}
		this.manuallyClosed = false;
		this.clearReconnectTimer();
		const connectPromise = this.openSocket().finally(() => {
			if (this.connectPromise === connectPromise) {
				this.connectPromise = null;
			}
		});
		this.connectPromise = connectPromise;
		return await connectPromise;
	}

	disconnect(): void {
		this.manuallyClosed = true;
		this.clearReconnectTimer();
		this.updateConnectionState({
			connection: "closed",
			attempt: this.reconnectAttempt,
			reason: "manual_disconnect",
		});
		if (this.socket) {
			this.socket.close(1000, "client disconnect");
			this.socket = null;
		}
	}

	async sendMessage(
		text: string,
		metadata?: Record<string, unknown>,
		options?: { messageId?: string },
	): Promise<string> {
		const trimmed = text.trim();
		if (!trimmed) {
			throw createClientError({
				message: "message text is required",
				category: "validation",
				code: "invalid_message",
			});
		}
		const messageId = options?.messageId?.trim() || createMessageId("client");
		this.sendEnvelope({
			type: "client.message",
			messageId,
			text: trimmed,
			metadata,
		});
		return messageId;
	}

	async resolveApproval(params: {
		approvalId: string;
		decision: ApprovalDecision;
		metadata?: Record<string, unknown>;
		actionId?: string;
	}): Promise<string> {
		if (!params.approvalId.trim()) {
			throw createClientError({
				message: "approvalId is required",
				category: "validation",
				code: "invalid_action",
			});
		}
		const actionId = params.actionId?.trim() || createMessageId("action");
		const action: ClientActionEvent = {
			type: "client.action",
			actionId,
			action: {
				type: "approval.resolve",
				approvalId: params.approvalId,
				decision: params.decision,
			},
			metadata: params.metadata,
		};
		this.sendEnvelope(action);
		return actionId;
	}

	async configureThreadRoute(params: {
		mode: ThreadRouteMode;
		agentId?: string;
		sessionKey?: string;
		label?: string;
		metadata?: Record<string, unknown>;
		actionId?: string;
	}): Promise<string> {
		const actionId = params.actionId?.trim() || createMessageId("action");
		const action: ClientActionEvent = {
			type: "client.action",
			actionId,
			action: {
				type: "thread.configure",
				mode: params.mode,
				agentId: params.agentId,
				sessionKey: params.sessionKey,
				label: params.label,
			},
			metadata: params.metadata,
		};
		this.sendEnvelope(action);
		return actionId;
	}

	async inspectThreadRoute(params?: {
		metadata?: Record<string, unknown>;
		actionId?: string;
	}): Promise<string> {
		const actionId = params?.actionId?.trim() || createMessageId("action");
		const action: ClientActionEvent = {
			type: "client.action",
			actionId,
			action: {
				type: "thread.inspect",
			},
			metadata: params?.metadata,
		};
		this.sendEnvelope(action);
		return actionId;
	}

	private async openSocket(): Promise<void> {
		if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === 0)) {
			return;
		}
		this.updateConnectionState({
			connection: this.reconnectAttempt > 0 ? "reconnecting" : "connecting",
			attempt: this.reconnectAttempt,
			reason: "connect_called",
		});

		let token: string;
		try {
			token = await this.resolveToken();
		} catch (error) {
			const clientError = normalizeError(error, {
				message: "failed to resolve client token",
				category: "auth",
				code: "auth_failed",
				retryable: false,
			});
			this.updateConnectionState({
				connection: this.reconnectAttempt > 0 ? "reconnecting" : "idle",
				attempt: this.reconnectAttempt,
				lastError: clientError.message,
				reason: "connect_failed",
			});
			this.emitter.emit("error", { error: clientError });
			throw clientError;
		}

		const wsBase = new URL(this.options.baseUrl);
		wsBase.protocol = wsBase.protocol === "https:" ? "wss:" : "ws:";
		const path = buildBridgeWebSocketPath({
			accountId: this.accountId,
			role: "client",
			conversationId: this.options.conversationId,
			clientId: this.options.clientId,
			token,
		});
		const socket = this.webSocketFactory(new URL(path, wsBase).toString());
		this.socket = socket;

		try {
			await new Promise<void>((resolve, reject) => {
				const cleanup = () => {
					socket.removeEventListener("open", onOpen);
					socket.removeEventListener("error", onError);
				};
				const onOpen = () => {
					cleanup();
					resolve();
				};
				const onError = () => {
					cleanup();
					reject(
						createClientError({
							message: "websocket failed before open",
							category: "network",
							code: "connect_failed",
							retryable: true,
						}),
					);
				};
				socket.addEventListener("open", onOpen, { once: true });
				socket.addEventListener("error", onError, { once: true });
			});
		} catch (error) {
			this.socket = null;
			const clientError = normalizeError(error, {
				message: "websocket failed before open",
				category: "network",
				code: "connect_failed",
				retryable: true,
			});
			this.updateConnectionState({
				connection: "idle",
				attempt: this.reconnectAttempt,
				lastError: clientError.message,
				reason: "connect_failed",
			});
			this.emitter.emit("error", { error: clientError });
			throw clientError;
		}

		socket.addEventListener("message", (event) => {
			this.handleMessage(event.data);
		});
		socket.addEventListener("close", (event) => {
			this.emitter.emit("close", {
				code: event.code,
				reason: event.reason,
				wasClean: event.wasClean,
			});
			this.socket = null;
			if (!this.manuallyClosed && this.reconnectEnabled) {
				this.scheduleReconnect();
				return;
			}
			this.updateConnectionState({
				connection: this.manuallyClosed ? "closed" : "idle",
				attempt: this.reconnectAttempt,
				reason: this.manuallyClosed ? "manual_disconnect" : "socket_closed",
			});
		});
		socket.addEventListener("error", () => {
			const clientError = createClientError({
				message: "websocket error",
				category: "network",
				code: "socket_error",
				retryable: true,
			});
			this.emitter.emit("error", {
				error: clientError,
			});
		});

		this.reconnectAttempt = 0;
		this.updateConnectionState({
			connection: "connected",
			attempt: 0,
			reason: "connect_succeeded",
		});
		this.emitter.emit("open", {
			conversationId: this.options.conversationId,
		});
		this.sendEnvelope({
			type: "client.hello",
			clientId: this.options.clientId,
		});
	}

	private handleMessage(raw: unknown): void {
		const payload = typeof raw === "string" ? raw : String(raw);
		let envelope: BridgeSocketEnvelope;
		try {
			envelope = JSON.parse(payload) as BridgeSocketEnvelope;
		} catch {
			this.emitter.emit("error", {
				error: createClientError({
					message: "invalid bridge payload",
					category: "protocol",
					code: "invalid_payload",
				}),
			});
			return;
		}
		const serverEvent = envelope as ServerEvent;
		if (serverEvent.type === "server.ack") {
			this.emitter.emit("ack", {
				conversationId: serverEvent.conversationId,
				messageId: serverEvent.messageId,
			});
			return;
		}
		if (serverEvent.type === "server.message") {
			this.emitter.emit("message", {
				conversationId: serverEvent.conversationId,
				message: serverEvent.message,
			});
			return;
		}
		if (serverEvent.type === "server.status") {
			this.emitter.emit("status", serverEvent);
			return;
		}
		if (serverEvent.type === "server.error") {
			const details = createClientError({
				message: serverEvent.error,
				category: "server",
				code: "server_error",
				conversationId: serverEvent.conversationId,
			});
			this.emitter.emit("serverError", {
				conversationId: serverEvent.conversationId,
				error: serverEvent.error,
				details,
			});
			this.emitter.emit("error", {
				error: details,
			});
		}
	}

	private sendEnvelope(envelope: ClientEvent): void {
		if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
			throw createClientError({
				message: "channel client is not connected",
				category: "state",
				code: "not_connected",
				retryable: true,
			});
		}
		this.socket.send(JSON.stringify(envelope));
	}

	private async resolveToken(): Promise<string> {
		const auth = this.options.auth;
		if (auth.kind === "jwt") {
			return auth.token;
		}
		if (auth.kind === "tokenProvider") {
			return await auth.getToken();
		}
		const issued = await issueChannelClientJwt({
			baseUrl: this.options.baseUrl,
			clientId: auth.clientId,
			clientSecret: auth.clientSecret,
			fetchImpl: this.fetchImpl,
		});
		return issued.token;
	}

	private scheduleReconnect(): void {
		this.clearReconnectTimer();
		this.reconnectAttempt += 1;
		const delay = Math.min(
			this.reconnectInitialDelayMs * 2 ** Math.max(this.reconnectAttempt - 1, 0),
			this.reconnectMaxDelayMs,
		);
		this.updateConnectionState({
			connection: "reconnecting",
			attempt: this.reconnectAttempt,
			reason: "reconnect_scheduled",
		});
		this.reconnectTimer = setTimeout(() => {
			void this.connect().catch((error) => {
				const clientError = normalizeError(error, {
					message: "reconnect failed",
					category: "network",
					code: "connect_failed",
					retryable: true,
				});
				this.updateConnectionState({
					connection: "reconnecting",
					attempt: this.reconnectAttempt,
					lastError: clientError.message,
					reason: "connect_failed",
				});
				this.emitter.emit("error", {
					error: clientError,
				});
				this.scheduleReconnect();
			});
		}, delay);
	}

	private clearReconnectTimer(): void {
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}
	}

	private updateConnectionState(next: ChannelClientStatus): void {
		this.connectionState = next;
		this.emitter.emit("connection", { ...next });
	}
}

export type ChannelPendingSend = {
	messageId: string;
	text: string;
	metadata?: Record<string, unknown>;
	createdAt: string;
	status: "pending" | "acked" | "failed";
	error?: ChannelClientError;
};

export type ChannelApprovalState = {
	approvalId: string;
	status: "required" | "resolved";
	approvalKind?: "exec" | "plugin" | "pairing";
	title?: string;
	body?: string;
	messageId?: string;
	allowedDecisions?: ApprovalDecision[];
	buttons?: Extract<ChannelUi, { kind: "approval" }>["buttons"];
	updatedAt: string;
};

export type ChannelSessionState = {
	connection: ChannelClientStatus;
	messages: ChannelMessage[];
	pendingSends: ChannelPendingSend[];
	approvals: ChannelApprovalState[];
	statuses: ServerStatusEvent[];
	threadRoute?: ThreadRouteState;
	threadCatalog?: ThreadRouteCatalog;
	lastError?: ChannelClientError;
};

export type ChannelSessionEvents = {
	state: ChannelSessionState;
};

export class ChannelSession {
	private readonly emitter = new TypedEmitter<ChannelSessionEvents>();
	private readonly unsubscribers: Array<() => void> = [];
	private state: ChannelSessionState;

	constructor(private readonly client: ChannelClient) {
		this.state = {
			connection: client.status,
			messages: [],
			pendingSends: [],
			approvals: [],
			statuses: [],
		};

		this.unsubscribers.push(
			client.on("connection", (connection) => {
				this.setState({
					...this.state,
					connection,
				});
			}),
		);
		this.unsubscribers.push(
			client.on("message", ({ conversationId, message }) => {
				const messages = this.state.messages.some((entry) => entry.id === message.id)
					? this.state.messages
					: [...this.state.messages, message];
				const pendingSends = this.state.pendingSends.filter((pending) => pending.messageId !== message.id);
				const approvalFromMessageUi = message.ui?.kind === "approval"
					? upsertApproval(this.state.approvals, {
							approvalId: message.ui.approvalId,
							status: "required",
							approvalKind: message.ui.approvalKind,
							title: message.ui.title,
							body: message.ui.body,
							messageId: message.id,
							allowedDecisions: message.ui.allowedDecisions,
							buttons: message.ui.buttons,
							updatedAt: message.timestamp,
						})
					: this.state.approvals;
				// Legacy metadata-based approval parsing is projection-only compatibility.
				// If a structured approval UI payload is present, treat that as canonical
				// and do not let metadata overwrite its decisions/body/title.
				const approvalFromMetadata =
					message.ui?.kind === "approval" ? undefined : deriveApprovalStateFromMessageMetadata(message);
				const approvalFromMessage = approvalFromMetadata
					? upsertApproval(approvalFromMessageUi, approvalFromMetadata)
					: approvalFromMessageUi;
				const threadRoute = deriveThreadRouteStateFromMessageMetadata(message) ?? this.state.threadRoute;
				const threadCatalog =
					deriveThreadRouteCatalogFromMessageMetadata(message) ?? this.state.threadCatalog;
				const pairingResolution = derivePairingResolutionFromApprovedNotice(
					approvalFromMessage,
					conversationId,
					message,
				);
				const approvals = pairingResolution.approvals;
				let statuses = this.state.statuses;
				const syntheticApprovalRequired = deriveApprovalRequiredStatusFromApprovalMessage(
					conversationId,
					message,
					statuses,
				);
				if (syntheticApprovalRequired) {
					statuses = [...statuses, syntheticApprovalRequired].slice(-20);
				}
				const syntheticApprovalFromMetadata = deriveApprovalStatusFromMessageMetadata(
					conversationId,
					message,
					statuses,
				);
				if (syntheticApprovalFromMetadata) {
					statuses = [...statuses, syntheticApprovalFromMetadata].slice(-20);
				}
				if (pairingResolution.syntheticStatus) {
					statuses = [...statuses, pairingResolution.syntheticStatus].slice(-20);
				}
				this.setState({
					...this.state,
					messages,
					pendingSends,
					approvals,
					statuses,
					threadRoute,
					threadCatalog,
				});
			}),
		);
		this.unsubscribers.push(
			client.on("ack", ({ messageId }) => {
				this.setState({
					...this.state,
					pendingSends: this.state.pendingSends.map((pending) =>
						pending.messageId === messageId ? { ...pending, status: "acked" } : pending,
					),
				});
			}),
		);
		this.unsubscribers.push(
			client.on("status", (statusEvent) => {
				const statuses = [...this.state.statuses, statusEvent].slice(-20);
				const approvals =
					statusEvent.status.kind === "approval_required" || statusEvent.status.kind === "approval_resolved"
						? upsertApproval(this.state.approvals, {
								approvalId: statusEvent.status.approvalId ?? statusEvent.status.referenceId ?? createMessageId("approval"),
								status: statusEvent.status.kind === "approval_required" ? "required" : "resolved",
								approvalKind: statusEvent.status.approvalKind,
								body: statusEvent.status.message,
								updatedAt: statusEvent.timestamp,
							})
						: this.state.approvals;
				this.setState({
					...this.state,
					statuses,
					approvals,
				});
			}),
		);
		this.unsubscribers.push(
			client.on("error", ({ error }) => {
				this.setState({
					...this.state,
					lastError: error,
				});
			}),
		);
	}

	on(event: "state", handler: EventHandler<ChannelSessionState>): () => void {
		return this.emitter.on(event, handler);
	}

	get snapshot(): ChannelSessionState {
		return {
			connection: { ...this.state.connection },
			messages: [...this.state.messages],
			pendingSends: [...this.state.pendingSends],
			approvals: [...this.state.approvals],
			statuses: [...this.state.statuses],
			threadRoute: this.state.threadRoute ? { ...this.state.threadRoute } : undefined,
			threadCatalog: this.state.threadCatalog
				? {
						...this.state.threadCatalog,
						agents: this.state.threadCatalog.agents.map((agent) => ({ ...agent })),
					}
				: undefined,
			lastError: this.state.lastError,
		};
	}

	async connect(): Promise<void> {
		return await this.client.connect();
	}

	disconnect(): void {
		this.client.disconnect();
	}

	async sendMessage(text: string, metadata?: Record<string, unknown>): Promise<string> {
		const trimmed = text.trim();
		if (!trimmed) {
			throw createClientError({
				message: "message text is required",
				category: "validation",
				code: "invalid_message",
			});
		}
		const messageId = createMessageId("client");
		this.setState({
			...this.state,
			pendingSends: [
				...this.state.pendingSends,
				{
					messageId,
					text: trimmed,
					metadata,
					createdAt: new Date().toISOString(),
					status: "pending",
				},
			],
		});
		try {
			await this.client.sendMessage(trimmed, metadata, { messageId });
			return messageId;
		} catch (error) {
			const clientError = normalizeError(error, {
				message: "failed to send message",
				category: "state",
				code: "not_connected",
				retryable: true,
			});
			this.setState({
				...this.state,
				lastError: clientError,
				pendingSends: this.state.pendingSends.map((pending) =>
					pending.messageId === messageId
						? {
								...pending,
								status: "failed",
								error: clientError,
							}
						: pending,
				),
			});
			throw clientError;
		}
	}

	async resolveApproval(params: {
		approvalId: string;
		decision: ApprovalDecision;
		metadata?: Record<string, unknown>;
	}): Promise<string> {
		return await this.client.resolveApproval(params);
	}

	async configureThreadRoute(params: {
		mode: ThreadRouteMode;
		agentId?: string;
		sessionKey?: string;
		label?: string;
		metadata?: Record<string, unknown>;
	}): Promise<string> {
		return await this.client.configureThreadRoute(params);
	}

	async inspectThreadRoute(params?: {
		metadata?: Record<string, unknown>;
	}): Promise<string> {
		return await this.client.inspectThreadRoute(params);
	}

	dispose(): void {
		for (const unsubscribe of this.unsubscribers) {
			unsubscribe();
		}
		this.unsubscribers.length = 0;
	}

	private setState(next: ChannelSessionState): void {
		this.state = next;
		this.emitter.emit("state", this.snapshot);
	}
}

function upsertApproval(
	current: ChannelApprovalState[],
	next: ChannelApprovalState,
): ChannelApprovalState[] {
	const index = current.findIndex((approval) => approval.approvalId === next.approvalId);
	if (index === -1) {
		return [...current, next];
	}
	return current.map((approval, approvalIndex) =>
		approvalIndex === index
			? {
					...approval,
					...next,
				}
			: approval,
	);
}

function deriveApprovalRequiredStatusFromApprovalMessage(
	conversationId: string,
	message: ChannelMessage,
	currentStatuses: ServerStatusEvent[],
): ServerStatusEvent | undefined {
	if (message.ui?.kind !== "approval") {
		return undefined;
	}
	const approvalId = message.ui.approvalId?.trim();
	if (!approvalId) {
		return undefined;
	}
	const alreadyTracked = currentStatuses.some(
		(statusEvent) =>
			statusEvent.status.kind === "approval_required" && statusEvent.status.approvalId === approvalId,
	);
	if (alreadyTracked) {
		return undefined;
	}
	return {
		type: "server.status",
		conversationId,
		status: {
			kind: "approval_required",
			approvalId,
			approvalKind: message.ui.approvalKind,
			message: message.ui.body,
		},
		timestamp: message.timestamp,
	};
}

function parseApprovalMetadata(message: ChannelMessage): {
	approvalId: string;
	approvalKind?: "exec" | "plugin" | "pairing";
	allowedDecisions?: ApprovalDecision[];
	title?: string;
	body?: string;
	status: "required" | "resolved";
} | undefined {
	const metadata =
		message.metadata && typeof message.metadata === "object" && !Array.isArray(message.metadata)
			? message.metadata
			: undefined;
	if (!metadata) {
		return undefined;
	}
	const metadataRecord = metadata as Record<string, unknown>;
	const channelData =
		metadataRecord.channelData &&
		typeof metadataRecord.channelData === "object" &&
		!Array.isArray(metadataRecord.channelData)
			? (metadataRecord.channelData as Record<string, unknown>)
			: undefined;
	const rawApproval = metadataRecord.execApproval ?? channelData?.execApproval;
	const rawCfDoChannel = metadataRecord.cfDoChannel ?? channelData?.cfDoChannel;
	const cfDoUi =
		rawCfDoChannel && typeof rawCfDoChannel === "object" && !Array.isArray(rawCfDoChannel)
			? (rawCfDoChannel as { ui?: unknown }).ui
			: undefined;
	const approval =
		rawApproval && typeof rawApproval === "object" && !Array.isArray(rawApproval)
			? (rawApproval as {
					approvalId?: unknown;
					approvalKind?: unknown;
					allowedDecisions?: unknown;
					title?: unknown;
					body?: unknown;
					status?: unknown;
			  })
			: undefined;
	const approvalUi =
		cfDoUi && typeof cfDoUi === "object" && !Array.isArray(cfDoUi)
			? (cfDoUi as {
					kind?: unknown;
					approvalId?: unknown;
					approvalKind?: unknown;
					allowedDecisions?: unknown;
					title?: unknown;
					body?: unknown;
			  })
			: undefined;
	const approvalId =
		typeof approval?.approvalId === "string" && approval.approvalId.trim().length > 0
			? approval.approvalId.trim()
			: approvalUi?.kind === "approval" &&
				  typeof approvalUi.approvalId === "string" &&
				  approvalUi.approvalId.trim().length > 0
				? approvalUi.approvalId.trim()
			: undefined;
	if (!approvalId) {
		return undefined;
	}
	const allowedDecisionsRaw = Array.isArray(approval?.allowedDecisions)
		? approval.allowedDecisions
		: Array.isArray(approvalUi?.allowedDecisions)
			? approvalUi.allowedDecisions
			: undefined;
	const allowedDecisions = allowedDecisionsRaw?.filter(
		(decision): decision is ApprovalDecision =>
			decision === "allow-once" || decision === "allow-always" || decision === "deny",
	);
	const approvalKind =
		approval?.approvalKind === "exec" ||
		approval?.approvalKind === "plugin" ||
		approval?.approvalKind === "pairing"
			? approval.approvalKind
			: approvalUi?.approvalKind === "exec" ||
				  approvalUi?.approvalKind === "plugin" ||
				  approvalUi?.approvalKind === "pairing"
				? approvalUi.approvalKind
			: approvalId.startsWith("plugin:")
				? "plugin"
				: "exec";
	const status =
		approval?.status === "resolved" || (Array.isArray(allowedDecisionsRaw) && allowedDecisionsRaw.length === 0)
			? "resolved"
			: "required";
	return {
		approvalId,
		approvalKind,
		allowedDecisions,
		title:
			typeof approval?.title === "string"
				? approval.title
				: typeof approvalUi?.title === "string"
					? approvalUi.title
					: undefined,
		body:
			typeof approval?.body === "string"
				? approval.body
				: typeof approvalUi?.body === "string"
					? approvalUi.body
					: undefined,
		status,
	};
}

function deriveApprovalStateFromMessageMetadata(message: ChannelMessage): ChannelApprovalState | undefined {
	const parsed = parseApprovalMetadata(message);
	if (!parsed) {
		return undefined;
	}
	const defaultAllowed = parsed.status === "required" ? (["allow-once", "allow-always", "deny"] as const) : [];
	const allowedDecisions =
		parsed.allowedDecisions && parsed.allowedDecisions.length > 0 ? parsed.allowedDecisions : [...defaultAllowed];
	return {
		approvalId: parsed.approvalId,
		status: parsed.status,
		approvalKind: parsed.approvalKind,
		title: parsed.title ?? (parsed.status === "resolved" ? "Approval Resolved" : "Approval Required"),
		body: parsed.body ?? message.text,
		messageId: message.id,
		allowedDecisions,
		updatedAt: message.timestamp,
	};
}

function deriveApprovalStatusFromMessageMetadata(
	conversationId: string,
	message: ChannelMessage,
	currentStatuses: ServerStatusEvent[],
): ServerStatusEvent | undefined {
	const parsed = parseApprovalMetadata(message);
	if (!parsed) {
		return undefined;
	}
	const statusKind = parsed.status === "resolved" ? "approval_resolved" : "approval_required";
	const alreadyTracked = currentStatuses.some(
		(statusEvent) => statusEvent.status.kind === statusKind && statusEvent.status.approvalId === parsed.approvalId,
	);
	if (alreadyTracked) {
		return undefined;
	}
	return {
		type: "server.status",
		conversationId,
		status: {
			kind: statusKind,
			approvalId: parsed.approvalId,
			approvalKind: parsed.approvalKind,
			message: parsed.body ?? message.text,
		},
		timestamp: message.timestamp,
	};
}

function deriveThreadRouteStateFromMessageMetadata(message: ChannelMessage): ThreadRouteState | undefined {
	const cfDoChannel = readCfDoChannelMetadata(message);
	const threadRoute =
		cfDoChannel?.threadRoute &&
		typeof cfDoChannel.threadRoute === "object" &&
		!Array.isArray(cfDoChannel.threadRoute)
			? (cfDoChannel.threadRoute as Record<string, unknown>)
			: undefined;
	if (!threadRoute) {
		return undefined;
	}
	const conversationId =
		typeof threadRoute.conversationId === "string" ? threadRoute.conversationId.trim() : "";
	const mode = threadRoute.mode;
	const source = threadRoute.source;
	if (
		!conversationId ||
		(mode !== "auto" && mode !== "agent" && mode !== "session") ||
		(source !== "default" && source !== "configured" && source !== "binding")
	) {
		return undefined;
	}
	return {
		conversationId,
		mode,
		source,
		resolvedAgentId:
			typeof threadRoute.resolvedAgentId === "string" ? threadRoute.resolvedAgentId.trim() || undefined : undefined,
		resolvedSessionKey:
			typeof threadRoute.resolvedSessionKey === "string"
				? threadRoute.resolvedSessionKey.trim() || undefined
				: undefined,
		targetSessionKey:
			typeof threadRoute.targetSessionKey === "string"
				? threadRoute.targetSessionKey.trim() || undefined
				: undefined,
		agentId: typeof threadRoute.agentId === "string" ? threadRoute.agentId.trim() || undefined : undefined,
		label: typeof threadRoute.label === "string" ? threadRoute.label.trim() || undefined : undefined,
		bindingId:
			typeof threadRoute.bindingId === "string" ? threadRoute.bindingId.trim() || undefined : undefined,
		updatedAt:
			typeof threadRoute.updatedAt === "string" && threadRoute.updatedAt.trim()
				? threadRoute.updatedAt
				: message.timestamp,
	};
}

function deriveThreadRouteCatalogFromMessageMetadata(message: ChannelMessage): ThreadRouteCatalog | undefined {
	const cfDoChannel = readCfDoChannelMetadata(message);
	const threadCatalog =
		cfDoChannel?.threadCatalog &&
		typeof cfDoChannel.threadCatalog === "object" &&
		!Array.isArray(cfDoChannel.threadCatalog)
			? (cfDoChannel.threadCatalog as Record<string, unknown>)
			: undefined;
	if (!threadCatalog || !Array.isArray(threadCatalog.agents)) {
		return undefined;
	}
	const agents: ThreadAgentDescriptor[] = [];
	for (const entry of threadCatalog.agents) {
		if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
			continue;
		}
		const candidate = entry as Record<string, unknown>;
		const id = typeof candidate.id === "string" ? candidate.id.trim() : "";
		if (!id) {
			continue;
		}
		agents.push({
			id,
			name: typeof candidate.name === "string" ? candidate.name.trim() || undefined : undefined,
			workspace:
				typeof candidate.workspace === "string" ? candidate.workspace.trim() || undefined : undefined,
			default: candidate.default === true ? true : undefined,
		});
	}
	if (agents.length === 0) {
		return undefined;
	}
	const defaultAgentId =
		typeof threadCatalog.defaultAgentId === "string"
			? threadCatalog.defaultAgentId.trim() || undefined
			: undefined;
	return {
		agents,
		defaultAgentId,
		updatedAt:
			typeof threadCatalog.updatedAt === "string" && threadCatalog.updatedAt.trim()
				? threadCatalog.updatedAt
				: message.timestamp,
	};
}

function readCfDoChannelMetadata(message: ChannelMessage): Record<string, unknown> | undefined {
	const metadata =
		message.metadata && typeof message.metadata === "object" && !Array.isArray(message.metadata)
			? (message.metadata as Record<string, unknown>)
			: undefined;
	return metadata?.cfDoChannel && typeof metadata.cfDoChannel === "object" && !Array.isArray(metadata.cfDoChannel)
		? (metadata.cfDoChannel as Record<string, unknown>)
		: undefined;
}

function derivePairingResolutionFromApprovedNotice(
	approvals: ChannelApprovalState[],
	conversationId: string,
	message: ChannelMessage,
): {
	approvals: ChannelApprovalState[];
	syntheticStatus?: ServerStatusEvent;
} {
	if (!isPairingApprovedNotice(message)) {
		return { approvals };
	}
	const pendingPairing = approvals.find(
		(approval) => approval.approvalKind === "pairing" && approval.status === "required",
	);
	if (!pendingPairing) {
		return { approvals };
	}
	return {
		approvals: approvals.map((approval) =>
			approval.approvalKind === "pairing" && approval.status === "required"
				? {
						...approval,
						status: "resolved",
						body: message.text,
						updatedAt: message.timestamp,
					}
				: approval,
		),
		syntheticStatus: {
			type: "server.status",
			conversationId,
			status: {
				kind: "approval_resolved",
				approvalId: pendingPairing.approvalId,
				approvalKind: "pairing",
				message: message.text,
			},
			timestamp: message.timestamp,
		},
	};
}

function isPairingApprovedNotice(message: ChannelMessage): boolean {
	if (message.ui?.kind === "notice") {
		const badge = message.ui.badge?.trim().toLowerCase() ?? "";
		const title = message.ui.title?.trim().toLowerCase() ?? "";
		const body = message.ui.body?.trim().toLowerCase() ?? "";
		if (badge === "approved" && title.includes("pairing")) {
			return true;
		}
		if (title.includes("pairing approved") || body.includes("pairing approved")) {
			return true;
		}
	}
	return message.text.trim().toLowerCase().includes("openclaw access approved");
}

export function createChannelClient(options: CreateChannelClientOptions): ChannelClient {
	return new ChannelClient(options);
}

export function createChannelSession(client: ChannelClient): ChannelSession {
	return new ChannelSession(client);
}
