export type CommandCategory =
	| "status"
	| "tools"
	| "management"
	| "session"
	| "options"
	| "media"
	| "docks";

export type CommandScope = "both" | "text" | "native";

export type CommandChoice = {
	value: string;
	label?: string;
};

export type CommandArgument = {
	name: string;
	description: string;
	required?: boolean;
	captureRemaining?: boolean;
	choices?: readonly CommandChoice[];
};

export type CommandSpec = {
	name: string;
	description: string;
	category: CommandCategory;
	scope: CommandScope;
	aliases?: readonly string[];
	args?: readonly CommandArgument[];
};

export type CommandInputState = {
	isCommand: boolean;
	query: string;
	commandName: string | null;
	argsText: string;
	activeCommand: CommandSpec | null;
	suggestions: CommandSpec[];
};

const thinkingChoices = ["off", "minimal", "low", "medium", "high", "xhigh"] as const;

export const DEMO_COMMANDS: readonly CommandSpec[] = [
	{ name: "help", description: "Show available commands.", category: "status", scope: "both" },
	{ name: "commands", description: "List all slash commands.", category: "status", scope: "both" },
	{
		name: "tools",
		description: "List available runtime tools.",
		category: "status",
		scope: "both",
		args: [{ name: "mode", description: "compact or verbose", choices: toChoices(["compact", "verbose"]) }],
	},
	{
		name: "skill",
		description: "Run a skill by name.",
		category: "tools",
		scope: "both",
		args: [
			{ name: "name", description: "Skill name", required: true },
			{ name: "input", description: "Skill input", captureRemaining: true },
		],
	},
	{ name: "status", description: "Show current status.", category: "status", scope: "both" },
	{
		name: "allowlist",
		description: "List, add, or remove allowlist entries.",
		category: "management",
		scope: "text",
		args: [{ name: "command", description: "list, add, or remove", captureRemaining: true }],
	},
	{
		name: "approve",
		description: "Approve or deny exec requests.",
		category: "management",
		scope: "both",
		args: [
			{ name: "approval-id", description: "Approval id", required: true },
			{ name: "decision", description: "allow-once, allow-always, or deny", captureRemaining: true },
		],
	},
	{
		name: "context",
		description: "Explain how context is built and used.",
		category: "status",
		scope: "both",
		args: [{ name: "mode", description: "list, detail, or json", captureRemaining: true }],
	},
	{
		name: "btw",
		description: "Ask a side question without mutating future session context.",
		category: "tools",
		scope: "both",
		args: [{ name: "question", description: "Side question", captureRemaining: true }],
	},
	{
		name: "export-session",
		description: "Export the current session to HTML.",
		category: "status",
		scope: "both",
		aliases: ["/export"],
		args: [{ name: "path", description: "Output path" }],
	},
	{
		name: "tts",
		description: "Control text-to-speech.",
		category: "media",
		scope: "both",
		args: [
			{
				name: "action",
				description: "TTS action",
				choices: toChoices(["on", "off", "status", "provider", "limit", "summary", "audio", "help"]),
			},
			{ name: "value", description: "Provider, limit, or text", captureRemaining: true },
		],
	},
	{ name: "whoami", description: "Show your sender id.", category: "status", scope: "both", aliases: ["/id"] },
	{
		name: "session",
		description: "Manage session-level settings.",
		category: "session",
		scope: "both",
		args: [
			{ name: "action", description: "idle or max-age", choices: toChoices(["idle", "max-age"]) },
			{ name: "value", description: "Duration like 24h or off", captureRemaining: true },
		],
	},
	{
		name: "subagents",
		description: "List, kill, log, spawn, or steer subagent runs.",
		category: "management",
		scope: "both",
		args: [
			{ name: "action", description: "Subagent action", choices: toChoices(["list", "kill", "log", "info", "send", "steer", "spawn"]) },
			{ name: "target", description: "Run id, index, or session key" },
			{ name: "value", description: "Additional input", captureRemaining: true },
		],
	},
	{
		name: "acp",
		description: "Manage ACP sessions and runtime options.",
		category: "management",
		scope: "both",
		args: [
			{ name: "action", description: "ACP action", choices: toChoices(["spawn", "cancel", "steer", "close", "sessions", "status", "set-mode", "set", "cwd", "permissions", "timeout", "model", "reset-options", "doctor", "install", "help"]) },
			{ name: "value", description: "Action arguments", captureRemaining: true },
		],
	},
	{
		name: "focus",
		description: "Bind this conversation to a session target.",
		category: "management",
		scope: "both",
		args: [{ name: "target", description: "Subagent label, index, or session key", captureRemaining: true }],
	},
	{ name: "unfocus", description: "Remove the current conversation binding.", category: "management", scope: "both" },
	{ name: "agents", description: "List thread-bound agents for this session.", category: "management", scope: "both" },
	{
		name: "kill",
		description: "Kill a running subagent.",
		category: "management",
		scope: "both",
		args: [{ name: "target", description: "Label, run id, index, or all" }],
	},
	{
		name: "steer",
		description: "Send guidance to a running subagent.",
		category: "management",
		scope: "both",
		aliases: ["/tell"],
		args: [
			{ name: "target", description: "Label, run id, or index" },
			{ name: "message", description: "Steering message", captureRemaining: true },
		],
	},
	{
		name: "config",
		description: "Show or set config values.",
		category: "management",
		scope: "both",
		args: [
			{ name: "action", description: "show, get, set, or unset", choices: toChoices(["show", "get", "set", "unset"]) },
			{ name: "path", description: "Config path" },
			{ name: "value", description: "Value for set", captureRemaining: true },
		],
	},
	{
		name: "mcp",
		description: "Show or set OpenClaw MCP servers.",
		category: "management",
		scope: "both",
		args: [
			{ name: "action", description: "show, get, set, or unset", choices: toChoices(["show", "get", "set", "unset"]) },
			{ name: "path", description: "MCP server name" },
			{ name: "value", description: "JSON config for set", captureRemaining: true },
		],
	},
	{
		name: "plugins",
		description: "List, show, enable, or disable plugins.",
		category: "management",
		scope: "both",
		aliases: ["/plugin"],
		args: [
			{ name: "action", description: "list, show, get, enable, or disable", choices: toChoices(["list", "show", "get", "enable", "disable"]) },
			{ name: "path", description: "Plugin id or name" },
		],
	},
	{
		name: "debug",
		description: "Set runtime debug overrides.",
		category: "management",
		scope: "both",
		args: [
			{ name: "action", description: "show, reset, set, or unset", choices: toChoices(["show", "reset", "set", "unset"]) },
			{ name: "path", description: "Debug path" },
			{ name: "value", description: "Value for set", captureRemaining: true },
		],
	},
	{
		name: "usage",
		description: "Set usage footer or cost summary mode.",
		category: "options",
		scope: "both",
		args: [{ name: "mode", description: "off, tokens, full, or cost", choices: toChoices(["off", "tokens", "full", "cost"]) }],
	},
	{ name: "stop", description: "Stop the current run.", category: "session", scope: "both" },
	{ name: "restart", description: "Restart OpenClaw.", category: "tools", scope: "both" },
	{
		name: "activation",
		description: "Set group activation mode.",
		category: "management",
		scope: "both",
		args: [{ name: "mode", description: "mention or always", choices: toChoices(["mention", "always"]) }],
	},
	{
		name: "send",
		description: "Set send policy.",
		category: "management",
		scope: "both",
		args: [{ name: "mode", description: "on, off, or inherit", choices: toChoices(["on", "off", "inherit"]) }],
	},
	{ name: "reset", description: "Reset the current session.", category: "session", scope: "both" },
	{ name: "new", description: "Start a new session.", category: "session", scope: "both" },
	{
		name: "compact",
		description: "Compact the current session context.",
		category: "session",
		scope: "both",
		args: [{ name: "instructions", description: "Extra compaction instructions", captureRemaining: true }],
	},
	{
		name: "think",
		description: "Set thinking level.",
		category: "options",
		scope: "both",
		aliases: ["/thinking", "/t"],
		args: [{ name: "level", description: "Thinking level", choices: toChoices(thinkingChoices) }],
	},
	{
		name: "verbose",
		description: "Toggle verbose mode.",
		category: "options",
		scope: "both",
		aliases: ["/v"],
		args: [{ name: "mode", description: "on or off", choices: toChoices(["on", "off"]) }],
	},
	{
		name: "fast",
		description: "Toggle fast mode.",
		category: "options",
		scope: "both",
		args: [{ name: "mode", description: "status, on, or off", choices: toChoices(["status", "on", "off"]) }],
	},
	{
		name: "reasoning",
		description: "Toggle reasoning visibility.",
		category: "options",
		scope: "both",
		aliases: ["/reason"],
		args: [{ name: "mode", description: "on, off, or stream", choices: toChoices(["on", "off", "stream"]) }],
	},
	{
		name: "elevated",
		description: "Toggle elevated mode.",
		category: "options",
		scope: "both",
		aliases: ["/elev"],
		args: [{ name: "mode", description: "on, off, ask, or full", choices: toChoices(["on", "off", "ask", "full"]) }],
	},
	{
		name: "exec",
		description: "Set exec defaults for this session.",
		category: "options",
		scope: "both",
		args: [
			{ name: "host", description: "sandbox, gateway, or node", choices: toChoices(["sandbox", "gateway", "node"]) },
			{ name: "security", description: "deny, allowlist, or full", choices: toChoices(["deny", "allowlist", "full"]) },
			{ name: "ask", description: "off, on-miss, or always", choices: toChoices(["off", "on-miss", "always"]) },
			{ name: "node", description: "Node id or name" },
		],
	},
	{
		name: "model",
		description: "Show or set the model.",
		category: "options",
		scope: "both",
		args: [{ name: "model", description: "Model id" }],
	},
	{
		name: "models",
		description: "List model providers or provider models.",
		category: "options",
		scope: "both",
		args: [{ name: "query", description: "Provider or model filter", captureRemaining: true }],
	},
	{
		name: "queue",
		description: "Adjust queue settings.",
		category: "options",
		scope: "both",
		args: [
			{ name: "mode", description: "Queue mode", choices: toChoices(["steer", "interrupt", "followup", "collect", "steer-backlog"]) },
			{ name: "debounce", description: "Debounce duration like 500ms or 2s" },
			{ name: "cap", description: "Queue cap" },
			{ name: "drop", description: "Drop policy", choices: toChoices(["old", "new", "summarize"]) },
		],
	},
	{
		name: "bash",
		description: "Run host shell commands.",
		category: "tools",
		scope: "text",
		args: [{ name: "command", description: "Shell command", captureRemaining: true }],
	},
	{
		name: "dock-cf-do-channel",
		description: "Route replies to the Cloudflare DO channel.",
		category: "docks",
		scope: "both",
		aliases: ["/dock_cf_do_channel"],
	},
] as const;

