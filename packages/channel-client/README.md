# Channel Client

This package is the primary integration surface for browser or app clients.

It has two layers:

- `ChannelClient`: the explicit transport client for auth, connect, reconnect, disconnect, and typed bridge events
- `ChannelSession`: an optional higher-level state helper for transcript, pending sends, approvals, statuses, and last error

## Lifecycle Semantics

`ChannelClient` is intentionally explicit:

- `connect()` is idempotent while a connection attempt is in flight
- `connect()` resolves only after the socket is open and the client is ready to send
- `disconnect()` is manual and stops automatic reconnects
- reconnects reuse the same lifecycle and call `tokenProvider.getToken()` again on each new attempt
- `status.reason` explains why the latest state transition happened

## Error Model

All SDK-generated failures use `ChannelClientError`.

Each error includes:

- `category`: `auth`, `network`, `protocol`, `server`, `state`, or `validation`
- `code`: stable machine-readable error code
- `retryable`: whether retry is usually sensible
- optional `status` and `conversationId`

The SDK emits normalized errors through the `error` event and also rejects promises with the same error type.

## Low-Level Example

```ts
import { createChannelClient } from "@pandemicsyn/cf-do-channel-client";

const client = createChannelClient({
  baseUrl: "https://your-worker.example.workers.dev",
  conversationId: "demo-room",
  auth: {
    kind: "credentials",
    clientId: "web-alice",
    clientSecret: "replace-me",
  },
});

client.on("connection", (status) => {
  console.log(status.connection, status.reason, status.lastError);
});

client.on("error", ({ error }) => {
  console.error(error.category, error.code, error.message);
});

client.on("message", ({ message }) => {
  console.log(message.role, message.text, message.ui);
});

await client.connect();
await client.sendMessage("hello");
```

## Session Helper Example

```ts
import { createChannelClient, createChannelSession } from "@pandemicsyn/cf-do-channel-client";

const client = createChannelClient({
  baseUrl: "https://your-worker.example.workers.dev",
  conversationId: "demo-room",
  auth: {
    kind: "tokenProvider",
    getToken: async () => {
      const response = await fetch("/api/chat-token");
      const payload = await response.json();
      return payload.token;
    },
  },
});

const session = createChannelSession(client);

session.on("state", (state) => {
  console.log(state.connection);
  console.log(state.messages);
  console.log(state.pendingSends);
  console.log(state.approvals);
});

await session.connect();
await session.sendMessage("hello");
```

## Token Refresh

If you use:

- `auth.kind = "jwt"`: the SDK reuses the provided token until you replace the client
- `auth.kind = "credentials"`: the SDK requests a fresh Worker-issued JWT on each new connection attempt
- `auth.kind = "tokenProvider"`: the SDK calls `getToken()` on each new connection attempt, including reconnects

That means `tokenProvider` is the right hook for expiring application-issued auth.
