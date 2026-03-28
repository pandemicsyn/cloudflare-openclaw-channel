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
} from "../../channel-contract/src/index.js";

export type {
	ApprovalDecision,
	ChannelMessage,
	ChannelStatusKind,
	ChannelUi,
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
			client.on("message", ({ message }) => {
				const messages = this.state.messages.some((entry) => entry.id === message.id)
					? this.state.messages
					: [...this.state.messages, message];
				const pendingSends = this.state.pendingSends.filter((pending) => pending.messageId !== message.id);
				const approvals = message.ui?.kind === "approval"
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
				this.setState({
					...this.state,
					messages,
					pendingSends,
					approvals,
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

export function createChannelClient(options: CreateChannelClientOptions): ChannelClient {
	return new ChannelClient(options);
}

export function createChannelSession(client: ChannelClient): ChannelSession {
	return new ChannelSession(client);
}
