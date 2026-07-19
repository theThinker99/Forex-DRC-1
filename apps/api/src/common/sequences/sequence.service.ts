import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export type SequenceScope = 'TX' | 'BRD';

/**
 * Numerotation des documents metier.
 *
 * L'unicite ne peut pas reposer sur un `count() + 1` : deux cabistes qui
 * valident au meme instant obtiendraient le meme numero. On s'appuie donc
 * sur un UPSERT atomique qui incremente et renvoie la valeur sous verrou de
 * ligne PostgreSQL.
 *
 * Toutes les methodes exigent un client transactionnel : le numero et le
 * document qu'il identifie doivent naitre ou echouer ensemble, sinon on
 * consomme des numeros dans le vide et la sequence presente des trous
 * inexplicables lors d'un controle.
 */
@Injectable()
export class SequenceService {
  /**
   * Reference de transaction : TX-GOM-20260717-000042
   * Remise a zero chaque jour et par agence : un numero reste lisible et
   * situable a l'oeil nu sur un bordereau papier.
   */
  async nextTransactionReference(
    tx: Prisma.TransactionClient,
    agencyCode: string,
    date: Date,
  ): Promise<string> {
    const period = formatDate(date);
    const value = await this.next(tx, 'TX', agencyCode, period);
    return `TX-${agencyCode}-${period}-${String(value).padStart(6, '0')}`;
  }

  /**
   * Numero de bordereau : BRD-GOM-2026-000042
   * Sequence annuelle : c'est la maille de conservation et de controle.
   */
  async nextReceiptNumber(
    tx: Prisma.TransactionClient,
    agencyCode: string,
    date: Date,
  ): Promise<string> {
    const period = String(date.getFullYear());
    const value = await this.next(tx, 'BRD', agencyCode, period);
    return `BRD-${agencyCode}-${period}-${String(value).padStart(6, '0')}`;
  }

  /**
   * Increment atomique.
   *
   * `ON CONFLICT DO UPDATE ... RETURNING` fait l'insertion et l'increment en
   * une seule instruction : PostgreSQL serialise les concurrents sur la ligne,
   * sans lecture-puis-ecriture cote applicatif.
   */
  private async next(
    tx: Prisma.TransactionClient,
    scope: SequenceScope,
    agency: string,
    period: string,
  ): Promise<number> {
    const rows = await tx.$queryRaw<Array<{ current: number }>>`
      INSERT INTO document_sequences (id, scope, agency, period, current)
      VALUES (gen_random_uuid(), ${scope}, ${agency}, ${period}, 1)
      ON CONFLICT (scope, agency, period)
      DO UPDATE SET current = document_sequences.current + 1
      RETURNING current
    `;

    if (rows.length === 0) {
      throw new Error(
        `Echec d'attribution d'un numero (${scope}/${agency}/${period}).`,
      );
    }
    return rows[0].current;
  }
}

/** Date -> "20260717", en heure locale du serveur (heure du guichet). */
function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}
