import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
	resolve: {
		alias: {
			"@pandemicsyn/cf-do-channel-client": path.resolve(
				__dirname,
				"./packages/channel-client/src/index.ts",
			),
			"@pandemicsyn/cf-do-channel-contract": path.resolve(
				__dirname,
				"./packages/channel-contract/src/index.ts",
			),
		},
	},
	test: {
		environment: "jsdom",
		include: ["apps/web-demo/src/**/*.test.tsx"],
		exclude: ["node_modules/**"],
	},
});
