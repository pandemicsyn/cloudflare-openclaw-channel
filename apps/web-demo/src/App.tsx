import { useEffect, useRef } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { ApprovalDock } from "./components/ApprovalDock";
import { Composer } from "./components/Composer";
import { ConnectionPanel } from "./components/ConnectionPanel";
import { StatusRail } from "./components/StatusRail";
import { ThreadHistoryPanel } from "./components/ThreadHistoryPanel";
import { ThreadRoutePanel } from "./components/ThreadRoutePanel";
import { TranscriptPanel } from "./components/TranscriptPanel";
import { useChannelDemoSession } from "./hooks/useChannelDemoSession";

export default function App() {
	const demo = useChannelDemoSession();
	const transcriptRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		transcriptRef.current?.scrollTo({
			top: transcriptRef.current.scrollHeight,
			behavior: "smooth",
		});
	}, [demo.sessionState.messages, demo.sessionState.pendingSends, demo.sessionState.statuses]);

	return (
		<div className="app-shell">
			<div className="backdrop-grid" />
			<div className="glow glow-cyan" />
			<div className="glow glow-pink" />
			<Card className="hero-panel frame">
				<CardHeader>
					<div>
						<p className="eyebrow">Cloudflare Durable Object Channel</p>
						<h1>Neon bridge operator console</h1>
						<p className="hero-copy">
							A best-practice demo UI built on the headless client SDK and the higher-level session
							helper.
						</p>
						{demo.debugEnabled ? <p className="hero-copy">Debug logging enabled (`cfDebug=1`).</p> : null}
					</div>
				</CardHeader>
				<CardContent className="hero-metrics">
					<div className="metric-card">
						<span className="metric-label">Link state</span>
						<Badge className={`metric-value metric-pill state-${demo.sessionState.connection.connection}`} variant="outline">
							{demo.sessionState.connection.connection}
						</Badge>
					</div>
					<div className="metric-card">
						<span className="metric-label">Thread</span>
						<Badge className="metric-value metric-pill" variant="outline">{demo.config.conversationId}</Badge>
					</div>
					<div className="metric-card">
						<span className="metric-label">Route</span>
						<Badge className="metric-value metric-pill" variant="outline">{demo.sessionState.threadRoute?.mode ?? "auto"}</Badge>
					</div>
				</CardContent>
			</Card>

			<main className="dashboard-grid">
				<div className="control-column">
					<ConnectionPanel
						config={demo.config}
						connection={demo.sessionState.connection}
						runtimeError={demo.runtimeError}
						onConfigChange={(field, value) =>
							demo.setConfig((current) => ({
								...current,
								[field]: value,
							}))
						}
						onConnect={() => void demo.connect()}
						onDisconnect={demo.disconnect}
					/>
					<ThreadHistoryPanel
						history={demo.threadHistory}
						currentConversationId={demo.config.conversationId}
						isConnected={demo.isConnected}
						onOpenThread={(conversationId) => void demo.openThread(conversationId)}
						onForgetThread={demo.forgetThread}
					/>
					<ThreadRoutePanel
						config={demo.config}
						threadRoute={demo.sessionState.threadRoute}
						threadCatalog={demo.sessionState.threadCatalog}
						isConnected={demo.isConnected}
						onConfigChange={(field, value) =>
							demo.setConfig((current) => ({
								...current,
								[field]: value,
							}))
						}
						onApply={() => void demo.configureThreadRoute()}
						onRefresh={() => void demo.inspectThreadRoute()}
					/>
					<ApprovalDock
						state={demo.sessionState}
						onResolveApproval={(approvalId, decision) => void demo.resolveApproval(approvalId, decision)}
					/>
				</div>

				<div className="transcript-column">
					<TranscriptPanel state={demo.sessionState} transcriptRef={transcriptRef} />
					<Composer
						draft={demo.draft}
						isConnected={demo.isConnected}
						onDraftChange={demo.setDraft}
						onSend={() => void demo.sendDraft()}
					/>
				</div>

				<StatusRail statuses={demo.sessionState.statuses} />
			</main>
		</div>
	);
}
