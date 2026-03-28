import { defineSetupPluginEntry } from "openclaw/plugin-sdk/core";

import { cloudflareDoChannelPlugin } from "./channel.js";

export default defineSetupPluginEntry(cloudflareDoChannelPlugin);
