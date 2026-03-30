import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
	ensureConfiguredBindingRouteReady,
	getSessionBindingService,
	registerSessionBindingAdapter,
	resolveConfiguredBindingRoute,
	unregisterSessionBindingAdapter,
	type BindingTargetKind,
	type SessionBindingAdapter,
	type SessionBindingRecord,
} from "openclaw/plugin-sdk/conversation-runtime";
import type { OpenClawConfig } from "openclaw/plugin-sdk/core";
import {
	buildAgentSessionKey,
	deriveLastRoutePolicy,
	resolveAgentIdFromSessionKey,
	resolveAgentRoute,
} from "openclaw/plugin-sdk/routing";

import {
	DEFAULT_ACCOUNT_ID,
	DEFAULT_CHANNEL_ID,
	type ThreadRouteMode,
	type ThreadRouteState,
} from "../../channel-contract/src/index.js";

const THREAD_BINDINGS_FILENAME = "thread-bindings.json";

type StoredThreadBindingRecord = {
	accountId: string;
	conversationId: string;
	targetKind: BindingTargetKind;
	targetSessionKey: string;
	boundAt: number;
	lastActivityAt: number;
	metadata?: Record<string, unknown>;
};

type StoredThreadBindingState = {
	version: 1;
	entries: Record<string, StoredThreadBindingRecord>;
};

type RouteResolution = {
	route: ReturnType<typeof resolveAgentRoute>;
	threadRoute: ThreadRouteState;
	binding: SessionBindingRecord | null;
};

const registeredAdapters = new Set<string>();

function resolveStateDir(env: NodeJS.ProcessEnv = process.env): string {
	const override = env.OPENCLAW_STATE_DIR?.trim();
	if (override) {
		return override;
	}
	return path.join(env.HOME?.trim() || os.homedir(), ".openclaw");
}

function resolveStorePath(): string {
	return path.join(resolveStateDir(), "channels", DEFAULT_CHANNEL_ID, THREAD_BINDINGS_FILENAME);
}

function bindingKey(accountId: string, conversationId: string): string {
	return `${accountId}::${conversationId}`;
}

function bindingId(record: { accountId: string; conversationId: string }): string {
	return `${DEFAULT_CHANNEL_ID}:${record.accountId}:${record.conversationId}`;
}

function normalizeAccountId(accountId?: string | null): string {
	return accountId?.trim() || DEFAULT_ACCOUNT_ID;
}

function trimOptional(value?: string | null): string | undefined {
	const trimmed = value?.trim();
	return trimmed || undefined;
}

async function ensureParentDir(filePath: string): Promise<void> {
	await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
}

async function readStore(): Promise<StoredThreadBindingState> {
	const filePath = resolveStorePath();
	try {
		const raw = await fs.promises.readFile(filePath, "utf8");
		const parsed = JSON.parse(raw) as Partial<StoredThreadBindingState>;
		if (parsed.version === 1 && parsed.entries && typeof parsed.entries === "object") {
			return {
				version: 1,
				entries: parsed.entries as Record<string, StoredThreadBindingRecord>,
			};
		}
	} catch {}
	return {
		version: 1,
		entries: {},
	};
}

async function writeStore(store: StoredThreadBindingState): Promise<void> {
	const filePath = resolveStorePath();
	await ensureParentDir(filePath);
	const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
	await fs.promises.writeFile(tempPath, JSON.stringify(store, null, 2), "utf8");
	await fs.promises.rename(tempPath, filePath);
}

function toSessionBindingRecord(record: StoredThreadBindingRecord): SessionBindingRecord {
	return {
		bindingId: bindingId(record),
		targetSessionKey: record.targetSessionKey,
		targetKind: record.targetKind,
		conversation: {
			channel: DEFAULT_CHANNEL_ID,
			accountId: record.accountId,
			conversationId: record.conversationId,
		},
		status: "active",
		boundAt: record.boundAt,
		metadata: {
			...(record.metadata ?? {}),
			lastActivityAt: record.lastActivityAt,
		},
	};
}

function fromSessionBindingRecord(record: SessionBindingRecord): StoredThreadBindingRecord {
	return {
		accountId: record.conversation.accountId,
		conversationId: record.conversation.conversationId,
		targetKind: record.targetKind,
		targetSessionKey: record.targetSessionKey,
		boundAt: record.boundAt,
		lastActivityAt:
			typeof record.metadata?.lastActivityAt === "number" ? record.metadata.lastActivityAt : record.boundAt,
		metadata: record.metadata,
	};
}

function readBindingMetadata(record: SessionBindingRecord | null): {
	mode?: ThreadRouteMode;
	agentId?: string;
	label?: string;
} {
	const metadata =
		record?.metadata && typeof record.metadata === "object" && !Array.isArray(record.metadata)
			? (record.metadata as Record<string, unknown>)
			: null;
	const rawMode = metadata?.mode;
	return {
		mode: rawMode === "auto" || rawMode === "agent" || rawMode === "session" ? rawMode : undefined,
		agentId: typeof metadata?.agentId === "string" ? metadata.agentId.trim() || undefined : undefined,
		label: typeof metadata?.label === "string" ? metadata.label.trim() || undefined : undefined,
	};
}

