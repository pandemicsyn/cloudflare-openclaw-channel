import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

async function issueClientToken(): Promise<string> {
	const response = await SELF.fetch("https://example.test/v1/auth/token", {
		method: "POST",
		headers: {
			"content-type": "application/json",
		},
		body: JSON.stringify({
			clientId: "web-alice",
			clientSecret: "test-secret",
		}),
	});
	expect(response.status).toBe(200);
	const payload = (await response.json()) as { token: string };
	return payload.token;
}

async function waitForServerError(ws: WebSocket, expectedMessage: string): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		const timeout = setTimeout(() => {
			reject(new Error(`timed out waiting for server.error (${expectedMessage})`));
		}, 2_000);
		ws.addEventListener("message", (event) => {
			try {
				const envelope = JSON.parse(String(event.data)) as { type?: string; error?: string };
				if (envelope.type === "server.error" && envelope.error === expectedMessage) {
					clearTimeout(timeout);
					resolve();
				}
			} catch {}
		});
	});
}

describe("worker integration", () => {
	it("serves root health with auth config summary", async () => {
		const response = await SELF.fetch("https://example.test/health");
		expect(response.status).toBe(200);
		const payload = (await response.json()) as {
			ok: boolean;
			channelId: string;
			auth: {
				serviceTokenConfigured: boolean;
				jwtConfigured: boolean;
				staticCredentialRegistryConfigured: boolean;
			};
		};
		expect(payload.ok).toBe(true);
		expect(payload.channelId).toBe("cf-do-channel");
		expect(payload.auth.serviceTokenConfigured).toBe(true);
		expect(payload.auth.jwtConfigured).toBe(true);
		expect(payload.auth.staticCredentialRegistryConfigured).toBe(true);
	});

	it("issues client jwt tokens from configured credentials", async () => {
		const response = await SELF.fetch("https://example.test/v1/auth/token", {
			method: "POST",
			headers: {
				"content-type": "application/json",
			},
			body: JSON.stringify({
				clientId: "web-alice",
				clientSecret: "test-secret",
			}),
		});
		expect(response.status).toBe(200);
		const payload = (await response.json()) as {
			ok: boolean;
			token: string;
			sub: string;
			name: string;
		};
		expect(payload.ok).toBe(true);
		expect(payload.sub).toBe("user_123");
		expect(payload.name).toBe("Alice");
		expect(payload.token.split(".")).toHaveLength(3);
		expect(response.headers.get("access-control-allow-origin")).toBe("*");
	});

	it("answers CORS preflight requests for auth token issuance", async () => {
		const response = await SELF.fetch("https://example.test/v1/auth/token", {
			method: "OPTIONS",
			headers: {
				origin: "http://localhost:4173",
				"access-control-request-method": "POST",
				"access-control-request-headers": "content-type",
			},
		});
		expect(response.status).toBe(204);
		expect(response.headers.get("access-control-allow-origin")).toBe("*");
		expect(response.headers.get("access-control-allow-methods")).toContain("POST");
	});

	it("treats malformed token requests as 400 client errors", async () => {
		const response = await SELF.fetch("https://example.test/v1/auth/token", {
			method: "POST",
			headers: {
				"content-type": "application/json",
			},
			body: "{not-json",
		});
		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toEqual({
			error: "invalid json body",
		});
	});

	it("rejects protected bridge status without the service token", async () => {
		const response = await SELF.fetch("https://example.test/v1/bridge/status?accountId=default");
		expect(response.status).toBe(401);
	});

	it("returns 401 for malformed client jwt tokens instead of 500", async () => {
		const response = await SELF.fetch(
			"https://example.test/v1/bridge/ws?role=client&conversationId=demo&token=not-a-jwt",
			{
				headers: {
					upgrade: "websocket",
				},
			},
		);
		expect(response.status).toBe(401);
		await expect(response.json()).resolves.toEqual({
			error: "invalid jwt format",
		});
	});

	it("returns 400 when client websocket requests omit conversationId", async () => {
		const tokenResponse = await SELF.fetch("https://example.test/v1/auth/token", {
			method: "POST",
			headers: {
				"content-type": "application/json",
			},
			body: JSON.stringify({
				clientId: "web-alice",
				clientSecret: "test-secret",
			}),
		});
		expect(tokenResponse.status).toBe(200);
		const tokenPayload = (await tokenResponse.json()) as { token: string };

		const response = await SELF.fetch(
			`https://example.test/v1/bridge/ws?role=client&token=${encodeURIComponent(tokenPayload.token)}`,
			{
				headers: {
					upgrade: "websocket",
				},
			},
		);
		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toEqual({
			error: "conversation id is required",
		});
	});

	it("returns bridge status with auth and room summary when authorized", async () => {
		const response = await SELF.fetch("https://example.test/v1/bridge/status?accountId=default", {
			headers: {
				authorization: "Bearer test-service-token",
			},
		});
		expect(response.status).toBe(200);
		const payload = (await response.json()) as {
			ok: boolean;
			accountId: string;
			auth: {
				serviceTokenConfigured: boolean;
				jwtConfigured: boolean;
			};
			bridge: {
				ok: boolean;
				accountId: string;
				providerConnected: boolean;
				providerCount: number;
				clientCount: number;
				roomCount: number;
				rooms: Array<{ conversationId: string; clientCount: number }>;
			};
		};
		expect(payload.ok).toBe(true);
		expect(payload.accountId).toBe("default");
		expect(payload.auth.serviceTokenConfigured).toBe(true);
		expect(payload.auth.jwtConfigured).toBe(true);
		expect(payload.bridge.ok).toBe(true);
		expect(payload.bridge.providerConnected).toBe(false);
		expect(payload.bridge.providerCount).toBe(0);
		expect(payload.bridge.clientCount).toBe(0);
		expect(payload.bridge.roomCount).toBe(0);
		expect(payload.bridge.rooms).toEqual([]);
	});

	it("treats malformed outbound json as 400 client errors", async () => {
		const response = await SELF.fetch("https://example.test/v1/conversations/demo/messages", {
			method: "POST",
			headers: {
				authorization: "Bearer test-service-token",
				"content-type": "application/json",
			},
			body: "{bad-json",
		});
		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toEqual({
			error: "invalid json body",
		});
	});

	it("rejects outbound message payloads that fail schema validation", async () => {
		const response = await SELF.fetch("https://example.test/v1/conversations/demo/messages", {
			method: "POST",
			headers: {
				authorization: "Bearer test-service-token",
				"content-type": "application/json",
			},
			body: JSON.stringify({
				role: "assistant",
				metadata: {
					debug: true,
				},
			}),
		});
		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toEqual({
			error: "invalid outbound message payload",
		});
	});

	it("accepts service-authenticated status posts for a conversation", async () => {
		const response = await SELF.fetch("https://example.test/v1/conversations/demo/status", {
			method: "POST",
			headers: {
				authorization: "Bearer test-service-token",
				"content-type": "application/json",
			},
			body: JSON.stringify({
				kind: "approval_required",
				approvalId: "exec_123",
				approvalKind: "exec",
				message: "Exec approval required.",
			}),
		});
		expect(response.status).toBe(200);
		const payload = (await response.json()) as {
			ok: boolean;
			status: {
				type: "server.status";
				conversationId: string;
				status: {
					kind: string;
					approvalId?: string;
					approvalKind?: string;
				};
			};
		};
		expect(payload.ok).toBe(true);
		expect(payload.status.type).toBe("server.status");
		expect(payload.status.conversationId).toBe("demo");
		expect(payload.status.status.kind).toBe("approval_required");
		expect(payload.status.status.approvalId).toBe("exec_123");
		expect(payload.status.status.approvalKind).toBe("exec");
	});

	it("rejects outbound status payloads that fail schema validation", async () => {
		const response = await SELF.fetch("https://example.test/v1/conversations/demo/status", {
			method: "POST",
			headers: {
				authorization: "Bearer test-service-token",
				"content-type": "application/json",
			},
			body: JSON.stringify({
				kind: "not-a-real-kind",
				message: "invalid",
			}),
		});
		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toEqual({
			error: "invalid outbound status payload",
		});
	});

	it("rejects unauthenticated status posts", async () => {
		const response = await SELF.fetch("https://example.test/v1/conversations/demo/status", {
			method: "POST",
			headers: {
				"content-type": "application/json",
			},
			body: JSON.stringify({
				kind: "working",
				message: "test",
			}),
		});
		expect(response.status).toBe(401);
	});

	it("rejects malformed client websocket envelopes with a structured server.error", async () => {
		const token = await issueClientToken();
		const response = await SELF.fetch(
			`https://example.test/v1/bridge/ws?role=client&conversationId=demo&token=${encodeURIComponent(token)}`,
			{
				headers: {
					upgrade: "websocket",
				},
			},
		);
		expect(response.status).toBe(101);
		const ws = response.webSocket;
		expect(ws).toBeDefined();
		ws!.accept();
		ws!.send(
			JSON.stringify({
				type: "client.message",
				text: 123,
			}),
		);
		await waitForServerError(ws!, "invalid client event payload");
		ws!.close(1000, "test done");
	});

	it("rejects malformed provider websocket envelopes with a structured server.error", async () => {
		const response = await SELF.fetch(
			"https://example.test/v1/bridge/ws?role=provider&accountId=default",
			{
				headers: {
					authorization: "Bearer test-service-token",
					upgrade: "websocket",
				},
			},
		);
		expect(response.status).toBe(101);
		const ws = response.webSocket;
		expect(ws).toBeDefined();
		ws!.accept();
		ws!.send(
			JSON.stringify({
				type: "provider.message",
				conversationId: "demo",
				message: {
					id: "bad",
					role: "assistant",
					text: 123,
					timestamp: new Date().toISOString(),
				},
			}),
		);
		await waitForServerError(ws!, "invalid provider event payload");
		ws!.close(1000, "test done");
	});

	it("exposes the durable object binding through the worker env", async () => {
		const stub = env.CHANNEL_BRIDGE.getByName("default");
		const response = await stub.fetch("https://do.internal/health?accountId=default");
		expect(response.status).toBe(200);
		const payload = (await response.json()) as {
			ok: boolean;
			accountId: string;
			providerConnected: boolean;
			clientCount: number;
		};
		expect(payload.ok).toBe(true);
		expect(payload.accountId).toBe("default");
		expect(payload.providerConnected).toBe(false);
		expect(payload.clientCount).toBe(0);
	});
});
