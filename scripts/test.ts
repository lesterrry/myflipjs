import flipper = require("@flipperdevices/fz-sdk/flipper");

const model: string = flipper.getModel();
print("TypeScript pipeline works on", model);
