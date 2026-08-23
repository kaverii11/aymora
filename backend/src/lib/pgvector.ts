/** Serializes a JS number array to the string literal pgvector expects, e.g. "[0.1,0.2,0.3]". */
export function toPgVector(values: number[]): string {
  return `[${values.join(",")}]`;
}
