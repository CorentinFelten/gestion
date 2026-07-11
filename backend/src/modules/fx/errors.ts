/**
 * FX provider error taxonomy.
 *
 * The distinction matters for control flow in FxService:
 * - `RateUnavailableError`, the provider has no rate for THIS exact date
 *   (weekend / holiday / before its data range). Drives the walk-back loop:
 *   FxService steps one calendar day back and retries.
 * - `RateProviderError`, the provider itself failed (network, timeout, HTTP
 *   5xx, malformed payload, unsupported currency). Aborts the walk-back and
 *   triggers the fallback provider.
 */

/** No published rate exists for the requested date, walk back one day. */
export class RateUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RateUnavailableError';
  }
}

/** The provider failed to answer, fall through to the fallback provider. */
export class RateProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RateProviderError';
  }
}
