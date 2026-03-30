# OpenClaw Cloudflare Channel Plugin

This package is a native OpenClaw channel plugin that targets the Worker in this repository.

The install shape is standard for an OpenClaw channel plugin:

1. build the package
2. install it where OpenClaw can load it
3. add a `channels.cf-do-channel` config block
4. make sure the Cloudflare Worker bridge is running

## Current Scope

- native `gateway.startAccount` provider connection to the Worker
- inbound dispatch through OpenClaw's channel runtime
- outbound delivery from OpenClaw to the Worker
- typed bridge status events for queued / typing / working / approvals / final
- first-class approval payloads with interactive button actions
- first-class thread route inspection and thread/session binding actions
- account/config resolution
- simple status probe
- setup-only entrypoint

## Expected Config

```json5
{
  channels: {
    "cf-do-channel": {
      baseUrl: "https://your-worker.example.workers.dev",
      serviceToken: "secret",
      defaultTo: "demo-room",
      dmPolicy: "allowlist",
      allowFrom: ["*"],
      approvalAllowFrom: ["user_123"]
    }
  }
}
```

Notes:

- Keep `defaultTo` and inbound/outbound targets as canonical conversation ids (for example `demo-room`).
- Exec approvals are first-class channel payloads; local prompt suppression is limited to approval payloads only so normal tool output still delivers after approval.
- `conversationId` is the CF DO thread key, not the whole OpenClaw session model.
- Thread routing is layered on top of the thread key through persisted bindings:
  - `auto`: follow normal route resolution
  - `agent`: pin thread to a configured agent
  - `session`: bind thread to an explicit session key
- The plugin emits thread route metadata and a configured-agent catalog in `metadata.cfDoChannel` so clients can render route state without scraping transcript text.

## Build

From the repo root:

```bash
pnpm --filter @pandemicsyn/openclaw-cf-do-channel build
```

## Transport Shape

The plugin is designed to keep a persistent outbound WebSocket open to the Worker bridge endpoint. The Worker acts as the WebSocket server, which is the Durable Object side compatible with WebSocket hibernation.
