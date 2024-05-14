/*global*/
import type { Disposable } from 'vscode';
import type { IpcMessage } from '../../protocol';
import type { State } from '../../connection/protocol';
import { ConnectCommand, DidChangeNotification, UpdateConfigurationCommand } from '../../connection/protocol';
import { App } from '../shared/appBase';
import { DOM } from '../shared/dom';

export class ConnectionApp extends App<State> {
	constructor() {
		super('ConnectionApp');
	}

	protected override onInitialize() {
		this.updateState();
	}

	private onStartClicked() {
		this.sendCommand(ConnectCommand, undefined);
	}

	protected override onBind(): Disposable[] {
		const disposables = [
			...(super.onBind?.() ?? []),
			DOM.on('[data-action="connect"]', 'click', () => this.onStartClicked()),
		];
		return disposables;
	}

	protected override onMessageReceived(msg: IpcMessage) {
		switch (true) {
			case DidChangeNotification.is(msg):
				this.state = msg.params.state;
				this.setState(this.state);
				this.updateState();
				break;

			default:
				super.onMessageReceived?.(msg);
				break;
		}
	}

	private updateState() {
	}
}

new ConnectionApp();
// requestAnimationFrame(() => new Snow());
