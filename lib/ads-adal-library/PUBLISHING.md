These steps should be followed to publish a new version of the package to npmjs.

1. Bump version if needed
2. Download ads-adal-library-X.X.X.tgz package from [Official Build Pipeline](https://mssqltools.visualstudio.com/CrossPlatBuildScripts/_build?definitionId=391&_a=summary) artifacts
3. Run `npm publish <PATH_TO_PACKAGE>/ads-adal-library-X.X.X.tgz`
   * If you do not have permissions to publish see [Publishing Microsoft scoped packages](https://docs.opensource.microsoft.com/releasing/publish/npm/#publish-microsoft-scoped-packages) to get access