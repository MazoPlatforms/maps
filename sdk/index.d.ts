export type Position = [number, number];
export interface CanonicalFeature {
  schemaVersion: 2;
  id: string;
  featureType: string;
  geometry: { type: string; coordinates: unknown };
  properties: Record<string, unknown>;
  status: 'active' | 'removed';
  revision: number;
  previous: string | null;
  sources: Record<string, unknown>[];
  administration: Record<string, unknown>;
}
export interface SearchOptions {
  limit?: number;
  category?: string;
  type?: string;
  bbox?: [number, number, number, number];
  near?: Position;
  radius?: number;
  region?: string;
}
export interface SearchResult {
  id: string;
  names: string[];
  position: Position;
  type: string;
  distance?: number;
  score: number;
}
export class MazoError extends Error {
  code: string;
}
export class MazoMaps {
  constructor(options?: {
    baseURL?: string | URL;
    fetcher?: typeof fetch;
    maxCachedBytes?: number;
  });
  initialize(): Promise<Record<string, unknown>>;
  getDatasetVersion(): Promise<string>;
  getFeature(id: string): Promise<CanonicalFeature>;
  getFeatureSnapshot(
    id: string,
  ): Promise<{ record: CanonicalFeature; sha256: string }>;
  getRegion(id: string): Promise<Record<string, unknown>>;
  search(query: string, options?: SearchOptions): Promise<SearchResult[]>;
  autocomplete(query: string, options?: SearchOptions): Promise<SearchResult[]>;
  geocode(query: string, options?: SearchOptions): Promise<SearchResult[]>;
  nearby(
    position: Position,
    options?: { radius?: number; limit?: number; type?: string },
  ): Promise<
    {
      id: string;
      feature: CanonicalFeature;
      distance: number;
      position: Position;
    }[]
  >;
  reverseGeocode(
    position: Position,
    options?: SearchOptions,
  ): Promise<{
    kind: 'approximate-nearby-place';
    address: null;
    results: unknown[];
    notice: string;
  }>;
}
export function normalize(value: string): string;
export function distance(a: Position, b: Position): number;
