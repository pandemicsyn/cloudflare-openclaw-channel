declare module "openclaw/plugin-sdk/core" {
	export type OpenClawConfig = Record<string, any>;
	export type ChannelPlugin<TResolvedAccount = any> = any;
	export function defineChannelPluginEntry(options: any): any;
	export function defineSetupPluginEntry(plugin: any): any;
	export function createChannelPluginBase(options: any): any;
	export function createChatChannelPlugin<TResolvedAccount = any>(options: any): ChannelPlugin<TResolvedAccount>;
}

declare module "openclaw/gateway/call" {
	export function buildGatewayConnectionDetails(options: any): { url: string; urlSource?: string };
}

declare module "openclaw/gateway/client" {
	export class GatewayClient {
		constructor(options: any);
		start(): void;
		request(method: string, params?: unknown): Promise<unknown>;
		stopAndWait(): Promise<void>;
	}
}

declare module "openclaw/gateway/connection-auth" {
	export function resolveGatewayConnectionAuth(params: any): Promise<{
		token?: string;
		password?: string;
	}>;
}

declare module "openclaw/gateway/method-scopes" {
	export const APPROVALS_SCOPE: string;
}

declare module "openclaw/version" {
	export const VERSION: string;
}
