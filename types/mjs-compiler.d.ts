// They add no runtime APIs beyond the Function type declared by the fz-sdk.
interface CallableFunction extends Function {}
interface NewableFunction extends Function {}

// mJS arrays support bracket access, but fz-sdk's Array declaration omits it.
interface Array<T> {
	[index: number]: T;
}
