import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Ouvre une route sans authentification.
 * Le JwtAuthGuard est global : tout est ferme par defaut, on ouvre explicitement.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
