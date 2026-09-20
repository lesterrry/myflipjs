/** biome-ignore-all lint/correctness/noUnusedVariables: TypeScript requires these two marker interfaces for ES2015 type checking. */
// They add no runtime APIs beyond the Function type declared by the fz-sdk.
/** biome-ignore-all lint/complexity/noBannedTypes: KISS */

interface CallableFunction extends Function {}
interface NewableFunction extends Function {}
