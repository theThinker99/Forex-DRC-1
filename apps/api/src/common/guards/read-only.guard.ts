import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { RequestWithUser } from '../types/authenticated-user';

/** Roles dont l'acces est strictement consultatif, quelle que soit la route. */
const READ_ONLY_ROLES: ReadonlySet<Role> = new Set([Role.BCC]);

const SAFE_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Filet de securite global pour le mandat de controle de la BCC.
 *
 * Le RolesGuard suffirait si chaque controleur declarait ses roles sans erreur.
 * Ce guard rend l'oubli inoffensif : un futur endpoint POST/PATCH/DELETE qui
 * omettrait @Roles restera fermé à la BCC. La regle "lecture seule" cesse ainsi
 * de dependre de la vigilance du developpeur.
 *
 * Une exception legitime (ex. la BCC devrait pouvoir annoter un controle)
 * devra passer par un retrait explicite de son role de READ_ONLY_ROLES,
 * decision qui merite une revue.
 */
@Injectable()
export class ReadOnlyGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const user = request.user;
    if (!user) return true; // Laisse le JwtAuthGuard trancher.

    if (!READ_ONLY_ROLES.has(user.role)) return true;
    if (SAFE_METHODS.has(request.method.toUpperCase())) return true;

    throw new ForbiddenException(
      'Le profil BCC est en lecture seule : aucune creation, modification ou suppression n\'est autorisee.',
    );
  }
}
