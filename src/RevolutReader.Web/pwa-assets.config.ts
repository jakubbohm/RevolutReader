import {
  defineConfig,
  type AssetType,
  type Preset,
  type ResolvedAssetSize,
} from "@vite-pwa/assets-generator/config";

// The app's icons, made from the design system's App icon by `npm run icons` and committed (c003 design.md D10). The
// build never runs this tool. The art is full-bleed with the maskable safe zone drawn in, so no icon gets padding.

/** The icon's amber ground, baked into app-icon.svg: it backs the icons that must have no transparent pixel. */
const ICON_GROUND = "#edc06a";

/** The file names of the design's App icon guideline. */
const fileNames: Record<AssetType, (size: ResolvedAssetSize) => string> = {
  transparent: (size) => `icon-${size.width}.png`,
  maskable: (size) => `icon-maskable-${size.width}.png`,
  apple: () => "apple-touch-icon.png",
};

const preset: Preset = {
  // The manifest's "any" icons.
  transparent: { sizes: [192, 512], padding: 0 },
  // The manifest's "maskable" icon: Android crops it to its own shape.
  maskable: {
    sizes: [512],
    padding: 0,
    resizeOptions: { fit: "contain", background: ICON_GROUND },
  },
  // The Home Screen icon on iOS, which rounds the corners itself and turns transparency black.
  apple: {
    sizes: [180],
    padding: 0,
    resizeOptions: { fit: "contain", background: ICON_GROUND },
  },
  assetName: (type, size) => fileNames[type](size),
  // Palette PNGs, as the tool's default, but at full quality so the edges keep their smoothing. Every pixel is opaque,
  // so they carry no alpha channel, which the iOS icon needs.
  png: { compressionLevel: 9, quality: 100 },
};

export default defineConfig({
  preset,
  images: ["public/app-icon.svg"],
});
