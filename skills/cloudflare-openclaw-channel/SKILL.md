# Cloudflare OpenClaw Channel

Use this skill when working on the Cloudflare OpenClaw Channel repository.

## Use This Skill For

- Worker or Durable Object transport changes
- OpenClaw native channel plugin work
- client SDK lifecycle, session, or approval work
- demo UI work built on the SDK
- auth, pairing, approval, or routing changes
- test, CI, release, or packaging changes

## Working Rules

1. Treat this repository as SDK-first.
   The headless client package is the primary integration surface. The demo UI exists to demonstrate the SDK, not to bypass it.

2. Preserve the native OpenClaw channel boundary.
   Do not collapse the plugin into a simple HTTP bridge. OpenClaw should own pairing, routing, session identity, and approval integration.

3. Keep thread identity separate from route/session identity.
   `conversationId` is the stable channel thread key, not a pseudo-session id. Thread routing may auto-route, pin to an `agentId`, or bind to a concrete `sessionKey`, but those are separate layers.

4. Keep the Worker transport thin.
   The Worker and Durable Object layer should validate IO, authenticate clients, and bridge transport events. Avoid pushing channel semantics such as approval interpretation, pairing state, or route decisions down into the Worker when the plugin or SDK can own them.

5. Keep the demo app modern and lightweight.
   Prefer hooks, small components, and local state. Do not add HOCs. Do not add TanStack Query for the socket/chat path unless the app grows real HTTP-backed server state that justifies it.

6. Verify current Cloudflare documentation before platform changes.
   This repo depends on Workers and Durable Objects. Limits and APIs can change. Check current docs before changing platform behavior, bindings, limits-sensitive logic, or runtime assumptions.

7. Use the session layer before adding UI-local transport state.
   The demo should consume `createChannelClient()` plus `createChannelSession()` instead of rebuilding transcript, approval, or connection state by hand.

8. Keep approvals first-class.
   Preserve approval restrictions such as `allowedDecisions` and explicit `buttons`. Do not hard-code approval actions when the channel provided a narrower set.

9. Keep auth and pairing explicit.
   Verified identity should come from server-validated auth, not from arbitrary client-supplied IDs. Pairing should be enforced as part of native channel ingress.

10. Optimize for downstream forks.
    This repo is a template for other channel integrations. Prefer patterns that generalize: shared wire contracts, plugin-owned semantics, SDK-owned UI state, and demo-only local persistence for conveniences like recent thread history.

## Key Areas

- `src/`
  Cloudflare Worker, auth helpers, HTTP utilities, integration tests.
- `packages/channel-contract/`
  Shared protocol types, thread-route contracts, and route helpers.
- `packages/channel-client/`
  Headless client SDK and session helper. First-class UI state should accumulate here before it leaks into the demo.
- `packages/openclaw-channel/`
  Native OpenClaw plugin package. Pairing, ingress routing, session binding, and approval semantics belong here.
- `apps/web-demo/`
  Reference UI built on the client SDK. Local thread history and command UX are fine here as long as they do not redefine channel semantics.

## Normal Workflow

1. Read the relevant package boundary before editing.
2. If the change touches Cloudflare platform behavior, verify current docs first.
3. Prefer minimal, layered changes over cross-cutting shortcuts.
4. Run the narrowest useful test loop while iterating.
5. Before finishing, run:

```bash
npm run typecheck
pnpm test
```

6. If bindings changed in `wrangler.jsonc`, also run:

```bash
npm run cf-typegen
```

## Review Checklist

- Does the change preserve SDK-first layering?
- Does the demo still reflect recommended SDK usage?
- Does the plugin rely only on public OpenClaw SDK surfaces?
- Are auth and pairing semantics still explicit and defensible?
- Are approval and status event contracts preserved end-to-end?
- Does the change keep `conversationId` as thread identity rather than a fake session id?
- If the repo is forked to another channel, would this pattern still make sense?
- Are repo docs still accurate after the change?

## Expected Documentation Updates

When behavior changes, update the matching docs:

- `README.md` for overview, setup, deployment, and first-use guidance
- `ARCHITECTURE.md` for system boundaries and flow changes
- package READMEs when a package-facing API or workflow changes
- `SKILLS.md` or this skill if contributor guidance changes materially
