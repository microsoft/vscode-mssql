import { ILogger, LogImportance } from '../logger/Logger';
import { IConfigurationProvider } from './ConfigurationProvider';
import { FabricEnvironmentName, FabricEnvironmentSettings } from './FabricEnvironment';
import * as vscode from 'vscode';

export interface IFabricEnvironmentProvider {
    getCurrent(): FabricEnvironmentSettings;
    onDidEnvironmentChange: vscode.Event<void>;
}

export const FABRIC_ENVIRONMENT_KEY = 'Environment';
export const FABRIC_ENVIRONMENT_DEFAULT_VALUE = 'PROD';

export class FabricEnvironmentProvider implements IFabricEnvironmentProvider {
    private disposables: vscode.Disposable[] = [];

    constructor(
        private configService: IConfigurationProvider, 
        private logger: ILogger
    ) {
        // Add a listener to the configuration provider to log when the environment changes
        this.disposables.push(this.configService.onDidConfigurationChange((key: string) => {
            if (key === FABRIC_ENVIRONMENT_KEY) {
                this.onDidEnvironmentChangeEmitter.fire();
            }
        }));
    }

    getCurrent(): FabricEnvironmentSettings {
        const configValue = this.configService.get<string>(FABRIC_ENVIRONMENT_KEY, FABRIC_ENVIRONMENT_DEFAULT_VALUE);
        return getFabricEnvironment(configValue, this.logger);
    }

    public dispose(): void {
        if (this.disposables) {
            this.disposables.forEach(item => item.dispose());
        }
        this.disposables = [];
    }

    private readonly onDidEnvironmentChangeEmitter = new vscode.EventEmitter<void>();
    readonly onDidEnvironmentChange = this.onDidEnvironmentChangeEmitter.event;
}

const vsCodeFabricClientIdPPE = '5bc58d85-1abe-45e0-bdaf-f487e3ce7bfb'; //  NON-PROD-vscode-fabric (PPE)
const vsCodeFabricClientIdPROD = '02fe4832-64e1-42d2-a605-d14958774a2e'; // PROD-vscode-fabric (PROD)
// const synapseClientIdPPE = '448e8446-7f2d-4c49-927e-e8a6cc9dcac2'; // Trident-Spark-IDE PPE 
// const synapseClientIdPROD = '36c50012-7aa1-4bff-9ff8-51c75190ae4d'; // Trident-Spark-IDE PROD
// const defaultVsCodeClientId = 'aebc6443-996d-45c2-90f0-388ff96faa56'; // Use default VS Code client id for now (we need vscode.dev redirect to work)

const theScopesPPE = ['https://analysis.windows-int.net/powerbi/api/.default'];
const theScopesPROD = ['https://analysis.windows.net/powerbi/api/.default'];

export const FABRIC_ENVIRONMENTS: { [key in FabricEnvironmentName]: FabricEnvironmentSettings } = {
    [FabricEnvironmentName.MOCK]: {
        env: FabricEnvironmentName.MOCK,
        clientId: '00000000-0000-0000-0000-000000000000',
        scopes: [],
        sharedUri: '',
        portalUri: ''
    },
    [FabricEnvironmentName.ONEBOX]: {
        env: FabricEnvironmentName.ONEBOX,
        clientId: vsCodeFabricClientIdPPE,
        scopes: theScopesPPE,
        sharedUri: 'https://onebox-redirect.analysis.windows-int.net',
        portalUri: 'portal.analysis.windows-int.net'
    },
    [FabricEnvironmentName.EDOG]: {
        env: FabricEnvironmentName.EDOG,
        clientId: vsCodeFabricClientIdPPE,
        scopes: theScopesPPE,
        sharedUri: 'https://powerbiapi.analysis-df.windows.net',
        portalUri: 'edog.analysis-df.windows.net'
    },
    [FabricEnvironmentName.EDOGONEBOX]: {
        env: FabricEnvironmentName.EDOGONEBOX,
        clientId: vsCodeFabricClientIdPPE,
        scopes: theScopesPPE,
        sharedUri: 'https://powerbiapi.analysis-df.windows.net',
        portalUri: 'edog.analysis-df.windows.net'
    },
    [FabricEnvironmentName.DAILY]: {
        env: FabricEnvironmentName.DAILY,
        clientId: vsCodeFabricClientIdPROD,
        scopes: theScopesPROD,
        sharedUri: 'https://dailyapi.fabric.microsoft.com',
        portalUri: 'daily.fabric.microsoft.com'
    },
    [FabricEnvironmentName.DXT]: {
        env: FabricEnvironmentName.DXT,
        clientId: vsCodeFabricClientIdPROD,
        scopes: theScopesPROD,
        sharedUri: 'https://dxtapi.fabric.microsoft.com',
        portalUri: 'dxt.fabric.microsoft.com'
    },
    [FabricEnvironmentName.MSIT]: {
        env: FabricEnvironmentName.MSIT,
        clientId: vsCodeFabricClientIdPROD,
        scopes: theScopesPROD,
        sharedUri: 'https://msitapi.fabric.microsoft.com',
        portalUri: 'msit.fabric.microsoft.com'
    },
    [FabricEnvironmentName.PROD]: {
        env: FabricEnvironmentName.PROD,
        clientId: vsCodeFabricClientIdPROD,
        scopes: theScopesPROD,
        sharedUri: 'https://api.fabric.microsoft.com',
        portalUri: 'app.fabric.microsoft.com'
    }
};

export function getFabricEnvironment(env: string, logger?: ILogger): FabricEnvironmentSettings {
    const envString = env.toUpperCase() as FabricEnvironmentName;
    if (!Object.values(FabricEnvironmentName).includes(envString)) {
        logger?.log(`Invalid environment setting: ${envString}`, LogImportance.high);
        logger?.log(`Using default environment setting: ${FabricEnvironmentName.PROD}`);
        return FABRIC_ENVIRONMENTS[FabricEnvironmentName.PROD];
    }
    // eslint-disable-next-line security/detect-object-injection
    return FABRIC_ENVIRONMENTS[envString];
}