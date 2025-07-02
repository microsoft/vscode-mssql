# React Webviews

## State

Reducers are used to update the state for a webview.  They take in a `state` parameter, update it with the new state changes, and return it at the end.  The webview controller base class automatically sets `this.state = state` at the end of the reducer's execution.

If you want to update the state (and force a re-render) mid-reducer, you can manually call `this.state = state` within your reducer definition.  Do not update properties of `this.state` directly (e.g. `this.state.someProperty = "new value"`) because then the actual state is out of sync with the local `state` variable that was passed as a parameter.

## Checking Webview Size

When you build the extension, `webviews-metafile.json` will be generated at your repository root; build using `yarn build --prod` to get a version without all the debugging sourcemaps.  Upload this to the [ESBuild Bundle Analyzer](https://esbuild.github.io/analyze/) to get a visual breakdown of what's taking up space.