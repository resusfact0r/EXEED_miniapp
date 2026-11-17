import data from './article-applications.json';

interface SourceProfile {
  brand: string;
  model: string;
  configuration: string;
  schemeUrl: string;
  modelYearFrom?: number;
}

export interface CatalogApplication {
  brand: string;
  model: string;
  configuration: string;
  checkedDate: string;
  modelYearFrom?: number;
}

const registry = data as unknown as {
  checkedDate: string;
  profiles: SourceProfile[];
  articles: Record<string, [number, string, string][]>;
};

/** Exact reviewed article only. No prefix, suffix, model-code or cross-reference inference. */
export function articleApplications(code: string | undefined): CatalogApplication[] | undefined {
  if (!code || !Object.prototype.hasOwnProperty.call(registry.articles, code)) return undefined;
  return registry.articles[code].map(([profileIndex]) => {
    const profile = registry.profiles[profileIndex];
    // Explicit public fields keep provenance and supplier URLs in the internal registry.
    return { brand: profile.brand, model: profile.model, configuration: profile.configuration,
      checkedDate: registry.checkedDate, ...(profile.modelYearFrom === undefined ? {} : { modelYearFrom: profile.modelYearFrom }) };
  });
}
