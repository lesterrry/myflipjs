// TypeScript requires these two marker interfaces for ES2015 type checking.
// They add no runtime APIs beyond the Function type declared by the fz-sdk.
interface CallableFunction extends Function {}
interface NewableFunction extends Function {}
