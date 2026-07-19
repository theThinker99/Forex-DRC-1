import { ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AuthenticatedUser } from '../types/authenticated-user';

/** Roles dont le perimetre est national : ils voient toutes les agences. */
const NATIONAL_ROLES: ReadonlySet<Role> = new Set([Role.ADMIN, Role.BCC]);

export function isNational(user: AuthenticatedUser): boolean {
  return NATIONAL_ROLES.has(user.role);
}

/**
 * Resout l'agence a appliquer dans un `where` Prisma.
 *
 * - ADMIN / BCC : perimetre national. Peuvent filtrer sur une agence precise.
 * - SUPERVISEUR / CABISTE : cloisonnes a leur agence. Toute demande portant
 *   sur une autre agence est un refus explicite, pas un resultat vide : un
 *   silence laisserait croire que l'agence n'existe pas, ce qui est une
 *   reponse plus trompeuse qu'utile.
 *
 * Renvoie `undefined` quand aucun filtre ne doit etre applique (national sans
 * filtre demande).
 */
export function resolveAgencyFilter(
  user: AuthenticatedUser,
  requestedAgencyId?: string,
): string | undefined {
  if (isNational(user)) {
    return requestedAgencyId;
  }

  if (!user.agencyId) {
    // Un cabiste ou superviseur sans agence est une donnee incoherente :
    // mieux vaut bloquer que servir l'integralite du parc.
    throw new ForbiddenException(
      'Votre compte n\'est rattache a aucune agence. Contactez un administrateur.',
    );
  }

  if (requestedAgencyId && requestedAgencyId !== user.agencyId) {
    throw new ForbiddenException(
      'Vous ne pouvez consulter que les donnees de votre agence.',
    );
  }

  return user.agencyId;
}

/**
 * Verifie qu'un utilisateur cloisonne agit bien dans son agence.
 * A appeler avant toute ecriture portant un agencyId venant du client.
 */
export function assertAgencyAccess(user: AuthenticatedUser, agencyId: string): void {
  if (isNational(user)) return;
  if (user.agencyId !== agencyId) {
    throw new ForbiddenException(
      'Cette operation concerne une autre agence que la votre.',
    );
  }
}

/**
 * Restriction supplementaire du cabiste : il ne voit que ses propres
 * operations. Renvoie l'identifiant d'operateur a forcer dans le `where`,
 * ou `undefined` si le role n'est pas concerne.
 */
export function resolveOperatorFilter(
  user: AuthenticatedUser,
  requestedOperatorId?: string,
): string | undefined {
  if (user.role !== Role.CABISTE) {
    return requestedOperatorId;
  }

  if (requestedOperatorId && requestedOperatorId !== user.id) {
    throw new ForbiddenException(
      'Vous ne pouvez consulter que vos propres operations.',
    );
  }

  return user.id;
}
