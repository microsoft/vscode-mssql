# Extension Toolkit

Reusable building blocks for VS Code extensions in this repository.

The package has three public entry points with a one-way dependency direction:

- `extension-toolkit/base` contains portable primitives. It must not import the
  `vscode` module or anything from the toolkit's `vscode` layer so it remains
  usable outside the VS Code extension host.
- `extension-toolkit/vscode` contains shared extension-host services and may
  depend on `base`, the VS Code API, and VS Code-dependent libraries. Shared
  helpers such as telemetry integrations belong in this layer.
- `extension-toolkit/vscode/testing` contains test fakes and utilities. It may
  depend on either production layer, but production code must not import it so
  test-only behavior is not included in the shipped runtime.

Do not import from the package root. Use an explicit layer import instead.

## HTTP client

`extension-toolkit/base` exports a transport-neutral HTTP client. No Axios type
appears in any exported contract, so the underlying transport can be replaced
without a breaking change for callers.

```ts
import { HttpClient } from "extension-toolkit/base";

const client = new HttpClient({ logger });
const response = await client.get<Payload>(url, { headers: { Authorization: token } });
```

- `request`, `get`, and `postJson` return `IHttpResponse<T>` with `data`,
  `status`, `statusText`, `ok`, and a case-insensitive `headers` collection.
- `downloadToPath` stages the download in a sibling temporary file and only
  replaces the destination after the transfer completes, so an existing file is
  never truncated by a failed download.
- `downloadToFileDescriptor` writes to a caller-supplied descriptor and never
  closes it; the caller keeps ownership. Descriptor `0` is a valid descriptor.
- Failures are reported as `HttpClientError` with a `kind` describing the
  failure category (`network`, `timeout`, `cancelled`, `response-stream`,
  `destination`, `progress-callback`, `proxy-configuration`).

Authentication, JSON envelopes, logging, and user-facing messages are the
caller's responsibility. The client takes an optional `IHttpClientLogger` and
never localizes or surfaces UI.

### Proxy support

`HttpClient` resolves proxies from the environment (`HTTPS_PROXY`, `HTTP_PROXY`,
and `NO_PROXY`). `extension-toolkit/vscode` exports `VscodeHttpClient`, which
prefers the `http.proxy` setting and applies `http.proxyStrictSSL` to HTTPS
proxy certificate validation, falling back to the environment when `http.proxy`
is unset.

Proxy strings are parsed once by `parseProxyConfiguration`, so validation and
execution always agree. Extensions that want to warn about a malformed setting
can call `getVscodeProxyConfigurationIssue()` and localize the returned
`ProxyConfigurationIssue` themselves.
