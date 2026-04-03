import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { ThreadHistoryEntry } from "../demo-state";

type ThreadHistoryPanelProps = {
	history: ThreadHistoryEntry[];
	currentConversationId: string;
	isConnected: boolean;
	onOpenThread: (conversationId: string) => void;
	onForgetThread: (conversationId: string) => void;
};

export function ThreadHistoryPanel(props: ThreadHistoryPanelProps) {
	return (
		<Card className="frame thread-history-panel">
			<CardHeader className="panel-heading">
				<CardTitle>Thread Deck</CardTitle>
				<CardDescription>Recent thread keys, labels, and resolved routes stored locally in the demo client.</CardDescription>
			</CardHeader>
			<CardContent>

			{props.history.length === 0 ? (
				<div className="thread-history-empty">No recent threads yet. Connect and talk in a few threads to build a deck.</div>
			) : (
				<div className="thread-history-list">
					{props.history.map((entry) => {
						const isActive = entry.conversationId === props.currentConversationId;
						return (
							<article
								key={entry.conversationId}
								className={`thread-history-card ${isActive ? "thread-history-card-active" : ""}`}
							>
								<div className="thread-history-card-top">
									<div>
										<strong>{entry.label ?? entry.conversationId}</strong>
										<code>{entry.conversationId}</code>
									</div>
									<Badge className={`route-badge route-badge-${entry.routeSource ?? "idle"}`} variant="outline">
										{entry.routeMode ?? "thread"}
									</Badge>
								</div>
								<div className="thread-history-meta">
									<span>{entry.resolvedAgentId ? `agent ${entry.resolvedAgentId}` : "agent not resolved"}</span>
									<span>{formatThreadSeenAt(entry.lastSeenAt)}</span>
								</div>
								{entry.lastMessagePreview ? (
									<p className="thread-history-preview">{entry.lastMessagePreview}</p>
								) : null}
								{entry.recentMessages && entry.recentMessages.length > 0 ? (
									<div className="thread-history-snippets">
										{entry.recentMessages.map((message, index) => (
											<div
												key={`${entry.conversationId}:${message.timestamp}:${index}`}
												className={`thread-history-snippet role-${message.role}`}
											>
												<span>{message.role}</span>
												<p>{message.text}</p>
											</div>
										))}
									</div>
								) : null}
								<div className="button-row">
									<Button
										type="button"
										variant="outline"
										className="btn btn-secondary"
										onClick={() => props.onOpenThread(entry.conversationId)}
									>
										{isActive && props.isConnected ? "Reconnect" : "Open Thread"}
									</Button>
									<Button
										type="button"
										variant="outline"
										className="btn btn-secondary"
										onClick={() => props.onForgetThread(entry.conversationId)}
									>
										Forget
									</Button>
								</div>
							</article>
						);
					})}
				</div>
			)}
			</CardContent>
		</Card>
	);
}

function formatThreadSeenAt(timestamp: string): string {
	try {
		return new Date(timestamp).toLocaleString([], {
			month: "short",
			day: "numeric",
			hour: "2-digit",
			minute: "2-digit",
		});
	} catch {
		return timestamp;
	}
}
