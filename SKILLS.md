# Skills

This repo ships a Codex-style skill so downstream users can work on the channel without having to rediscover the architecture and workflows each time.

## What Is Included

- [`skills/cloudflare-openclaw-channel/SKILL.md`](./skills/cloudflare-openclaw-channel/SKILL.md)
  The actual skill definition.

## Intended Use

The shipped skill is meant to help with:

- Cloudflare Worker and Durable Object changes
- native OpenClaw channel plugin work
- client SDK and demo UI work
- auth, pairing, approval, and bridge lifecycle changes
- test and release workflow changes

## How To Use It

If you use Codex skills directly, copy or install the `skills/cloudflare-openclaw-channel` folder into your Codex skills directory.

If you just want a repo-local reference, open the skill file and edit it to match your team's workflow. It is plain Markdown on purpose.

## Why This Repo Ships A Skill

This project crosses several boundaries:

- Cloudflare Workers and Durable Objects
- OpenClaw native plugin APIs
- a headless client SDK
- a demo React app

That makes it easy for agents and contributors to miss constraints. The skill keeps the important rules in one place:

- always verify current Cloudflare Workers docs before platform work
- preserve the SDK-first layering
- keep the demo UI as a reference app, not the product surface
- treat the OpenClaw plugin as a real native channel, not an HTTP shim
- keep thread identity separate from OpenClaw agent/session routing
- keep Worker transport code dumb and push channel semantics into the plugin + SDK layers

## Forking Guidance

This repo is meant to be forked for other channel integrations, not just reused verbatim.

The most important architectural rule to preserve in a fork is:

- channel thread identity is not the same thing as OpenClaw runtime session identity

In this repo that means:

- `conversationId` is the stable thread key on the transport side
- thread routing decides whether the thread auto-routes, pins to an agent, or binds to a session
- the Worker stays focused on auth, validation, and bridge transport
- the native plugin owns pairing, ingress, routing, and binding semantics
- the client SDK/session layer owns first-class UI state such as approvals, route snapshots, and recent thread state

## Customizing

The skill is expected to be edited.

Common customizations:

- add your deployment environment details
- add repo-specific release rules
- add local development shortcuts
- add stricter coding or review checklists
- add team conventions for auth, pairing, and approval UX
