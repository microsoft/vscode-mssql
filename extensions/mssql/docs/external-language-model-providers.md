# External Language Model Providers

The MSSQL extension can register external `vscode.lm` providers for SQL inline completion:

- `anthropic-api`: streams directly from the Anthropic Messages API.
- `openai-api`: streams directly from the OpenAI Chat Completions API.

The SDK providers support native cancellation, return API usage when available, and are the path expected to make automatic inline completion responsive. Typical first-token latency is 300-800ms for Anthropic and 200-600ms for OpenAI; full continuation completions are usually 1-3s, while larger intent-mode completions are usually 2-6s.

## API Providers

Set API keys with the command palette:

- **Set Anthropic API Key**
- **Set OpenAI API Key**

Keys are stored in VS Code SecretStorage, backed by the OS keychain, and are not written to `settings.json`. The providers resolve keys in this order:

1. SecretStorage.
2. `mssql.copilot.sdkProviders.<vendor>.env` fallback value for `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`.
3. The process environment variable.

SDK settings:

- `mssql.copilot.sdkProviders.anthropic.enabled`
- `mssql.copilot.sdkProviders.anthropic.additionalModels`
- `mssql.copilot.sdkProviders.anthropic.baseUrl`
- `mssql.copilot.sdkProviders.anthropic.timeout`
- `mssql.copilot.sdkProviders.anthropic.env`
- `mssql.copilot.sdkProviders.openai.enabled`
- `mssql.copilot.sdkProviders.openai.additionalModels`
- `mssql.copilot.sdkProviders.openai.baseUrl`
- `mssql.copilot.sdkProviders.openai.timeout`
- `mssql.copilot.sdkProviders.openai.env`

Use `baseUrl` for corporate gateways, proxies, LiteLLM, or Azure OpenAI-compatible routing. Add preview or organization-specific models with `additionalModels`.

## Selection

Inline completion queries vendors from `mssql.copilot.inlineCompletions.modelVendors`, which defaults to:

```jsonc
["copilot", "anthropic-api", "openai-api"]
```

`mssql.copilot.inlineCompletions.modelFamily` applies when the inline completion profile is `default`. Preset profiles use their own model preference, category, and debounce defaults.

`mssql.copilot.inlineCompletions.profile` controls the default request profile:

- `default`: standard inline completion behavior.
- `focused`: intent-only completions with the lowest automatic request volume.
- `balanced`: intent-only completions with a moderate automatic debounce.
- `broad`: intent and continuation completions with the quickest debounce.

Inline completion has two request categories:

- `continuation`: cursor-continuation ghost text for the current SQL statement.
- `intent`: comment-to-query completions when a natural-language SQL request is directly above the cursor.

`mssql.copilot.inlineCompletions.enabledCategories` defaults to both categories. Set it to `["continuation"]`, `["intent"]`, or `[]` to narrow or disable category handling without changing provider registration.

## Limitations

- Providers are text-in/text-out only.
- Tool calls and image inputs are intentionally unsupported.
- OpenAI token counting is approximate before a request; Anthropic uses the native count endpoint with approximation fallback.
- Streaming usage is recorded for telemetry, but prompt text, response text, API keys, and user queries are never logged.
