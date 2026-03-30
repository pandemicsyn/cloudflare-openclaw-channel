import { useEffect, useMemo, useState, type KeyboardEvent } from "react";

import {
	analyzeCommandInput,
	buildCommandUsage,
	resolveNextArgument,
	type CommandChoice,
	type CommandSpec,
} from "../command-catalog";

type ComposerProps = {
	draft: string;
	isConnected: boolean;
	onDraftChange: (value: string) => void;
	onSend: () => void;
};

export function Composer(props: ComposerProps) {
	const commandState = useMemo(() => analyzeCommandInput(props.draft), [props.draft]);
	const [selectedIndex, setSelectedIndex] = useState(0);

	useEffect(() => {
		setSelectedIndex(0);
	}, [commandState.query, commandState.activeCommand?.name]);

	const isSuggestMode = commandState.isCommand && !commandState.activeCommand;
	const selectedSuggestion =
		commandState.suggestions[Math.min(selectedIndex, Math.max(commandState.suggestions.length - 1, 0))] ?? null;
	const activeCommand = commandState.activeCommand ?? selectedSuggestion;
	const nextArgument = commandState.activeCommand
		? resolveNextArgument(commandState.activeCommand, commandState.argsText)
		: null;

	const applyCommand = (command: CommandSpec) => {
		const leadingWhitespace = props.draft.match(/^\s*/)?.[0] ?? "";
		const suffix = command.args && command.args.length > 0 ? " " : "";
		props.onDraftChange(`${leadingWhitespace}/${command.name}${suffix}`);
	};

	const appendChoice = (choice: CommandChoice) => {
		if (!commandState.activeCommand) {
			return;
		}
		const base = props.draft.trimEnd();
		const needsSpace = base.length > 0 && !base.endsWith(" ");
		props.onDraftChange(`${base}${needsSpace ? " " : ""}${choice.value} `);
	};

	const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
		if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
			event.preventDefault();
			if (props.isConnected) {
				props.onSend();
			}
			return;
		}

		if (!isSuggestMode || commandState.suggestions.length === 0) {
			return;
		}

		if (event.key === "ArrowDown") {
			event.preventDefault();
			setSelectedIndex((current) => (current + 1) % commandState.suggestions.length);
			return;
		}

		if (event.key === "ArrowUp") {
			event.preventDefault();
			setSelectedIndex((current) =>
				current === 0 ? commandState.suggestions.length - 1 : current - 1,
			);
			return;
		}

		if (event.key === "Tab" || (event.key === "Enter" && !event.shiftKey && !event.altKey)) {
			if (!selectedSuggestion) {
				return;
			}
			event.preventDefault();
			applyCommand(selectedSuggestion);
		}
	};

	return (
		<div className="composer frame">
			<div className="panel-heading">
				<h2>Composer</h2>
				<p>Send through the session helper so pending and ack state stay consistent.</p>
			</div>
			<div className="composer-shell">
				<textarea
					value={props.draft}
					onChange={(event) => props.onDraftChange(event.target.value)}
					onKeyDown={handleKeyDown}
					placeholder={props.isConnected ? "Type a dramatic prompt or slash command..." : "Connect before sending."}
					disabled={!props.isConnected}
				/>
				{commandState.isCommand ? (
					<div className="command-deck" aria-live="polite">
						<div className="command-deck-header">
							<div>
								<span className="command-eyebrow">
									{isSuggestMode ? "Command completion" : "Command hinting"}
								</span>
								<strong>
									{activeCommand ? `/${activeCommand.name}` : "Shared OpenClaw slash commands"}
								</strong>
							</div>
							<span className="command-shortcut">
								{isSuggestMode ? "Tab or Enter completes" : "Cmd/Ctrl+Enter transmits"}
							</span>
						</div>

						{isSuggestMode ? (
							commandState.suggestions.length === 0 ? (
								<div className="command-empty">No matching commands in the local catalog.</div>
							) : (
								<div className="command-list" role="listbox" aria-label="Command suggestions">
									{commandState.suggestions.map((command, index) => (
										<button
											key={command.name}
											type="button"
											className={`command-option ${index === selectedIndex ? "command-option-active" : ""}`}
											onClick={() => applyCommand(command)}
										>
											<div className="command-option-header">
												<code>{`/${command.name}`}</code>
												<span className="command-badge">{formatCategory(command.category)}</span>
											</div>
											<p>{command.description}</p>
											<div className="command-option-meta">
												<span>{formatScope(command.scope)}</span>
												<span>{buildCommandUsage(command)}</span>
											</div>
										</button>
									))}
								</div>
							)
						) : activeCommand ? (
							<div className="command-detail">
								<p className="command-description">{activeCommand.description}</p>
								<code className="command-usage">{buildCommandUsage(activeCommand)}</code>
								<div className="command-meta-row">
									<span className="command-badge">{formatCategory(activeCommand.category)}</span>
									<span className="command-badge command-badge-muted">{formatScope(activeCommand.scope)}</span>
									{activeCommand.aliases?.map((alias) => (
										<span key={alias} className="command-badge command-badge-muted">
											{alias}
										</span>
									))}
								</div>
								{nextArgument ? (
									<div className="command-argument-card">
										<div className="command-argument-copy">
											<span className="command-argument-label">Next argument</span>
											<strong>{nextArgument.name}</strong>
											<p>{nextArgument.description}</p>
										</div>
										{nextArgument.choices && nextArgument.choices.length > 0 ? (
											<div className="command-choice-row">
												{nextArgument.choices.map((choice) => (
													<button
														key={choice.value}
														type="button"
														className="command-choice"
														onClick={() => appendChoice(choice)}
													>
														{choice.label ?? choice.value}
													</button>
												))}
											</div>
										) : null}
									</div>
								) : (
									<div className="command-ready">Command looks complete. Send it when ready.</div>
								)}
							</div>
						) : null}
					</div>
				) : null}
			</div>
			<div className="button-row composer-actions">
				<button className="btn btn-primary" onClick={props.onSend} disabled={!props.isConnected}>
					Transmit
				</button>
				<span className="composer-shortcut">Cmd/Ctrl+Enter to transmit</span>
			</div>
		</div>
	);
}

function formatCategory(category: CommandSpec["category"]): string {
	return category.replace(/-/g, " ");
}

function formatScope(scope: CommandSpec["scope"]): string {
	if (scope === "text") {
		return "text only";
	}
	if (scope === "native") {
		return "native only";
	}
	return "text + native";
}
