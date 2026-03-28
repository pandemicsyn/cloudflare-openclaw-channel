import { defineChannelPluginEntry } from "openclaw/plugin-sdk/core";

import { cloudflareDoChannelPlugin } from "./channel.js";

export default defineChannelPluginEntry({
	id: "cf-do-channel",
	name: "Cloudflare Durable Object Channel",
	description: "OpenClaw channel plugin scaffold for a Cloudflare Worker-backed chat surface",
	plugin: cloudflareDoChannelPlugin,
});
