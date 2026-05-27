declare module "lz4js" {
  /** Upper bound on the compressed size of `n` input bytes. */
  export function compressBound(n: number): number;
  /**
   * Compresses one raw LZ4 block from `src[sIndex .. sIndex+sLength]` into
   * `dst` (written from index 0). Returns the compressed length, or 0 if the
   * data could not be compressed. `hashTable` must be a zeroed Uint32Array
   * (>= 65536 entries) and should be cleared between independent blocks.
   */
  export function compressBlock(
    src: Uint8Array,
    dst: Uint8Array,
    sIndex: number,
    sLength: number,
    hashTable: Uint32Array
  ): number;
  export function decompressBlock(
    src: Uint8Array,
    dst: Uint8Array,
    sIndex: number,
    sLength: number,
    dIndex: number
  ): number;
  export function compress(src: Uint8Array, maxSize?: number): Uint8Array;
  export function decompress(src: Uint8Array, maxSize?: number): Uint8Array;
  export function makeBuffer(size: number): Uint8Array;
}
