import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { UserStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import {
  AccessTokenPayload,
  RequestWithUser,
} from '../types/authenticated-user';

/**
 * Guard global : toute route est fermee sauf @Public.
 *
 * Le role et l'agence sont relus en base a chaque requete plutot que pris
 * dans le token : une revocation de droits ou une suspension de compte doit
 * prendre effet immediatement, sans attendre l'expiration de l'access token.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const token = this.extractToken(request);

    if (!token) {
      throw new UnauthorizedException('Jeton d\'acces manquant.');
    }

    let payload: AccessTokenPayload;
    try {
      payload = await this.jwtService.verifyAsync<AccessTokenPayload>(token, {
        secret: this.config.get<string>('jwt.accessSecret'),
      });
    } catch {
      throw new UnauthorizedException('Jeton d\'acces invalide ou expire.');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        role: true,
        agencyId: true,
        fullName: true,
        status: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException('Compte introuvable.');
    }
    if (user.status !== UserStatus.ACTIF) {
      throw new UnauthorizedException(
        'Compte suspendu ou archive. Contactez un administrateur.',
      );
    }

    request.user = {
      id: user.id,
      email: user.email,
      role: user.role,
      agencyId: user.agencyId,
      fullName: user.fullName,
    };
    return true;
  }

  private extractToken(request: RequestWithUser): string | null {
    const header = request.headers.authorization;
    if (!header) return null;
    const [scheme, value] = header.split(' ');
    return scheme?.toLowerCase() === 'bearer' && value ? value : null;
  }
}
