/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { ConnectionDialog as Loc } from "../../src/constants/locConstants";
import { addAuthenticationOptionInfoTooltips } from "../../src/connectionconfig/formComponentHelpers";
import { AuthenticationType } from "../../src/sharedInterfaces/connectionDialog";
import { FormItemOptions } from "../../src/sharedInterfaces/form";

suite("Connection Form Component Helpers Tests", () => {
    function getIntegratedOption(): FormItemOptions {
        return {
            displayName: "Windows Authentication",
            value: AuthenticationType.Integrated,
        };
    }

    test("adds the Kerberos tooltip on macOS", () => {
        const option = getIntegratedOption();

        addAuthenticationOptionInfoTooltips([option], "darwin");

        expect(option.infoTooltip).to.equal(Loc.kerberosAuthTooltip);
    });

    test("adds the Kerberos tooltip on Linux", () => {
        const option = getIntegratedOption();

        addAuthenticationOptionInfoTooltips([option], "linux");

        expect(option.infoTooltip).to.equal(Loc.kerberosAuthTooltip);
    });

    test("does not add the Kerberos tooltip on Windows", () => {
        const option = getIntegratedOption();

        addAuthenticationOptionInfoTooltips([option], "win32");

        expect(option.infoTooltip).to.be.undefined;
    });
});
