import { useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import {
	createChannelClient,
	createChannelSession,
	type ApprovalDecision,
	type ChannelClient,
	type ChannelSession,
	type ChannelSessionState,
} from "@pandemicsyn/cf-do-channel-client";

import {
	initialSessionState,
	loadStoredConfig,
	loadThreadHistory,
	STORAGE_KEY,
	saveThreadHistory,
	upsertThreadHistoryEntry,
	type ConnectionFormState,
	type ThreadHistoryEntry,
} from "../demo-state";

type DemoSessionHook = {
	config: ConnectionFormState;
	setConfig: Dispatch<SetStateAction<ConnectionFormState>>;
	draft: string;
	setDraft: Dispatch<SetStateAction<string>>;
	sessionState: ChannelSessionState;
	threadHistory: ThreadHistoryEntry[];
	runtimeError: string | null;
	debugEnabled: boolean;
	isConnected: boolean;
	connect: () => Promise<void>;
	openThread: (conversationId: string) => Promise<void>;
	forgetThread: (conversationId: string) => void;
	disconnect: () => void;
	sendDraft: () => Promise<void>;
	resolveApproval: (approvalId: string, decision: ApprovalDecision) => Promise<void>;
	inspectThreadRoute: () => Promise<void>;
	configureThreadRoute: () => Promise<void>;
};

export function useChannelDemoSession(): DemoSessionHook {
	const [config, setConfig] = useState<ConnectionFormState>(() => loadStoredConfig());
	const [draft, setDraft] = useState("Tell me something dramatic.");
	const [sessionState, setSessionState] = useState<ChannelSessionState>(initialSessionState);
	const [threadHistory, setThreadHistory] = useState<ThreadHistoryEntry[]>(() => loadThreadHistory());
	const [runtimeError, setRuntimeError] = useState<string | null>(null);
	const clientRef = useRef<ChannelClient | null>(null);
	const sessionRef = useRef<ChannelSession | null>(null);
	const unsubscribeRef = useRef<(() => void) | null>(null);
	const debugClientUnsubsRef = useRef<Array<() => void>>([]);
	const debugEnabledRef = useRef<boolean>(isDemoDebugEnabled());

	useEffect(() => {
		window.localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
	}, [config]);

	useEffect(() => {
		saveThreadHistory(threadHistory);
	}, [threadHistory]);

	useEffect(() => {
		const route = sessionState.threadRoute;
		if (!route) {
			return;
		}
		setConfig((current) => {
			const nextMode = route.mode;
			const nextAgentId = route.agentId ?? current.agentId;
			const nextSessionKey = route.targetSessionKey ?? "";
			const nextLabel = route.label ?? current.threadLabel;
			if (
				current.threadRouteMode === nextMode &&
				current.agentId === nextAgentId &&
				current.sessionKey === nextSessionKey &&
				current.threadLabel === nextLabel
			) {
				return current;
			}
			return {
				...current,
				threadRouteMode: nextMode,
				agentId: nextAgentId,
				sessionKey: nextSessionKey,
				threadLabel: nextLabel,
			};
		});
	}, [sessionState.threadRoute]);

	useEffect(() => {
		const conversationId = config.conversationId.trim();
		if (!conversationId) {
			return;
		}
		const latestMessage = sessionState.messages.at(-1);
		const latestStatus = sessionState.statuses.at(-1);
		const threadRoute = sessionState.threadRoute;
		const lastSeenAt =
			latestMessage?.timestamp ?? latestStatus?.timestamp ?? threadRoute?.updatedAt ?? undefined;
		if (!lastSeenAt) {
			return;
		}
		const nextEntry: ThreadHistoryEntry = {
			conversationId,
			label: threadRoute?.label ?? (config.threadLabel.trim() || undefined),
			lastSeenAt,
			lastMessagePreview: summarizeLatestMessage(latestMessage?.text),
			recentMessages: summarizeRecentMessages(sessionState.messages),
			routeMode: threadRoute?.mode,
			routeSource: threadRoute?.source,
			resolvedAgentId: threadRoute?.resolvedAgentId,
			resolvedSessionKey: threadRoute?.resolvedSessionKey,
		};
		setThreadHistory((current) => mergeThreadHistory(current, nextEntry));
	}, [
		config.conversationId,
		config.threadLabel,
		sessionState.messages,
		sessionState.statuses,
		sessionState.threadRoute,
	]);

	useEffect(() => {
		return () => {
			teardownCurrentSession({
				clientRef,
				sessionRef,
				unsubscribeRef,
				debugClientUnsubsRef,
			});
		};
	}, []);

	const isConnected = sessionState.connection.connection === "connected";

	const connectWithConfig = async (nextConfig: ConnectionFormState) => {
		setRuntimeError(null);
		setSessionState(initialSessionState);
		debugLog(debugEnabledRef.current, "connect.start", {
			baseUrl: nextConfig.baseUrl,
			conversationId: nextConfig.conversationId,
			clientId: nextConfig.clientId,
		});
		teardownCurrentSession({
			clientRef,
			sessionRef,
			unsubscribeRef,
			debugClientUnsubsRef,
		});

		const client = createChannelClient({
			baseUrl: nextConfig.baseUrl,
			conversationId: nextConfig.conversationId,
			clientId: nextConfig.clientId,
			auth: {
				kind: "credentials",
				clientId: nextConfig.clientId,
				clientSecret: nextConfig.clientSecret,
			},
		});
		const session = createChannelSession(client);
		clientRef.current = client;
		sessionRef.current = session;
		if (debugEnabledRef.current) {
			debugClientUnsubsRef.current.push(
				client.on("message", ({ conversationId, message }) => {
					const metadata =
						message.metadata && typeof message.metadata === "object" && !Array.isArray(message.metadata)
							? (message.metadata as Record<string, unknown>)
							: undefined;
					const channelData =
						metadata?.channelData &&
						typeof metadata.channelData === "object" &&
						!Array.isArray(metadata.channelData)
							? (metadata.channelData as Record<string, unknown>)
							: undefined;
					const execApproval =
						(metadata?.execApproval && typeof metadata.execApproval === "object"
							? metadata.execApproval
							: undefined) ??
						(channelData?.execApproval && typeof channelData.execApproval === "object"
							? channelData.execApproval
							: undefined);
					const rawCfDoChannel =
						(metadata?.cfDoChannel && typeof metadata.cfDoChannel === "object"
							? metadata.cfDoChannel
							: undefined) ??
						(channelData?.cfDoChannel && typeof channelData.cfDoChannel === "object"
							? channelData.cfDoChannel
							: undefined);
					const cfDoUi =
						rawCfDoChannel &&
						typeof rawCfDoChannel === "object" &&
						(rawCfDoChannel as { ui?: unknown }).ui
							? (rawCfDoChannel as { ui?: unknown }).ui
							: undefined;
					debugLog(debugEnabledRef.current, "client.message", {
						conversationId,
						id: message.id,
						role: message.role,
						ui: message.ui,
						metadataKeys: metadata ? Object.keys(metadata) : [],
						metadataChannelDataKeys: channelData ? Object.keys(channelData) : [],
						metadataExecApproval: execApproval,
						metadataCfDoUiKind:
							cfDoUi && typeof cfDoUi === "object" && (cfDoUi as { kind?: unknown }).kind,
						textPreview: message.text.slice(0, 180),
					});
				}),
			);
			debugClientUnsubsRef.current.push(
				client.on("status", (statusEvent) => {
					debugLog(debugEnabledRef.current, "client.status", {
						conversationId: statusEvent.conversationId,
						kind: statusEvent.status.kind,
						approvalId: statusEvent.status.approvalId,
						approvalKind: statusEvent.status.approvalKind,
						referenceId: statusEvent.status.referenceId,
						message: statusEvent.status.message,
					});
				}),
			);
			debugClientUnsubsRef.current.push(
				client.on("serverError", (serverError) => {
					debugLog(debugEnabledRef.current, "client.serverError", serverError);
				}),
			);
			debugClientUnsubsRef.current.push(
				client.on("error", (errorEvent) => {
					debugLog(debugEnabledRef.current, "client.error", {
						message: errorEvent.error.message,
						code: errorEvent.error.code,
						category: errorEvent.error.category,
					});
				}),
			);
		}
		setSessionState(session.snapshot);
		debugLog(debugEnabledRef.current, "session.snapshot.initial", summarizeSessionState(session.snapshot));
		unsubscribeRef.current = session.on("state", (nextState) => {
			setSessionState(nextState);
			debugLog(debugEnabledRef.current, "session.state", summarizeSessionState(nextState));
			if (nextState.lastError?.message) {
				setRuntimeError(nextState.lastError.message);
			}
		});

		try {
			await session.connect();
			debugLog(debugEnabledRef.current, "connect.success");
			setThreadHistory((current) =>
				mergeThreadHistory(current, {
						conversationId: nextConfig.conversationId,
						label: nextConfig.threadLabel.trim() || undefined,
						lastSeenAt: new Date().toISOString(),
						routeMode: nextConfig.threadRouteMode,
						recentMessages: [],
					}),
				);
			if (typeof session.inspectThreadRoute === "function") {
				void session.inspectThreadRoute().catch((error) => {
					debugLog(debugEnabledRef.current, "thread.inspect.connect.error", {
						message: error instanceof Error ? error.message : String(error),
					});
				});
			}
		} catch (error) {
			debugLog(debugEnabledRef.current, "connect.error", {
				message: error instanceof Error ? error.message : String(error),
			});
			teardownCurrentSession({
				clientRef,
				sessionRef,
				unsubscribeRef,
				debugClientUnsubsRef,
			});
			setSessionState(initialSessionState);
			setRuntimeError(error instanceof Error ? error.message : String(error));
		}
	};

	const connect = async () => {
		await connectWithConfig(config);
	};

	const openThread = async (conversationId: string) => {
		const nextConversationId = conversationId.trim();
		if (!nextConversationId) {
			return;
		}
		const historyEntry = threadHistory.find((entry) => entry.conversationId === nextConversationId);
		const nextConfig: ConnectionFormState = {
			...config,
			conversationId: nextConversationId,
			threadLabel: historyEntry?.label ?? "",
			threadRouteMode: "auto",
			agentId: "",
			sessionKey: "",
		};
		setConfig(nextConfig);
		if (sessionRef.current) {
			await connectWithConfig(nextConfig);
		}
	};

	const forgetThread = (conversationId: string) => {
		setThreadHistory((current) => current.filter((entry) => entry.conversationId !== conversationId));
	};

	const disconnect = () => {
		setRuntimeError(null);
		debugLog(debugEnabledRef.current, "disconnect.manual");
		teardownCurrentSession({
			clientRef,
			sessionRef,
			unsubscribeRef,
			debugClientUnsubsRef,
		});
		setSessionState((current) => ({
			...current,
			connection: {
				connection: "closed",
				attempt: current.connection.attempt,
				reason: "manual_disconnect",
			},
		}));
	};

	const sendDraft = async () => {
		const text = draft.trim();
		if (!text) {
			return;
		}
		if (!sessionRef.current) {
			setRuntimeError("Connect the channel before sending a message.");
			return;
		}
		setRuntimeError(null);
		setDraft("");
		try {
			debugLog(debugEnabledRef.current, "send.request", {
				text,
			});
			await sessionRef.current.sendMessage(text);
			debugLog(debugEnabledRef.current, "send.queued");
		} catch (error) {
			debugLog(debugEnabledRef.current, "send.error", {
				message: error instanceof Error ? error.message : String(error),
			});
			setRuntimeError(error instanceof Error ? error.message : String(error));
		}
	};

	const resolveApproval = async (approvalId: string, decision: ApprovalDecision) => {
		if (!sessionRef.current) {
			setRuntimeError("Connect the channel before resolving approvals.");
			return;
		}
		setRuntimeError(null);
		try {
			debugLog(debugEnabledRef.current, "approval.resolve.request", {
				approvalId,
				decision,
			});
			await sessionRef.current.resolveApproval({
				approvalId,
				decision,
			});
			debugLog(debugEnabledRef.current, "approval.resolve.sent", {
				approvalId,
				decision,
			});
		} catch (error) {
			debugLog(debugEnabledRef.current, "approval.resolve.error", {
				approvalId,
				decision,
				message: error instanceof Error ? error.message : String(error),
			});
			setRuntimeError(error instanceof Error ? error.message : String(error));
		}
	};

	const inspectThreadRoute = async () => {
		if (!sessionRef.current) {
			setRuntimeError("Connect the channel before inspecting thread routing.");
			return;
		}
		setRuntimeError(null);
		try {
			debugLog(debugEnabledRef.current, "thread.inspect.request", {
				conversationId: config.conversationId,
			});
			await sessionRef.current.inspectThreadRoute();
			debugLog(debugEnabledRef.current, "thread.inspect.sent", {
				conversationId: config.conversationId,
			});
		} catch (error) {
			debugLog(debugEnabledRef.current, "thread.inspect.error", {
				message: error instanceof Error ? error.message : String(error),
			});
			setRuntimeError(error instanceof Error ? error.message : String(error));
		}
	};

	const configureThreadRoute = async () => {
		if (!sessionRef.current) {
			setRuntimeError("Connect the channel before changing thread routing.");
			return;
		}
		setRuntimeError(null);
		try {
			debugLog(debugEnabledRef.current, "thread.configure.request", {
				mode: config.threadRouteMode,
				agentId: config.agentId,
				sessionKey: config.sessionKey ? "[redacted]" : "",
				label: config.threadLabel,
			});
			await sessionRef.current.configureThreadRoute({
				mode: config.threadRouteMode,
				agentId: config.agentId,
				sessionKey: config.sessionKey,
				label: config.threadLabel,
			});
			debugLog(debugEnabledRef.current, "thread.configure.sent", {
				mode: config.threadRouteMode,
			});
		} catch (error) {
			debugLog(debugEnabledRef.current, "thread.configure.error", {
				message: error instanceof Error ? error.message : String(error),
			});
			setRuntimeError(error instanceof Error ? error.message : String(error));
		}
	};

	return {
		config,
		setConfig,
		draft,
		setDraft,
		sessionState,
		threadHistory,
		runtimeError,
		debugEnabled: debugEnabledRef.current,
		isConnected,
		connect,
		openThread,
		forgetThread,
		disconnect,
		sendDraft,
		resolveApproval,
		inspectThreadRoute,
		configureThreadRoute,
	};
}

function isDemoDebugEnabled(): boolean {
	if (typeof window === "undefined") {
		return false;
	}
	const params = new URLSearchParams(window.location.search);
	if (params.get("cfDebug") === "1" || params.get("debug") === "1") {
		return true;
	}
	return window.localStorage.getItem("CF_DO_DEMO_DEBUG") === "1";
}

function debugLog(enabled: boolean, event: string, payload?: unknown): void {
	if (!enabled) {
		return;
	}
	const timestamp = new Date().toISOString();
	if (payload === undefined) {
		console.log(`[cf-do-demo][${timestamp}] ${event}`);
		return;
	}
	console.log(`[cf-do-demo][${timestamp}] ${event}`, payload);
}

function summarizeSessionState(state: ChannelSessionState): Record<string, unknown> {
	const latestStatus = state.statuses.at(-1);
	const latestMessage = state.messages.at(-1);
	return {
		connection: state.connection.connection,
		attempt: state.connection.attempt,
		messages: state.messages.length,
		pendingSends: state.pendingSends.length,
		approvals: state.approvals.map((approval) => ({
			approvalId: approval.approvalId,
			approvalKind: approval.approvalKind,
			status: approval.status,
			allowedDecisions: approval.allowedDecisions,
		})),
		statuses: state.statuses.map((statusEvent) => ({
			kind: statusEvent.status.kind,
			approvalId: "approvalId" in statusEvent.status ? statusEvent.status.approvalId : undefined,
			approvalKind: "approvalKind" in statusEvent.status ? statusEvent.status.approvalKind : undefined,
		})),
		latestStatus:
			latestStatus === undefined
				? null
				: {
						kind: latestStatus.status.kind,
						approvalId: "approvalId" in latestStatus.status ? latestStatus.status.approvalId : undefined,
						approvalKind: "approvalKind" in latestStatus.status ? latestStatus.status.approvalKind : undefined,
					},
		latestMessage:
			latestMessage === undefined
				? null
				: {
						id: latestMessage.id,
						role: latestMessage.role,
						uiKind: latestMessage.ui?.kind,
						approvalId: latestMessage.ui?.kind === "approval" ? latestMessage.ui.approvalId : undefined,
					},
		threadRoute: state.threadRoute
			? {
					mode: state.threadRoute.mode,
					source: state.threadRoute.source,
					resolvedAgentId: state.threadRoute.resolvedAgentId,
					resolvedSessionKey: state.threadRoute.resolvedSessionKey,
				}
			: null,
		threadCatalog: state.threadCatalog
			? {
					defaultAgentId: state.threadCatalog.defaultAgentId,
					agents: state.threadCatalog.agents.map((agent) => agent.id),
				}
			: null,
	};
}

function summarizeLatestMessage(text?: string): string | undefined {
	const trimmed = text?.trim();
	if (!trimmed) {
		return undefined;
	}
	return trimmed.length > 120 ? `${trimmed.slice(0, 117)}...` : trimmed;
}

function mergeThreadHistory(current: ThreadHistoryEntry[], next: ThreadHistoryEntry): ThreadHistoryEntry[] {
	const existing = current.find((entry) => entry.conversationId === next.conversationId);
	if (
		existing &&
		existing.label === next.label &&
		existing.lastSeenAt === next.lastSeenAt &&
		existing.lastMessagePreview === next.lastMessagePreview &&
		JSON.stringify(existing.recentMessages ?? []) === JSON.stringify(next.recentMessages ?? []) &&
		existing.routeMode === next.routeMode &&
		existing.routeSource === next.routeSource &&
		existing.resolvedAgentId === next.resolvedAgentId &&
		existing.resolvedSessionKey === next.resolvedSessionKey
	) {
		return current;
	}
	return upsertThreadHistoryEntry(current, next);
}

function summarizeRecentMessages(
	messages: ChannelSessionState["messages"],
): Array<{ role: "user" | "assistant" | "system"; text: string; timestamp: string }> {
	return messages
		.filter((message) => Boolean(message.text.trim()))
		.slice(-3)
		.map((message) => ({
			role: message.role,
			text: summarizeLatestMessage(message.text) ?? message.text.trim(),
			timestamp: message.timestamp,
		}));
}

function teardownCurrentSession(params: {
	clientRef: MutableRefObject<ChannelClient | null>;
	sessionRef: MutableRefObject<ChannelSession | null>;
	unsubscribeRef: MutableRefObject<(() => void) | null>;
	debugClientUnsubsRef: MutableRefObject<Array<() => void>>;
}): void {
	for (const unsubscribe of params.debugClientUnsubsRef.current) {
		unsubscribe();
	}
	params.debugClientUnsubsRef.current = [];
	params.unsubscribeRef.current?.();
	params.unsubscribeRef.current = null;
	params.sessionRef.current?.disconnect();
	params.sessionRef.current?.dispose();
	params.sessionRef.current = null;
	params.clientRef.current?.disconnect();
	params.clientRef.current = null;
}
