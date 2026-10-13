/** Triggers a client-side download of a text payload (JSON, etc.). */
export function downloadTextFile(
  filename: string,
  text: string,
  mime = "application/json",
): void {
  try {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch {
    /* downloads are best-effort */
  }
}