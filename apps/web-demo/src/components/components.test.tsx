// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ConnectionPanel } from "./ConnectionPanel";
import { TranscriptPanel } from "./TranscriptPanel";

describe("web demo components", () => {
	afterEach(() => {
		cleanup();
	});

	it("renders transcript messages and pending sends", () => {
		render(
			<TranscriptPanel
				state={{
					messages: [
						{
							id: "msg_1",
							role: "assistant",
							text: "Neon reply",
							timestamp: "2026-03-28T18:00:00.000Z",
						},
					],
					pendingSends: [
						{
							messageId: "client_1",
							text: "Pending user message",
							createdAt: "2026-03-28T18:00:01.000Z",
							status: "pending",
						},
					],
					approvals: [],
				}}
				onResolveApproval={vi.fn()}
				transcriptRef={{ current: null }}
			/>,
		);

		expect(screen.getByText("Neon reply")).toBeTruthy();
		expect(screen.getByText("Pending user message")).toBeTruthy();
		expect(screen.getByText(/user · pending/i)).toBeTruthy();
	});

	it("renders first-class approval UI from session approvals", () => {
		render(
			<TranscriptPanel
				state={{
					messages: [],
					pendingSends: [],
					approvals: [
						{
							approvalId: "plugin:123",
							status: "required",
							approvalKind: "plugin",
							title: "Tool Approval",
							body: "A tool action needs approval.",
							updatedAt: "2026-03-28T18:00:00.000Z",
						},
					],
				}}
				onResolveApproval={vi.fn()}
				transcriptRef={{ current: null }}
			/>,
		);

		expect(screen.getByText("Tool Approval")).toBeTruthy();
		expect(screen.getByText("A tool action needs approval.")).toBeTruthy();
		expect(screen.getByText("Allow Once")).toBeTruthy();
		expect(screen.getByText("Always Allow")).toBeTruthy();
		expect(screen.getByText("Deny")).toBeTruthy();
	});

	it("renders only allowed approval actions when approvals are restricted", () => {
		render(
			<TranscriptPanel
				state={{
					messages: [],
					pendingSends: [],
					approvals: [
						{
							approvalId: "plugin:restricted",
							status: "required",
							approvalKind: "plugin",
							title: "Restricted Approval",
							body: "Only allow-once is valid.",
							allowedDecisions: ["allow-once"],
							updatedAt: "2026-03-28T18:00:00.000Z",
						},
					],
				}}
				onResolveApproval={vi.fn()}
				transcriptRef={{ current: null }}
			/>,
		);

		expect(screen.getByText("Allow Once")).toBeTruthy();
		expect(screen.queryByText("Always Allow")).toBeNull();
		expect(screen.queryByText("Deny")).toBeNull();
	});

	it("reflects connection state and runtime errors in the connection panel", () => {
		render(
			<ConnectionPanel
				config={{
					baseUrl: "https://worker.example",
					conversationId: "demo-room",
					clientId: "web-alice",
					clientSecret: "secret",
				}}
				connection={{
					connection: "reconnecting",
					attempt: 2,
					reason: "reconnect_scheduled",
					lastError: "socket error",
				}}
				runtimeError="token issuance failed (401)"
				onConfigChange={vi.fn()}
				onConnect={vi.fn()}
				onDisconnect={vi.fn()}
			/>,
		);

		expect(screen.getByDisplayValue("https://worker.example")).toBeTruthy();
		expect(screen.getByText("token issuance failed (401)")).toBeTruthy();
		expect(screen.getByRole("button", { name: "Connect" }).hasAttribute("disabled")).toBe(true);
	});
});
