declare module "fflate" {
  export function deflateSync(data: Uint8Array, opts?: unknown): Uint8Array;
  export function inflateSync(data: Uint8Array, opts?: unknown): Uint8Array;
}
