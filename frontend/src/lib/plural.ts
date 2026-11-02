/**
 * English count nouns inflect ("1 credit", "2 credits"); Vietnamese count
 * nouns do not, so its singular and plural catalogue values are identical.
 */
export function countLabel(count: number, singular: string, plural: string): string {
  return count === 1 ? singular : plural;
}
