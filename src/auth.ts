import type { WorkerEnv } from "./env.js";
import {
	mintClientJwt,
	parseClientCredentialRegistry,
	verifyClientJwt,
	type VerifiedClientIdentity,
} from "./jwt.js";

export function getBearerToken(request: Request): string | null {
	const raw = request.headers.get("authorization")?.trim();
	if (!raw) {
		return null;
	}
	const match = /^Bearer\s+(.+)$/i.exec(raw);
	return match?.[1]?.trim() ?? null;
}

export function getRequestToken(request: Request): string | null {
	return getBearerToken(request) ?? new URL(request.url).searchParams.get("token")?.trim() ?? null;
}

export async function authorizeClientRequest(
	request: Request,
	env: WorkerEnv,
): Promise<VerifiedClientIdentity | null> {
	const token = getRequestToken(request);
	const jwtSecret = env.CHANNEL_JWT_SECRET?.trim();
	if (jwtSecret) {
		if (!token) {
			return null;
		}
		return await verifyClientJwt(token, env);
	}
	const required = env.CHANNEL_PUBLIC_TOKEN?.trim();
	if (!required) {
		return null;
	}
	return token === required ? { subject: "anonymous" } : null;
}

export async function issueClientJwtFromCredential(params: {
	credentialId: string;
	credentialSecret: string;
	env: WorkerEnv;
}): Promise<VerifiedClientIdentity & { token: string; expiresInSec: number }> {
	const registry = parseClientCredentialRegistry(params.env);
	const record = registry[params.credentialId];
	if (!record || record.enabled === false) {
		throw new Error("invalid client credential");
	}
	if (!record.secret || record.secret !== params.credentialSecret) {
		throw new Error("invalid client credential");
	}
	const expiresInSec = 3600;
	const token = await mintClientJwt({
		env: params.env,
		subject: record.sub,
		name: record.name,
		expiresInSec,
	});
	return {
		subject: record.sub,
		name: record.name,
		token,
		expiresInSec,
	};
}

export function authorizeServiceRequest(request: Request, env: WorkerEnv): boolean {
	const required = env.CHANNEL_SERVICE_TOKEN?.trim();
	if (!required) {
		return false;
	}
	return getRequestToken(request) === required;
}
