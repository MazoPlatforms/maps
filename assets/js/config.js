/** Map and data-provider configuration. Keep credentials out of this public file. */
export const mapConfig = Object.freeze({
  center: [79.8612, 6.9271],
  zoom: 11.6,
  minZoom: 2,
  maxZoom: 19,
  styles: Object.freeze({
    light: 'https://tiles.openfreemap.org/styles/positron',
    dark: 'https://tiles.openfreemap.org/styles/dark'
  })
});

/** Future data providers are registered here after source and license review. */
export const dataSources = Object.freeze({
  overture: { status: 'planned', url: null, layers: [] },
  pointsOfInterest: { status: 'planned', url: null, layers: [] }
});
