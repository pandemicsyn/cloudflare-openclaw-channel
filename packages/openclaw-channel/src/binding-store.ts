import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BINDING_FILENAME = "sender-bindings.json";

type SenderBindingEntry = {
	conversationId: string;
	senderId: string;
	accountId: string;
	updatedAt: string;
};

type SenderBindingStore = {
	version: 1;
	entries: Record<string, SenderBindingEntry>;
};

function resolveStateDir(env: NodeJS.ProcessEnv = process.env): string {
	const override = env.OPENCLAW_STATE_DIR?.trim();
	if (override) {
		return override;
	}
	return path.join(env.HOME?.trim() || os.homedir(), ".openclaw");
}

function resolveBindingStorePath(): string {
	return path.join(resolveStateDir(), "channels", "cf-do-channel", BINDING_FILENAME);
}

async function ensureParentDir(filePath: string): Promise<void> {
	await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
}

async function readStore(): Promise<SenderBindingStore> {
	const filePath = resolveBindingStorePath();
	try {
		const raw = await fs.promises.readFile(filePath, "utf8");
		const parsed = JSON.parse(raw) as Partial<SenderBindingStore>;
		if (parsed.version === 1 && parsed.entries && typeof parsed.entries === "object") {
			return {
				version: 1,
				entries: parsed.entries as Record<string, SenderBindingEntry>,
			};
		}
	} catch {}
	return {
		version: 1,
		entries: {},
	};
}

async function writeStore(store: SenderBindingStore): Promise<void> {
	const filePath = resolveBindingStorePath();
	await ensureParentDir(filePath);
	const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
	await fs.promises.writeFile(tempPath, JSON.stringify(store, null, 2), "utf8");
	await fs.promises.rename(tempPath, filePath);
}

function bindingKey(accountId: string, senderId: string): string {
	return `${accountId}::${senderId}`;
}

export async function recordSenderBinding(params: {
	accountId: string;
	senderId: string;
	conversationId: string;
}): Promise<void> {
	const store = await readStore();
	store.entries[bindingKey(params.accountId, params.senderId)] = {
		accountId: params.accountId,
		senderId: params.senderId,
		conversationId: params.conversationId,
		updatedAt: new Date().toISOString(),
	};
	await writeStore(store);
}

export async function readSenderBinding(params: {
	accountId: string;
	senderId: string;
}): Promise<SenderBindingEntry | null> {
	const store = await readStore();
	return store.entries[bindingKey(params.accountId, params.senderId)] ?? null;
}
