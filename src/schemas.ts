import { z } from "zod";

const jsonRecordSchema = z.record(z.string(), z.unknown());

const approvalDecisionSchema = z.enum(["allow-once", "allow-always", "deny"]);
const threadRouteModeSchema = z.enum(["auto", "agent", "session"]);
const statusKindSchema = z.enum([
	"queued",
	"typing",
	"working",
	"approval_required",
	"approval_resolved",
	"final",
]);

const channelUiButtonSchema = z.object({
	id: z.string(),
	label: z.string(),
	style: z.enum(["primary", "secondary", "success", "danger"]).optional(),
	action: z.union([
		z.object({
			type: z.literal("approval.resolve"),
			approvalId: z.string(),
			decision: approvalDecisionSchema,
		}),
		z.object({
			type: z.literal("link"),
			url: z.string().url(),
		}),
	]),
});

const channelUiSchema = z.union([
	z.object({
		kind: z.literal("notice"),
		title: z.string(),
		body: z.string().optional(),
		badge: z.string().optional(),
	}),
	z.object({
		kind: z.literal("approval"),
		title: z.string(),
		body: z.string(),
		approvalId: z.string(),
		approvalKind: z.enum(["exec", "plugin", "pairing"]).optional(),
		allowedDecisions: z.array(approvalDecisionSchema).optional(),
		buttons: z.array(channelUiButtonSchema).optional(),
	}),
	z.object({
		kind: z.literal("form"),
		title: z.string(),
		submitLabel: z.string().optional(),
		fields: z.array(
			z.object({
				id: z.string(),
				label: z.string(),
				type: z.literal("text").optional(),
				required: z.boolean().optional(),
				placeholder: z.string().optional(),
				value: z.string().optional(),
			}),
		),
	}),
]);

const channelMessageSchema = z.object({
	id: z.string(),
	role: z.enum(["user", "assistant", "system"]),
	text: z.string(),
	timestamp: z.string(),
	participantId: z.string().optional(),
	metadata: jsonRecordSchema.optional(),
	ui: channelUiSchema.optional(),
});

const clientActionPayloadSchema = z.union([
	z.object({
		type: z.literal("approval.resolve"),
		approvalId: z.string(),
		decision: approvalDecisionSchema,
	}),
	z.object({
		type: z.literal("thread.configure"),
		mode: threadRouteModeSchema,
		agentId: z.string().optional(),
		sessionKey: z.string().optional(),
		label: z.string().optional(),
	}),
	z.object({
		type: z.literal("thread.inspect"),
	}),
]);

const clientPingEventSchema = z.object({
	type: z.literal("client.ping"),
});

const clientHelloEventSchema = z.object({
	type: z.literal("client.hello"),
	clientId: z.string().optional(),
});

const clientMessageEventSchema = z.object({
	type: z.literal("client.message"),
	messageId: z.string().optional(),
	text: z.string(),
	metadata: jsonRecordSchema.optional(),
});

const clientActionEventSchema = z.object({
	type: z.literal("client.action"),
	actionId: z.string().optional(),
	action: clientActionPayloadSchema,
	metadata: jsonRecordSchema.optional(),
});

const providerStatusEventSchema = z.object({
	type: z.literal("provider.status"),
	conversationId: z.string(),
	status: z.object({
		kind: statusKindSchema,
		message: z.string().optional(),
		referenceId: z.string().optional(),
		approvalId: z.string().optional(),
		approvalKind: z.enum(["exec", "plugin", "pairing"]).optional(),
		details: jsonRecordSchema.optional(),
	}),
});

const providerMessageEventSchema = z.object({
	type: z.literal("provider.message"),
	conversationId: z.string(),
	message: channelMessageSchema,
});

const providerActionEventSchema = z.object({
	type: z.literal("provider.action"),
	conversationId: z.string(),
	senderId: z.string(),
	senderName: z.string().optional(),
	actionId: z.string(),
	action: clientActionPayloadSchema,
	metadata: jsonRecordSchema.optional(),
});

const providerHelloEventSchema = z.object({
	type: z.literal("provider.hello"),
	accountId: z.string().optional(),
});

export const clientEventSchema = z.union([
	clientPingEventSchema,
	clientHelloEventSchema,
	clientMessageEventSchema,
	clientActionEventSchema,
]);

export const providerEventSchema = z.union([
	providerHelloEventSchema,
	providerStatusEventSchema,
	providerMessageEventSchema,
	providerActionEventSchema,
]);

export const outboundRestRequestSchema = z.object({
	messageId: z.string().optional(),
	role: z.enum(["assistant", "system"]).optional(),
	text: z.string(),
	participantId: z.string().optional(),
	metadata: jsonRecordSchema.optional(),
	ui: channelUiSchema.optional(),
});

export const outboundStatusRequestSchema = z.object({
	kind: statusKindSchema,
	message: z.string().optional(),
	referenceId: z.string().optional(),
	approvalId: z.string().optional(),
	approvalKind: z.enum(["exec", "plugin", "pairing"]).optional(),
	details: jsonRecordSchema.optional(),
});

export const issueTokenRequestSchema = z.object({
	clientId: z.string(),
	clientSecret: z.string(),
});

export type OutboundRestRequest = z.infer<typeof outboundRestRequestSchema>;
export type OutboundStatusRequest = z.infer<typeof outboundStatusRequestSchema>;
export type IssueTokenRequest = z.infer<typeof issueTokenRequestSchema>;
