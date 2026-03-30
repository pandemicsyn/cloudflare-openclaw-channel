import type {
	ChannelPendingSend,
	ChannelSessionState,
	ChannelStatusKind,
	ThreadRouteSource,
	ThreadRouteMode,
} from "@pandemicsyn/cf-do-channel-client";

export type ConnectionFormState = {
	baseUrl: string;
	conversationId: string;
	clientId: string;
	clientSecret: string;
	threadRouteMode: ThreadRouteMode;
	agentId: string;
	sessionKey: string;
	threadLabel: string;
};

export const STORAGE_KEY = "cf-do-channel-demo-config";
export const THREAD_HISTORY_STORAGE_KEY = "cf-do-channel-demo-thread-history";
export const MAX_THREAD_HISTORY_ITEMS = 12;

export const initialConfig: ConnectionFormState = {
	baseUrl: "http://127.0.0.1:8787",
	conversationId: "demo-room",
	clientId: "web-alice",
	clientSecret: "replace-me",
	threadRouteMode: "auto",
	agentId: "",
	sessionKey: "",
	threadLabel: "",
};

export const initialSessionState: ChannelSessionState = {
	connection: {
		connection: "idle",
		attempt: 0,
		reason: "initial",
	},
	messages: [],
	pendingSends: [],
	approvals: [],
	statuses: [],
};

export function loadStoredConfig(): ConnectionFormState {
	try {
		const raw = window.localStorage.getItem(STORAGE_KEY);
		if (!raw) {
			return initialConfig;
		}
		const parsed = JSON.parse(raw) as Partial<ConnectionFormState>;
		return {
			baseUrl: parsed.baseUrl?.trim() || initialConfig.baseUrl,
			conversationId: parsed.conversationId?.trim() || initialConfig.conversationId,
			clientId: parsed.clientId?.trim() || initialConfig.clientId,
			clientSecret: parsed.clientSecret?.trim() || initialConfig.clientSecret,
			threadRouteMode:
				parsed.threadRouteMode === "agent" || parsed.threadRouteMode === "session"
					? parsed.threadRouteMode
					: initialConfig.threadRouteMode,
			agentId: parsed.agentId?.trim() || initialConfig.agentId,
			sessionKey: parsed.sessionKey?.trim() || initialConfig.sessionKey,
			threadLabel: parsed.threadLabel?.trim() || initialConfig.threadLabel,
		};
	} catch {
		return initialConfig;
	}
}

export function formatTime(timestamp: string): string {
	try {
		return new Date(timestamp).toLocaleTimeString([], {
			hour: "2-digit",
			minute: "2-digit",
		});
	} catch {
		return timestamp;
	}
}

export function statusTone(kind: ChannelStatusKind | string): "cyan" | "pink" | "lime" | "amber" {
	if (kind === "approval_required") {
		return "amber";
	}
	if (kind === "approval_resolved" || kind === "final") {
		return "lime";
	}
	if (kind === "typing" || kind === "working") {
		return "pink";
	}
	return "cyan";
}

export type TranscriptEntry =
	| {
			id: string;
			kind: "message";
			timestamp: string;
			role: "user" | "assistant" | "system";
			text: string;
			ui?: ChannelSessionState["messages"][number]["ui"];
	  }
	| {
			id: string;
			kind: "pending";
			timestamp: string;
			role: "user";
			text: string;
			pendingStatus: ChannelPendingSend["status"];
			error?: string;
	  };

export function buildTranscriptEntries(
	state: Pick<ChannelSessionState, "messages" | "pendingSends">,
): TranscriptEntry[] {
	const messages: TranscriptEntry[] = state.messages.map((message) => ({
		id: message.id,
		kind: "message",
		timestamp: message.timestamp,
		role: message.role,
		text: message.text,
		ui: message.ui,
	}));
	const pending: TranscriptEntry[] = state.pendingSends.map((item) => ({
		id: item.messageId,
		kind: "pending",
		timestamp: item.createdAt,
		role: "user",
		text: item.text,
		pendingStatus: item.status,
		error: item.error?.message,
	}));
	return [...messages, ...pending].sort((left, right) => {
		return new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime();
	});
}

