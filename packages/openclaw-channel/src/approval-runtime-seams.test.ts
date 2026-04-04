import { describe, expect, it } from "vitest";

import { isApproverAllowed, resolveApprovalAllowFrom } from "./approval-auth";
import {
	resolveApproverApprovalTargets,
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
});
