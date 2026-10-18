import { runIrSequence } from "./common/ir_sequence";

// Save the learned Aiwa remote here using the Flipper Infrared app.
const REMOTE_PATH = "/ext/infrared/aiwa.ir";

// Add exact, case-sensitive button names from aiwa.ir in playback order.
// Repeating a name presses the same button again. Pause between presses: 250 ms.
// Example names only (replace with your own): "Power", "Tuner", "Memory".
const SEQUENCE: string[] = [];

runIrSequence(REMOTE_PATH, SEQUENCE);
