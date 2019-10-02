/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import * as path from 'path';
import { ObjectExplorerUtils } from '../src/objectExplorer/objectExplorerUtils';
import { expect } from 'chai';
import { TreeNodeInfo } from '../src/objectExplorer/treeNodeInfo';
import { IConnectionProfile } from '../src/models/interfaces';
import { ConnectionProfile } from '../src/models/connectionProfile';

suite('Object Explorer Utils Tests', () => {

    test('Test iconPath function', () => {
        const testObjects = ['Server', 'Table', 'StoredProcedure'];
        const expectedPaths = ['Server.svg', 'Table.svg', 'StoredProcedure.svg'];
        for (let i = 0; i < testObjects.length; i++) {
            const iconPath = ObjectExplorerUtils.iconPath(testObjects[i]);
            const fileName = path.basename(iconPath);
            expect(fileName, 'File name should be the same as expected file name').is.equal(expectedPaths[i]);
        }
    });

    test('Test getNodeUri function', () => {
        const disconnectedTestNode = new TreeNodeInfo('disconnectedTest', undefined, undefined, undefined,
        undefined, 'disconnectedServer', undefined, undefined, undefined);
        const serverTestNode = new TreeNodeInfo('serverTest', undefined, undefined, 'test_path',
        undefined, 'Server', undefined, undefined, undefined);
        const databaseTestNode = new TreeNodeInfo('databaseTest', undefined, undefined, 'test_path',
        undefined, 'Database', undefined, undefined, serverTestNode);
        const tableTestNode = new TreeNodeInfo('tableTest', undefined, undefined, 'test_path',
        undefined, 'Table', undefined, undefined, databaseTestNode);
        const testNodes = [disconnectedTestNode, serverTestNode, tableTestNode];
        const expectedUris = [undefined, 'test_path_serverTest', 'test_path_serverTest'];

        for (let i = 0; i < testNodes.length; i++) {
            const nodeUri = ObjectExplorerUtils.getNodeUri(testNodes[i]);
            expect(nodeUri, 'Node URI should be the same as expected Node URI').is.equal(expectedUris[i]);
        }
    });

    test('Test getNodeUriFromProfile', () => {
        const testProfile = new ConnectionProfile();
        testProfile.server = 'test_server';
        testProfile.profileName = 'test_profile';
        const testProfile2 = new ConnectionProfile();
        testProfile2.server = 'test_server2';
        testProfile2.profileName = undefined;
        const testProfiles = [testProfile, testProfile2];
        const expectedProfiles = ['test_server_test_profile', 'test_server2_undefined'];

        for (let i = 0; i < testProfiles.length; i++) {
            const uri = ObjectExplorerUtils.getNodeUriFromProfile(testProfiles[i]);
            expect(uri, 'Node URI should be the same as expected Node URI').is.equal(expectedProfiles[i]);
        }
    });
});
