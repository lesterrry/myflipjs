# myflipjs

TypeScript source files for Flipper Zero's mJS interpreter. The build follows
the official `@flipperdevices/fz-sdk` target and the sync step uses the
Flipper's USB serial CLI.

## Setup

```sh
npm install
```

Use a current official firmware whose JavaScript SDK version matches the
installed `@flipperdevices/fz-sdk` package. The generated script checks this at
startup so an incompatible device fails clearly.

## Add and build scripts

Every top-level `scripts/<name>.ts` file is an entry point and becomes
`dist/<name>.js`. Subdirectories under `scripts/` may contain imported helper
modules; they do not become standalone device scripts.

```sh
npm run build
```

The committed source of truth is `scripts/**/*.ts`. Generated `dist/` files and
installed dependencies are intentionally ignored by Git.

## Sync to Flipper Zero

Connect the Flipper over a USB data cable and close qFlipper so it releases the
serial port. Then run:

```sh
npm run sync
```

This copies every `dist/*.js` file to the constant device directory
`/ext/apps/Scripts`, preserving each basename. A same-named file is removed and
replaced; unrelated files on the Flipper are left alone. Missing files are
created.

To sync only selected scripts:

```sh
npm run sync -- test another-script
```

If more than one Flipper is connected, select its serial port explicitly:

```sh
npm run sync -- --port /dev/cu.usbmodemflip_NAME test
```

Build and sync everything in one command:

```sh
npm run deploy
```

The source, output, and device directories are centralized in
`tools/config.mjs`.

## Imports

Use the SDK imports to get Flipper-aware type checking and code completion:

```ts
import * as storage from "@flipperdevices/fz-sdk/storage";
```

The official SDK documentation is at
<https://developer.flipper.net/flipperzero/doxygen/js.html>.
