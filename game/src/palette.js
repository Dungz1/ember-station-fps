// EMBER STATION's palette: the one source of colour truth for the scene, the view models and the
// HUD. Deep charcoal carries the station fabric, ember orange is heat, danger and the Raiders,
// teal is the Wardens' accent and the cold light of the dusk sky. The HUD styles never hardcode a
// colour: applyCssPalette() pushes these values into CSS custom properties at boot.

export const PALETTE = {
  canvas: 0x12141a,
  sky: 0x2c2733,
  ground: 0x272c33,
  surface: 0x22272e,
  surfaceDark: 0x191d23,
  surfaceLight: 0x333a42,
  hairline: 0x3c434c,
  ink: 0xefe9de,
  muted: 0x98a1aa,
  ember: 0xff7a22,
  emberDim: 0xc25a18,
  emberBright: 0xffc178,
  lava: 0xff4d00,
  teal: 0x2fd8c8,
  tealDim: 0x1b7c73,
  danger: 0xff4a38,
  warden: 0x2fd8c8,
  raider: 0xff8a2b,
  sun: 0xffb27a,
  sunSky: 0x3a3346,
  sunGround: 0x14171c,
};

// CSS custom property name -> PALETTE key. index.html styles reference exactly these names.
const CSS_VARS = {
  '--canvas': 'canvas',
  '--surface': 'surface',
  '--surface-dark': 'surfaceDark',
  '--surface-light': 'surfaceLight',
  '--hairline': 'hairline',
  '--ink': 'ink',
  '--muted': 'muted',
  '--ember': 'ember',
  '--ember-bright': 'emberBright',
  '--teal': 'teal',
  '--danger': 'danger',
};

/** A palette entry as a CSS hex string. */
export function cssHex(key) {
  return '#' + (PALETTE[key] >>> 0).toString(16).padStart(6, '0');
}

/** Push the palette into CSS custom properties so HUD styles stay colour-free. */
export function applyCssPalette(root = document.documentElement) {
  for (const name of Object.keys(CSS_VARS)) root.style.setProperty(name, cssHex(CSS_VARS[name]));
}
