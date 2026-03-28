type ComposerProps = {
	draft: string;
	isConnected: boolean;
	onDraftChange: (value: string) => void;
	onSend: () => void;
};

export function Composer(props: ComposerProps) {
	return (
		<div className="composer frame">
			<div className="panel-heading">
				<h2>Composer</h2>
				<p>Send through the session helper so pending and ack state stay consistent.</p>
			</div>
			<textarea
				value={props.draft}
				onChange={(event) => props.onDraftChange(event.target.value)}
				placeholder={props.isConnected ? "Type a dramatic prompt..." : "Connect before sending."}
				disabled={!props.isConnected}
			/>
			<div className="button-row">
				<button className="btn btn-primary" onClick={props.onSend} disabled={!props.isConnected}>
					Transmit
				</button>
			</div>
		</div>
	);
}
