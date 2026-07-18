// Target-label generation for the Network module (migration-035).
//
// A site's label_scheme is a template expanded per drop:
//   {room}  → the drop's room number
//   {jack}  → expands to one label per jack letter, joined with ", "
//   {jacks} → the jack letters joined with commas, inside a single label
//
// "{room}-{jack}" with jacks "A,B,C" → "2153-A, 2153-B, 2153-C"
// "{room} {jacks}" with jacks "A,B,C" → "2153 A,B,C"
export function genTargetLabel(room: string, jacks: string | null, scheme: string): string {
  const letters = (jacks && jacks.trim() !== '' ? jacks : 'A,B,C')
    .split(',').map((s) => s.trim()).filter(Boolean);
  if (scheme.includes('{jack}')) {
    return letters.map((j) => scheme.replaceAll('{room}', room).replaceAll('{jack}', j)).join(', ');
  }
  return scheme.replaceAll('{room}', room).replaceAll('{jacks}', letters.join(','));
}
