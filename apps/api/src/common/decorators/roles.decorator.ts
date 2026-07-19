import { SetMetadata } from '@nestjs/common';
import { Role } from '@prisma/client';

export const ROLES_KEY = 'roles';

/**
 * Restreint une route a une liste de roles.
 * Sans ce decorateur, une route authentifiee est accessible a tous les roles :
 * chaque controleur doit donc declarer ses roles explicitement.
 */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
