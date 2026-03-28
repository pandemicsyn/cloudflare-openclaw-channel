import { describe, expect, it } from "vitest";

import {
	buildBridgeWebSocketPath,
	createMessageId,
	normalizeConversationId,
} from "./index.js";

describe("channel-contract", () => {
	it("normalizes conversation ids", () => {
		expect(normalizeConversationId(" Demo Room ")).toBe("demo-room");
		expect(normalizeConversationId("room:alpha_1")).toBe("room:alpha_1");
	});

	it("builds bridge websocket paths without legacy participant ids", () => {
		expect(
			buildBridgeWebSocketPath({
				accountId: "acct",
				role: "client",
				conversationId: "Demo Room",
				clientId: "web-1",
				token: "jwt-token",
			}),
		).toBe(
			"/v1/bridge/ws?accountId=acct&role=client&conversationId=demo-room&clientId=web-1&token=jwt-token",
		);
	});

	it("creates message ids with the requested prefix", () => {
		expect(createMessageId("client")).toMatch(/^client_/);
	});
});
