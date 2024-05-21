import type { ConfigurationChangeEvent } from 'vscode';
import { Disposable } from 'vscode';
import type { ContextKeys } from '../../constants';
import type { Container } from '../../container';
import { configuration } from '../../system/configuration';
import { onDidChangeContext } from '../../system/context';
import type { IpcMessage } from '../protocol';
import type { WebviewHost, WebviewProvider } from '../webviewProvider';
import type { State, UpdateConfigurationParams } from './protocol';
import { ConnectCommand, DidChangeNotification, UpdateConfigurationCommand } from './protocol';

export class ConnectionWebviewProvider implements WebviewProvider<State> {
	private readonly _disposable: Disposable;

	constructor(
		private readonly container: Container,
		private readonly host: WebviewHost,
	) {
		this._disposable = Disposable.from(
			configuration.onDidChange(this.onConfigurationChanged, this),
			onDidChangeContext(this.onContextChanged, this),
		);
	}

	dispose() {
		this._disposable.dispose();
	}

	includeBootstrap(): Promise<State> {
		return this.getState();
	}

	onReloaded() {
		void this.notifyDidChange();
	}

	private onContextChanged(key: ContextKeys) {
		// if (['mssql:connect'].includes(key)) {
		// 	this.notifyDidChangeOrgSettings();
		// }
	}

	private onConfigurationChanged(e: ConfigurationChangeEvent) {
		// if (!configuration.changed(e, 'codeLens.enabled') && !configuration.changed(e, 'currentLine.enabled')) return;

		void this.notifyDidChange();
	}

	onMessageReceived(e: IpcMessage) {
		switch (true) {
			case UpdateConfigurationCommand.is(e):
				this.updateConfiguration(e.params);
				break;
			case ConnectCommand.is(e):
				console.log('ConnectCommand');
				break;
		}
	}

	private async getState(): Promise<State> {
		return {
			...this.host.baseWebviewState,
			version: this.container.version,
			// Make sure to get the raw config so to avoid having the mode mixed in
			config: {
				codeLens: undefined,
				currentLine: true, // configuration.get('currentLine.enabled', undefined, true, true),
			}
		};
	}

	private updateConfiguration(params: UpdateConfigurationParams) {
	}

	private async notifyDidChange() {
		void this.host.notify(DidChangeNotification, { state: await this.getState() });
	}
}
