// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApprovalDock } from "./ApprovalDock";
import { Composer } from "./Composer";
import { ConnectionPanel } from "./ConnectionPanel";
import { ThreadHistoryPanel } from "./ThreadHistoryPanel";
import { ThreadRoutePanel } from "./ThreadRoutePanel";
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
				}}
				transcriptRef={{ current: null }}
			/>,
		);

		expect(screen.getByText("Neon reply")).toBeTruthy();
		expect(screen.getByText("Pending user message")).toBeTruthy();
		expect(screen.getByText(/user · pending/i)).toBeTruthy();
	});

	it("renders transcript empty state when there are no messages", () => {
		render(
			<TranscriptPanel
				state={{
					messages: [],
					pendingSends: [],
				}}
				transcriptRef={{ current: null }}
			/>,
		);

		expect(screen.getByText("Connect the demo and fire a message into the neon void.")).toBeTruthy();
	});

	it("renders first-class approval UI from session approvals", () => {
		render(
			<ApprovalDock
				state={{
					messages: [],
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
			<ApprovalDock
				state={{
					messages: [],
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
			/>,
		);

		expect(screen.getByText("Allow Once")).toBeTruthy();
		expect(screen.queryByText("Always Allow")).toBeNull();
		expect(screen.queryByText("Deny")).toBeNull();
	});

	it("does not render local action buttons for pairing approvals", () => {
		render(
			<ApprovalDock
				state={{
					messages: [],
					approvals: [
						{
							approvalId: "user_123",
							status: "required",
							approvalKind: "pairing",
							title: "Pairing Required",
							body: "An operator must approve this chat before messages can run.",
							updatedAt: "2026-03-28T18:00:00.000Z",
						},
					],
				}}
				onResolveApproval={vi.fn()}
			/>,
		);

		expect(screen.queryByText("Allow Once")).toBeNull();
		expect(screen.queryByText("Always Allow")).toBeNull();
		expect(screen.queryByText("Deny")).toBeNull();
		expect(screen.getByText("Approve from your operator channel, or run:")).toBeTruthy();
		expect(screen.getByText("openclaw pairing list --channel cf-do-channel")).toBeTruthy();
		expect(
			screen.getByText("openclaw pairing approve --channel cf-do-channel <PAIRING_CODE> --notify"),
		).toBeTruthy();
	});

	it("hides pairing approval instructions after an approved system notice", () => {
		render(
			<ApprovalDock
				state={{
					messages: [
						{
							id: "msg_approved",
							role: "system",
							text: "✅ OpenClaw access approved. Send a message to start chatting.",
							timestamp: "2026-03-29T18:40:04.000Z",
							ui: {
								kind: "notice",
								title: "Pairing Approved",
								body: "You can start chatting in this conversation now.",
								badge: "approved",
							},
						},
					],
					approvals: [
						{
							approvalId: "user_123",
							status: "required",
							approvalKind: "pairing",
							title: "Approval Required",
							body: "Pairing approval is required before this chat can continue.",
							updatedAt: "2026-03-29T18:40:00.000Z",
						},
					],
				}}
				onResolveApproval={vi.fn()}
			/>,
		);

		expect(screen.getByText("No active approvals.")).toBeTruthy();
		expect(screen.queryByText("openclaw pairing list --channel cf-do-channel")).toBeNull();
	});

	it("reflects connection state and runtime errors in the connection panel", () => {
		render(
			<ConnectionPanel
				config={{
					baseUrl: "https://worker.example",
					conversationId: "demo-room",
					clientId: "web-alice",
					clientSecret: "secret",
					threadRouteMode: "auto",
					agentId: "",
					sessionKey: "",
					threadLabel: "",
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

	it("shows configured agent suggestions in the thread route panel", () => {
		const onConfigChange = vi.fn();
		render(
			<ThreadRoutePanel
				config={{
					baseUrl: "https://worker.example",
					conversationId: "demo-room",
					clientId: "web-alice",
					clientSecret: "secret",
					threadRouteMode: "auto",
					agentId: "",
					sessionKey: "",
					threadLabel: "",
				}}
				threadRoute={{
					conversationId: "demo-room",
					mode: "auto",
					source: "default",
					resolvedAgentId: "main",
					resolvedSessionKey: "agent:main:demo-room",
					updatedAt: "2026-03-30T01:00:00.000Z",
				}}
				threadCatalog={{
					defaultAgentId: "main",
					updatedAt: "2026-03-30T01:00:00.000Z",
					agents: [
						{ id: "main", name: "Main", default: true },
						{ id: "ops", name: "Ops" },
					],
				}}
				isConnected={true}
				onConfigChange={onConfigChange}
				onApply={vi.fn()}
				onRefresh={vi.fn()}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: /Ops/i }));

		expect(screen.getByText("Configured agents")).toBeTruthy();
		expect(onConfigChange).toHaveBeenCalledWith("threadRouteMode", "agent");
		expect(onConfigChange).toHaveBeenCalledWith("agentId", "ops");
	});

	it("renders recent thread history cards", () => {
		render(
			<ThreadHistoryPanel
				history={[
					{
						conversationId: "demo-room4",
						label: "Primary sandbox",
						lastSeenAt: "2026-03-30T02:00:00.000Z",
						lastMessagePreview: "Route pinned to codex.",
						recentMessages: [
							{
								role: "user",
								text: "Summarize the approval bug.",
								timestamp: "2026-03-30T01:58:00.000Z",
							},
							{
								role: "assistant",
								text: "The followup dispatch is failing after approval.",
								timestamp: "2026-03-30T01:59:00.000Z",
							},
						],
						routeMode: "agent",
						routeSource: "binding",
						resolvedAgentId: "codex",
					},
				]}
				currentConversationId="demo-room4"
				isConnected={true}
				onOpenThread={vi.fn()}
				onForgetThread={vi.fn()}
			/>,
		);

		expect(screen.getByText("Thread Deck")).toBeTruthy();
		expect(screen.getByText("Primary sandbox")).toBeTruthy();
		expect(screen.getByText("Route pinned to codex.")).toBeTruthy();
		expect(screen.getByText("Summarize the approval bug.")).toBeTruthy();
		expect(screen.getByText("The followup dispatch is failing after approval.")).toBeTruthy();
		expect(screen.getByRole("button", { name: "Reconnect" })).toBeTruthy();
	});

	it("shows command suggestions for slash input", () => {
		renderComposerHarness("/st");

		expect(screen.getByText("Command completion")).toBeTruthy();
		expect(screen.getByRole("button", { name: /\/status/i })).toBeTruthy();
		expect(screen.getByRole("button", { name: /\/stop/i })).toBeTruthy();
	});

	it("completes a slash command from the suggestion deck", () => {
		renderComposerHarness("/rea");

		fireEvent.click(screen.getByRole("button", { name: /\/reasoning/i }));

		expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("/reasoning ");
		expect(screen.getByText("Command hinting")).toBeTruthy();
	});

	it("shows argument hints and applies choice chips", () => {
		renderComposerHarness("/reasoning ");

		expect(screen.getByText("Next argument")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "stream" }));
		expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("/reasoning stream ");
	});

	it("sends from the composer with cmd or ctrl enter", () => {
		const onSend = vi.fn();
		renderComposerHarness("/status", { onSend });

		fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter", metaKey: true });

		expect(onSend).toHaveBeenCalledTimes(1);
	});
});

function renderComposerHarness(initialDraft: string, overrides?: { onSend?: () => void }) {
	function Harness() {
		const [draft, setDraft] = useState(initialDraft);
		return (
			<Composer
				draft={draft}
				isConnected={true}
				onDraftChange={setDraft}
				onSend={overrides?.onSend ?? vi.fn()}
			/>
		);
	}

	return render(<Harness />);
}
