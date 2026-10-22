/** Batticaloa extract configuration. All data endpoints are same-origin Pages assets. */
export const mapConfig = Object.freeze({
  center: [81.695, 7.71],
  zoom: 8.35,
  minZoom: 2,
  maxZoom: 16,
  bounds: [81.45, 7.35, 81.9, 8.35],
  styles: Object.freeze({
    light: './assets/styles/batticaloa-light.json',
    dark: './assets/styles/batticaloa-dark.json'
  })
});

export const archiveThemes = Object.freeze(['base', 'transportation', 'buildings', 'places']);
