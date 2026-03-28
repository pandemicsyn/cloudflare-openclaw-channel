# OpenClaw Cloudflare Channel Plugin

This package is a scaffold for a native OpenClaw channel plugin that targets the Worker in this repository.

## Current Scope

- native `gateway.startAccount` provider connection to the Worker
- inbound dispatch through OpenClaw's channel runtime
- outbound delivery from OpenClaw to the Worker
- typed bridge status events for queued / typing / working / approvals / final
- first-class approval payloads with interactive button actions
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

## Transport Shape

The plugin is designed to keep a persistent outbound WebSocket open to the Worker bridge endpoint. The Worker acts as the WebSocket server, which is the Durable Object side compatible with WebSocket hibernation.
