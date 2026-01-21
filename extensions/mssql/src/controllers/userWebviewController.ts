/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import {
    ObjectManagementActionParams,
    ObjectManagementActionResult,
    ObjectManagementDialogType,
    ObjectManagementSearchParams,
    ObjectManagementSearchResult,
    UserInfo,
    UserParams,
    UserType,
    UserViewModel,
    SecurableTypeMetadata,
} from "../sharedInterfaces/objectManagement";
import * as Constants from "../constants/constants";
import * as LocConstants from "../constants/locConstants";
import { ObjectManagementService } from "../services/objectManagementService";
import { getErrorMessage } from "../utils/utils";
import VscodeWrapper from "./vscodeWrapper";
import { ObjectManagementWebviewController } from "./objectManagementWebviewController";

interface UserViewInfo {
    objectInfo: UserInfo;
    userTypes?: UserType[];
    languages?: string[];
    schemas?: string[];
    logins?: string[];
    databaseRoles?: string[];
    supportedSecurableTypes?: SecurableTypeMetadata[];
}

export class UserWebviewController extends ObjectManagementWebviewController {
    private objectInfo: UserInfo | undefined;
    private readonly isNewObject: boolean;

    public constructor(
        context: vscode.ExtensionContext,
        vscodeWrapper: VscodeWrapper,
        objectManagementService: ObjectManagementService,
        connectionUri: string,
        serverName: string,
        databaseName?: string,
        parentUrn?: string,
        objectUrn?: string,
        isNewObject: boolean = false,
        dialogTitle?: string,
    ) {
        super(
            context,
            vscodeWrapper,
            objectManagementService,
            ObjectManagementDialogType.User,
            dialogTitle ??
                (isNewObject
                    ? LocConstants.newUserDialogTitle
                    : LocConstants.userPropertiesDialogTitle),
            "userDialog",
            connectionUri,
            serverName,
            databaseName,
            parentUrn,
            objectUrn,
        );

        this.isNewObject = isNewObject;
        this.start();
    }

    protected get helpLink(): string {
        return this.isNewObject ? Constants.createUserHelpLink : Constants.alterUserHelpLink;
    }

    protected async initializeDialog(): Promise<void> {
        try {
            const viewInfo = this.asViewInfo(
                await this.objectManagementService.initializeView(
                    this.contextId,
                    Constants.userString,
                    this.connectionUri,
                    this.databaseName || Constants.defaultDatabase,
                    this.isNewObject,
                    this.parentUrn ?? "Server",
                    this.objectUrn,
                ),
            );

            this.objectInfo = viewInfo.objectInfo;
            const viewModel: UserViewModel = {
                serverName: this.serverName,
                databaseName: this.databaseName ?? "",
                isNewObject: this.isNewObject,
                user: viewInfo.objectInfo ?? { name: "" },
                userTypes: viewInfo.userTypes ?? [],
                languages: viewInfo.languages ?? [],
                schemas: viewInfo.schemas ?? [],
                logins: viewInfo.logins ?? [],
                databaseRoles: viewInfo.databaseRoles ?? [],
                supportedSecurableTypes: viewInfo.supportedSecurableTypes ?? [],
            };

            this.updateWebviewState({
                viewModel: {
                    dialogType: ObjectManagementDialogType.User,
                    model: viewModel,
                },
                isLoading: false,
            });
        } catch (error) {
            this.logger.error(`User dialog initialization failed: ${getErrorMessage(error)}`);
            this.updateWebviewState({
                viewModel: {
                    dialogType: ObjectManagementDialogType.User,
                    model: {
                        serverName: this.serverName,
                        databaseName: this.databaseName ?? "",
                        isNewObject: this.isNewObject,
                        user: { name: "" },
                        userTypes: [],
                        languages: [],
                        schemas: [],
                        logins: [],
                        databaseRoles: [],
                        supportedSecurableTypes: [],
                    },
                },
                isLoading: false,
            });
        }
    }

    protected async handleSubmit(
        params: ObjectManagementActionParams["params"],
    ): Promise<ObjectManagementActionResult> {
        const typedParams = params as UserParams;
        try {
            if (!this.objectInfo) {
                return {
                    success: false,
                    errorMessage: LocConstants.msgChooseDatabaseNotConnected,
                };
            }

            this.applyUserParams(typedParams);
            await this.objectManagementService.save(this.contextId, this.objectInfo);

            await this.disposeView();
            this.closeDialog(typedParams.name);
            return { success: true };
        } catch (error) {
            return { success: false, errorMessage: getErrorMessage(error) };
        }
    }

    protected async handleScript(
        params: ObjectManagementActionParams["params"],
    ): Promise<ObjectManagementActionResult> {
        const typedParams = params as UserParams;
        try {
            if (!this.objectInfo) {
                return {
                    success: false,
                    errorMessage: LocConstants.msgChooseDatabaseNotConnected,
                };
            }

            this.applyUserParams(typedParams);
            const script = await this.objectManagementService.script(this.contextId, this.objectInfo);

            if (!script) {
                void this.vscodeWrapper.showWarningMessage(LocConstants.msgNoScriptGenerated);
                return {
                    success: false,
                    errorMessage: LocConstants.msgNoScriptGenerated,
                };
            }

            await this.openScriptInEditor(script);
            return { success: true };
        } catch (error) {
            this.logger.error(`Script generation failed: ${getErrorMessage(error)}`);
            return { success: false, errorMessage: getErrorMessage(error) };
        }
    }

    protected async handleSearch(
        params: ObjectManagementSearchParams,
    ): Promise<ObjectManagementSearchResult> {
        try {
            const results = await this.objectManagementService.search(
                this.contextId,
                params.objectTypes,
                params.searchText,
                params.schema,
                params.database,
            );
            return { success: true, results };
        } catch (error) {
            return { success: false, errorMessage: getErrorMessage(error) };
        }
    }

    private asViewInfo(viewInfo: unknown): UserViewInfo {
        return viewInfo as UserViewInfo;
    }

    private applyUserParams(params: UserParams): void {
        if (!this.objectInfo) {
            return;
        }

        this.objectInfo.name = params.name;
        this.objectInfo.type = params.type;
        this.objectInfo.loginName = params.loginName;
        this.objectInfo.password = params.password;
        this.objectInfo.defaultSchema = params.defaultSchema;
        this.objectInfo.ownedSchemas = params.ownedSchemas ?? [];
        this.objectInfo.databaseRoles = params.databaseRoles ?? [];
        this.objectInfo.defaultLanguage = params.defaultLanguage;
        this.objectInfo.securablePermissions = params.securablePermissions ?? [];
    }
}
