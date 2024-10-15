import * as testCli from '@vscode/test-cli';

export default testCli.defineConfig({ files: 'out/test/**/*.test.js' });