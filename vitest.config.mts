import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
	plugins: [
		cloudflareTest({
			wrangler: {
				configPath: "./wrangler.jsonc",
			},
			miniflare: {
				bindings: {
					CHANNEL_SERVICE_TOKEN: "test-service-token",
					CHANNEL_JWT_SECRET: "test-jwt-secret",
					CHANNEL_USERS_JSON: JSON.stringify({
						user_123: { name: "Alice", enabled: true },
						user_disabled: { name: "Disabled", enabled: false },
					}),
					CHANNEL_CLIENT_CREDENTIALS_JSON: JSON.stringify({
						"web-alice": {
							secret: "test-secret",
							sub: "user_123",
							name: "Alice",
							enabled: true,
						},
					}),
				},
			},
		}),
	],
	test: {
		include: [
			"packages/**/*.test.ts",
			"packages/**/*.test.tsx",
			"src/**/*.test.ts",
			"src/**/*.test.tsx",
		],
		exclude: ["**/node_modules/**", "apps/web-demo/src/**/*.test.tsx"],
	},
});
