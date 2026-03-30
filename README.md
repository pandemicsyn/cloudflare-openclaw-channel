# Cloudflare OpenClaw Channel

Cloudflare OpenClaw Channel is a native OpenClaw channel backed by Cloudflare Workers and Durable Objects.

It is organized around three deliverables:

- a Worker + Durable Object transport
- a native OpenClaw channel plugin
- a headless client SDK for custom apps and demo UIs

The intended shape is SDK-first. Any basic chat UI should be a thin demo on top of the client package, not the primary integration surface.

## Thread Model

This channel now treats the browser-visible `conversationId` as a `Thread ID`.

- `Thread ID`
  Stable channel thread key. Reusing the same value rejoins the same CF DO conversation stream.
- `Thread Route`
  Routing policy layered on top of the thread key. A thread can:
  - auto-route to the default/configured OpenClaw target
  - pin to a specific `agentId`
  - bind to an explicit `sessionKey`

That separation is intentional. A CF DO thread is not itself the OpenClaw runtime session. The plugin stores thread bindings and resolves the effective agent/session for each inbound turn.

## Overview

The system works like this:

1. A client authenticates and connects to the Worker bridge.
2. The Worker verifies the client identity and binds the socket to a conversation room in a Durable Object.
3. OpenClaw opens a persistent provider WebSocket into that same bridge.
4. Client messages are forwarded into OpenClaw through the native channel plugin.
5. The plugin enforces pairing, routing, sessions, and approvals.
6. Replies, approval payloads, and typed status events are streamed back to clients through the bridge.

Important packages:

- [packages/channel-contract](./packages/channel-contract)
  Shared wire protocol and route helpers.
- [packages/channel-client](./packages/channel-client)
  Headless client SDK for browser or app integrations.
- [packages/openclaw-channel](./packages/openclaw-channel)
  Native OpenClaw channel plugin package.

Architecture details live in [ARCHITECTURE.md](./ARCHITECTURE.md).

Contributor and agent guidance lives in [SKILLS.md](./SKILLS.md), with the concrete skill definition in [`skills/cloudflare-openclaw-channel/SKILL.md`](./skills/cloudflare-openclaw-channel/SKILL.md).

## Hello World

This is the simplest way to use the client SDK from your own app:

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

client.on("message", ({ message }) => {
  console.log(message.role, message.text, message.ui);
});

client.on("status", (event) => {
  console.log(event.status.kind, event.status.message);
});

