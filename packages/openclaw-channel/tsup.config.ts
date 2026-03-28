import { defineConfig } from "tsup";

export default defineConfig({
	entry: ["src/index.ts", "src/setup-entry.ts"],
	format: ["esm"],
	dts: true,
	clean: true,
	sourcemap: true,
	target: "es2022",
	outDir: "dist",
	tsconfig: "../../tsconfig.packages.json",
	external: [
		"openclaw",
		"openclaw/*",
	],
});
