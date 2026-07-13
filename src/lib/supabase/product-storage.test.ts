import { describe, expect, it } from "vitest";
import {
  PRODUCT_IMAGE_MAX_BYTES,
  detectProductImageMime,
  normalizeProductImageMime,
  validateProductImage,
} from "@/lib/supabase/product-storage";

const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);

describe("product storage image validation", () => {
  it("reconhece apenas assinaturas suportadas", () => {
    expect(detectProductImageMime(jpeg)).toBe("image/jpeg");
    expect(detectProductImageMime(png)).toBe("image/png");
    expect(detectProductImageMime(webp)).toBe("image/webp");
    expect(detectProductImageMime(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(normalizeProductImageMime("image/jpg")).toBe("image/jpeg");
  });

  it("rejeita spoofing de MIME e arquivos acima do limite", () => {
    expect(() =>
      validateProductImage({ declaredMimeType: "image/png", size: jpeg.length, bytes: jpeg })
    ).toThrow(/nao corresponde/);
    expect(() =>
      validateProductImage({
        declaredMimeType: "image/jpeg",
        size: PRODUCT_IMAGE_MAX_BYTES + 1,
        bytes: jpeg,
      })
    ).toThrow(/5 MB/);
  });
});
