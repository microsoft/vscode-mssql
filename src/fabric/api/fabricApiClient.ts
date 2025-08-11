/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as azApi from "@azure/core-rest-pipeline";

// https://dev.azure.com/powerbi/Power%20BI/_git/ArtifactRegistry?path=/Microsoft.DataCloud.ArtifactRegistry/ArtifactDefinitions/AppDevFunction.xml

/**
 * ApiClient allows us to call the Trident REST API
 * It is a wrapper around @azure/core-rest-pipeline that adds the baseUri and apiVersion
 * https://github.com/Azure/azure-sdk-for-js/blob/main/sdk/core/core-rest-pipeline/README.md
 */

export interface IFabricApiClient {
    sendRequest(options: IApiClientRequestOptions): Promise<IApiClientResponse>;
}

export interface IApiClientRequestOptions {
    url?: string;
    method?: azApi.HttpMethods; // defaults to "GET"
    pathTemplate?: string;
    body?: any;
    headers?: azApi.RawHttpHeadersInput;
    token?: string; // if you want to override the token (perhaps because on OneBox with Edog credentials)
    tokenType?: string; // defaults to "Bearer".
    timeout?: number; //  msecs.  Defaults to 0, which disables the timeout.

    dumpToken?: boolean; // if true, will log the token
    /**
     * To simulate a browser form post
     */
    formData?: azApi.FormDataMap;
    /**
     * A list of response status codes whose corresponding PipelineResponse body should be treated as a stream.
     */
    streamResponseStatusCodes?: Set<number>;
}

export interface IApiClientResponse {
    requestOptions?: IApiClientRequestOptions;
    request?: azApi.PipelineRequest;
    response?: azApi.PipelineResponse;
    bodyAsText?: string;
    parsedBody?: any;
    status: number;
    elapsedms?: number; // how long the API call took
    headers?: azApi.HttpHeaders;
    url?: string;
}

/* eslint-disable */
export enum RuntimeType {
    DotNet = "DOTNET", // upper case to match workload
    Python = "PYTHON",
}

export type RuntimeAttribute = RuntimeType.DotNet | RuntimeType.Python; // workload also has 'NOTASSIGNED', but we'll query user for value if not set

export type ArtifactAttributes = {
    runtime?: RuntimeAttribute;
    // 'inputType'?: InputTypeAttribute
};

/**
 * IArtifact as seen in api responses
 */
export interface IArtifact {
    id: string;
    type: string;
    displayName: string;
    description: string | undefined;
    workspaceId: string;
    attributes?: ArtifactAttributes;

    /** Represent the Fabric environment this item exists in, like "DAILY" or "PROD".
     *
     * It's debatable whether this should be here as it's not part of the API response,
     * however we use IArtifact throughout the codebase and it's useful to have it here.
     */
    fabricEnvironment: string;
}
