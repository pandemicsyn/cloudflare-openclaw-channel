const CORS_HEADERS = {
	"access-control-allow-origin": "*",
	"access-control-allow-methods": "GET,POST,OPTIONS",
	"access-control-allow-headers": "authorization,content-type",
};

export function json(data: unknown, init?: ResponseInit): Response {
	return new Response(JSON.stringify(data, null, 2), {
		...init,
		headers: {
			"content-type": "application/json; charset=utf-8",
			...CORS_HEADERS,
			...(init?.headers ?? {}),
		},
	});
}

export class JsonRequestError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "JsonRequestError";
	}
}

export async function readJson<T>(request: Request): Promise<T> {
	try {
		return (await request.json()) as T;
	} catch {
		throw new JsonRequestError("invalid json body");
	}
}

export function badRequest(message: string, status = 400): Response {
	return json({ error: message }, { status });
}

export function corsPreflight(): Response {
	return new Response(null, {
		status: 204,
		headers: CORS_HEADERS,
	});
}
