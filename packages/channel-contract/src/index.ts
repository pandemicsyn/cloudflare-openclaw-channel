export const DEFAULT_CHANNEL_ID = "cf-do-channel";
export const DEFAULT_OPENCLAW_MODEL = "openclaw/default";
export const DEFAULT_OPENCLAW_RESPONSES_PATH = "/v1/responses";
export const DEFAULT_ACCOUNT_ID = "default";

export type ChannelRole = "user" | "assistant" | "system";
export type BridgeSocketRole = "client" | "provider";
export type ApprovalDecision = "allow-once" | "allow-always" | "deny";
export type ChannelStatusKind =
	| "queued"
	| "typing"
	| "working"
	| "approval_required"
	| "approval_resolved"
	| "final";

export type ChannelUiButton = {
	id: string;
	label: string;
	style?: "primary" | "secondary" | "success" | "danger";
	action:
		| {
				type: "approval.resolve";
				approvalId: string;
				decision: ApprovalDecision;
		  }
		| {
				type: "link";
				url: string;
		  };
};

export type ChannelUiFormField = {
	id: string;
	label: string;
	type?: "text";
	required?: boolean;
	placeholder?: string;
	value?: string;
};

export type ChannelUi =
	| {
			kind: "notice";
			title: string;
			body?: string;
			badge?: string;
	  }
	| {
			kind: "approval";
			title: string;
			body: string;
			approvalId: string;
			approvalKind?: "exec" | "plugin" | "pairing";
			allowedDecisions?: ApprovalDecision[];
			buttons?: ChannelUiButton[];
	  }
	| {
			kind: "form";
			title: string;
			submitLabel?: string;
			fields: ChannelUiFormField[];
	  };

export type ChannelMessage = {
	id: string;
	role: ChannelRole;
	text: string;
	timestamp: string;
	participantId?: string;
	metadata?: Record<string, unknown>;
	ui?: ChannelUi;
};

export type ClientHelloEvent = {
	type: "client.hello";
	clientId?: string;
};

export type ClientPingEvent = {
	type: "client.ping";
};

export type ClientMessageEvent = {
	type: "client.message";
	messageId?: string;
	text: string;
	metadata?: Record<string, unknown>;
};

export type ClientActionEvent = {
	type: "client.action";
	actionId?: string;
	action:
		| {
				type: "approval.resolve";
				approvalId: string;
				decision: ApprovalDecision;
		  };
	metadata?: Record<string, unknown>;
};

export type ClientEvent = ClientHelloEvent | ClientPingEvent | ClientMessageEvent | ClientActionEvent;

export type ProviderHelloEvent = {
	type: "provider.hello";
	accountId?: string;
};

export type ProviderInboundEvent = {
	type: "provider.inbound";
	conversationId: string;
	senderId: string;
	senderName?: string;
	event: ClientMessageEvent;
};

export type ProviderMessageEvent = {
	type: "provider.message";
	conversationId: string;
	message: ChannelMessage;
};

export type ProviderStatusEvent = {
	type: "provider.status";
	conversationId: string;
	status: {
		kind: ChannelStatusKind;
		message?: string;
		referenceId?: string;
		approvalId?: string;
		approvalKind?: "exec" | "plugin" | "pairing";
		details?: Record<string, unknown>;
	};
};

export type ProviderActionEvent = {
	type: "provider.action";
	conversationId: string;
	senderId: string;
	senderName?: string;
	actionId: string;
	action: ClientActionEvent["action"];
	metadata?: Record<string, unknown>;
};

export type ProviderEvent =
	| ProviderHelloEvent
	| ProviderMessageEvent
	| ProviderStatusEvent
	| ProviderActionEvent;

export type ServerAckEvent = {
	type: "server.ack";
	conversationId: string;
	messageId: string;
};

export type ServerMessageEvent = {
	type: "server.message";
	conversationId: string;
	message: ChannelMessage;
};

export type ServerErrorEvent = {
	type: "server.error";
	conversationId: string;
	error: string;
};

export type ServerStatusEvent = {
	type: "server.status";
	conversationId: string;
	status: ProviderStatusEvent["status"];
	timestamp: string;
};

export type ServerEvent =
	| ServerAckEvent
	| ServerMessageEvent
	| ServerErrorEvent
	| ServerStatusEvent;

export type OutboundSendRequest = {
	text: string;
	messageId?: string;
	role?: Extract<ChannelRole, "assistant" | "system">;
	participantId?: string;
	metadata?: Record<string, unknown>;
	ui?: ChannelUi;
};

export type InboundRestEventRequest = {
	messageId?: string;
	text: string;
	participantId?: string;
	metadata?: Record<string, unknown>;
};

export type BridgeSocketEnvelope = ClientEvent | ProviderEvent | ServerEvent;

export function normalizeConversationId(raw: string): string {
	const trimmed = raw.trim().toLowerCase();
	if (!trimmed) {
		throw new Error("conversation id is required");
	}
	const normalized = trimmed.replace(/[^a-z0-9:_-]+/g, "-");
	if (!normalized) {
		throw new Error("conversation id is invalid");
	}
	return normalized.slice(0, 120);
}

export function buildConversationWebSocketPath(conversationId: string): string {
	return `/v1/conversations/${encodeURIComponent(normalizeConversationId(conversationId))}/ws`;
}

export function buildConversationEventsPath(conversationId: string): string {
	return `/v1/conversations/${encodeURIComponent(normalizeConversationId(conversationId))}/events`;
}

export function buildConversationMessagesPath(conversationId: string): string {
	return `/v1/conversations/${encodeURIComponent(normalizeConversationId(conversationId))}/messages`;
}

export function buildBridgeWebSocketPath(params?: {
	accountId?: string;
	role?: BridgeSocketRole;
	conversationId?: string;
	clientId?: string;
	token?: string;
}): string {
	const search = new URLSearchParams();
	search.set("accountId", (params?.accountId ?? DEFAULT_ACCOUNT_ID).trim());
	search.set("role", params?.role ?? "client");
	if (params?.conversationId) {
		search.set("conversationId", normalizeConversationId(params.conversationId));
	}
	if (params?.clientId?.trim()) {
		search.set("clientId", params.clientId.trim());
	}
	if (params?.token?.trim()) {
		search.set("token", params.token.trim());
	}
	return `/v1/bridge/ws?${search.toString()}`;
}

export function createMessageId(prefix = "msg"): string {
	return `${prefix}_${crypto.randomUUID()}`;
}
