import { describe, expect, it } from "vitest";

import { authorizeClientRequest } from "./auth.js";
import type { WorkerEnv } from "./env.js";
import { mintClientJwt } from "./jwt.js";

function makeEnv(overrides: Partial<WorkerEnv> = {}): WorkerEnv {
	return {
		CHANNEL_ID: "cf-do-channel",
		CHANNEL_SERVICE_TOKEN: "service-token",
		CHANNEL_JWT_SECRET: undefined,
		CHANNEL_PUBLIC_TOKEN: undefined,
		CHANNEL_USERS_JSON: "{}",
		CHANNEL_CLIENT_CREDENTIALS_JSON: "{}",
		...overrides,
	} as WorkerEnv;
}

describe("authorizeClientRequest", () => {
	it("fails closed when neither jwt nor public token auth is configured", async () => {
		const request = new Request("https://example.test/v1/bridge/ws?role=client&conversationId=demo");
		await expect(authorizeClientRequest(request, makeEnv())).resolves.toBeNull();
	});

	it("throws on invalid jwt tokens so callers can map them to 401", async () => {
		const request = new Request("https://example.test/v1/bridge/ws?role=client&conversationId=demo", {
			headers: {
				authorization: "Bearer not-a-jwt",
			},
		});
		await expect(
			authorizeClientRequest(
				request,
				makeEnv({
					CHANNEL_JWT_SECRET: "test-jwt-secret",
				}),
			),
		).rejects.toThrow(/invalid jwt format/i);
	});

	it("accepts valid provisioned jwt subjects", async () => {
		const env = makeEnv({
			CHANNEL_JWT_SECRET: "test-jwt-secret",
			CHANNEL_USERS_JSON: JSON.stringify({
				user_123: { name: "Alice", enabled: true },
			}),
		});
		const token = await mintClientJwt({
			env,
			subject: "user_123",
			name: "Alice",
		});
		const request = new Request("https://example.test/v1/bridge/ws?role=client&conversationId=demo", {
			headers: {
				authorization: `Bearer ${token}`,
			},
		});
		await expect(authorizeClientRequest(request, env)).resolves.toEqual({
			subject: "user_123",
			name: "Alice",
		});
	});
});
