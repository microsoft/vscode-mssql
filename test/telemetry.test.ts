import assert = require('assert');
import vscode = require('vscode');

suite('Telemetry Tests', () => {
    test('Correct version of applicationInsights is installed', () => {
        // Find the path of our extension
        let ext = vscode.extensions.getExtension('microsoft.vscode-mssql');

        // Open the applicationInsights node module package.json
        const appInsightsPackage: any = require(ext.extensionPath + '/node_modules/vscode-extension-telemetry/node_modules/applicationinsights/package.json');
        assert.ok(appInsightsPackage);

        // Verify that it is at least version 0.15.19
        const versionString: string = appInsightsPackage.version;
        assert.ok(versionString);
        const version: number[] = versionString.split('.').map(str => parseInt(str, 10));
        assert.ok(version);
        assert.ok(version[0] >= 0);
        assert.ok(version[1] >= 15);
        assert.ok(version[2] >= 19);
    });
});
