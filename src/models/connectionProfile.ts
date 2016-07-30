'use strict';
// import vscode = require('vscode');
import Constants = require('./constants');
import { PropertyUpdater } from './propertyUpdater';
import { IConnectionProfile } from './interfaces';
import { ConnectionCredentials } from './connectionCredentials';
import { isEmpty } from './utils';

// Concrete implementation of the IConnectionProfile interface
export class ConnectionProfile extends ConnectionCredentials implements IConnectionProfile {
    public profileName: string;
    public savePassword: boolean;

    // Gets an array of PropertyUpdaters that define the steps to set all needed values for a new Connection
    public static getCreateProfileSteps(isPasswordRequired: boolean): PropertyUpdater<IConnectionProfile>[]  {
        let steps: PropertyUpdater<IConnectionProfile>[] = [
            // server
            PropertyUpdater.CreateInputBoxUpdater<IConnectionProfile>(
                ConnectionCredentials.createInputBoxOptions(Constants.serverPlaceholder, Constants.serverPrompt),
                (c) => isEmpty(c.server),
                (c, input) => c.server = input),

            // database (defaults to master)
            PropertyUpdater.CreateInputBoxUpdater<IConnectionProfile>(
                ConnectionCredentials.createInputBoxOptions(Constants.databasePlaceholder, Constants.databasePrompt, Constants.databaseDefaultValue),
                (c) => isEmpty(c.database),
                (c, input) => c.database = input)
        ];
        // Add username and password
        steps = steps.concat(ConnectionCredentials.getUsernameAndPasswordCredentialUpdaters(isPasswordRequired));

        // Add prompt to save password
        steps = steps.concat(PropertyUpdater.CreateQuickPickUpdater<IConnectionProfile>(
            undefined,
            (c) => true,
            (c, input) => c.savePassword = (input === Constants.msgYes)
        ));
        return steps;
    }
}
