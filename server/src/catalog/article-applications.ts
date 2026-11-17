import data from './article-applications.json';
import reviewedData from './reviewed-applications.json';

interface VehicleProfile {
  brand: string;
  model: string;
  configuration: string;
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
  profiles: VehicleProfile[];
  articles: Record<string, [number, string, string][]>;
};

const reviewed = reviewedData as unknown as {
  checkedDate: string;
  profiles: VehicleProfile[];
  articles: Record<string, number[]>;
};

function publicApplication(profile: VehicleProfile, checkedDate: string): CatalogApplication {
  // Project public fields explicitly; internal evidence never reaches the browser.
  return { brand: profile.brand, model: profile.model, configuration: profile.configuration,
    checkedDate, ...(profile.modelYearFrom === undefined ? {} : { modelYearFrom: profile.modelYearFrom }) };
}

/** Exact reviewed article only. No prefix, suffix, model-code or cross-reference inference. */
export function articleApplications(code: string | undefined): CatalogApplication[] | undefined {
  if (!code) return undefined;
  if (Object.prototype.hasOwnProperty.call(registry.articles, code)) {
    return registry.articles[code].map(([index]) => publicApplication(registry.profiles[index], registry.checkedDate));
  }
  if (Object.prototype.hasOwnProperty.call(reviewed.articles, code)) {
    return reviewed.articles[code].map((index) => publicApplication(reviewed.profiles[index], reviewed.checkedDate));
  }
  return undefined;
}
