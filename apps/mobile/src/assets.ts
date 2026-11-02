/**
 * Bundled-asset URI without assuming a platform.
 *
 * On Android/iOS, require("./x.png") returns a number and
 * Image.resolveAssetSource() resolves it. On web there is no
 * resolveAssetSource — require() returns a string URL (or an object
 * wrapping one). The caller passes whatever resolver its platform has
 * (or nothing); anything else is handled by shape.
 */

export interface ResolvedAsset {
  uri: string;
  width: number;
  height: number;
}

export type AssetResolver = (
  mod: unknown,
) => { uri: string; width?: number; height?: number } | null | undefined;

export function bundledAssetUri(
  mod: unknown,
  fallbackSize: [number, number],
  resolve?: AssetResolver,
): ResolvedAsset {
  const [fw, fh] = fallbackSize;
  if (resolve) {
    try {
      const s = resolve(mod);
      if (s && typeof s.uri === "string" && s.uri) {
        return { uri: s.uri, width: s.width || fw, height: s.height || fh };
      }
    } catch {
      // fall through to the web shapes below
    }
  }
  if (typeof mod === "string" && mod) {
    return { uri: mod, width: fw, height: fh };
  }
  if (mod && typeof mod === "object" && !Array.isArray(mod)) {
    const o = mod as Record<string, unknown>;
    if (typeof o.uri === "string" && o.uri) {
      return { uri: o.uri, width: fw, height: fh };
    }
    if (typeof o.default === "string" && o.default) {
      return { uri: o.default, width: fw, height: fh };
    }
  }
  throw new Error("cannot resolve bundled asset");
}
