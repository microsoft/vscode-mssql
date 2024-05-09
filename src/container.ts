import type { Disposable, ExtensionContext } from 'vscode';
import { WebviewsController } from './webviews/webviewsController';
import { memoize } from './system/decorators/memoize';
// import { EventEmitter, ExtensionMode } from 'vscode';
// import { getSupportedGitProviders, getSupportedRepositoryPathMappingProvider } from '@env/providers';
// import type { AIProviderService } from './ai/aiProviderService';
// import { Autolinks } from './annotations/autolinks';
// import { FileAnnotationController } from './annotations/fileAnnotationController';
// import { LineAnnotationController } from './annotations/lineAnnotationController';
// import { ActionRunners } from './api/actionRunners';
// import { setDefaultGravatarsStyle } from './avatars';
// import { CacheProvider } from './cache';
// import { GitCodeLensController } from './codelens/codeLensController';
// import type { ToggleFileAnnotationCommandArgs } from './commands/toggleFileAnnotations';
// import type { DateStyle, FileAnnotationType, ModeConfig } from './config';
// import { fromOutputLevel } from './config';
// import { Commands, extensionPrefix } from './constants';
// import { EventBus } from './eventBus';
// import { GitFileSystemProvider } from './git/fsProvider';
// import { GitProviderService } from './git/gitProviderService';
// import { LineHoverController } from './hovers/lineHoverController';
// import type { RepositoryPathMappingProvider } from './pathMapping/repositoryPathMappingProvider';
// import { DraftService } from './plus/drafts/draftsService';
// import { EnrichmentService } from './plus/focus/enrichmentService';
// import { FocusIndicator } from './plus/focus/focusIndicator';
// import { FocusProvider } from './plus/focus/focusProvider';
// import { AccountAuthenticationProvider } from './plus/gk/account/authenticationProvider';
// import { OrganizationService } from './plus/gk/account/organizationService';
// import { SubscriptionService } from './plus/gk/account/subscriptionService';
// import { ServerConnection } from './plus/gk/serverConnection';
// import type { CloudIntegrationService } from './plus/integrations/authentication/cloudIntegrationService';
// import { IntegrationAuthenticationService } from './plus/integrations/authentication/integrationAuthentication';
// import { IntegrationService } from './plus/integrations/integrationService';
// import type { GitHubApi } from './plus/integrations/providers/github/github';
// import type { GitLabApi } from './plus/integrations/providers/gitlab/gitlab';
// import { RepositoryIdentityService } from './plus/repos/repositoryIdentityService';
// import { registerAccountWebviewView } from './plus/webviews/account/registration';
// import { registerFocusWebviewCommands, registerFocusWebviewPanel } from './plus/webviews/focus/registration';
// import type { GraphWebviewShowingArgs } from './plus/webviews/graph/registration';
// import {
// 	registerGraphWebviewCommands,
// 	registerGraphWebviewPanel,
// 	registerGraphWebviewView,
// } from './plus/webviews/graph/registration';
// import { GraphStatusBarController } from './plus/webviews/graph/statusbar';
// import type { PatchDetailsWebviewShowingArgs } from './plus/webviews/patchDetails/registration';
// import {
// 	registerPatchDetailsWebviewPanel,
// 	registerPatchDetailsWebviewView,
// } from './plus/webviews/patchDetails/registration';
// import type { TimelineWebviewShowingArgs } from './plus/webviews/timeline/registration';
// import {
// 	registerTimelineWebviewCommands,
// 	registerTimelineWebviewPanel,
// 	registerTimelineWebviewView,
// } from './plus/webviews/timeline/registration';
// import { scheduleAddMissingCurrentWorkspaceRepos, WorkspacesService } from './plus/workspaces/workspacesService';
// import { StatusBarController } from './statusbar/statusBarController';
// import { executeCommand } from './system/command';
// import { configuration } from './system/configuration';
// import { log } from './system/decorators/log';
// import { memoize } from './system/decorators/memoize';
// import { Keyboard } from './system/keyboard';
// import { Logger } from './system/logger';
// import type { Storage } from './system/storage';
// import { TelemetryService } from './telemetry/telemetry';
// import { UsageTracker } from './telemetry/usageTracker';
// import { GitTerminalLinkProvider } from './terminal/linkProvider';
// import { GitDocumentTracker } from './trackers/documentTracker';
// import { LineTracker } from './trackers/lineTracker';
// import { DeepLinkService } from './uris/deepLinks/deepLinkService';
// import { UriService } from './uris/uriService';
// import { BranchesView } from './views/branchesView';
// import { CommitsView } from './views/commitsView';
// import { ContributorsView } from './views/contributorsView';
// import { DraftsView } from './views/draftsView';
// import { FileHistoryView } from './views/fileHistoryView';
// import { LineHistoryView } from './views/lineHistoryView';
// import { RemotesView } from './views/remotesView';
// import { RepositoriesView } from './views/repositoriesView';
// import { SearchAndCompareView } from './views/searchAndCompareView';
// import { StashesView } from './views/stashesView';
// import { TagsView } from './views/tagsView';
// import { ViewCommands } from './views/viewCommands';
// import { ViewFileDecorationProvider } from './views/viewDecorationProvider';
// import { WorkspacesView } from './views/workspacesView';
// import { WorktreesView } from './views/worktreesView';
// import { VslsController } from './vsls/vsls';
// import type { CommitDetailsWebviewShowingArgs } from './webviews/commitDetails/registration';
// import {
// 	registerCommitDetailsWebviewView,
// 	registerGraphDetailsWebviewView,
// } from './webviews/commitDetails/registration';
// import { registerHomeWebviewView } from './webviews/home/registration';
// import { RebaseEditorProvider } from './webviews/rebase/rebaseEditor';
// import { registerSettingsWebviewCommands, registerSettingsWebviewPanel } from './webviews/settings/registration';
// import type { WebviewViewProxy } from './webviews/webviewsController';
// import { WebviewsController } from './webviews/webviewsController';
import { registerConnectionWebviewPanel } from './webviews/connection/registration';
import { registerWelcomeWebviewPanel } from './webviews/welcome/registration';

