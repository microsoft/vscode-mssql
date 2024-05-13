/*global*/
import type { Disposable } from 'vscode';
import type { IpcMessage } from '../../protocol';
import type { State } from '../../connection/protocol';
import { ConnectCommand, DidChangeNotification, DidChangeOrgSettings, UpdateConfigurationCommand } from '../../connection/protocol';
import { App } from '../shared/appBase';
import { DOM } from '../shared/dom';


export class ConnectionApp extends App<State> {
	constructor() {
		super('ConnectionApp');

		console.log('Connection.ts loading here....');
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
			DOM.on('[data-feature]', 'change', (e, target: HTMLInputElement) => this.onFeatureToggled(e, target)),
			DOM.on('[data-requires="repo"]', 'click', (e, target: HTMLElement) => this.onRepoFeatureClicked(e, target)),

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

			case DidChangeOrgSettings.is(msg):
				this.state.orgSettings = msg.params.orgSettings;
				this.setState(this.state);
				this.updateOrgSettings();
				break;

			default:
				super.onMessageReceived?.(msg);
				break;
		}
	}

	private onRepoFeatureClicked(e: MouseEvent, _target: HTMLElement) {
		if (this.state.repoFeaturesBlocked ?? false) {
			e.preventDefault();
			e.stopPropagation();
			return false;
		}

		return true;
	}

	private onFeatureToggled(e: Event, target: HTMLElement) {
		const feature = target.dataset.feature;
		if (!feature) return;

		let type: keyof State['config'];
		switch (feature) {
			case 'blame':
				type = 'currentLine';
				break;
			case 'codelens':
				type = 'codeLens';
				break;
			default:
				return;
		}

		const enabled = (target as HTMLInputElement).checked;
		this.state.config[type] = enabled;
		this.sendCommand(UpdateConfigurationCommand, { type: type, value: enabled });
		this.updateFeatures();
	}

	private updateState() {
		this.updateVersion();
		this.updateFeatures();
		this.updateRepoState();
		this.updateAccountState();
		this.updatePromo();
		this.updateOrgSettings();
	}

	private updateOrgSettings() {
		const {
			orgSettings: { drafts, ai },
		} = this.state;

		document.body.dataset.orgDrafts = drafts ? 'allowed' : 'blocked';
		document.body.dataset.orgAi = ai ? 'allowed' : 'blocked';
	}

	private updatePromo() {
		const { canShowPromo } = this.state;
		document.getElementById('promo')!.hidden = !(canShowPromo ?? false);
	}

	private updateVersion() {
		document.getElementById('version')!.textContent = this.state.version;
	}

	private updateFeatures() {
		// const { config } = this.state;

		// const $el = document.getElementById('blame') as BlameSvg;
		// $el.inline = config.currentLine ?? false;
		// $el.codelens = config.codeLens ?? false;

		// let $input = document.getElementById('inline-blame') as HTMLInputElement;
		// $input.checked = config.currentLine ?? false;

		// $input = document.getElementById('codelens') as HTMLInputElement;
		// $input.checked = config.codeLens ?? false;
	}

	private updateRepoState() {
		const { repoFeaturesBlocked } = this.state;
		document.body.dataset.repos = repoFeaturesBlocked ? 'blocked' : 'allowed';
	}

	private updateAccountState() {
		const { isTrialOrPaid } = this.state;
		// for (const el of document.querySelectorAll('[data-visible="try-pro"]')) {
		// 	(el as HTMLElement).hidden = isTrialOrPaid ?? false;
		// }
		// document.getElementById('try-pro')!.hidden = isTrialOrPaid ?? false;
	}
}

new ConnectionApp();
// requestAnimationFrame(() => new Snow());
