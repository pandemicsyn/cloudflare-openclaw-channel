import type { WorkerEnv } from "./env.js";

export type ChannelUserRecord = {
	name?: string;
	enabled?: boolean;
};

export type ChannelClientCredentialRecord = {
	secret: string;
	sub: string;
	name?: string;
	enabled?: boolean;
};

export type VerifiedClientIdentity = {
	subject: string;
	name?: string;
};

type JwtHeader = {
	alg?: string;
	typ?: string;
};

type JwtPayload = {
	sub?: string;
	name?: string;
	exp?: number;
	nbf?: number;
	iat?: number;
} & Record<string, unknown>;

function decodeBase64Url(input: string): Uint8Array {
	const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
	const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
	const decoded = atob(padded);
	const bytes = new Uint8Array(decoded.length);
	for (let i = 0; i < decoded.length; i += 1) {
		bytes[i] = decoded.charCodeAt(i);
	}
	return bytes;
}

function decodeJson<T>(input: string): T {
	return JSON.parse(new TextDecoder().decode(decodeBase64Url(input))) as T;
}

function encodeBase64Url(input: Uint8Array): string {
	let binary = "";
	for (const byte of input) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function encodeJsonBase64Url(value: unknown): string {
	return encodeBase64Url(new TextEncoder().encode(JSON.stringify(value)));
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
	return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function parseUserRegistry(env: WorkerEnv): Record<string, ChannelUserRecord> {
	const raw = env.CHANNEL_USERS_JSON?.trim();
	if (!raw) {
		return {};
	}
	try {
		const parsed = JSON.parse(raw) as Record<string, ChannelUserRecord>;
		return parsed && typeof parsed === "object" ? parsed : {};
	} catch {
		return {};
	}
}

export function parseClientCredentialRegistry(
	env: WorkerEnv,
): Record<string, ChannelClientCredentialRecord> {
	const raw = env.CHANNEL_CLIENT_CREDENTIALS_JSON?.trim();
	if (!raw) {
		return {};
	}
	try {
		const parsed = JSON.parse(raw) as Record<string, ChannelClientCredentialRecord>;
		return parsed && typeof parsed === "object" ? parsed : {};
	} catch {
		return {};
	}
}

async function signHs256Jwt(
	header: JwtHeader,
	payload: JwtPayload,
	secret: string,
): Promise<string> {
	const encodedHeader = encodeJsonBase64Url(header);
	const encodedPayload = encodeJsonBase64Url(payload);
	const signingInput = `${encodedHeader}.${encodedPayload}`;
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const signature = await crypto.subtle.sign(
		"HMAC",
		key,
		new TextEncoder().encode(signingInput),
	);
	const encodedSignature = encodeBase64Url(new Uint8Array(signature));
	return `${encodedHeader}.${encodedPayload}.${encodedSignature}`;
}

async function verifyHs256Jwt(token: string, secret: string): Promise<JwtPayload> {
	const parts = token.split(".");
	if (parts.length !== 3) {
		throw new Error("invalid jwt format");
	}
	const [encodedHeader, encodedPayload, encodedSignature] = parts;
	const header = decodeJson<JwtHeader>(encodedHeader);
	if (header.alg !== "HS256") {
		throw new Error("unsupported jwt alg");
	}
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["verify"],
	);
	const verified = await crypto.subtle.verify(
		"HMAC",
		key,
		toArrayBuffer(decodeBase64Url(encodedSignature)),
		new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`),
	);
	if (!verified) {
		throw new Error("invalid jwt signature");
	}
	const payload = decodeJson<JwtPayload>(encodedPayload);
	const now = Math.floor(Date.now() / 1000);
	if (typeof payload.nbf === "number" && payload.nbf > now) {
		throw new Error("jwt not active");
	}
	if (typeof payload.exp === "number" && payload.exp <= now) {
		throw new Error("jwt expired");
	}
	if (!payload.sub || !String(payload.sub).trim()) {
		throw new Error("jwt missing sub");
	}
	return payload;
}

export async function verifyClientJwt(
	token: string,
	env: WorkerEnv,
): Promise<VerifiedClientIdentity> {
	const secret = env.CHANNEL_JWT_SECRET?.trim();
	if (!secret) {
		throw new Error("CHANNEL_JWT_SECRET is not configured");
	}
	const payload = await verifyHs256Jwt(token, secret);
	const subject = String(payload.sub).trim();
	const registry = parseUserRegistry(env);
	const configured = registry[subject];
	if (Object.keys(registry).length > 0 && !configured) {
		throw new Error("jwt subject is not provisioned");
	}
	if (configured?.enabled === false) {
		throw new Error("jwt subject is disabled");
	}
	return {
		subject,
		name:
			(typeof configured?.name === "string" && configured.name.trim()) ||
			(typeof payload.name === "string" && payload.name.trim()) ||
			undefined,
	};
}

export async function mintClientJwt(params: {
	env: WorkerEnv;
	subject: string;
	name?: string;
	expiresInSec?: number;
}): Promise<string> {
	const secret = params.env.CHANNEL_JWT_SECRET?.trim();
	if (!secret) {
		throw new Error("CHANNEL_JWT_SECRET is not configured");
	}
	const now = Math.floor(Date.now() / 1000);
	return await signHs256Jwt(
		{
			alg: "HS256",
			typ: "JWT",
		},
		{
			sub: params.subject,
			...(params.name ? { name: params.name } : {}),
			iat: now,
			nbf: now,
			exp: now + (params.expiresInSec ?? 3600),
		},
		secret,
	);
}
