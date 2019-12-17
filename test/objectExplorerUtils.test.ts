/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import * as path from 'path';
import { ObjectExplorerUtils } from '../src/objectExplorer/objectExplorerUtils';
import { expect, assert } from 'chai';
import Constants = require('../src/constants/constants');
import { TreeNodeInfo } from '../src/objectExplorer/treeNodeInfo';
import { ConnectionProfile } from '../src/models/connectionProfile';
import { ObjectMetadata } from '../src/models/contracts/metadata/metadataRequest';

suite('Object Explorer Utils Tests', () => {

    test('Test iconPath function', () => {
        const testObjects = ['Server', 'Table', 'StoredProcedure', 'disconnectedServer'];
        const expectedPaths = ['Server_green.svg', 'Table.svg', 'StoredProcedure.svg', 'Server_red.svg'];
        for (let i = 0; i < testObjects.length; i++) {
            const iconPath = ObjectExplorerUtils.iconPath(testObjects[i]);
            const fileName = path.basename(iconPath);
            expect(fileName, 'File name should be the same as expected file name').is.equal(expectedPaths[i]);
        }
    });

    test('Test getNodeUri function', () => {
        const disconnectedProfile = new ConnectionProfile();
        disconnectedProfile.server = 'disconnected_server';
        const testProfile = new ConnectionProfile();
        testProfile.server = 'test_server';
        testProfile.profileName = 'test_profile';
        testProfile.database = 'test_database';
        testProfile.user = 'test_user';
        testProfile.authenticationType = Constants.sqlAuthentication;
        const disconnectedTestNode = new TreeNodeInfo('disconnectedTest', undefined, undefined, undefined,
        undefined, 'disconnectedServer', undefined, disconnectedProfile, undefined, undefined);
        const serverTestNode = new TreeNodeInfo('serverTest', undefined, undefined, 'test_path',
        undefined, 'Server', undefined, testProfile, undefined, undefined);
        const databaseTestNode = new TreeNodeInfo('databaseTest', undefined, undefined, 'test_path',
        undefined, 'Database', undefined, testProfile, serverTestNode, undefined);
        const tableTestNode = new TreeNodeInfo('tableTest', undefined, undefined, 'test_path',
        undefined, 'Table', undefined, testProfile, databaseTestNode, undefined);
        const testNodes = [disconnectedTestNode, serverTestNode, tableTestNode];
        const expectedUris = ['disconnected_server_undefined_undefined',
            'test_server_test_database_test_user_test_profile',
            'test_server_test_database_test_user_test_profile'];

        for (let i = 0; i < testNodes.length; i++) {
            const nodeUri = ObjectExplorerUtils.getNodeUri(testNodes[i]);
            expect(nodeUri, 'Node URI should be the same as expected Node URI').is.equal(expectedUris[i]);
        }
    });

    test('Test getNodeUriFromProfile', () => {
        const testProfile = new ConnectionProfile();
        testProfile.server = 'test_server';
        testProfile.profileName = 'test_profile';
        testProfile.database = 'test_database';
        testProfile.user = 'test_user';
        testProfile.authenticationType = Constants.sqlAuthentication;
        const testProfile2 = new ConnectionProfile();
        testProfile2.server = 'test_server2';
        testProfile2.profileName = undefined;
        testProfile2.authenticationType = 'Integrated';
        const testProfiles = [testProfile, testProfile2];
        const expectedProfiles = ['test_server_test_database_test_user_test_profile', 'test_server2_undefined_undefined'];

        for (let i = 0; i < testProfiles.length; i++) {
            const uri = ObjectExplorerUtils.getNodeUriFromProfile(testProfiles[i]);
            expect(uri, 'Node URI should be the same as expected Node URI').is.equal(expectedProfiles[i]);
        }
    });

    test('Test getDatabaseName', () => {
        const testProfile = new ConnectionProfile();
        testProfile.server = 'test_server';
        testProfile.profileName = 'test_profile';
        testProfile.database = 'test_database';
        testProfile.user = 'test_user';
        const serverTestNode = new TreeNodeInfo('serverTest', undefined, undefined, 'test_path',
        undefined, 'Server', undefined, testProfile, undefined);
        let databaseMetatadata: ObjectMetadata = {
            metadataType: undefined,
            metadataTypeName: Constants.databaseString,
            urn: undefined,
            name: 'databaseTest',
            schema: undefined
        };
        const databaseTestNode = new TreeNodeInfo('databaseTest', undefined, undefined, 'test_path',
        undefined, 'Database', undefined, undefined, serverTestNode, databaseMetatadata);
        const databaseTestNode2 = new TreeNodeInfo('databaseTest', undefined, undefined, 'test_path',
        undefined, 'Database', undefined, undefined, serverTestNode, undefined);
        const tableTestNode = new TreeNodeInfo('tableTest', undefined, undefined, 'test_path',
        undefined, 'Table', undefined, undefined, databaseTestNode);
        const testNodes = [serverTestNode, databaseTestNode, databaseTestNode2, tableTestNode];
        const expectedDatabaseNames = ['test_database', 'databaseTest', '<default>', 'databaseTest'];
        for (let i = 0; i < testNodes.length; i++) {
            let databaseName = ObjectExplorerUtils.getDatabaseName(testNodes[i]);
            assert.equal(databaseName, expectedDatabaseNames[i]);
        }
    });

    test('Test isFirewallError', () => {
        const testMessage =  'test_error';
        assert.isNotTrue(ObjectExplorerUtils.isFirewallError(testMessage), 'Error should not be a firewall error');
        const firewallMessageCheck = Constants.firewallErrorMessage;
        let testFirewallMessage = `test ${firewallMessageCheck} foo bar`;
        assert.isTrue(ObjectExplorerUtils.isFirewallError(testFirewallMessage), 'Error should be a firewall error');
    });
});
