# ClinePass Provider Monitor for SillyTavern

An observation-only SillyTavern UI extension that reports which downstream provider a `cline-pass/*` response says it used.

It watches SillyTavern's chat-completion response, reads a cloned copy of the stream, and looks for Cline/Vercel-style routing fields:

- `finalProvider`
- `resolvedProvider`
- `totalProviderAttemptCount`
- provider-attempt records

The extension compares the observed final provider with the expected provider slug you configure, then reports **MATCHED**, **MISMATCH**, or **UNKNOWN**.

## Safety and scope

This extension is deliberately read-only:

- It does not add or overwrite request parameters.
- It does not retry, cancel, delay, or replace generations.
- It does not read or store API keys.
- It returns the original `Response` object to SillyTavern unchanged.

The response clone is inspected asynchronously after the stream finishes, so normal token streaming continues.

## Install from SillyTavern

1. Open **Extensions**.
2. Choose **Install Extension**.
3. Paste `https://github.com/meowings20000/sillytavern-clinepass-provider-monitor.git`.
4. Install it for the current user (or all users, if desired).
5. Reload SillyTavern if the panel does not appear immediately.

The extension appears under **ClinePass Provider Monitor** in Extension settings.

## Use

1. Enable **Monitor responses for `cline-pass/*` models**.
2. Set **Expected provider slug** to the exact provider identifier you expect, for example `moonshotai`.
3. Generate a normal reply using a model such as `cline-pass/kimi-k3`.
4. Wait for the stream to finish and read **Last observation**.

The browser console also receives the complete routing object when one is found.

## Result meanings

- **MATCHED**: response metadata contains the expected final provider.
- **MISMATCH**: response metadata contains a different final provider.
- **UNKNOWN**: no conclusive `finalProvider` or `resolvedProvider` reached SillyTavern.

`UNKNOWN` is important: an OpenAI-compatible relay such as New API may consume or strip the upstream metadata. In that case this browser extension cannot prove the final provider. It does not guess from the model name or response text.

## Compatibility

- SillyTavern 1.18.0 or newer
- Chat Completion requests generated through SillyTavern's `/api/backends/chat-completions/generate` endpoint
- Model names beginning with `cline-pass/` (case-insensitive)
- Streaming SSE and non-stream JSON responses

## Development

```powershell
npm test
npm run check
```

No runtime dependencies or build step are required.