function toThreadRouteState(params: {
	conversationId: string;
	route: ReturnType<typeof resolveAgentRoute>;
	binding: SessionBindingRecord | null;
	source: ThreadRouteState["source"];
	targetSessionKey?: string;
	updatedAt?: string;
}): ThreadRouteState {
	const metadata = readBindingMetadata(params.binding);
	const updatedAt = params.updatedAt ?? new Date().toISOString();
	if (params.binding) {
		return {
			conversationId: params.conversationId,
			mode:
				metadata.mode ??
				(metadata.agentId ? "agent" : params.binding.targetKind === "subagent" ? "session" : "session"),
			source: params.source,
			resolvedAgentId: params.route.agentId,
			resolvedSessionKey: params.route.sessionKey,
			targetSessionKey: params.binding.targetSessionKey,
			agentId: metadata.agentId ?? resolveAgentIdFromSessionKey(params.binding.targetSessionKey),
			label: metadata.label,
			bindingId: params.binding.bindingId,
			updatedAt,
		};
	}
	return {
		conversationId: params.conversationId,
		mode: "auto",
		source: params.source,
		resolvedAgentId: params.route.agentId,
		resolvedSessionKey: params.route.sessionKey,
		targetSessionKey: params.targetSessionKey,
		agentId: resolveAgentIdFromSessionKey(params.targetSessionKey) ?? params.route.agentId,
		updatedAt,
	};
}

function createThreadBindingAdapter(accountId: string): SessionBindingAdapter {
	return {
		channel: DEFAULT_CHANNEL_ID,
		accountId,
		capabilities: {
			placements: ["current"],
			bindSupported: true,
			unbindSupported: true,
		},
		bind: async (input) => {
			const store = await readStore();
			const record = fromSessionBindingRecord({
				bindingId: bindingId({ accountId, conversationId: input.conversation.conversationId }),
				targetSessionKey: input.targetSessionKey,
				targetKind: input.targetKind,
				conversation: {
					channel: DEFAULT_CHANNEL_ID,
					accountId,
					conversationId: input.conversation.conversationId,
				},
				status: "active",
				boundAt: Date.now(),
				metadata: input.metadata,
			});
			store.entries[bindingKey(accountId, input.conversation.conversationId)] = record;
			await writeStore(store);
			return toSessionBindingRecord(record);
		},
		listBySession: (targetSessionKey) => {
			const filePath = resolveStorePath();
			if (!fs.existsSync(filePath)) {
				return [];
			}
			try {
				const raw = fs.readFileSync(filePath, "utf8");
				const parsed = JSON.parse(raw) as StoredThreadBindingState;
				return Object.values(parsed.entries ?? {})
					.filter((entry) => entry.accountId === accountId && entry.targetSessionKey === targetSessionKey)
					.map((entry) => toSessionBindingRecord(entry));
			} catch {
				return [];
			}
		},
		resolveByConversation: (ref) => {
			const filePath = resolveStorePath();
			if (!fs.existsSync(filePath)) {
				return null;
			}
			try {
				const raw = fs.readFileSync(filePath, "utf8");
				const parsed = JSON.parse(raw) as StoredThreadBindingState;
				const entry = parsed.entries?.[bindingKey(accountId, ref.conversationId)];
				return entry ? toSessionBindingRecord(entry) : null;
			} catch {
				return null;
			}
		},
		touch: (bindingRecordId, at) => {
			void (async () => {
				const conversationId = bindingRecordId.split(":").slice(2).join(":");
				if (!conversationId) {
					return;
				}
				const store = await readStore();
				const key = bindingKey(accountId, conversationId);
				const entry = store.entries[key];
				if (!entry) {
					return;
				}
				entry.lastActivityAt = at ?? Date.now();
				store.entries[key] = entry;
				await writeStore(store);
			})();
		},
		unbind: async (input) => {
			const store = await readStore();
			const removed: SessionBindingRecord[] = [];
			for (const [key, entry] of Object.entries(store.entries)) {
				if (entry.accountId !== accountId) {
					continue;
				}
				const matchesBindingId = input.bindingId ? bindingId(entry) === input.bindingId : false;
				const matchesSessionKey = input.targetSessionKey ? entry.targetSessionKey === input.targetSessionKey : false;
				if (!matchesBindingId && !matchesSessionKey) {
					continue;
				}
				removed.push(toSessionBindingRecord(entry));
				delete store.entries[key];
			}
			if (removed.length > 0) {
				await writeStore(store);
			}
			return removed;
		},
	};
}

export function ensureThreadBindingAdapter(accountId?: string | null): void {
	const normalizedAccountId = normalizeAccountId(accountId);
	if (registeredAdapters.has(normalizedAccountId)) {
		return;
	}
	registerSessionBindingAdapter(createThreadBindingAdapter(normalizedAccountId));
	registeredAdapters.add(normalizedAccountId);
}

