import {
	createOperatorApprovalsGatewayClient,
	type GatewayClient,
} from "openclaw/plugin-sdk/gateway-runtime";
import type { OpenClawConfig } from "openclaw/plugin-sdk/core";

import type {
	ChannelStatusKind,
	ChannelUi,
	ProviderActionEvent,
} from "../../channel-contract/src/index.js";
import { isApproverAllowed } from "./approval-auth.js";
import { resolveApproverApprovalTargets, resolveOriginApprovalTarget } from "./approval-targets.js";

type AdapterContext = {
	cfg: OpenClawConfig;
	approvalAllowFrom: string[];
	defaultConversationId?: string;
	log?: {
		info?: (message: string) => void;
		warn?: (message: string) => void;
		error?: (message: string) => void;
		debug?: (message: string) => void;
	};
	sendProviderMessage: (params: {
		conversationId: string;
		text: string;
		role?: "assistant" | "system";
		ui?: ChannelUi;
	}) => Promise<void>;
	sendProviderStatus: (params: {
		conversationId: string;
		kind: ChannelStatusKind;
		referenceId?: string;
		approvalId?: string;
		message?: string;
		details?: Record<string, unknown>;
	}) => Promise<void>;
};

export class ApprovalRuntimeAdapter {
	private approvalClient: GatewayClient | null = null;
	private readyPromise: Promise<void> | null = null;

	constructor(private readonly ctx: AdapterContext) {}

	async handleApprovalResolve(envelope: ProviderActionEvent): Promise<void> {
		if (envelope.action.type !== "approval.resolve") {
			return;
		}
		const targets = {
			origin: resolveOriginApprovalTarget({
				conversationId: envelope.conversationId,
				senderId: envelope.senderId,
				approvalAllowFrom: this.ctx.approvalAllowFrom,
			}),
			approvers: resolveApproverApprovalTargets({
				conversationId: envelope.conversationId,
				senderId: envelope.senderId,
				approvalAllowFrom: this.ctx.approvalAllowFrom,
			}),
		};
		if (!isApproverAllowed(envelope.senderId, this.ctx.approvalAllowFrom)) {
			await this.ctx.sendProviderMessage({
				conversationId: envelope.conversationId,
				text: `Approval denied: ${envelope.senderId} is not allowed to approve actions on this channel.`,
				role: "system",
				ui: {
					kind: "notice",
					title: "Approval Not Authorized",
					body: `${envelope.senderId} is not allowed to approve actions on this channel.`,
					badge: "denied",
				},
			});
			return;
		}

		await this.ensureConnected();
		await this.ctx.sendProviderStatus({
			conversationId: envelope.conversationId,
			kind: "working",
			referenceId: envelope.actionId,
			approvalId: envelope.action.approvalId,
			message: "Submitting approval decision to OpenClaw.",
			details: { targets },
		});
		try {
			const method = envelope.action.approvalId.startsWith("plugin:")
				? "plugin.approval.resolve"
				: "exec.approval.resolve";
			await this.approvalClient!.request(method, {
				id: envelope.action.approvalId,
				decision: envelope.action.decision,
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			await this.ctx.sendProviderMessage({
				conversationId: envelope.conversationId,
				text: `Approval submit failed: ${message}`,
				role: "system",
				ui: {
					kind: "notice",
					title: "Approval Submit Failed",
					body: message,
					badge: "error",
				},
			});
		}
	}

	close(): void {
		const client = this.approvalClient;
		this.approvalClient = null;
		this.readyPromise = null;
		void client?.stopAndWait().catch(() => undefined);
	}

	private async ensureConnected(): Promise<void> {
		if (this.approvalClient && this.readyPromise) {
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
			onHelloOk: () => resolveReady(),
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
		this.approvalClient = client;
		client.start();
		await this.readyPromise;
	}
}
