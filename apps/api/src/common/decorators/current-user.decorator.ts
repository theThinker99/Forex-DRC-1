import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthenticatedUser, RequestWithUser } from '../types/authenticated-user';

/**
 * Injecte l'utilisateur authentifie dans un handler.
 * Non nullable : le JwtAuthGuard global garantit sa presence sur toute route
 * non annotee @Public.
 */
export const CurrentUser = createParamDecorator(
  (data: keyof AuthenticatedUser | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<RequestWithUser>();
    const user = request.user as AuthenticatedUser;
    return data ? user?.[data] : user;
  },
);