await client.connect();
await client.sendMessage("hello");
```

If the channel emits an approval payload, your app can submit the decision with:

```ts
await client.resolveApproval({
  approvalId: "plugin:123",
  decision: "allow-once",
});
```

## Install

This follows the normal OpenClaw channel shape:

1. deploy the external channel transport
2. install the OpenClaw plugin
3. add `channels.cf-do-channel` config
4. start OpenClaw

The only non-standard part is that this channel depends on a Cloudflare Worker + Durable Object bridge.

### 1. Build the repo

```bash
pnpm install
npm run typecheck
pnpm build
```

### 2. Configure and deploy the Worker

For local development with Wrangler:

```bash
cp .dev.vars.example .dev.vars
npm run cf-typegen
npm run dev
```

For deployed environments, set these Worker secrets and vars:

- `CHANNEL_SERVICE_TOKEN`
  Required for the OpenClaw provider connection and protected status routes.
- `CHANNEL_JWT_SECRET`
  Required for client JWT issuance and verification.
- `CHANNEL_USERS_JSON`
  Optional static user registry keyed by JWT `sub`.
- `CHANNEL_CLIENT_CREDENTIALS_JSON`
  Optional static credential registry for `POST /v1/auth/token`.
- `CHANNEL_ID`
  Optional channel id override. Default is `cf-do-channel`.
- `CF_DO_CHANNEL_DEBUG`
  Optional debug logging toggle (`1` enables Worker debug logs).

Example static registries:

```json
{
  "user_123": { "name": "Alice", "enabled": true }
}
```

```json
{
  "web-alice": {
    "secret": "replace-me",
    "sub": "user_123",
    "name": "Alice",
    "enabled": true
  }
}
```

For production deploy:

```bash
npm run cf-typegen
npm run deploy
```

Run `npm run cf-typegen` again after changing bindings in [wrangler.jsonc](./wrangler.jsonc).

### 3. Install the OpenClaw plugin

Build artifacts for the plugin are written under [packages/openclaw-channel/dist](./packages/openclaw-channel/dist).

The plugin package is [packages/openclaw-channel](./packages/openclaw-channel) and includes:

- `dist/index.js`
- `dist/setup-entry.js`
- `openclaw.plugin.json`

Install it the same way you install other external OpenClaw channel plugins in your environment, then make sure OpenClaw can load the built package.

### 4. Add OpenClaw channel config

Suggested OpenClaw config:

```json5
{
  channels: {
    "cf-do-channel": {
      baseUrl: "https://your-worker.example.workers.dev",
      serviceToken: "secret",
      dmPolicy: "pairing",
      allowFrom: [],
      approvalAllowFrom: ["user_123"]
    }
  }
}
```

Useful optional fields:

- `defaultTo`
  Default conversation id for outbound sends when no explicit target is provided.
  Use the canonical conversation id (for example `demo-room`), not a `cf-do:`-prefixed address.
- `dmPolicy`
  Typical value is `pairing` for a real DM onboarding flow.
- `allowFrom`
  DM allowlist entries.
- `approvalAllowFrom`
  Identities allowed to submit approval actions over the channel.

### Thread Routing Modes

The plugin supports three thread-route modes:

- `auto`
  Follow the normal OpenClaw route resolution for this thread. This may still land on a configured binding.
- `agent`
  Pin the thread to a specific configured agent. The plugin derives the target session key for that agent/thread pair.
- `session`
  Bind the thread directly to an explicit OpenClaw session key.

Bindings are persisted under the OpenClaw state directory so the same thread can resume the same target session later.

### 5. Start OpenClaw

Once the Worker is reachable and the plugin is installed, start OpenClaw with the config that includes `channels.cf-do-channel`.

At runtime, OpenClaw keeps a persistent provider WebSocket open to the Worker bridge.

## Local Dev

For a full local loop:

1. Run the Worker locally with `npm run dev`.
2. Start OpenClaw with the plugin enabled and `baseUrl` pointing at the local Worker.
3. Use the demo app or the headless client SDK to connect as a client.

The demo app is optional. The stable integration surface is the SDK in [packages/channel-client](./packages/channel-client).

The demo now exposes:

- `Thread ID`
  The channel thread key used to reconnect to the same chat stream.
- `Thread Deck`
  Recent local threads with labels, last message preview, resolved route summary, and the last few local message snippets per thread.
- `Thread Route`
  Route inspection and binding controls backed by first-class `thread.inspect` and `thread.configure` actions.

### Smoke config in repo

The smoke-test OpenClaw config now lives at [config/openclaw-cf-do-smoke.json](./config/openclaw-cf-do-smoke.json).

Run it with:

```bash
cd ~/projects/openclaw
OPENCLAW_CONFIG_PATH=~/projects/cloudflare-openclaw-channel/config/openclaw-cf-do-smoke.json pnpm -s openclaw gateway run --allow-unconfigured
```

Important notes:

- This config uses test-only tokens (`test-service-token`, `test-gateway-token`).
- Exec approval forwarding is enabled (`approvals.exec.enabled: true`) so approval requests can appear in this channel session.
- Keep your Worker `.dev.vars` aligned with [\.dev.vars.example](./.dev.vars.example).
- The plugin path in the smoke config is absolute for this workspace. If your repo path differs, update `plugins.load.paths[0]`.

## Bridge API

Endpoints:

- `GET /health`
- `GET /v1/bridge/status`
- `POST /v1/auth/token`
- `GET /v1/bridge/ws?role=provider|client&accountId=default&conversationId=...`
- `POST /v1/conversations/:conversationId/messages`

Client WebSocket auth:

- preferred: JWT via `?token=...` or `Authorization: Bearer ...`
- fallback: shared `CHANNEL_PUBLIC_TOKEN` only when `CHANNEL_JWT_SECRET` is unset

Provider WebSocket auth:

- `CHANNEL_SERVICE_TOKEN` via `?token=...` or `Authorization: Bearer ...`

Protected bridge status probe:

- `GET /v1/bridge/status?accountId=default`
- requires `CHANNEL_SERVICE_TOKEN`
- returns provider state, room counts, and auth config summary

## Package Development

This repo is now wired as a pnpm workspace.

Useful commands:

```bash
npm run typecheck
pnpm build
pnpm test
```

`pnpm build` builds the publishable package artifacts under `dist/` for workspace packages.

## CI

GitHub Actions CI is defined in [\.github/workflows/ci.yml](./.github/workflows/ci.yml).

It runs:

- install
- typecheck
- package builds
- tests

At the moment, the repo is set up for package build and test validation in CI. The remaining gap is release automation, not basic build/test correctness.

GitHub releases are defined in [\.github/workflows/release.yml](./.github/workflows/release.yml).

Release behavior:

- pushing a tag like `v0.1.0` builds and tests the repo, then creates a GitHub release
- the release attaches package tarballs for `channel-contract`, `channel-client`, and `openclaw-channel`
- npm publishing is not part of this workflow
