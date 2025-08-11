// Property names for telemetry. These names are used to classify GDPR, or suppress.
// Other VSCode extensions might have the same name: if that other extension suppresses 'runtime', then ours is also suppressed.

export type ResultPropertyNames = 'succeeded' | 'error' | 'callstack' | 'nonLocalizedMessage' | 'result' | 'lastStep';
export type ResultMeasureNames = 'errorCode' | 'startTimeInMilliseconds' | 'endTimeInMilliseconds' | 'activityDurationInMilliseconds';
type SignInRequestPropertyNames = 'silent' | 'forceNewSession' | 'createIfNone' | 'clearSessionPreference';
type EnvironmentPropertyNames = 'environmentType';
type AccountPropertyNames = 'signedIn';
type VsCodeSessionPropertyNames = 'providerId' | 'tenantId' | 'objectOrAltsecId' | 'sessionId';
export type ApiResultPropertyNames = ResultPropertyNames | 'endpoint' | 'statusCode' | 'resourcePath' | 'apiTimeout' | 'rootActivityId' | 'requestId' | 'errorCode' | 'fabricWorkspaceName' | 'httpmethod' | 'bodyAsText';
export type WorkspacePropertyNames = 'workspaceId' | 'fabricWorkspaceName';
export type ArtifactPropertyNames = WorkspacePropertyNames | 'artifactId' | 'itemType' | 'fabricArtifactName';
export type ArtifactManagerResultPropertyNames = ApiResultPropertyNames | ArtifactPropertyNames | ResultPropertyNames;

/* eslint-disable @typescript-eslint/naming-convention */
export type TelemetryEventNames = {
	'activation': { properties: ResultPropertyNames; measurements: never },

	// auth
	'auth/get-session': {
		properties:
		| ResultPropertyNames
		| SignInRequestPropertyNames
		| EnvironmentPropertyNames
		| VsCodeSessionPropertyNames
		| AccountPropertyNames
		| 'callerId'
		| 'scopes'
		| 'tenantId'
		measurements: ResultMeasureNames
	}

	// apiclient
	'apiclient/send-request': { properties: ApiResultPropertyNames; measurements: never },

	// uri handler
	'handle-uri': { properties: ResultPropertyNames | ArtifactPropertyNames | 'query' | 'error' | 'targetEnvironment' | 'openArtifact' | 'uriQuery'; measurements: never }
};