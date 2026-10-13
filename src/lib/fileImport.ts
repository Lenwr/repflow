export async function extractWorkoutText(
  file: File,
  onProgress: (message: string) => void,
) {
  const lower = file.name.toLowerCase();
  if (
    file.type === "text/plain" ||
    file.type === "text/csv" ||
    lower.endsWith(".txt") ||
    lower.endsWith(".csv")
  ) {
    onProgress("Lecture du fichier…");
    return file.text();
  }
  if (file.type === "application/pdf" || lower.endsWith(".pdf")) {
    onProgress("Lecture du PDF…");
    const [{ GlobalWorkerOptions, getDocument }, workerModule] =
      await Promise.all([
        import("pdfjs-dist"),
        import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
      ]);
    GlobalWorkerOptions.workerSrc = workerModule.default;
    const pdf = await getDocument({ data: await file.arrayBuffer() }).promise;
    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      onProgress(`Lecture du PDF — page ${pageNumber}/${pdf.numPages}`);
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const positioned = content.items
        .filter((item) => "str" in item && item.str.trim())
        .map((item) => ({
          text: "str" in item ? item.str.trim() : "",
          x: "transform" in item ? item.transform[4] : 0,
          y: "transform" in item ? item.transform[5] : 0,
        }));
      const rows: { y: number; items: typeof positioned }[] = [];
      for (const item of positioned) {
        let row = rows.find((candidate) => Math.abs(candidate.y - item.y) < 3);
        if (!row) {
          row = { y: item.y, items: [] };
          rows.push(row);
        }
        row.items.push(item);
      }
      pages.push(
        rows
          .sort((a, b) => b.y - a.y)
          .map((row) =>
            row.items
              .sort((a, b) => a.x - b.x)
              .map((item) => item.text)
              .join(" | "),
          )
          .join("\n"),
      );
    }
    const result = pages.join("\n").trim();
    if (!result)
      throw new Error(
        "Ce PDF semble être scanné. Exportez sa page en JPEG/PNG pour utiliser la reconnaissance visuelle.",
      );
    return result;
  }
  if (file.type.startsWith("image/") || /\.(jpe?g|png|webp)$/i.test(lower)) {
    const { recognize } = await import("tesseract.js");
    const result = await recognize(file, "fra+eng", {
      logger: (event) => {
        if (event.status === "recognizing text")
          onProgress(
            `Reconnaissance de l’image — ${Math.round((event.progress ?? 0) * 100)}%`,
          );
        else onProgress("Préparation de la reconnaissance…");
      },
    });
    return result.data.text.trim();
  }
  throw new Error(
    "Format non pris en charge. Utilisez PDF, JPEG, PNG, TXT ou CSV.",
  );
}
