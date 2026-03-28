declare module "openclaw/plugin-sdk/direct-dm" {
	export function resolveInboundDirectDmAccessWithRuntime(params: any): Promise<any>;
	export function dispatchInboundDirectDmWithRuntime(params: any): Promise<any>;
}

declare module "openclaw/plugin-sdk/channel-pairing" {
	export function createChannelPairingController(params: any): {
		readAllowFromStore: () => Promise<string[]>;
		issueChallenge: (params: any) => Promise<any>;
	};
}

declare module "openclaw/plugin-sdk/approval-runtime" {
	export function buildExecApprovalPendingReplyPayload(params: any): { text?: string; channelData?: Record<string, unknown> };
	export function buildPluginApprovalRequestMessage(request: any, nowMs: number): string;
	export function buildPluginApprovalResolvedMessage(resolved: any): string;
}
