const CHUNK_SIZE = 1024 * 1024;

export interface TusUpload {
  file: File;
  uploadUrl: string | null;
  bytesUploaded: number;
  totalBytes: number;
  status: "pending" | "uploading" | "completed" | "error" | "cancelled";
  error: string | null;
  id: string;
}

export interface UploadProgress {
  id: string;
  filename: string;
  progress: number;
  status: TusUpload["status"];
  error: string | null;
}

function encodeMetadataValue(value: string): string {
  return btoa(value);
}

export async function createTusUpload(
  file: File,
  targetFolderPath: string,
  onProgress: (uploaded: number, total: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  const metadata = [
    `filename ${encodeMetadataValue(file.name)}`,
    `filetype ${encodeMetadataValue(file.type || "application/octet-stream")}`,
    `targetFolder ${encodeMetadataValue(targetFolderPath)}`,
  ].join(",");

  const createRes = await fetch("/api/uploads", {
    method: "POST",
    headers: {
      "Upload-Length": String(file.size),
      "Upload-Metadata": metadata,
      "Tus-Resumable": "1.0.0",
    },
    credentials: "same-origin",
    signal,
  });

  if (!createRes.ok) {
    const body = await createRes.json().catch(() => null);
    throw new Error(body?.error?.message ?? `Upload creation failed: ${createRes.status}`);
  }

  const location = createRes.headers.get("Location");
  if (!location) throw new Error("No Location header in upload response");

  let offset = 0;

  while (offset < file.size) {
    if (signal?.aborted) {
      await fetch(location, {
        method: "DELETE",
        headers: { "Tus-Resumable": "1.0.0" },
        credentials: "same-origin",
      }).catch(() => {});
      throw new DOMException("Upload cancelled", "AbortError");
    }

    const end = Math.min(offset + CHUNK_SIZE, file.size);
    const chunk = file.slice(offset, end);

    const patchRes = await fetch(location, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/offset+octet-stream",
        "Upload-Offset": String(offset),
        "Tus-Resumable": "1.0.0",
      },
      credentials: "same-origin",
      body: chunk,
      signal,
    });

    if (!patchRes.ok) {
      const body = await patchRes.json().catch(() => null);
      throw new Error(body?.error?.message ?? `Chunk upload failed: ${patchRes.status}`);
    }

    const newOffset = patchRes.headers.get("Upload-Offset");
    offset = newOffset ? parseInt(newOffset, 10) : end;
    onProgress(offset, file.size);
  }
}
