import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
	plugins: [react()],
	resolve: {
		alias: {
			"@pandemicsyn/cf-do-channel-client": path.resolve(
				__dirname,
				"../../packages/channel-client/src/index.ts",
			),
			"@pandemicsyn/cf-do-channel-contract": path.resolve(
				__dirname,
				"../../packages/channel-contract/src/index.ts",
			),
		},
	},
	server: {
		host: true,
		port: 4173,
	},
});
