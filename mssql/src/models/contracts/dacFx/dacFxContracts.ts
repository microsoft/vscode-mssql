/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RequestType } from "vscode-languageclient";
import * as mssql from "vscode-mssql";

export namespace ExportRequest {
    export const type = new RequestType<mssql.ExportParams, mssql.DacFxResult, void, void>(
        "dacfx/export",
    );
}

export namespace ImportRequest {
    export const type = new RequestType<mssql.ImportParams, mssql.DacFxResult, void, void>(
        "dacfx/import",
    );
}

export namespace ExtractRequest {
    export const type = new RequestType<mssql.ExtractParams, mssql.DacFxResult, void, void>(
        "dacfx/extract",
    );
}

export namespace DeployRequest {
    export const type = new RequestType<mssql.DeployParams, mssql.DacFxResult, void, void>(
        "dacfx/deploy",
    );
}

export namespace GenerateDeployScriptRequest {
    export const type = new RequestType<
        mssql.GenerateDeployScriptParams,
        mssql.DacFxResult,
        void,
        void
    >("dacfx/generateDeploymentScript");
}

export namespace GenerateDeployPlanRequest {
    export const type = new RequestType<
        mssql.GenerateDeployPlanParams,
        mssql.GenerateDeployPlanResult,
        void,
        void
    >("dacfx/generateDeployPlan");
}

export namespace GetOptionsFromProfileRequest {
    export const type = new RequestType<
        mssql.GetOptionsFromProfileParams,
        mssql.DacFxOptionsResult,
        void,
        void
    >("dacfx/getOptionsFromProfile");
}

export namespace ValidateStreamingJobRequest {
    export const type = new RequestType<
        mssql.ValidateStreamingJobParams,
        mssql.ValidateStreamingJobResult,
        void,
        void
    >("dacfx/validateStreamingJob");
}

export namespace SavePublishProfileRequest {
    export const type = new RequestType<
        mssql.SavePublishProfileParams,
        mssql.ResultStatus,
        void,
        void
    >("dacfx/savePublishProfile");
}
