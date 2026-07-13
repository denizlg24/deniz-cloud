import { describe, expect, it } from "bun:test";
import { contentDisposition } from "../content-disposition";

describe("contentDisposition", () => {
  it("keeps the fallback header ASCII-only and preserves the UTF-8 filename", () => {
    const header = contentDisposition("inline", "le_ts_care_portugal_â_desafios.png");

    expect(header).toBe(
      "inline; filename=\"le_ts_care_portugal_a_desafios.png\"; filename*=UTF-8''le_ts_care_portugal_%C3%A2_desafios.png",
    );
    expect([...header].every((character) => character.charCodeAt(0) <= 0x7f)).toBe(true);
    expect(() => new Response(null, { headers: { "Content-Disposition": header } })).not.toThrow();
  });

  it("neutralizes quotes, slashes, and line breaks in the ASCII fallback", () => {
    const header = contentDisposition("attachment", 'evil"\\\r\nname.txt');

    expect(header).toStartWith('attachment; filename="evil____name.txt"');
    expect(header).not.toContain("\r");
    expect(header).not.toContain("\n");
  });
});
