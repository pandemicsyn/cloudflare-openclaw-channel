import { beforeEach, describe, expect, it, vi } from "vitest";

const { request, start, stopAndWait, createOperatorApprovalsGatewayClient } = vi.hoisted(() => {
	const request = vi.fn();
	const start = vi.fn();
	const stopAndWait = vi.fn();
	const createOperatorApprovalsGatewayClient = vi.fn(async (params: { onHelloOk?: () => void }) => ({
		request,
		start: () => {
			start();
			params.onHelloOk?.();
		},
		stopAndWait,
	}));
	return { request, start, stopAndWait, createOperatorApprovalsGatewayClient };
});

vi.mock("openclaw/plugin-sdk/gateway-runtime", () => ({
	createOperatorApprovalsGatewayClient,
}));

import { ApprovalRuntimeAdapter } from "./approval-runtime-adapter";

describe("ApprovalRuntimeAdapter", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		request.mockReset();
		start.mockReset();
		stopAndWait.mockReset();
		createOperatorApprovalsGatewayClient.mockClear();
	});

	it("denies unauthorized actors before gateway submission", async () => {
		const sendProviderMessage = vi.fn(async () => undefined);
		const sendProviderStatus = vi.fn(async () => undefined);
		const adapter = new ApprovalRuntimeAdapter({
			cfg: {} as any,
			approvalAllowFrom: ["owner"],
			authorizeActorAction: () => ({
				authorized: false,
				reason: "❌ You are not authorized to approve exec requests on CF DO.",
			}),
			sendProviderMessage,
			sendProviderStatus,
		});

		await adapter.handleApprovalResolve({
			type: "provider.action",
			actionId: "action_1",
			conversationId: "demo-room",
			senderId: "intruder",
			action: {
				type: "approval.resolve",
				approvalId: "exec:approval_1",
				decision: "deny",
			},
		} as any);

		expect(createOperatorApprovalsGatewayClient).not.toHaveBeenCalled();
		expect(sendProviderStatus).not.toHaveBeenCalled();
		expect(sendProviderMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				conversationId: "demo-room",
				text: "❌ You are not authorized to approve exec requests on CF DO.",
			}),
		);
	});

	it("submits authorized approval resolutions through the gateway", async () => {
		const sendProviderMessage = vi.fn(async () => undefined);
		const sendProviderStatus = vi.fn(async () => undefined);
		const adapter = new ApprovalRuntimeAdapter({
			cfg: {} as any,
			approvalAllowFrom: ["owner"],
			authorizeActorAction: () => ({ authorized: true }),
			sendProviderMessage,
			sendProviderStatus,
		});

		await adapter.handleApprovalResolve({
			type: "provider.action",
			actionId: "action_2",
			conversationId: "demo-room",
			senderId: "owner",
			action: {
				type: "approval.resolve",
				approvalId: "plugin:approval_2",
				decision: "allow-once",
			},
		} as any);

		expect(createOperatorApprovalsGatewayClient).toHaveBeenCalledTimes(1);
		expect(start).toHaveBeenCalledTimes(1);
		expect(sendProviderStatus).toHaveBeenCalledWith(
			expect.objectContaining({
				conversationId: "demo-room",
				kind: "working",
				approvalId: "plugin:approval_2",
				details: {
					targets: {
						origin: { kind: "origin", conversationId: "demo-room" },
						approvers: [{ kind: "approver-dm", conversationId: "demo-room", to: "owner" }],
					},
				},
			}),
		);
		expect(request).toHaveBeenCalledWith("plugin.approval.resolve", {
			id: "plugin:approval_2",
			decision: "allow-once",
		});
		expect(sendProviderMessage).not.toHaveBeenCalled();
	});
});
