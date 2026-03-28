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
	STORAGE_KEY,
	type ConnectionFormState,
} from "../demo-state";

type DemoSessionHook = {
	config: ConnectionFormState;
	setConfig: Dispatch<SetStateAction<ConnectionFormState>>;
	draft: string;
	setDraft: Dispatch<SetStateAction<string>>;
	sessionState: ChannelSessionState;
	runtimeError: string | null;
	isConnected: boolean;
	connect: () => Promise<void>;
	disconnect: () => void;
	sendDraft: () => Promise<void>;
	resolveApproval: (approvalId: string, decision: ApprovalDecision) => Promise<void>;
};

export function useChannelDemoSession(): DemoSessionHook {
	const [config, setConfig] = useState<ConnectionFormState>(() => loadStoredConfig());
	const [draft, setDraft] = useState("Tell me something dramatic.");
	const [sessionState, setSessionState] = useState<ChannelSessionState>(initialSessionState);
	const [runtimeError, setRuntimeError] = useState<string | null>(null);
	const clientRef = useRef<ChannelClient | null>(null);
	const sessionRef = useRef<ChannelSession | null>(null);
	const unsubscribeRef = useRef<(() => void) | null>(null);

	useEffect(() => {
		window.localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
	}, [config]);

	useEffect(() => {
		return () => {
			teardownCurrentSession({
				clientRef,
				sessionRef,
				unsubscribeRef,
			});
		};
	}, []);

	const isConnected = sessionState.connection.connection === "connected";

	const connect = async () => {
		setRuntimeError(null);
		setSessionState(initialSessionState);
		teardownCurrentSession({
			clientRef,
			sessionRef,
			unsubscribeRef,
		});

		const client = createChannelClient({
			baseUrl: config.baseUrl,
			conversationId: config.conversationId,
			clientId: config.clientId,
			auth: {
				kind: "credentials",
				clientId: config.clientId,
				clientSecret: config.clientSecret,
			},
		});
		const session = createChannelSession(client);
		clientRef.current = client;
		sessionRef.current = session;
		setSessionState(session.snapshot);
		unsubscribeRef.current = session.on("state", (nextState) => {
			setSessionState(nextState);
			if (nextState.lastError?.message) {
				setRuntimeError(nextState.lastError.message);
			}
		});

		try {
			await session.connect();
		} catch (error) {
			teardownCurrentSession({
				clientRef,
				sessionRef,
				unsubscribeRef,
			});
			setSessionState(initialSessionState);
			setRuntimeError(error instanceof Error ? error.message : String(error));
		}
	};

	const disconnect = () => {
		setRuntimeError(null);
		teardownCurrentSession({
			clientRef,
			sessionRef,
			unsubscribeRef,
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
			await sessionRef.current.sendMessage(text);
		} catch (error) {
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
			await sessionRef.current.resolveApproval({
				approvalId,
				decision,
			});
		} catch (error) {
			setRuntimeError(error instanceof Error ? error.message : String(error));
		}
	};

	return {
		config,
		setConfig,
		draft,
		setDraft,
		sessionState,
		runtimeError,
		isConnected,
		connect,
		disconnect,
		sendDraft,
		resolveApproval,
	};
}

function teardownCurrentSession(params: {
	clientRef: MutableRefObject<ChannelClient | null>;
	sessionRef: MutableRefObject<ChannelSession | null>;
	unsubscribeRef: MutableRefObject<(() => void) | null>;
}): void {
	params.unsubscribeRef.current?.();
	params.unsubscribeRef.current = null;
	params.sessionRef.current?.disconnect();
	params.sessionRef.current?.dispose();
	params.sessionRef.current = null;
	params.clientRef.current?.disconnect();
	params.clientRef.current = null;
}
