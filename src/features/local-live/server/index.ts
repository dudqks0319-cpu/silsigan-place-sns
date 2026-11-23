import { createAirQualityProvider } from "./air-quality.ts";
import { createPlacesProvider } from "./places.ts";
import { createRuntime, type ProviderOptions } from "./runtime.ts";
import { createWeatherProvider } from "./weather.ts";

/** Server-only providers. Injectable transport and clock keep tests independent of live services. */
export function createLocalProviders(options: ProviderOptions = {}) {
  const runtime = createRuntime(options);
  return {
    getWeather: createWeatherProvider(runtime),
    getPlaces: createPlacesProvider(runtime),
    getAirQuality: createAirQualityProvider(runtime),
  };
}

const providers = createLocalProviders();
export const { getWeather, getPlaces, getAirQuality } = providers;
