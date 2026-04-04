import type { OpenClawConfig } from "openclaw/plugin-sdk/core";

export function resolveApprovalAllowFrom(
	cfg: OpenClawConfig,
	read: (cfg: OpenClawConfig) => string[],
): string[] {
	return read(cfg);
}

export function isApproverAllowed(senderId: string, allowFrom: string[]): boolean {
	return allowFrom.includes("*") || allowFrom.includes(senderId);
}
