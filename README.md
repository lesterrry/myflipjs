# myflipjs

TypeScript source files for Flipper Zero's mJS interpreter. The build follows
the official `@flipperdevices/fz-sdk` target and the sync step uses the
Flipper's USB serial CLI.

## Setup

```sh
nvm use
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

## Aiwa IR sequence

`scripts/conf_aiwa.ts` restores settings by playing an ordered list of learned
remote buttons. It requires Unleashed firmware with the `infrared-send` JS
feature. The shared implementation is in `scripts/common/ir_sequence.ts` and
is bundled into `dist/conf_aiwa.js`.

1. On the Flipper, open **Infrared → Learn New Remote**. Learn the buttons needed
   to configure the Aiwa and save them in one remote named `aiwa`. Its file
   should be `/ext/infrared/aiwa.ir`; adjust `REMOTE_PATH` in `conf_aiwa.ts` if
   you use another filename.
2. Edit `SEQUENCE` in `scripts/conf_aiwa.ts`. Use the exact button names from
   the saved remote (`name:` fields in the `.ir` file), including capitalization.
   For example, if you saved buttons with these names:

   ```ts
   const SEQUENCE: string[] = ["Power", "Tuner", "Memory", "Preset_1", "Memory"];
   ```

   This is only an example of the list format, not an Aiwa setup procedure.
   Fill in the presses required by your model. Repeat a name to press that
   button again. The initial list is empty because no Aiwa commands have been
   supplied yet.
3. Remove `conf_aiwa.ts` from the root `exclude.txt` when you are ready to use
   it (it is excluded initially). Build and copy the script with the Flipper
   connected over USB:

   ```sh
   npm run build
   npm run sync -- conf_aiwa
   ```

4. Point the Flipper's IR transmitter at the Aiwa and open
   `apps/Scripts/conf_aiwa.js` on the device. The sequence starts immediately.
   The Aiwa must be in the starting state expected by your sequence.

Both `parsed` and `raw` signals from the
[standard Flipper `.ir` format](https://developer.flipper.net/flipperzero/doxygen/infrared_file_format.html)
are supported. The script checks the file and resolves all names before sending
anything; missing or ambiguous names stop execution. A hardcoded **250 ms**
pause separates commands, with no pause before the first or after the last.
The `.ir` file stays on the Flipper; syncing the script does not copy it.

To add another device, create a top-level script under `scripts/` and call:

```ts
import { runIrSequence } from "./common/ir_sequence";

runIrSequence("/ext/infrared/another_remote.ir", ["Power", "Input"]);
```

## Samsung menu sequence

`scripts/conf_samsung.ts` currently sends exactly **Exit → Menu → Down ×2 → OK**,
with the shared 250 ms pause between presses. It stops there so navigation can
be checked before adding clock-setting steps. Start with the TV on; the initial
Exit closes the menu before navigation begins.

The Samsung32 buttons are embedded in the TS script, using the
[AA59-00580A capture](https://github.com/Lucaslhm/Flipper-IRDB/blob/main/TVs/Samsung/Samsung_AA59-00580A.ir).
No physical remote or separate `.ir` file is needed. Compatibility with your
particular TV and its menu response time still needs to be checked on hardware.
Like the Aiwa script, this requires Unleashed's `infrared-send` feature.

```sh
npm run build
npm run sync -- conf_samsung
```

Point the Flipper at the TV and run `apps/Scripts/conf_samsung.js`. It starts
immediately. Edit `SEQUENCE` in `conf_samsung.ts` to extend the button presses.
`runIrSequence` accepts either a device `.ir` path or an inline `IrSignal[]`,
followed by the ordered button names.

## Sync to Flipper Zero

Connect the Flipper over a USB data cable and close qFlipper so it releases the
serial port. Then run:

```sh
npm run sync
```

The top-level `scripts/*.ts` entries define the device's JavaScript scripts.
Sync copies their non-excluded `dist/*.js` builds to `/ext/apps/Scripts`,
preserving each basename and replacing existing copies.

Every sync lists that device directory and removes top-level `.js` files that
have no corresponding top-level `.ts` source or are excluded. Deleting a `.ts`
therefore removes its device copy on the next sync, even without rebuilding:
stale files in `dist/` are never uploaded. This also works after rebuilding has
removed the old output. All top-level `.js` files in `/ext/apps/Scripts` are
managed this way; data files and subdirectories are preserved.

The root `exclude.txt` lists top-level filenames from `scripts/`, one per line:

```text
# Keep this script locally, but remove its JS from the Flipper.
conf_aiwa.ts
```

Blank lines and `#` comments are allowed. Use exact `.ts` filenames without
paths or wildcards; helper modules and `.d.ts` files are not entries.
Exclusions affect syncing only: sources remain in place and are still built.
Every sync removes the corresponding `.js` files from `/ext/apps/Scripts` if
they exist, including when syncing selected scripts. Excluded names cannot be
uploaded explicitly. Removal also works without a local `dist/` file. Remove
an entry to enable uploading that script again.

To sync only selected scripts:

```sh
npm run sync -- test another-script
```

Selection limits uploads only. Cleanup of excluded and deleted-source scripts
still applies to the entire device script directory. Enabled scripts that were
not selected are preserved. An empty `scripts/` directory removes all top-level
device `.js` files; a missing `scripts/` directory aborts before connecting.

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
import storage = require("@flipperdevices/fz-sdk/storage");
```

Use `import ... = require(...)` for native SDK modules to avoid JavaScript
interop helpers unavailable in mJS. Use ordinary `export` / `import` for local
TypeScript helpers; the build bundles them into each standalone script.

The official SDK documentation is at
<https://developer.flipper.net/flipperzero/doxygen/js.html>.
