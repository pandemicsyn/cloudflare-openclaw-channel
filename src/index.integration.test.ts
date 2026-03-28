import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

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
