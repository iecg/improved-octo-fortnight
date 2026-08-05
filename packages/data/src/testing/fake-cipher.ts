/**
 * A cipher that does not encrypt.
 *
 * The repository suites are about the domain boundary and the shape of what is
 * written, not about the crypto — that has its own tests in `packages/crypto`.
 * Sealing here is a JSON string tagged with the scope and the row identity, so
 * a payload sealed by the wrong cipher, or moved to another row, still fails to
 * open and the boundary tests keep their meaning.
 *
 * Extracted rather than copied into each suite: two fakes of the same thing
 * drift, and the one that drifts is always the one holding the assertion you
 * were relying on.
 */
import type { FieldCipher, RecordIdentity } from '@couple/crypto';

export function fakeCipher(scope: FieldCipher['scope']): FieldCipher {
  let counter = 0;
  return {
    scope,
    seal: (fields, identity) => JSON.stringify({ scope, identity, fields }),
    open(blob, identity: RecordIdentity) {
      const parsed = JSON.parse(blob) as {
        scope: string;
        identity: RecordIdentity;
        fields: Record<string, unknown>;
      };
      if (parsed.scope !== scope) throw new Error('wrong scope');
      if (JSON.stringify(parsed.identity) !== JSON.stringify(identity))
        throw new Error('wrong row');
      return parsed.fields;
    },
    newId: () => `generated-${(counter += 1)}`,
  };
}
