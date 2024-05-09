import type { ConfigurationChangeEvent } from 'vscode';
import { Disposable, workspace } from 'vscode';
import type { ContextKeys } from '../../constants';
import type { Container } from '../../container';
import { configuration } from '../../system/configuration';
import { getContext, onDidChangeContext } from '../../system/context';
import type { IpcMessage } from '../protocol';
import type { WebviewHost, WebviewProvider } from '../webviewProvider';
import type { State, UpdateConfigurationParams } from './protocol';
import { DidChangeNotification, DidChangeOrgSettings, UpdateConfigurationCommand } from './protocol';

const emptyDisposable = Object.freeze({
	dispose: () => {
		/* noop */
	},
});

export class WelcomeWebviewProvider implements WebviewProvider<State> {
	private readonly _disposable: Disposable;

	constructor(
		private readonly container: Container,
		private readonly host: WebviewHost,
	) {
		this._disposable = Disposable.from(
			configuration.onDidChange(this.onConfigurationChanged, this),
			!workspace.isTrusted
				? workspace.onDidGrantWorkspaceTrust(() => this.notifyDidChange(), this)
				: emptyDisposable,
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

	private getOrgSettings(): State['orgSettings'] {
		return {
			ai: getContext<boolean>('mssql:gk:organization:ai:enabled', false),
			drafts: getContext<boolean>('mssql:gk:organization:drafts:enabled', false),
		};
	}

	private onContextChanged(key: ContextKeys) {
		if (['gitlens:gk:organization:ai:enabled', 'gitlens:gk:organization:drafts:enabled'].includes(key)) {
			this.notifyDidChangeOrgSettings();
		}
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
			},
			repoFeaturesBlocked:
				!workspace.isTrusted,
			isTrialOrPaid: false,
			canShowPromo: false,
			orgSettings: this.getOrgSettings(),
		};
	}

	private updateConfiguration(params: UpdateConfigurationParams) {
		//void configuration.updateEffective(`${params.type}.enabled`, params.value);
	}

	private async notifyDidChange() {
		void this.host.notify(DidChangeNotification, { state: await this.getState() });
	}

	private notifyDidChangeOrgSettings() {
		void this.host.notify(DidChangeOrgSettings, {
			orgSettings: this.getOrgSettings(),
		});
	}
}
