import { describe, expect, it } from "vitest";

import { isApproverAllowed, resolveApprovalAllowFrom } from "./approval-auth";
import {
	resolveApproverApprovalTargets,
	resolveApprovalNativeDeliveryMode,
	resolveOriginApprovalTarget,
} from "./approval-targets";

describe("approval auth seams", () => {
	it("resolves allowlist entries from config reader", () => {
		const entries = resolveApprovalAllowFrom({} as any, () => ["user_1", "user_2"]);
		expect(entries).toEqual(["user_1", "user_2"]);
	});

	it("authorizes wildcard or explicit approvers", () => {
		expect(isApproverAllowed("user_1", ["*"])).toBe(true);
		expect(isApproverAllowed("user_1", ["user_1"])).toBe(true);
		expect(isApproverAllowed("user_2", ["user_1"])).toBe(false);
	});

	it("resolves default+configured approver IDs with trimming and wildcard filtering", () => {
		const allowFrom = resolveApprovalAllowFrom({} as any, () => [" user_999 ", "*", ""]);
		expect(allowFrom).toEqual([" user_999 ", "*", ""]);
		expect(isApproverAllowed("user_999", ["user_999"])).toBe(true);
		expect(isApproverAllowed("intruder", ["user_999"])).toBe(false);
		expect(isApproverAllowed("whoever", ["*"])).toBe(true);
	});
});

describe("approval target seams", () => {
	it("always resolves an origin target", () => {
		expect(
			resolveOriginApprovalTarget({
				conversationId: "demo-room",
				senderId: "user_123",
				approvalAllowFrom: [],
			}),
		).toEqual({ kind: "origin", conversationId: "demo-room" });
	});

	it("prefers configured approvers for dm targets", () => {
		expect(
			resolveApproverApprovalTargets({
				conversationId: "demo-room",
				senderId: "user_123",
				approvalAllowFrom: ["user_999", "*"],
			}),
		).toEqual([{ kind: "approver-dm", conversationId: "demo-room", to: "user_999" }]);
	});

	it("falls back to sender when no explicit approvers exist", () => {
		expect(
			resolveApproverApprovalTargets({
				conversationId: "demo-room",
				senderId: "user_123",
				approvalAllowFrom: [],
			}),
		).toEqual([{ kind: "approver-dm", conversationId: "demo-room", to: "user_123" }]);
	});

	it("resolves native delivery mode from channel policy", () => {
		expect(resolveApprovalNativeDeliveryMode({})).toBe("dm");
		expect(resolveApprovalNativeDeliveryMode({ dmPolicy: "channel" })).toBe("channel");
		expect(resolveApprovalNativeDeliveryMode({ dmPolicy: "both" })).toBe("both");
	});
});
