import { SetMetadata } from '@nestjs/common';
import { AuditAction } from '@prisma/client';

export const AUDIT_KEY = 'audit';

export interface AuditMetadata {
  action: AuditAction;
  entity: string;
  /** Nom du parametre de route portant l'identifiant (defaut : "id"). */
  idParam?: string;
}

/**
 * Marque une route comme auditable. L'AuditInterceptor n'ecrit la trace
 * qu'apres une reponse reussie : une action rejetee par un guard ne doit
 * pas apparaitre comme executee.
 */
export const Audit = (metadata: AuditMetadata) => SetMetadata(AUDIT_KEY, metadata);