export type ThreadHistoryEntry = {
	conversationId: string;
	label?: string;
	lastSeenAt: string;
	lastMessagePreview?: string;
	recentMessages?: ThreadHistoryMessage[];
	routeMode?: ThreadRouteMode;
	routeSource?: ThreadRouteSource;
	resolvedAgentId?: string;
	resolvedSessionKey?: string;
};

export type ThreadHistoryMessage = {
	role: "user" | "assistant" | "system";
	text: string;
	timestamp: string;
};

export function loadThreadHistory(): ThreadHistoryEntry[] {
	try {
		const raw = window.localStorage.getItem(THREAD_HISTORY_STORAGE_KEY);
		if (!raw) {
			return [];
		}
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed)) {
			return [];
		}
		return parsed
			.map((entry) => sanitizeThreadHistoryEntry(entry))
			.filter((entry): entry is ThreadHistoryEntry => entry !== null)
			.slice(0, MAX_THREAD_HISTORY_ITEMS);
	} catch {
		return [];
	}
}

export function saveThreadHistory(entries: ThreadHistoryEntry[]): void {
	window.localStorage.setItem(
		THREAD_HISTORY_STORAGE_KEY,
		JSON.stringify(entries.slice(0, MAX_THREAD_HISTORY_ITEMS)),
	);
}

export function upsertThreadHistoryEntry(
	current: ThreadHistoryEntry[],
	next: ThreadHistoryEntry,
): ThreadHistoryEntry[] {
	const filtered = current.filter((entry) => entry.conversationId !== next.conversationId);
	return [next, ...filtered].slice(0, MAX_THREAD_HISTORY_ITEMS);
}

function sanitizeThreadHistoryEntry(raw: unknown): ThreadHistoryEntry | null {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
		return null;
	}
	const entry = raw as Record<string, unknown>;
	const conversationId = typeof entry.conversationId === "string" ? entry.conversationId.trim() : "";
	if (!conversationId) {
		return null;
	}
	const routeMode =
		entry.routeMode === "auto" || entry.routeMode === "agent" || entry.routeMode === "session"
			? entry.routeMode
			: undefined;
	const routeSource =
		entry.routeSource === "default" || entry.routeSource === "configured" || entry.routeSource === "binding"
			? entry.routeSource
			: undefined;
	return {
		conversationId,
		label: typeof entry.label === "string" ? entry.label.trim() || undefined : undefined,
		lastSeenAt:
			typeof entry.lastSeenAt === "string" && entry.lastSeenAt.trim()
				? entry.lastSeenAt
				: new Date().toISOString(),
		lastMessagePreview:
			typeof entry.lastMessagePreview === "string" ? entry.lastMessagePreview.trim() || undefined : undefined,
		recentMessages: Array.isArray(entry.recentMessages)
			? entry.recentMessages
					.map((message) => sanitizeThreadHistoryMessage(message))
					.filter((message): message is ThreadHistoryMessage => message !== null)
					.slice(-3)
			: undefined,
		routeMode,
		routeSource,
		resolvedAgentId:
			typeof entry.resolvedAgentId === "string" ? entry.resolvedAgentId.trim() || undefined : undefined,
		resolvedSessionKey:
			typeof entry.resolvedSessionKey === "string" ? entry.resolvedSessionKey.trim() || undefined : undefined,
	};
}

function sanitizeThreadHistoryMessage(raw: unknown): ThreadHistoryMessage | null {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
		return null;
	}
	const message = raw as Record<string, unknown>;
	const role =
		message.role === "user" || message.role === "assistant" || message.role === "system"
			? message.role
			: null;
	const text = typeof message.text === "string" ? message.text.trim() : "";
	const timestamp = typeof message.timestamp === "string" ? message.timestamp.trim() : "";
	if (!role || !text || !timestamp) {
		return null;
	}
	return {
		role,
		text,
		timestamp,
	};
}
