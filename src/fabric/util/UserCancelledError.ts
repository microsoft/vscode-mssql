import { ICanceledError } from './FabricError';

/**
 * An error that indicates the user has cancelled an operation.
 * This is typically used to signal that the user has chosen to cancel a step in a multi-step process.
 */
export class UserCancelledError extends Error implements ICanceledError {
    public readonly isCanceledError = true as const;
    /** 
     * The name of the step that was cancelled, if applicable.
     */
    public readonly stepName: string | undefined;

    /**
     * Creates a new instance of UserCancelledError.
     * @param stepName The name of the step that was cancelled, if applicable
     * @param message Optional custom message, defaults to 'Operation canceled.'
     */
    constructor(stepName?: string, message: string = 'Operation canceled.') {
        super(message);
        this.stepName = stepName;
    }
}
