function encodeRfc5987(value: string): string {
  return encodeURIComponent(value).replace(
    /['()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function asciiFilename(filename: string): string {
  const fallback = filename
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7e]/g, "_")
    .replace(/["\\]/g, "_")
    .replace(/[\r\n]/g, "_")
    .trim();

  return fallback || "download";
}

export function contentDisposition(disposition: "attachment" | "inline", filename: string): string {
  const fallback = asciiFilename(filename);
  return `${disposition}; filename="${fallback}"; filename*=UTF-8''${encodeRfc5987(filename)}`;
}
