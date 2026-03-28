// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { STORAGE_KEY } from "../demo-state";
import { useChannelDemoSession } from "./useChannelDemoSession";

const mockCreateChannelClient = vi.fn();
const mockCreateChannelSession = vi.fn();

const clientDisconnectMock = vi.fn();
const sessionOnMock = vi.fn();
const sessionConnectMock = vi.fn();
const sessionDisconnectMock = vi.fn();
const sessionDisposeMock = vi.fn();
const sessionSendMessageMock = vi.fn();
const sessionResolveApprovalMock = vi.fn();

let sessionListener: ((state: any) => void) | null = null;
let snapshot: any;

vi.mock("@pandemicsyn/cf-do-channel-client", () => ({
	createChannelClient: (...args: unknown[]) => mockCreateChannelClient(...args),
	createChannelSession: (...args: unknown[]) => mockCreateChannelSession(...args),
}));

function HookHarness() {
	const demo = useChannelDemoSession();

	return (
		<div>
			<div data-testid="base-url">{demo.config.baseUrl}</div>
			<div data-testid="connection">{demo.sessionState.connection.connection}</div>
			<div data-testid="runtime-error">{demo.runtimeError ?? ""}</div>
			<input
				aria-label="draft"
				value={demo.draft}
				onChange={(event) => demo.setDraft(event.target.value)}
			/>
			<button onClick={() => void demo.connect()}>connect</button>
			<button onClick={demo.disconnect}>disconnect</button>
			<button onClick={() => void demo.sendDraft()}>send</button>
			<button onClick={() => void demo.resolveApproval("plugin:123", "allow-once")}>approve</button>
		</div>
	);
}

describe("useChannelDemoSession", () => {
	afterEach(() => {
		cleanup();
	});

	beforeEach(() => {
		window.localStorage.clear();
		vi.clearAllMocks();
		snapshot = {
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
		sessionListener = null;

		mockCreateChannelClient.mockReturnValue({
			disconnect: clientDisconnectMock,
		});
		sessionOnMock.mockImplementation((_event: string, handler: (state: unknown) => void) => {
			sessionListener = handler as (state: any) => void;
			return vi.fn();
		});
		mockCreateChannelSession.mockReturnValue({
			get snapshot() {
				return snapshot;
			},
			on: sessionOnMock,
			connect: sessionConnectMock,
			disconnect: sessionDisconnectMock,
			dispose: sessionDisposeMock,
			sendMessage: sessionSendMessageMock,
			resolveApproval: sessionResolveApprovalMock,
		});
	});

	it("initializes config from local storage", () => {
		window.localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify({
				baseUrl: "https://demo.example",
				conversationId: "alpha",
				clientId: "alice",
				clientSecret: "secret",
			}),
		);

		render(<HookHarness />);

		expect(screen.getByTestId("base-url").textContent).toBe("https://demo.example");
	});

	it("creates the client and session on connect", async () => {
		sessionConnectMock.mockResolvedValue(undefined);
		render(<HookHarness />);

		fireEvent.click(screen.getByText("connect"));

		await waitFor(() => {
			expect(mockCreateChannelClient).toHaveBeenCalledTimes(1);
			expect(mockCreateChannelSession).toHaveBeenCalledTimes(1);
			expect(sessionConnectMock).toHaveBeenCalledTimes(1);
		});
	});

	it("surfaces connect failures in runtimeError", async () => {
		sessionConnectMock.mockRejectedValue(new Error("token issuance failed (401)"));
		render(<HookHarness />);

		fireEvent.click(screen.getByText("connect"));

		await waitFor(() => {
			expect(screen.getByTestId("runtime-error").textContent).toBe("token issuance failed (401)");
		});
	});

	it("disconnects and disposes the current session cleanly", async () => {
		sessionConnectMock.mockResolvedValue(undefined);
		render(<HookHarness />);

		fireEvent.click(screen.getByText("connect"));
		await waitFor(() => {
			expect(sessionConnectMock).toHaveBeenCalledTimes(1);
		});

		fireEvent.click(screen.getByText("disconnect"));

		expect(sessionDisconnectMock).toHaveBeenCalled();
		expect(sessionDisposeMock).toHaveBeenCalled();
		expect(clientDisconnectMock).toHaveBeenCalled();
	});

	it("routes send and approval actions through the session helper", async () => {
		sessionConnectMock.mockResolvedValue(undefined);
		sessionSendMessageMock.mockResolvedValue("client_123");
		sessionResolveApprovalMock.mockResolvedValue("action_123");
		render(<HookHarness />);

		fireEvent.click(screen.getByText("connect"));
		await waitFor(() => {
			expect(sessionConnectMock).toHaveBeenCalledTimes(1);
		});

		fireEvent.change(screen.getByLabelText("draft"), {
			target: {
				value: "hello from the harness",
			},
		});
		fireEvent.click(screen.getByText("send"));
		fireEvent.click(screen.getByText("approve"));

		await waitFor(() => {
			expect(sessionSendMessageMock).toHaveBeenCalledWith("hello from the harness");
			expect(sessionResolveApprovalMock).toHaveBeenCalledWith({
				approvalId: "plugin:123",
				decision: "allow-once",
			});
		});
	});
});
