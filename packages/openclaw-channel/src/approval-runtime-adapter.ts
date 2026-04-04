import type { OpenClawConfig } from "openclaw/plugin-sdk/core";

import type {
	ChannelStatusKind,
	ChannelUi,
	ProviderActionEvent,
} from "../../channel-contract/src/index.js";
import { isApproverAllowed } from "./approval-auth.js";
import { ApprovalGatewayClient } from "./approval-client.js";

type AdapterContext = {
	cfg: OpenClawConfig;
	approvalAllowFrom: string[];
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
	private approvalClient: ApprovalGatewayClient | null = null;

	constructor(private readonly ctx: AdapterContext) {}

	async handleApprovalResolve(envelope: ProviderActionEvent): Promise<void> {
		if (envelope.action.type !== "approval.resolve") {
			return;
		}
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

		this.approvalClient ??= new ApprovalGatewayClient({
			cfg: this.ctx.cfg,
			log: this.ctx.log,
		});
		await this.ctx.sendProviderStatus({
			conversationId: envelope.conversationId,
			kind: "working",
			referenceId: envelope.actionId,
			approvalId: envelope.action.approvalId,
			message: "Submitting approval decision to OpenClaw.",
		});
		try {
			await this.approvalClient.resolveApproval({
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
		void this.approvalClient?.close();
		this.approvalClient = null;
	}
}
