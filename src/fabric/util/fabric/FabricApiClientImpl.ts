/* eslint-disable security/detect-non-literal-fs-filename */
/* eslint-disable security/detect-object-injection */
import * as azApi from '@azure/core-rest-pipeline';
import * as vscode from 'vscode';
import * as fs from 'fs';
import { AbortError } from '@azure/abort-controller';

import { IApiClientRequestOptions, IApiClientResponse, IFabricApiClient } from '@fabric/vscode-fabric-api';
import { TelemetryActivity } from '../telemetry/TelemetryActivity';

import * as path from 'path';
import { TelemetryService } from '../telemetry/TelemetryService';
import { IAccountProvider } from '../authentication/AccountProvider';
import { IConfigurationProvider } from '../settings/ConfigurationProvider';
import { IFabricEnvironmentProvider } from '../settings/FabricEnvironmentProvider';
import { FabricEnvironmentName } from '../settings/FabricEnvironment';
import { doFabricAction } from '../FabricError';
import { ILogger } from '../logger/Logger';

export interface ClusterUrisByTenantLocation {
    /* eslint-disable @typescript-eslint/naming-convention*/
    DynamicClusterUri: string;
    FixedClusterUri: string;
    NewTenantId: unknown;
    PrivateLinkFixedClusterUri: string;
    RuleDescription: string;
    TTLSeconds: number;
    TenantId: string;
    /* eslint-enable @typescript-eslint/naming-convention*/
}

/**
 * ApiClient allows us to call the Trident REST API
 * It is a wrapper around @azure/core-rest-pipeline that adds the baseUri and apiVersion
 * https://github.com/Azure/azure-sdk-for-js/blob/main/sdk/core/core-rest-pipeline/README.md
 */
export class FabricApiClient implements IFabricApiClient {
    azapiClient: azApi.HttpClient;
    private pipelineFactory: () => azApi.Pipeline; // Only tests should set directly

    constructor(
        private auth: IAccountProvider,
        private config: IConfigurationProvider,
        private fabricEnvironmentProvider: IFabricEnvironmentProvider,
        private telemetryService: TelemetryService | null,
        private logger: ILogger,
        pipelineFactory?: () => azApi.Pipeline) {
        this.azapiClient = azApi.createDefaultHttpClient();
        this.pipelineFactory = pipelineFactory ?? (() => azApi.createPipelineFromOptions({ // used by tests
            retryOptions: { maxRetries: 0 }
        }));
    }
    /**
     * gets a token from the identity service which uses VS Code MS auth provider 
     * @returns raw token without "Bearer ".
     */
    private async getToken(): Promise<string> {
        const token = await this.auth.getToken();
        if (!token) {
            throw new Error('Not signed in');
        }
        return token;
    }

