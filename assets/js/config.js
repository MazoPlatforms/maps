export const mapConfig = Object.freeze({
  minZoom: 2,
  maxZoom: 16,
  bounds: Object.freeze([79.3, 5.8, 82.1, 10.1]),
  styles: Object.freeze({
    light: './assets/styles/sri-lanka-light.json',
    dark: './assets/styles/sri-lanka-dark.json',
  }),
});

export const cityViews = Object.freeze({
  colombo: { center: [79.8612, 6.9271], zoom: 14 },
  jaffna: { center: [80.0255, 9.6615], zoom: 14 },
  kandy: { center: [80.6337, 7.2906], zoom: 14 },
  galle: { center: [80.217, 6.0329], zoom: 14 },
  trincomalee: { center: [81.2152, 8.5874], zoom: 14 },
  batticaloa: { center: [81.695, 7.71], zoom: 14 },
});

export const archiveThemes = Object.freeze([
  'base',
  'transportation',
  'buildings',
  'places',
]);
