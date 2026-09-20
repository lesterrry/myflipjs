import path from "node:path";

export const PROJECT_ROOT = path.resolve(import.meta.dirname, "..");
export const SOURCE_DIR = path.join(PROJECT_ROOT, "scripts");
export const COMPILED_DIR = path.join(PROJECT_ROOT, ".build");
export const OUTPUT_DIR = path.join(PROJECT_ROOT, "dist");

// All generated scripts are copied here on the Flipper's microSD card.
export const DEVICE_DIR = "/ext/apps/Scripts";

export const SERIAL_BAUD_RATE = 230400;
export const MINIFY = false;
export const ENFORCE_SDK_VERSION = true;
