import { Logger } from '@nestjs/common';
import type { RateProvider } from '../rate-provider.interface';
import { FrankfurterProvider } from './frankfurter.provider';
import { ErApiProvider } from './erapi.provider';

const logger = new Logger('FxProviderFactory');

/**
 * Build a concrete `RateProvider` from a provider name (env-selected).
 * Recognised: `frankfurter` (primary default) and `erapi` /
 * `exchangerate-api` / `open.er-api` (fallback default). Unknown names fall
 * back to Frankfurter with a warning so a typo never crashes startup.
 */
export function createRateProvider(name: string | undefined): RateProvider {
  switch ((name ?? '').trim().toLowerCase()) {
    case '':
    case 'frankfurter':
    case 'ecb':
      return new FrankfurterProvider();
    case 'erapi':
    case 'er-api':
    case 'open.er-api':
    case 'exchangerate-api':
      return new ErApiProvider();
    default:
      logger.warn(`Unknown FX provider "${name}", defaulting to frankfurter`);
      return new FrankfurterProvider();
  }
}