export type Environment = 'dev' | 'staging' | 'production';

export class Container {
	static #instance: Container | undefined;
	static #proxy = new Proxy<Container>({} as Container, {
		get: function (target, prop) {
			// In case anyone has cached this instance
			// eslint-disable-next-line @typescript-eslint/no-unsafe-return
			if (Container.#instance != null) return (Container.#instance as any)[prop];

			// Allow access to config before we are initialized
			// if (prop === 'config') return configuration.getAll();

			// debugger;
			throw new Error('Container is not initialized');
		},
	});

	static create(
		context: ExtensionContext,
		// storage: Storage,
		// prerelease: boolean,
		version: string,
		// previousVersion: string | undefined,
	) {
		if (Container.#instance != null) throw new Error('Container is already initialized');

		Container.#instance = new Container(context, version); // storage, prerelease, version, previousVersion);
		return Container.#instance;
	}

	static get instance(): Container {
		return Container.#instance ?? Container.#proxy;
	}

	// private _onReady: EventEmitter<void> = new EventEmitter<void>();
	// get onReady(): Event<void> {
	// 	return this._onReady.event;
	// }

	// readonly BranchDateFormatting = {
	// 	dateFormat: undefined! as string | null,
	// 	dateStyle: undefined! as DateStyle,

	// 	reset: () => {
	// 		this.BranchDateFormatting.dateFormat = configuration.get('defaultDateFormat');
	// 		this.BranchDateFormatting.dateStyle = configuration.get('defaultDateStyle');
	// 	},
	// };

	// readonly CommitDateFormatting = {
	// 	dateFormat: null as string | null,
	// 	dateSource: 'authored',
	// 	dateStyle: 'relative',

	// 	reset: () => {
	// 		this.CommitDateFormatting.dateFormat = configuration.get('defaultDateFormat');
	// 		this.CommitDateFormatting.dateSource = configuration.get('defaultDateSource');
	// 		this.CommitDateFormatting.dateStyle = configuration.get('defaultDateStyle');
	// 	},
	// };

	// readonly CommitShaFormatting = {
	// 	length: 7,

	// 	reset: () => {
	// 		// Don't allow shas to be shortened to less than 5 characters
	// 		this.CommitShaFormatting.length = Math.max(5, configuration.get('advanced.abbreviatedShaLength'));
	// 	},
	// };

	// readonly PullRequestDateFormatting = {
	// 	dateFormat: null as string | null,
	// 	dateStyle: 'relative',

	// 	reset: () => {
	// 		this.PullRequestDateFormatting.dateFormat = configuration.get('defaultDateFormat');
	// 		this.PullRequestDateFormatting.dateStyle = configuration.get('defaultDateStyle');
	// 	},
	// };

	// readonly TagDateFormatting = {
	// 	dateFormat: null as string | null,
	// 	dateStyle: 'relative',

	// 	reset: () => {
	// 		this.TagDateFormatting.dateFormat = configuration.get('defaultDateFormat');
	// 		this.TagDateFormatting.dateStyle = configuration.get('defaultDateStyle');
	// 	},
	// };

	// private readonly _connection: ServerConnection;
	private _disposables: Disposable[];
	// private _terminalLinks: GitTerminalLinkProvider | undefined;
	private _webviews: WebviewsController;
	// private _focusIndicator: FocusIndicator | undefined;

	private constructor(
		context: ExtensionContext,
		version: string,
	) {
		this._context = context;
		this._version = version;

		this._disposables = [];
		this._disposables.push((this._webviews = new WebviewsController(this)));
		this._disposables.push(registerConnectionWebviewPanel(this._webviews));
		this._disposables.push(registerWelcomeWebviewPanel(this._webviews));
	}

	// deactivate() {
	// 	this._deactivating = true;
	// }

	// private _deactivating: boolean = false;
	// get deactivating() {
	// 	return this._deactivating;
	// }

	// private _ready: boolean = false;

	// async ready() {
	// 	if (this._ready) throw new Error('Container is already ready');

	// 	this._ready = true;
	// 	await this.registerGitProviders();
	// 	queueMicrotask(() => this._onReady.fire());
	// }


	// private onAnyConfigurationChanged(e: ConfigurationChangeEvent) {
	// 	if (!configuration.changedAny(e, extensionPrefix)) return;

	// 	this._mode = undefined;

	// 	if (configuration.changed(e, 'outputLevel')) {
	// 		Logger.logLevel = fromOutputLevel(configuration.get('outputLevel'));
	// 	}

	// 	if (configuration.changed(e, 'defaultGravatarsStyle')) {
	// 		setDefaultGravatarsStyle(configuration.get('defaultGravatarsStyle'));
	// 	}

	// 	if (configuration.changed(e, 'mode')) {
	// 		this.ensureModeApplied();
	// 	}
	// }

	// private readonly _accountView: WebviewViewProxy<[]>;
	// get accountView() {
	// 	return this._accountView;
	// }

	// private readonly _actionRunners: ActionRunners;
	// get actionRunners() {
	// 	return this._actionRunners;
	// }

	// private _cache: CacheProvider | undefined;
	// get cache() {
	// 	if (this._cache == null) {
	// 		this._disposables.push((this._cache = new CacheProvider(this)));
	// 	}

	// 	return this._cache;
	// }

	private readonly _context: ExtensionContext;
	get context() {
		return this._context;
	}

	// @memoize()
	// get debugging() {
	// 	return this._context.extensionMode === ExtensionMode.Development;
	// }

	// private readonly _deepLinks: DeepLinkService;
	// get deepLinks() {
	// 	return this._deepLinks;
	// }

	// private readonly _d
	// @memoize()
	// get env(): Environment {
	// 	if (this.prereleaseOrDebugging) {
	// 		const env = configuration.getAny('gitkraken.env');
	// 		if (env === 'dev') return 'dev';
	// 		if (env === 'staging') return 'staging';
	// 	}

	// 	return 'production';
	// }

	// private readonly _eventBus: EventBus;
	// get events() {
	// 	return this._eventBus;
	// }

	// private readonly _focusProvider: FocusProvider;
	// get focus(): FocusProvider {
	// 	return this._focusProvider;
	// }

	// private readonly _graphDetailsView: WebviewViewProxy<CommitDetailsWebviewShowingArgs>;
	// get graphDetailsView() {
	// 	return this._graphDetailsView;
	// }

	// private readonly _graphView: WebviewViewProxy<GraphWebviewShowingArgs>;
	// get graphView() {
	// 	return this._graphView;
	// }

	// private readonly _homeView: WebviewViewProxy<[]>;
	// get homeView() {
	// 	return this._homeView;
	// }

	@memoize()
	get id() {
		return this._context.extension.id;
	}

	// private _integrationAuthentication: IntegrationAuthenticationService | undefined;
	// get integrationAuthentication() {
	// 	if (this._integrationAuthentication == null) {
	// 		this._disposables.push(
	// 			(this._integrationAuthentication = new IntegrationAuthenticationService(this, this._connection)),
	// 		);
	// 	}

	// 	return this._integrationAuthentication;
	// }

	// private _integrations: IntegrationService | undefined;
	// get integrations(): IntegrationService {
	// 	if (this._integrations == null) {
	// 		this._disposables.push((this._integrations = new IntegrationService(this, this._connection)));
	// 	}
	// 	return this._integrations;
	// }

	// private readonly _keyboard: Keyboard;
	// get keyboard() {
	// 	return this._keyboard;
	// }

	// private readonly _lineAnnotationController: LineAnnotationController;
	// get lineAnnotations() {
	// 	return this._lineAnnotationController;
	// }

	// private readonly _lineHistoryView: LineHistoryView;
	// get lineHistoryView() {
	// 	return this._lineHistoryView;
	// }

	// private readonly _lineHoverController: LineHoverController;
	// get lineHovers() {
	// 	return this._lineHoverController;
	// }

	// private readonly _lineTracker: LineTracker;
	// get lineTracker() {
	// 	return this._lineTracker;
	// }

	// private _mode: ModeConfig | undefined;
	// get mode() {
	// 	if (this._mode == null) {
	// 		this._mode = configuration.get('modes')?.[configuration.get('mode.active')];
	// 	}
	// 	return this._mode;
	// }

	// private _organizations: OrganizationService;
	// get organizations() {
	// 	return this._organizations;
	// }

	// private readonly _patchDetailsView: WebviewViewProxy<PatchDetailsWebviewShowingArgs>;
	// get patchDetailsView() {
	// 	return this._patchDetailsView;
	// }

	// private readonly _prerelease;
	// get prerelease() {
	// 	return this._prerelease;
	// }

	// @memoize()
	// get prereleaseOrDebugging() {
	// 	return this._prerelease || this.debugging;
	// }

	// private readonly _rebaseEditor: RebaseEditorProvider;
	// get rebaseEditor() {
	// 	return this._rebaseEditor;
	// }

	// private readonly _remotesView: RemotesView;
	// get remotesView() {
	// 	return this._remotesView;
	// }

	// private readonly _repositoriesView: RepositoriesView;
	// get repositoriesView(): RepositoriesView {
	// 	return this._repositoriesView;
	// }

	// private _repositoryPathMapping: RepositoryPathMappingProvider | undefined;
	// get repositoryPathMapping() {
	// 	if (this._repositoryPathMapping == null) {
	// 		this._disposables.push((this._repositoryPathMapping = getSupportedRepositoryPathMappingProvider(this)));
	// 	}
	// 	return this._repositoryPathMapping;
	// }

	// private readonly _searchAndCompareView: SearchAndCompareView;
	// get searchAndCompareView() {
	// 	return this._searchAndCompareView;
	// }

	// private readonly _stashesView: StashesView;
	// get stashesView() {
	// 	return this._stashesView;
	// }

	// private readonly _statusBarController: StatusBarController;
	// get statusBar() {
	// 	return this._statusBarController;
	// }

	// private readonly _storage: Storage;
	// get storage(): Storage {
	// 	return this._storage;
	// }

	// private _subscription: SubscriptionService;
	// get subscription() {
	// 	return this._subscription;
	// }

	// private readonly _tagsView: TagsView;
	// get tagsView() {
	// 	return this._tagsView;
	// }

	// private readonly _telemetry: TelemetryService;
	// get telemetry(): TelemetryService {
	// 	return this._telemetry;
	// }

	// private readonly _timelineView: WebviewViewProxy<TimelineWebviewShowingArgs>;
	// get timelineView() {
	// 	return this._timelineView;
	// }

	// private readonly _uri: UriService;
	// get uri() {
	// 	return this._uri;
	// }

	// private readonly _usage: UsageTracker;
	// get usage(): UsageTracker {
	// 	return this._usage;
	// }

	private readonly _version: string;
	get version(): string {
		return this._version;
	}

	// private _viewCommands: ViewCommands | undefined;
	// get viewCommands() {
	// 	if (this._viewCommands == null) {
	// 		this._viewCommands = new ViewCommands(this);
	// 	}
	// 	return this._viewCommands;
	// }

	// private readonly _vsls: VslsController;
	// get vsls() {
	// 	return this._vsls;
	// }

	// private _workspaces: WorkspacesService | undefined;
	// get workspaces() {
	// 	if (this._workspaces == null) {
	// 		this._disposables.push((this._workspaces = new WorkspacesService(this, this._connection)));
	// 	}
	// 	return this._workspaces;
	// }

	// private _workspacesView: WorkspacesView;
	// get workspacesView() {
	// 	return this._workspacesView;
	// }

	// private readonly _worktreesView: WorktreesView;
	// get worktreesView() {
	// 	return this._worktreesView;
	// }

	// private ensureModeApplied() {
	// 	const mode = this.mode;
	// 	if (mode == null) {
	// 		configuration.clearOverrides();

	// 		return;
	// 	}

	// 	if (mode.annotations != null) {
	// 		let command: Commands | undefined;
	// 		switch (mode.annotations) {
	// 			case 'blame':
	// 				command = Commands.ToggleFileBlame;
	// 				break;
	// 			case 'changes':
	// 				command = Commands.ToggleFileChanges;
	// 				break;
	// 			case 'heatmap':
	// 				command = Commands.ToggleFileHeatmap;
	// 				break;
	// 		}

	// 		if (command != null) {
	// 			const commandArgs: ToggleFileAnnotationCommandArgs = {
	// 				type: mode.annotations as FileAnnotationType,
	// 				on: true,
	// 			};
	// 			// Make sure to delay the execution by a bit so that the configuration changes get propagated first
	// 			setTimeout(executeCommand, 50, command, commandArgs);
	// 		}
	// 	}

	// 	// Apply any required configuration overrides
	// 	configuration.applyOverrides({
	// 		get: (section, value) => {
	// 			if (mode.annotations != null) {
	// 				if (configuration.matches(`${mode.annotations}.toggleMode`, section, value)) {
	// 					value = 'window' as typeof value;
	// 					return value;
	// 				}

	// 				if (configuration.matches(mode.annotations, section, value)) {
	// 					value.toggleMode = 'window';
	// 					return value;
	// 				}
	// 			}

	// 			for (const key of ['codeLens', 'currentLine', 'hovers', 'statusBar'] as const) {
	// 				if (mode[key] != null) {
	// 					if (configuration.matches(`${key}.enabled`, section, value)) {
	// 						value = mode[key] as NonNullable<typeof value>;
	// 						return value;
	// 					} else if (configuration.matches(key, section, value)) {
	// 						value.enabled = mode[key]!;
	// 						return value;
	// 					}
	// 				}
	// 			}

	// 			return value;
	// 		},
	// 		getAll: cfg => {
	// 			if (mode.annotations != null) {
	// 				cfg[mode.annotations].toggleMode = 'window';
	// 			}

	// 			if (mode.codeLens != null) {
	// 				cfg.codeLens.enabled = mode.codeLens;
	// 			}

	// 			if (mode.currentLine != null) {
	// 				cfg.currentLine.enabled = mode.currentLine;
	// 			}

	// 			if (mode.hovers != null) {
	// 				cfg.hovers.enabled = mode.hovers;
	// 			}

	// 			if (mode.statusBar != null) {
	// 				cfg.statusBar.enabled = mode.statusBar;
	// 			}

	// 			return cfg;
	// 		},
	// 		onDidChange: e => {
	// 			// When the mode or modes change, we will simulate that all the affected configuration also changed
	// 			if (!configuration.changed(e, ['mode', 'modes'])) return e;

	// 			const originalAffectsConfiguration = e.affectsConfiguration;
	// 			return {
	// 				...e,
	// 				affectsConfiguration: (section, scope) =>
	// 					/^gitlens\.(?:modes?|blame|changes|heatmap|codeLens|currentLine|hovers|statusBar)\b/.test(
	// 						section,
	// 					)
	// 						? true
	// 						: originalAffectsConfiguration(section, scope),
	// 			};
	// 		},
	// 	});
	// }
}

export function isContainer(container: any): container is Container {
	return container instanceof Container;
}
