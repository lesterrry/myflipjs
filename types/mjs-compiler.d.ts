// They add no runtime APIs beyond the Function type declared by the fz-sdk.
interface CallableFunction extends Function {}
interface NewableFunction extends Function {}

// TypeScript uses this compiler-only utility when checking for-in loops.
type Extract<T, U> = T extends U ? T : never;

// mJS arrays support bracket access, but fz-sdk's Array declaration omits it.
interface Array<T> {
	[index: number]: T;
}
