/** Reads a chosen .csv file in the browser; nothing is uploaded until the form is sent. */
export async function readCsvFile(file: File): Promise<{ csv: string; fileName: string }> {
  return { csv: await file.text(), fileName: file.name }
}
