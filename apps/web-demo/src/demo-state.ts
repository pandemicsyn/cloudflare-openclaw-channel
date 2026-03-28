import type {
	ChannelPendingSend,
	ChannelSessionState,
	ChannelStatusKind,
} from "@pandemicsyn/cf-do-channel-client";

export type ConnectionFormState = {
	baseUrl: string;
	conversationId: string;
	clientId: string;
	clientSecret: string;
};

export const STORAGE_KEY = "cf-do-channel-demo-config";

export const initialConfig: ConnectionFormState = {
	baseUrl: "http://127.0.0.1:8787",
	conversationId: "demo-room",
	clientId: "web-alice",
	clientSecret: "replace-me",
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
