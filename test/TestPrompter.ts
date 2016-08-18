
import { IQuestion, IPrompter, IPromptCallback } from '../src/prompts/question';

// Dummy implementation to simplify mocking
class TestPrompter implements IPrompter {
    public promptSingle<T>(question: IQuestion): Promise<T> {
        return Promise.resolve(undefined);
    }
    public prompt<T>(questions: IQuestion[]): Promise<{[key: string]: T}> {
        return Promise.resolve(undefined);
    }
    public promptCallback(questions: IQuestion[], callback: IPromptCallback): void {
        callback({});
    }
}

export default TestPrompter;
