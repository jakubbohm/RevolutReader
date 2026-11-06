// The launch images iOS shows while the Home Screen app opens (c003 design.md D10), laid out as the Screens artboard
// "Shell / Launch / Default". Run by `npm run icons` after the icons; the images are committed, the build never runs
// this. It uses the icon tool's API rather than its CLI, because the CLI can neither round the icon's corners nor skip
// the landscape images.
import { mkdir, readFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { generateAssets } from "@vite-pwa/assets-generator/api/generate-assets";
import { generateHtmlMarkup } from "@vite-pwa/assets-generator/api/generate-html-markup";
import { instructions } from "@vite-pwa/assets-generator/api/instructions";
import {
  AllAppleDeviceNames,
  appleSplashScreenSizes,
  type AppleDeviceSize,
} from "@vite-pwa/assets-generator/config";

/** The source art, as for the icons (pwa-assets.config.ts): a 1024 × 1024 square. */
const ART = new URL("public/app-icon.svg", import.meta.url);
const ART_SIZE = 1024;

/** The images' folder, which holds nothing else, and its address. */
const FOLDER = new URL("public/launch/", import.meta.url);
const ADDRESS = "/launch/";

/** The artboard's icon: 96 × 96 pt with corners of `radius-sheet`, 24 pt. */
const ICON_PT = 96;
const CORNER_PT = 24;

/** `color-pwa-background`, light and dark; the icon is the same in both. */
const LIGHT = "#f6f4ef";
const DARK = "#111416";

/** iPhone 11 to 17, the Air and the 16e (D10); no iPads. */
const iPhones = AllAppleDeviceNames.filter((name) =>
  /^iPhone (1[1-7]|Air)/.test(name),
);

/**
 * One iPhone's screen. The tool shrinks the icon to (1 − padding) of the screen's width in pixels, so this padding makes
 * it 96 pt wide on every screen, as in the artboard.
 */
function screenOf(device: AppleDeviceSize): AppleDeviceSize {
  return {
    ...device,
    padding: 1 - (ICON_PT * device.scaleFactor) / device.width,
  };
}

/** The art clipped to the artboard's rounded square, in memory only; the corners show the screen's background. */
function roundedIcon(art: string): Buffer {
  const radius = (ART_SIZE * CORNER_PT) / ICON_PT;
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ART_SIZE} ${ART_SIZE}" width="${ART_SIZE}" height="${ART_SIZE}">` +
      `<clipPath id="rounded"><rect width="${ART_SIZE}" height="${ART_SIZE}" rx="${radius}"/></clipPath>` +
      `<g clip-path="url(#rounded)">${art}</g></svg>`,
  );
}

const art = await readFile(ART, "utf8");
const all = await instructions({
  imageResolver: () => roundedIcon(art),
  imageName: "app-icon.svg",
  preset: {
    transparent: { sizes: [] },
    maskable: { sizes: [] },
    apple: { sizes: [] },
    appleSplashScreens: {
      sizes: iPhones.map((name) => screenOf(appleSplashScreenSizes[name])),
      resizeOptions: { fit: "contain", background: LIGHT },
      darkResizeOptions: { fit: "contain", background: DARK },
      // Palette PNGs at full quality, as the icons: the edges keep their smoothing.
      png: { compressionLevel: 9, quality: 100 },
      linkMediaOptions: { basePath: ADDRESS },
    },
  },
  htmlLinks: { xhtml: false, includeId: false },
  basePath: ADDRESS,
  resolveSvgName: (name) => name,
});

// The tool makes a landscape twin of every image; the app is portrait only.
const portrait = Object.fromEntries(
  Object.entries(all.appleSplashScreen).filter(([, image]) =>
    image.linkObject?.media.includes("(orientation: portrait)"),
  ),
);
const launchImages = {
  ...all,
  favicon: {},
  transparent: {},
  maskable: {},
  apple: {},
  appleSplashScreen: portrait,
};

await rm(FOLDER, { recursive: true, force: true });
await mkdir(FOLDER, { recursive: true });
await generateAssets(launchImages, true, fileURLToPath(FOLDER));

// Their tags, light and dark, for index.html.
console.log(generateHtmlMarkup(launchImages).join("\n"));
