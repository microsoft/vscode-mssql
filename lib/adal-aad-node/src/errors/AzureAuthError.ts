export class AzureAuthError extends Error {

	constructor(private errorCode: number, private readonly errorMessage: string, private readonly originalException: any) {
        super(errorMessage);
    }

	getPrintableString(): string {
		return JSON.stringify({
            errorCode: this.errorCode,
			errorMessage: this.errorMessage,
			originalException: this.originalException
		}, undefined, 2);
	}
}
