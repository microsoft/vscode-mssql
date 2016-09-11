'use strict';
import Constants = require('./constants');
import Interfaces = require('./interfaces');
const figures = require('figures');
import * as symbols from '../utils/symbol';
import * as Utils from './utils';

// Fix up connection settings if we're connecting to Azure SQL
export function fixupConnectionCredentials(connCreds: Interfaces.IConnectionCredentials): Interfaces.IConnectionCredentials {
    if (!connCreds.server) {
        connCreds.server = '';
    }

    if (!connCreds.database) {
        connCreds.database = '';
    }

    if (!connCreds.user) {
        connCreds.user = '';
    }

    if (!connCreds.password) {
        connCreds.password = '';
    }

    if (!connCreds.connectTimeout) {
        connCreds.connectTimeout = Constants.defaultConnectionTimeout;
    }

    // default value for encrypt
    if (!connCreds.encrypt) {
        connCreds.encrypt = false;
    }

    // default value for appName
    if (!connCreds.applicationName) {
        connCreds.applicationName = Constants.extensionName;
    }

    if (isAzureDatabase(connCreds.server)) {
        // always encrypt connection if connecting to Azure SQL
        connCreds.encrypt = true;

        // Ensure minumum connection timeout if connecting to Azure SQL
        if (connCreds.connectTimeout < Constants.azureSqlDbConnectionTimeout) {
            connCreds.connectTimeout = Constants.azureSqlDbConnectionTimeout;
        }
    }
    return connCreds;
}

// return true if server name ends with '.database.windows.net'
function isAzureDatabase(server: string): boolean {
    return (server ? server.endsWith(Constants.sqlDbPrefix) : false);
}

export function getPicklistLabel(connCreds: Interfaces.IConnectionCredentials): string {
    let profile: Interfaces.IConnectionProfile = <Interfaces.IConnectionProfile> connCreds;
    if (profile.profileName) {
        return `${symbols.star} ${profile.profileName}`;
    } else {
        return `${figures.play} ${connCreds.server}`;
    }
}

export function getPicklistDescription(connCreds: Interfaces.IConnectionCredentials): string {
    let profile: Interfaces.IConnectionProfile = <Interfaces.IConnectionProfile> connCreds;
    let desc: string = '[';
    if (profile.profileName) {
        // Add server name in this instance as it's needed for clarity
        desc = desc + 'server: ' + connCreds.server + ', ';
    }
    desc = desc + 'database: ' + (connCreds.database ? connCreds.database : '<connection default>');
    if (connCreds.authenticationType) {
        if (connCreds.authenticationType !== Interfaces.AuthenticationTypes[Interfaces.AuthenticationTypes.Integrated]) {
            desc = desc + ', username: ' + (connCreds.user ? connCreds.user : '<prompt>');
        } else if (process.platform === 'win32') {
            let userName = process.env.USERDOMAIN + '\\' + process.env.USERNAME;
            desc = desc + ', username: ' + userName;
        }
    }
    desc = desc + ']';
    return desc;
}

export function getPicklistDetails(connCreds: Interfaces.IConnectionCredentials): string {
    // In the current spec this is left empty intentionally. Leaving the method as this may change in the future
    return undefined;
}

export function getConnectionDisplayString(creds: Interfaces.IConnectionCredentials): string {
    // Update the connection text
    let text: string = creds.server;
    if (creds.database !== '') {
        text = appendIfNotEmpty(text, creds.database);
    } else {
        text = appendIfNotEmpty(text, Constants.defaultDatabaseLabel);
    }
    let user: string = getUserNameOrDomainLogin(creds);
    text = appendIfNotEmpty(text, user);
    return text;
}

function appendIfNotEmpty(connectionText: string, value: string): string {
    if (Utils.isNotEmpty(value)) {
        connectionText += ` : ${value}`;
    }
    return connectionText;
}

export function getUserNameOrDomainLogin(creds: Interfaces.IConnectionCredentials, defaultValue?: string): string {
    if (!defaultValue) {
        defaultValue = '';
    }

    if (creds.authenticationType === Interfaces.AuthenticationTypes[Interfaces.AuthenticationTypes.Integrated]) {
        return (process.platform === 'win32') ? process.env.USERDOMAIN + '\\' + process.env.USERNAME : '';
    } else {
        return creds.user ? creds.user : defaultValue;
    }
}

function addTooltipItem(creds: Interfaces.IConnectionCredentials, property: string): string {
    let value: any = creds[property];
    if (typeof value === 'undefined') {
        return '';
    } else if (typeof value === 'boolean') {
        return property + ': ' + (value ? 'true' : 'false') + '\r\n';
    } else {
        return property + ': ' + value + '\r\n';
    }
}

export function getTooltip(connCreds: Interfaces.IConnectionCredentials): string {
    let tooltip: string =
           'server: ' + connCreds.server + '\r\n' +
           'database: ' + (connCreds.database ? connCreds.database : '<connection default>') + '\r\n' +
           'username: ' + connCreds.user + '\r\n' +
           'encrypt connection: ' + (connCreds.encrypt ? 'true' : 'false') + '\r\n' +
           'connection timeout: ' + connCreds.connectTimeout + ' s\r\n';

    tooltip += addTooltipItem(connCreds, 'port');
    tooltip += addTooltipItem(connCreds, 'applicationName');
    tooltip += addTooltipItem(connCreds, 'applicationIntent');
    tooltip += addTooltipItem(connCreds, 'attachDbFilename');
    tooltip += addTooltipItem(connCreds, 'authenticationType');
    tooltip += addTooltipItem(connCreds, 'connectRetryCount');
    tooltip += addTooltipItem(connCreds, 'connectRetryInterval');
    tooltip += addTooltipItem(connCreds, 'currentLanguage');
    tooltip += addTooltipItem(connCreds, 'failoverPartner');
    tooltip += addTooltipItem(connCreds, 'loadBalanceTimeout');
    tooltip += addTooltipItem(connCreds, 'maxPoolSize');
    tooltip += addTooltipItem(connCreds, 'minPoolSize');
    tooltip += addTooltipItem(connCreds, 'multipleActiveResultSets');
    tooltip += addTooltipItem(connCreds, 'multiSubnetFailover');
    tooltip += addTooltipItem(connCreds, 'packetSize');
    tooltip += addTooltipItem(connCreds, 'persistSecurityInfo');
    tooltip += addTooltipItem(connCreds, 'pooling');
    tooltip += addTooltipItem(connCreds, 'replication');
    tooltip += addTooltipItem(connCreds, 'trustServerCertificate');
    tooltip += addTooltipItem(connCreds, 'typeSystemVersion');
    tooltip += addTooltipItem(connCreds, 'workstationId');

    return tooltip;
}
