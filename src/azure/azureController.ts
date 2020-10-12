import vscode = require('vscode');
import { AzureStringLookup } from '../azure/azureStringLookup';
import { AzureUserInteraction } from '../azure/azureUserInteraction';
import { AzureErrorLookup } from '../azure/azureErrorLookup';
import { AzureMessageDisplayer } from './azureMessageDisplayer';
import { AzureLogger } from '../azure/azureLogger';
import { AzureAuthRequest } from './azureAuthRequest';
import { SimpleTokenCache } from './cacheService';
import * as path from 'path';
import * as os from 'os';
import { promises as fs } from 'fs';
import { CredentialStore } from '../credentialstore/credentialstore';
import { StorageService } from './StorageService';

function getAppDataPath(): string {
    let platform = process.platform;
    switch (platform) {
        case 'win32': return process.env['APPDATA'] || path.join(process.env['USERPROFILE'], 'AppData', 'Roaming');
        case 'darwin': return path.join(os.homedir(), 'Library', 'Application Support');
        case 'linux': return process.env['XDG_CONFIG_HOME'] || path.join(os.homedir(), '.config');
        default: throw new Error('Platform not supported');
    }
}

function getDefaultLogLocation(): string {
    return path.join(getAppDataPath(), 'vscode-mssql');
}

async function findOrMakeStoragePath(): Promise<string | undefined> {
    let defaultLogLocation = getDefaultLogLocation();
    let storagePath = path.join(defaultLogLocation, 'AAD');

    try {
        await fs.mkdir(defaultLogLocation, { recursive: true });
    } catch (e) {
        if (e.code !== 'EEXIST') {
            console.log(`Creating the base directory failed... ${e}`);
            return undefined;
        }
    }

    try {
        await fs.mkdir(storagePath, { recursive: true });
    } catch (e) {
        if (e.code !== 'EEXIST') {
            console.error(`Initialization of vscode-mssql storage failed: ${e}`);
            console.error('Azure accounts will not be available');
            return undefined;
        }
    }

    console.log('Initialized vscode-mssql storage.');
    return storagePath;
}

export class AzureController {

    authRequest: AzureAuthRequest;
    azureStringLookup: AzureStringLookup;
    azureUserInteraction: AzureUserInteraction;
    azureErrorLookup: AzureErrorLookup;
    azureMessageDisplayer: AzureMessageDisplayer;
    cacheService: SimpleTokenCache;
    storageService: StorageService;
    context: vscode.ExtensionContext;
    logger: AzureLogger;

    constructor(context: vscode.ExtensionContext, logger: AzureLogger) {
        this.context = context;
        this.logger = logger;
    }
    public async init(): Promise<void> {
        this.authRequest = new AzureAuthRequest(this.context, this.logger);
        await this.authRequest.startServer();
        let storagePath = await findOrMakeStoragePath();
        let credentialStore = new CredentialStore();
        this.cacheService = new SimpleTokenCache('aad', storagePath, true, credentialStore);
        await this.cacheService.init();
        this.storageService = this.cacheService.db;
        this.azureStringLookup = new AzureStringLookup();
        this.azureUserInteraction = new AzureUserInteraction(this.authRequest.getState());
        this.azureErrorLookup = new AzureErrorLookup();
        this.azureMessageDisplayer = new AzureMessageDisplayer();
    }

}
