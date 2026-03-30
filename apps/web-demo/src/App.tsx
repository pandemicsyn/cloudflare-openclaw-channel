import { useEffect, useRef } from "react";

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
				<header className="hero-panel frame">
					<div>
						<p className="eyebrow">Cloudflare Durable Object Channel</p>
						<h1>Neon bridge operator console</h1>
						<p className="hero-copy">
							A best-practice demo UI built on the headless client SDK and the higher-level session
							helper.
						</p>
						{demo.debugEnabled ? <p className="hero-copy">Debug logging enabled (`cfDebug=1`).</p> : null}
					</div>
				<div className="hero-metrics">
					<div className="metric-card">
						<span className="metric-label">Link state</span>
						<span className={`metric-value state-${demo.sessionState.connection.connection}`}>
							{demo.sessionState.connection.connection}
						</span>
					</div>
					<div className="metric-card">
						<span className="metric-label">Thread</span>
						<span className="metric-value">{demo.config.conversationId}</span>
					</div>
					<div className="metric-card">
						<span className="metric-label">Route</span>
						<span className="metric-value">{demo.sessionState.threadRoute?.mode ?? "auto"}</span>
					</div>
				</div>
			</header>

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