export function clearThreadBindingAdapter(accountId?: string | null): void {
	const normalizedAccountId = normalizeAccountId(accountId);
	if (!registeredAdapters.has(normalizedAccountId)) {
		return;
	}
	unregisterSessionBindingAdapter({
		channel: DEFAULT_CHANNEL_ID,
		accountId: normalizedAccountId,
	});
	registeredAdapters.delete(normalizedAccountId);
}

export async function resolveConversationRoute(params: {
	cfg: OpenClawConfig;
	accountId?: string | null;
	conversationId: string;
}): Promise<RouteResolution> {
	const accountId = normalizeAccountId(params.accountId);
	ensureThreadBindingAdapter(accountId);
	const peer = {
		kind: "direct" as const,
		id: params.conversationId,
	};
	let route = resolveAgentRoute({
		cfg: params.cfg,
		channel: DEFAULT_CHANNEL_ID,
		accountId,
		peer,
	});
	const configuredRoute = resolveConfiguredBindingRoute({
		cfg: params.cfg,
		route,
		conversation: {
			channel: DEFAULT_CHANNEL_ID,
			accountId,
			conversationId: params.conversationId,
		},
	});
	let configuredBinding = configuredRoute.bindingResolution;
	const configuredSessionKey = trimOptional(configuredRoute.boundSessionKey);
	route = configuredRoute.route;

	const binding = getSessionBindingService().resolveByConversation({
		channel: DEFAULT_CHANNEL_ID,
		accountId,
		conversationId: params.conversationId,
	});
	const boundSessionKey = trimOptional(binding?.targetSessionKey);
	if (binding && boundSessionKey) {
		route = {
			...route,
			sessionKey: boundSessionKey,
			agentId: resolveAgentIdFromSessionKey(boundSessionKey) || route.agentId,
			lastRoutePolicy: deriveLastRoutePolicy({
				sessionKey: boundSessionKey,
				mainSessionKey: route.mainSessionKey,
			}),
			matchedBy: "binding.channel",
		};
		configuredBinding = null;
		getSessionBindingService().touch(binding.bindingId);
	}

	if (configuredBinding) {
		const ensured = await ensureConfiguredBindingRouteReady({
			cfg: params.cfg,
			bindingResolution: configuredBinding,
		});
		if (!ensured.ok) {
			throw new Error(`Configured binding unavailable: ${ensured.error}`);
		}
	}

	return {
		route,
		binding,
		threadRoute: binding
			? toThreadRouteState({
				conversationId: params.conversationId,
				route,
				binding,
				source: "binding",
			})
			: toThreadRouteState({
				conversationId: params.conversationId,
				route,
				binding: null,
				source: configuredSessionKey ? "configured" : "default",
				targetSessionKey: configuredSessionKey,
			}),
	};
}

export async function configureConversationThreadRoute(params: {
	cfg: OpenClawConfig;
	accountId?: string | null;
	conversationId: string;
	mode: ThreadRouteMode;
	agentId?: string;
	sessionKey?: string;
	label?: string;
	actorId?: string;
}): Promise<ThreadRouteState> {
	const accountId = normalizeAccountId(params.accountId);
	ensureThreadBindingAdapter(accountId);
	const service = getSessionBindingService();
	const conversation = {
		channel: DEFAULT_CHANNEL_ID,
		accountId,
		conversationId: params.conversationId,
	};
	const existing = service.resolveByConversation(conversation);
	if (existing) {
		await service.unbind({
			bindingId: existing.bindingId,
			reason: "cf-do-thread-route-update",
		});
	}
	if (params.mode === "auto") {
		return (await resolveConversationRoute({
			cfg: params.cfg,
			accountId,
			conversationId: params.conversationId,
		})).threadRoute;
	}
	const trimmedLabel = trimOptional(params.label);
	const metadata: Record<string, unknown> = {
		mode: params.mode,
		label: trimmedLabel,
		boundBy: trimOptional(params.actorId),
		source: "cf-do-thread-route",
	};
	let targetSessionKey = "";
	if (params.mode === "agent") {
		const agentId = trimOptional(params.agentId);
		if (!agentId) {
			throw new Error("agentId is required when mode=agent");
		}
		targetSessionKey = buildAgentSessionKey({
			agentId,
			channel: DEFAULT_CHANNEL_ID,
			accountId,
			peer: {
				kind: "direct",
				id: params.conversationId,
			},
			dmScope: params.cfg.session?.dmScope,
			identityLinks: params.cfg.session?.identityLinks,
		}).toLowerCase();
		metadata.agentId = agentId;
	} else {
		targetSessionKey = trimOptional(params.sessionKey) ?? "";
		if (!targetSessionKey) {
			throw new Error("sessionKey is required when mode=session");
		}
	}
	await service.bind({
		targetSessionKey,
		targetKind: "session",
		conversation,
		placement: "current",
		metadata,
	});
	return (await resolveConversationRoute({
		cfg: params.cfg,
		accountId,
		conversationId: params.conversationId,
	})).threadRoute;
}
