/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import {
    getDisplayNameForTool,
    buildChatAgentConnectPrompt,
} from "../../src/copilot/tools/toolsUtils";
import { ConnectionInfo } from "../../src/controllers/connectionManager";
import { IConnectionProfile } from "../../src/models/interfaces";
import { MssqlChatAgent as loc } from "../../src/constants/locConstants";

suite("toolsUtils Tests", () => {
    suite("getDisplayNameForTool", () => {
        test("should return unknown connection when connInfo is undefined", () => {
            const result = getDisplayNameForTool(undefined);
            expect(result).to.equal(loc.unknownConnection);
        });

        test("should return display name when connInfo is provided", () => {
            const mockConnectionInfo = new ConnectionInfo();
            mockConnectionInfo.credentials = {
                server: "localhost",
                database: "testDb",
            } as IConnectionProfile;

            const result = getDisplayNameForTool(mockConnectionInfo);

            expect(result).to.include("localhost");
        });
    });

    suite("buildChatAgentConnectPrompt", () => {
        test("should include profileId, serverName, and database when all are provided", () => {
            const profile: IConnectionProfile = {
                id: "test-profile-id",
                profileName: "My Profile",
                server: "localhost,1433",
                database: "AdventureWorks",
            } as IConnectionProfile;

            const result = buildChatAgentConnectPrompt(profile);
            const parsed = JSON.parse(result.replace("Connect to ", ""));

            expect(parsed.profileId).to.equal("test-profile-id");
            expect(parsed.profileName).to.equal("My Profile");
            expect(parsed.serverName).to.equal("localhost,1433");
            expect(parsed.database).to.equal("AdventureWorks");
        });

        test("should omit database when it is empty string", () => {
            const profile: IConnectionProfile = {
                id: "test-profile-id",
                server: "localhost,1433",
                database: "",
            } as IConnectionProfile;

            const result = buildChatAgentConnectPrompt(profile);
            const parsed = JSON.parse(result.replace("Connect to ", ""));

            expect(parsed.profileId).to.equal("test-profile-id");
            expect(parsed.serverName).to.equal("localhost,1433");
            expect(parsed).to.not.have.property("database");
        });

        test("should omit database when it is undefined", () => {
            const profile: IConnectionProfile = {
                id: "test-profile-id",
                server: "localhost,1433",
                database: undefined,
            } as IConnectionProfile;

            const result = buildChatAgentConnectPrompt(profile);
            const parsed = JSON.parse(result.replace("Connect to ", ""));

            expect(parsed).to.not.have.property("database");
        });

        test("should omit profileName when it is empty string", () => {
            const profile: IConnectionProfile = {
                id: "test-profile-id",
                profileName: "",
                server: "localhost,1433",
                database: "testDb",
            } as IConnectionProfile;

            const result = buildChatAgentConnectPrompt(profile);
            const parsed = JSON.parse(result.replace("Connect to ", ""));

            expect(parsed).to.not.have.property("profileName");
        });

        test("should omit profileName when it is whitespace only", () => {
            const profile: IConnectionProfile = {
                id: "test-profile-id",
                profileName: "   ",
                server: "localhost,1433",
                database: "testDb",
            } as IConnectionProfile;

            const result = buildChatAgentConnectPrompt(profile);
            const parsed = JSON.parse(result.replace("Connect to ", ""));

            expect(parsed).to.not.have.property("profileName");
        });

        test("should omit profileName when it is undefined", () => {
            const profile: IConnectionProfile = {
                id: "test-profile-id",
                profileName: undefined,
                server: "localhost,1433",
                database: "testDb",
            } as IConnectionProfile;

            const result = buildChatAgentConnectPrompt(profile);
            const parsed = JSON.parse(result.replace("Connect to ", ""));

            expect(parsed).to.not.have.property("profileName");
        });

        test("should handle server names with commas (port notation)", () => {
            const profile: IConnectionProfile = {
                id: "test-id",
                server: "myserver.database.windows.net,1433",
                database: "myDb",
            } as IConnectionProfile;

            const result = buildChatAgentConnectPrompt(profile);

            // The result should be valid JSON despite the comma in the server name
            expect(() => JSON.parse(result.replace("Connect to ", ""))).to.not.throw();

            const parsed = JSON.parse(result.replace("Connect to ", ""));
            expect(parsed.serverName).to.equal("myserver.database.windows.net,1433");
        });

        test("should return prompt starting with 'Connect to'", () => {
            const profile: IConnectionProfile = {
                id: "test-id",
                server: "localhost",
            } as IConnectionProfile;

            const result = buildChatAgentConnectPrompt(profile);

            expect(result).to.match(/^Connect to \{/);
        });

        test("should handle minimal profile with only server", () => {
            const profile: IConnectionProfile = {
                server: "localhost",
            } as IConnectionProfile;

            const result = buildChatAgentConnectPrompt(profile);
            const parsed = JSON.parse(result.replace("Connect to ", ""));

            expect(parsed.serverName).to.equal("localhost");
            expect(parsed).to.not.have.property("profileId");
            expect(parsed).to.not.have.property("profileName");
            expect(parsed).to.not.have.property("database");
        });
    });
});