const commandLookup = new Map<string, CommandSpec>();
const commandSearchRows = DEMO_COMMANDS.flatMap((command) => {
	commandLookup.set(command.name, command);
	const rows = [{ token: command.name, command }];
	for (const alias of command.aliases ?? []) {
		const token = alias.replace(/^\//, "");
		commandLookup.set(token, command);
		rows.push({ token, command });
	}
	return rows;
});

export function analyzeCommandInput(input: string): CommandInputState {
	const trimmed = input.trimStart();
	if (!trimmed.startsWith("/")) {
		return {
			isCommand: false,
			query: "",
			commandName: null,
			argsText: "",
			activeCommand: null,
			suggestions: [],
		};
	}

	const withoutSlash = trimmed.slice(1);
	const firstSpaceIndex = withoutSlash.search(/\s/);
	const hasArgs = firstSpaceIndex >= 0;
	const commandName = (hasArgs ? withoutSlash.slice(0, firstSpaceIndex) : withoutSlash).trim().toLowerCase();
	const argsText = hasArgs ? withoutSlash.slice(firstSpaceIndex).trim() : "";
	const activeCommand = commandLookup.get(commandName) ?? null;
	const query = hasArgs ? commandName : withoutSlash.trim().toLowerCase();
	const suggestions = searchCommands(query);

	return {
		isCommand: true,
		query,
		commandName: commandName || null,
		argsText,
		activeCommand,
		suggestions,
	};
}

export function searchCommands(query: string): CommandSpec[] {
	const normalized = query.trim().toLowerCase();
	if (!normalized) {
		return [...DEMO_COMMANDS].slice(0, 8);
	}
	const exactMatches: CommandSpec[] = [];
	const prefixMatches: CommandSpec[] = [];
	const fuzzyMatches: CommandSpec[] = [];
	const seen = new Set<string>();

	for (const row of commandSearchRows) {
		if (seen.has(row.command.name) && row.token !== row.command.name) {
			continue;
		}
		if (row.token === normalized) {
			if (!seen.has(row.command.name)) {
				exactMatches.push(row.command);
				seen.add(row.command.name);
			}
			continue;
		}
		if (row.token.startsWith(normalized)) {
			if (!seen.has(row.command.name)) {
				prefixMatches.push(row.command);
				seen.add(row.command.name);
			}
			continue;
		}
		if (row.token.includes(normalized) || row.command.description.toLowerCase().includes(normalized)) {
			if (!seen.has(row.command.name)) {
				fuzzyMatches.push(row.command);
				seen.add(row.command.name);
			}
		}
	}

	return [...exactMatches, ...prefixMatches, ...fuzzyMatches].slice(0, 8);
}

export function buildCommandUsage(command: CommandSpec): string {
	const parts = [`/${command.name}`];
	for (const arg of command.args ?? []) {
		const token = arg.captureRemaining ? `${arg.name}...` : arg.name;
		parts.push(arg.required ? `<${token}>` : `[${token}]`);
	}
	return parts.join(" ");
}

export function resolveNextArgument(command: CommandSpec, argsText: string): CommandArgument | null {
	const args = command.args ?? [];
	if (args.length === 0) {
		return null;
	}
	const tokens = argsText.trim() ? argsText.trim().split(/\s+/) : [];
	let tokenIndex = 0;
	for (const arg of args) {
		if (arg.captureRemaining) {
			return tokenIndex >= tokens.length ? arg : null;
		}
		if (tokenIndex >= tokens.length) {
			return arg;
		}
		tokenIndex += 1;
	}
	return null;
}

function toChoices(values: readonly string[]): readonly CommandChoice[] {
	return values.map((value) => ({ value }));
}