    /**
     * intercept sendRequest so we can add apiversion and baseurl as needed
     */
    public async sendRequest(options: IApiClientRequestOptions): Promise<IApiClientResponse> {
        const activity = new TelemetryActivity('apiclient/send-request', this.telemetryService);
        return await doFabricAction({ fabricLogger: this.logger, telemetryActivity: activity }, async () => {

            // URL and Token override much easier to handle as a setting, rather than an Env var.
            // needs to be set if "Click To Open in VSCode" from browser.
            const timeoutApiVal = this.config.get<number>('ApiTimeout', 30000);
            const debugLogging = this.config.get<boolean>('DebugLogging', false);
            const currentEnvironmentURI = this.fabricEnvironmentProvider.getCurrent().sharedUri;
            const baseUrl = options.url ?? currentEnvironmentURI;
            let theUrl = baseUrl;
            if (options.pathTemplate) {
                // if the RequestPrepareOptions URL is not null, then ApiVersion isn't required. If using pathtemplate, then it seems to be required
                theUrl += options.pathTemplate;// + "?api-version=" + extensionConstants.FABRIC_API_VERSION;
            }
            let tokenType = options.tokenType ?? 'Bearer';
            let token: string | undefined = options.token;
            let curHeaders: azApi.RawHttpHeadersInput = {};

            let tokenToUse: string | undefined;
            if (!token) { // if we're using a pathTemplate, then the base is from Fabric Environment and we need the token. Also needed for rundebug, where we use the invocation endpoint
                token = await this.getToken();
            }
            if (token) { // no token means we're not using the Fabric Environment or from a test
                tokenToUse = `${tokenType} ${token}`;
                // eslint-disable-next-line @typescript-eslint/naming-convention
                curHeaders['Authorization'] = tokenToUse;
            }
            if (options.url === undefined) { // if we're using one of the fabric endpoints, add the originating app header so back end can add telemetry
                // eslint-disable-next-line @typescript-eslint/naming-convention
                curHeaders = { ...curHeaders, ...{ 'x-ms-originatingapp': 'vscodefabric' } };
            }
            if (options.headers) { // add any additional headers
                curHeaders = { ...curHeaders, ...options.headers };
            }
            const headers = azApi.createHttpHeaders(curHeaders);
            if (options.formData) { // For more details, see Task 1330509: Determine why deployments consistently fail on 1st try, and require retry
                for (const key in options.formData) {
                    if (Object.prototype.hasOwnProperty.call(options.formData, key)) {
                        const element = options.formData[key];
                        if (typeof element === 'string' && element.startsWith('File:')) {
                            const filePath = element.substring(5);
                            const baseFilename = path.basename(filePath);
                            const strm = fs.createReadStream(filePath);
                            options.formData[key] = azApi.createFileFromStream(() => strm, baseFilename);
                        }
                    }
                }
            }
            const apiOptions: azApi.PipelineRequestOptions = {
                url: theUrl,
                method: options.method === undefined ? 'GET' : options.method,
                body: options.body === undefined ? undefined : JSON.stringify(options.body),
                headers: headers,
                streamResponseStatusCodes: options?.streamResponseStatusCodes,
                formData: options.formData,
            };
            if (options.dumpToken && tokenToUse) {
                this.logger.log(`Token = ${tokenToUse}`);
            }
            const req = azApi.createPipelineRequest(apiOptions);
            if (apiOptions.url.includes('localhost')) {
                req.allowInsecureConnection = true;
            }
            let azApiresponse: azApi.PipelineResponse;
            req.timeout = options.timeout ?? timeoutApiVal;

            function stopwatch(): () => number {
                const start = Date.now();
                return () => Date.now() - start;
            }
            if (debugLogging) {
                // this can get called befor the logger is set up
                this.logger.log(`API Call ${req.method} ${req.url}`); // consider using 'importance' parameter
            }
            const sw = stopwatch();
            try {

                // Use injected pipeline factory for testability
                const pipeLine = this.pipelineFactory();
                if (req.method === 'DELETE') {
                    // The decompressResponsePolicy adds "Accept-Encoding = gzip,deflate" header to the request, which causes 
                    // exception in pipeline: RestError: Error reading response as text: unexpected end of file
                    // core-rest-pipeline\src\nodeHttpCliett.ts line 349 (Gunzip.emit). 
                    // Workaround: remove the decompressResponsePolicy from the pipeline
                    pipeLine.removePolicy({ name: 'decompressResponsePolicy' });
                }
                azApiresponse = await pipeLine.sendRequest(this.azapiClient, req);
            }
            catch (error: any) {
                if (error instanceof AbortError || error?.name === 'AbortError') {
                    const elapsedms = sw();
                    const errmsgasjson: any = {
                        'error': `Timeout error ${elapsedms}ms ${req.url}`
                    };
                    azApiresponse = {
                        status: 408, // TIMEOUT
                        request: req,
                        headers: headers,
                        bodyAsText: JSON.stringify(errmsgasjson)
                    };
                }
                else {
                    throw error;
                }
            }
            finally {
                activity.addOrUpdateProperties({
                    'endpoint': baseUrl,
                    'httpmethod': req.method,
                    'resourcePath': JSON.stringify((options.pathTemplate ?? theUrl).split('/'))
                });
            }
            const elapsedms = sw();
            const rootActivityId = azApiresponse.headers.get('x-ms-root-activity-id');
            const requestId = azApiresponse.headers.get('RequestId');
            if (azApiresponse.status >= 300) {
                activity.addOrUpdateProperties({ 'bodyAsText': azApiresponse.bodyAsText ?? 'No body' });
            }
            activity.addOrUpdateProperties({ 'statusCode': azApiresponse.status.toString(), 'apiTimeout': req.timeout.toString(), 'rootActivityId': rootActivityId, 'requestId': requestId });

            if (debugLogging) {
                // get the header key 'x-ms-root-activity-id' from the response  header information
                this.logger.log(`    API Call Status (${elapsedms}ms) = ${azApiresponse.status}  RootActivityId = ${rootActivityId} RequestId = ${requestId}`);
                // if (azApiresponse.bodyAsText) {
                //     extensionVariables.serviceCollection.logger.log(`       Body = ${azApiresponse.bodyAsText}`); // warning: the body can be very big, clouding the log. todo: Use verbosity
                // }
            }

            const response: IApiClientResponse = {
                requestOptions: options,
                request: req,
                elapsedms: elapsedms,
                response: azApiresponse,
                url: theUrl,
                status: azApiresponse.status,
                headers: azApiresponse.headers
            };
            // for non-successful responses, add the body to the telemetry properties
            if (azApiresponse.bodyAsText) {
                response.bodyAsText = azApiresponse.bodyAsText;
                if (azApiresponse.headers.get('Content-Type')?.startsWith('application/json')) { // if it says we have JSON, then parse it
                    try {
                        response.parsedBody = JSON.parse(azApiresponse.bodyAsText);
                    }
                    catch (error) {
                        this.logger.reportExceptionTelemetryAndLog('sendRequest', 'json-parse', error, this.telemetryService);
                        throw error;
                    }
                }
                else {
                    // on Edog with Onebox workload, the response Content-Type is xml, not JSON, so we don't parse it.. (On OneBoxToOneBox, it is JSON so we'll try to parse it successfully as JSON above.)
                    // so for OneBox and EDOG, we'll try to parse it as JSON even if it fails, we'll just log it as text and not throw
                    const env = this.fabricEnvironmentProvider.getCurrent().env;
                    if (env === FabricEnvironmentName.ONEBOX || env === FabricEnvironmentName.EDOG || env === FabricEnvironmentName.EDOGONEBOX) { // ONEBOX, EDOG, or EDOGONEBOX
                        try {
                            response.parsedBody = JSON.parse(azApiresponse.bodyAsText);
                            this.logger.log(`ONEBOX: Parsed body as JSON ContentType = ${azApiresponse.headers.get('Content-Type')}: ${azApiresponse.bodyAsText}`);
                        }
                        catch (error) {
                            this.logger.log(`ONEBOX: exception parsing bodyAsText as JSON. ContentType = ${azApiresponse.headers.get('Content-Type')}: ${azApiresponse.bodyAsText}`);
                            // don't throw!!
                        }

                    }
                }
            }
            return response;
        });
    }
}
