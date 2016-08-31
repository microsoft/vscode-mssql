'use strict';
import Constants = require('./constants');
import Interfaces = require('./interfaces');

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

// TODO: this doesn't appear to be used anywhere in the project. Do we need it?
export function dump(connCreds: Interfaces.IConnectionCredentials): string {
    let contents =  'server=' + (connCreds.server ? connCreds.server : 'null') +
                    ' | database=' + (connCreds.database ? connCreds.database : 'null') +
                    ' | username=' + (connCreds.user ? connCreds.user : 'null') +
                    ' | encrypt=' + connCreds.encrypt +
                    ' | connectionTimeout=' + connCreds.connectTimeout;
    return contents;
}

// compare connections porperties, except for password
export function equals(connCreds: Interfaces.IConnectionCredentials, theOther: Interfaces.IConnectionCredentials): boolean {
    let equal = (connCreds.server === theOther.server) &&
                (connCreds.database === theOther.database) &&
                (connCreds.user === theOther.user) &&
                (connCreds.encrypt === theOther.encrypt) &&
                (connCreds.connectTimeout === theOther.connectTimeout) &&
                (connCreds.applicationIntent === theOther.applicationIntent) &&
                (connCreds.applicationName === theOther.applicationName) &&
                (connCreds.attachDbFilename === theOther.attachDbFilename) &&
                (connCreds.authenticationType === theOther.authenticationType) &&
                (connCreds.connectRetryCount === theOther.connectRetryCount) &&
                (connCreds.connectRetryInterval === theOther.connectRetryInterval) &&
                (connCreds.currentLanguage === theOther.currentLanguage) &&
                (connCreds.failoverPartner === theOther.failoverPartner) &&
                (connCreds.loadBalanceTimeout === theOther.loadBalanceTimeout) &&
                (connCreds.maxPoolSize === theOther.maxPoolSize) &&
                (connCreds.minPoolSize === theOther.minPoolSize) &&
                (connCreds.multipleActiveResultSets === theOther.multipleActiveResultSets) &&
                (connCreds.multiSubnetFailover === theOther.multiSubnetFailover) &&
                (connCreds.packetSize === theOther.packetSize) &&
                (connCreds.persistSecurityInfo === theOther.persistSecurityInfo) &&
                (connCreds.pooling === theOther.pooling) &&
                (connCreds.port === theOther.port) &&
                (connCreds.replication === theOther.replication) &&
                (connCreds.trustServerCertificate === theOther.trustServerCertificate) &&
                (connCreds.typeSystemVersion === theOther.typeSystemVersion) &&
                (connCreds.workstationId === theOther.workstationId);
    return equal;
}

export function getPicklistLabel(connCreds: Interfaces.IConnectionCredentials): string {
    return connCreds.server;
}

export function getPicklistDescription(connCreds: Interfaces.IConnectionCredentials): string {
    return '[' +
           'database: ' + (connCreds.database ? connCreds.database : '<connection default>') +
           ', username: ' + (connCreds.user ? connCreds.user : '<prompt>') +
           ']';
}

export function getPicklistDetails(connCreds: Interfaces.IConnectionCredentials): string {
    return '[' +
           'encrypt connection: ' + (connCreds.encrypt ? 'true' : 'false') +
           ', port: ' + (connCreds.port ? connCreds.port : Constants.defaultPortNumber) +
           ', connection timeout: ' + connCreds.connectTimeout + ' s' +
           ']';
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
