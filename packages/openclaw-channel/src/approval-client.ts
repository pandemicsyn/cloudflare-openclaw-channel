import { createOperatorApprovalsGatewayClient, type GatewayClient } from "openclaw/plugin-sdk/gateway-runtime";
import type { OpenClawConfig } from "openclaw/plugin-sdk/core";

type ApprovalClientContext = {
	cfg: OpenClawConfig;
	log?: {
		info?: (message: string) => void;
		warn?: (message: string) => void;
		error?: (message: string) => void;
		debug?: (message: string) => void;
	};
};

type ApprovalResolveRequest = {
	id: string;
	decision: "allow-once" | "allow-always" | "deny";
};

export class ApprovalGatewayClient {
	private client: GatewayClient | null = null;
	private readyPromise: Promise<void> | null = null;

	constructor(private readonly ctx: ApprovalClientContext) {}

	async resolveApproval(request: ApprovalResolveRequest): Promise<void> {
		await this.ensureConnected();
		const method = request.id.startsWith("plugin:")
			? "plugin.approval.resolve"
			: "exec.approval.resolve";
		await this.client!.request(method, request);
	}

	async close(): Promise<void> {
		const client = this.client;
		this.client = null;
		this.readyPromise = null;
		await client?.stopAndWait().catch(() => undefined);
	}

	private async ensureConnected(): Promise<void> {
		if (this.client && this.readyPromise) {
			await this.readyPromise;
			return;
		}
		let resolveReady!: () => void;
		let rejectReady!: (error: Error) => void;
		this.readyPromise = new Promise<void>((resolve, reject) => {
			resolveReady = resolve;
			rejectReady = reject;
		});
		const client = await createOperatorApprovalsGatewayClient({
			config: this.ctx.cfg,
			clientDisplayName: "CF DO Channel Plugin",
			onHelloOk: () => {
				resolveReady();
			},
			onConnectError: (error: Error) => {
				this.ctx.log?.error?.(`cf-do-channel approvals: gateway connect failed: ${String(error)}`);
				rejectReady(error instanceof Error ? error : new Error(String(error)));
			},
			onClose: (code: number, reason: string) => {
				this.ctx.log?.warn?.(
					`cf-do-channel approvals: gateway closed (${code}): ${reason || "unknown"}`,
				);
				rejectReady(new Error(`gateway closed before ready (${code}): ${reason}`));
			},
		});
		this.client = client;
		client.start();
		await this.readyPromise;
	}
}
