import { describe, expect, it, vi } from "vitest";

import {
	ChannelClient,
	ChannelClientError,
	createChannelClient,
	createChannelSession,
	issueChannelClientJwt,
} from "./index.js";

class FakeWebSocket extends EventTarget {
	static readonly OPEN = 1;
	static readonly CLOSED = 3;

	public readyState = 0;
	public sent: string[] = [];

	constructor(public readonly url: string) {
		super();
	}

	send(payload: string): void {
		this.sent.push(payload);
	}

	close(code = 1000, reason = ""): void {
		this.readyState = FakeWebSocket.CLOSED;
		this.dispatchEvent(
			new CloseEvent("close", {
				code,
				reason,
				wasClean: true,
			}),
		);
	}

	open(): void {
		this.readyState = FakeWebSocket.OPEN;
		this.dispatchEvent(new Event("open"));
	}

	receive(payload: unknown): void {
		this.dispatchEvent(
			new MessageEvent("message", {
				data: JSON.stringify(payload),
			}),
		);
	}
}

describe("channel-client", () => {
	it("issues client jwt tokens from static credentials", async () => {
		const fetchImpl = vi.fn(async () =>
			new Response(
				JSON.stringify({
					ok: true,
					token: "jwt-123",
					sub: "user_123",
					name: "Alice",
					expiresInSec: 3600,
				}),
				{
					status: 200,
					headers: {
						"content-type": "application/json",
					},
				},
			),
		);

		await expect(
			issueChannelClientJwt({
				baseUrl: "https://example.test",
				clientId: "web-alice",
				clientSecret: "secret",
				fetchImpl: fetchImpl as unknown as typeof fetch,
			}),
		).resolves.toEqual({
			token: "jwt-123",
			sub: "user_123",
			name: "Alice",
			expiresInSec: 3600,
		});
	});

	it("normalizes token endpoint failures into channel client errors", async () => {
		const fetchImpl = vi.fn(async () =>
			new Response("<html>unauthorized</html>", {
				status: 401,
				headers: {
					"content-type": "text/html; charset=utf-8",
				},
			}),
		);

		await expect(
			issueChannelClientJwt({
				baseUrl: "https://example.test",
				clientId: "web-alice",
				clientSecret: "secret",
				fetchImpl: fetchImpl as unknown as typeof fetch,
			}),
		).rejects.toMatchObject({
			name: "ChannelClientError",
			category: "auth",
			code: "token_issue_failed",
			message: "token issuance failed (401)",
		});
	});

	it("deduplicates overlapping connect calls while the websocket handshake is in flight", async () => {
		const sockets: FakeWebSocket[] = [];
		const client = createChannelClient({
			baseUrl: "https://example.test",
			conversationId: "demo-room",
			clientId: "web-1",
			auth: {
				kind: "jwt",
				token: "jwt-123",
			},
			webSocketFactory: (url) => {
				const socket = new FakeWebSocket(url);
				sockets.push(socket);
				return socket as unknown as WebSocket;
			},
		});

		const first = client.connect();
		const second = client.connect();

		await Promise.resolve();
		expect(sockets).toHaveLength(1);
		sockets[0]?.open();

		await Promise.all([first, second]);
		expect(sockets).toHaveLength(1);
		expect(client.status).toMatchObject({
			connection: "connected",
			reason: "connect_succeeded",
		});
		expect(sockets[0]?.sent[0]).toContain('"type":"client.hello"');
	});

	it("emits normalized server and protocol errors", async () => {
		const holder: { socket?: FakeWebSocket } = {};
		const client = createChannelClient({
			baseUrl: "https://example.test",
			conversationId: "demo-room",
			auth: {
				kind: "jwt",
				token: "jwt-123",
			},
			webSocketFactory: (url) => {
				holder.socket = new FakeWebSocket(url);
				queueMicrotask(() => holder.socket?.open());
				return holder.socket as unknown as WebSocket;
			},
		});

		const errors: ChannelClientError[] = [];
		client.on("error", ({ error }) => {
			errors.push(error);
		});

		await client.connect();
		holder.socket?.dispatchEvent(new MessageEvent("message", { data: "{bad-json" }));
		holder.socket?.receive({
			type: "server.error",
			conversationId: "demo-room",
			error: "provider unavailable",
		});

		expect(errors).toHaveLength(2);
		expect(errors[0]).toMatchObject({
			category: "protocol",
			code: "invalid_payload",
		});
		expect(errors[1]).toMatchObject({
			category: "server",
			code: "server_error",
			conversationId: "demo-room",
		});
	});

	it("tracks transcript, approvals, and pending sends through the session helper", async () => {
		const holder: { socket?: FakeWebSocket } = {};
		const client = createChannelClient({
			baseUrl: "https://example.test",
			conversationId: "demo-room",
			clientId: "web-1",
			auth: {
				kind: "jwt",
				token: "jwt-123",
			},
			webSocketFactory: (url) => {
				holder.socket = new FakeWebSocket(url);
				queueMicrotask(() => holder.socket?.open());
				return holder.socket as unknown as WebSocket;
			},
		});
		const session = createChannelSession(client);

		await session.connect();
		const messageId = await session.sendMessage("Hello from the edge");

		expect(session.snapshot.pendingSends).toHaveLength(1);
		expect(session.snapshot.pendingSends[0]).toMatchObject({
			messageId,
			status: "pending",
		});

		holder.socket?.receive({
			type: "server.ack",
			conversationId: "demo-room",
			messageId,
		});
		expect(session.snapshot.pendingSends[0]).toMatchObject({
			messageId,
			status: "acked",
		});

		holder.socket?.receive({
			type: "server.message",
			conversationId: "demo-room",
			message: {
				id: messageId,
				role: "user",
				text: "Hello from the edge",
				timestamp: new Date().toISOString(),
			},
		});
		holder.socket?.receive({
			type: "server.status",
			conversationId: "demo-room",
			status: {
				kind: "approval_required",
				approvalId: "plugin:123",
				approvalKind: "plugin",
				message: "Approval required.",
			},
			timestamp: new Date().toISOString(),
		});

		expect(session.snapshot.pendingSends).toEqual([]);
		expect(session.snapshot.messages).toHaveLength(1);
		expect(session.snapshot.approvals).toEqual([
			expect.objectContaining({
				approvalId: "plugin:123",
				status: "required",
				approvalKind: "plugin",
			}),
		]);
		expect(session.snapshot.statuses).toHaveLength(1);
	});

	it("preserves approval decision restrictions from approval ui messages", async () => {
		const holder: { socket?: FakeWebSocket } = {};
		const client = createChannelClient({
			baseUrl: "https://example.test",
			conversationId: "demo-room",
			auth: {
				kind: "jwt",
				token: "jwt-123",
			},
			webSocketFactory: (url) => {
				holder.socket = new FakeWebSocket(url);
				queueMicrotask(() => holder.socket?.open());
				return holder.socket as unknown as WebSocket;
			},
		});
		const session = createChannelSession(client);

		await session.connect();
		holder.socket?.receive({
			type: "server.message",
			conversationId: "demo-room",
			message: {
				id: "approval_msg_1",
				role: "system",
				text: "Approval required.",
				timestamp: new Date().toISOString(),
				ui: {
					kind: "approval",
					title: "Restricted Approval",
					body: "Only allow-once is valid.",
					approvalId: "plugin:restricted",
					approvalKind: "plugin",
					allowedDecisions: ["allow-once"],
					buttons: [
						{
							id: "allow-once",
							label: "Allow Once",
							style: "primary",
							action: {
								type: "approval.resolve",
								approvalId: "plugin:restricted",
								decision: "allow-once",
							},
						},
					],
				},
			},
		});

		expect(session.snapshot.approvals).toEqual([
			expect.objectContaining({
				approvalId: "plugin:restricted",
				allowedDecisions: ["allow-once"],
				buttons: [
					expect.objectContaining({
						label: "Allow Once",
					}),
				],
			}),
		]);
		expect(session.snapshot.statuses.at(-1)).toMatchObject({
			conversationId: "demo-room",
			status: {
				kind: "approval_required",
				approvalId: "plugin:restricted",
				approvalKind: "plugin",
			},
		});
	});

	it("does not let metadata override approval ui restrictions", async () => {
		const holder: { socket?: FakeWebSocket } = {};
		const client = createChannelClient({
			baseUrl: "https://example.test",
			conversationId: "demo-room",
			auth: {
				kind: "jwt",
				token: "jwt-123",
			},
			webSocketFactory: (url) => {
				holder.socket = new FakeWebSocket(url);
				queueMicrotask(() => holder.socket?.open());
				return holder.socket as unknown as WebSocket;
			},
		});
		const session = createChannelSession(client);

		await session.connect();
		holder.socket?.receive({
			type: "server.message",
			conversationId: "demo-room",
			message: {
				id: "approval_msg_mixed",
				role: "system",
				text: "Approval required.",
				timestamp: new Date().toISOString(),
				ui: {
					kind: "approval",
					title: "Restricted Approval",
					body: "Only allow-once is valid.",
					approvalId: "plugin:restricted",
					approvalKind: "plugin",
					allowedDecisions: ["allow-once"],
				},
				metadata: {
					execApproval: {
						approvalId: "plugin:restricted",
						allowedDecisions: ["allow-once", "allow-always", "deny"],
					},
				},
			},
		});

		expect(session.snapshot.approvals).toEqual([
			expect.objectContaining({
				approvalId: "plugin:restricted",
				allowedDecisions: ["allow-once"],
			}),
		]);
	});

	it("derives approval state from structured metadata when ui is omitted", async () => {
		const holder: { socket?: FakeWebSocket } = {};
		const client = createChannelClient({
			baseUrl: "https://example.test",
			conversationId: "demo-room",
			auth: {
				kind: "jwt",
				token: "jwt-123",
			},
			webSocketFactory: (url) => {
				holder.socket = new FakeWebSocket(url);
				queueMicrotask(() => holder.socket?.open());
				return holder.socket as unknown as WebSocket;
			},
		});
		const session = createChannelSession(client);

		await session.connect();
		holder.socket?.receive({
			type: "server.message",
			conversationId: "demo-room",
			message: {
				id: "msg_meta_approval",
				role: "assistant",
				text: "Approval required.",
				timestamp: "2026-03-29T19:58:27.000Z",
				metadata: {
					execApproval: {
						approvalId: "e5fc0c19",
					},
				},
			},
		});

		expect(session.snapshot.approvals).toEqual([
			expect.objectContaining({
				approvalId: "e5fc0c19",
				status: "required",
				approvalKind: "exec",
				allowedDecisions: ["allow-once", "allow-always", "deny"],
			}),
		]);
		expect(session.snapshot.statuses.at(-1)).toMatchObject({
			conversationId: "demo-room",
			status: {
				kind: "approval_required",
				approvalId: "e5fc0c19",
				approvalKind: "exec",
			},
		});
	});

	it("resolves pairing approvals and appends approval_resolved status from approved notices", async () => {
		const holder: { socket?: FakeWebSocket } = {};
		const client = createChannelClient({
			baseUrl: "https://example.test",
			conversationId: "demo-room",
			auth: {
				kind: "jwt",
				token: "jwt-123",
			},
			webSocketFactory: (url) => {
				holder.socket = new FakeWebSocket(url);
				queueMicrotask(() => holder.socket?.open());
				return holder.socket as unknown as WebSocket;
			},
		});
		const session = createChannelSession(client);

		await session.connect();
		holder.socket?.receive({
			type: "server.status",
			conversationId: "demo-room",
			status: {
				kind: "approval_required",
				approvalId: "user_123",
				approvalKind: "pairing",
				message: "Pairing approval is required before this chat can continue.",
			},
			timestamp: "2026-03-29T18:40:00.000Z",
		});
		holder.socket?.receive({
			type: "server.message",
			conversationId: "demo-room",
			message: {
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
		});

		expect(session.snapshot.approvals).toEqual([
			expect.objectContaining({
				approvalId: "user_123",
				approvalKind: "pairing",
				status: "resolved",
			}),
		]);
		expect(session.snapshot.statuses.at(-1)).toMatchObject({
			conversationId: "demo-room",
			status: {
				kind: "approval_resolved",
				approvalId: "user_123",
				approvalKind: "pairing",
			},
		});
	});

	it("can be constructed through the class directly", () => {
		const client = new ChannelClient({
			baseUrl: "https://example.test",
			conversationId: "demo-room",
			auth: {
				kind: "jwt",
				token: "jwt-123",
			},
			webSocketFactory: () => new FakeWebSocket("wss://example.test") as unknown as WebSocket,
		});
		expect(client.status.connection).toBe("idle");
		expect(client.status.reason).toBe("initial");
	});
});
