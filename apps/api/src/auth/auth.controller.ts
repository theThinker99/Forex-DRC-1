import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CookieOptions, Response } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { AuthenticatedUser, RequestWithUser } from '../common/types/authenticated-user';
import { clientIp, userAgent } from '../common/utils/request';
import { AuthenticatedResult, AuthService } from './auth.service';
import {
  ChangePasswordDto,
  GoogleLoginDto,
  LoginDto,
  SetPasswordDto,
} from './dto/auth.dto';
import { GoogleIdentityService } from './google-identity.service';
import { parseDuration } from './tokens.service';

export const REFRESH_COOKIE = 'refresh_token';

@ApiTags('Authentification')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly google: GoogleIdentityService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Permet au frontend de n'afficher le bouton Google que s'il est reellement
   * configure cote serveur : un bouton qui echoue vaut moins que pas de bouton.
   */
  @Public()
  @Get('providers')
  @ApiOperation({ summary: 'Methodes d\'authentification disponibles' })
  providers() {
    return {
      local: true,
      google: this.google.enabled,
      googleClientId: this.config.get<string | null>('google.clientId'),
    };
  }

  /** Limite stricte : 5 tentatives par minute et par IP contre le bourrage. */
  @Public()
  @Throttle({ court: { ttl: 60_000, limit: 5 } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Connexion par email et mot de passe' })
  async login(
    @Body() dto: LoginDto,
    @Req() req: RequestWithUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.loginLocal(dto.email, dto.password, {
      ip: clientIp(req),
      userAgent: userAgent(req),
    });
    return this.respond(res, result);
  }

  @Public()
  @Throttle({ court: { ttl: 60_000, limit: 10 } })
  @Post('google')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Connexion avec Google',
    description:
      'Le backend verifie le jeton Google, retrouve le compte local par email ' +
      'ou le lie, puis ouvre une session applicative. Le role reste celui ' +
      'enregistre en base : Google ne confere aucun privilege.',
  })
  async googleLogin(
    @Body() dto: GoogleLoginDto,
    @Req() req: RequestWithUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.loginGoogle(dto.credential, {
      ip: clientIp(req),
      userAgent: userAgent(req),
    });
    return this.respond(res, result);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Renouveler l\'access token',
    description: 'Lit le refresh token dans le cookie httpOnly et le fait tourner.',
  })
  async refresh(
    @Req() req: RequestWithUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token = req.cookies?.[REFRESH_COOKIE] as string | undefined;
    if (!token) {
      throw new UnauthorizedException('Aucune session active.');
    }
    try {
      const result = await this.auth.refresh(token, {
        ip: clientIp(req),
        userAgent: userAgent(req),
      });
      return this.respond(res, result);
    } catch (error) {
      // Session morte : on nettoie le cookie, sinon le navigateur le
      // represente indefiniment et l'utilisateur reste bloque.
      res.clearCookie(REFRESH_COOKIE, this.cookieOptions(0));
      throw error;
    }
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Deconnexion : revoque le refresh token courant' })
  async logout(
    @Req() req: RequestWithUser,
    @Res({ passthrough: true }) res: Response,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    const token = req.cookies?.[REFRESH_COOKIE] as string | undefined;
    await this.auth.logout(
      token,
      { id: user.id, email: user.email, role: user.role },
      { ip: clientIp(req), userAgent: userAgent(req) },
    );
    res.clearCookie(REFRESH_COOKIE, this.cookieOptions(0));
  }

  @Get('me')
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Profil de l\'utilisateur connecte' })
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.auth.me(user.id);
  }

  @Post('link-google')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Lier un compte Google au compte connecte',
    description:
      'L\'adresse du compte Google doit correspondre a celle du compte local.',
  })
  linkGoogle(
    @Body() dto: GoogleLoginDto,
    @Req() req: RequestWithUser,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.auth.linkGoogle(user.id, dto.credential, {
      ip: clientIp(req),
      userAgent: userAgent(req),
    });
  }

  @Post('unlink-google')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Delier le compte Google' })
  unlinkGoogle(@Req() req: RequestWithUser, @CurrentUser() user: AuthenticatedUser) {
    return this.auth.unlinkGoogle(user.id, {
      ip: clientIp(req),
      userAgent: userAgent(req),
    });
  }

  @Post('change-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Changer son mot de passe',
    description: 'Ferme toutes les autres sessions de l\'utilisateur.',
  })
  async changePassword(
    @Body() dto: ChangePasswordDto,
    @Req() req: RequestWithUser,
    @Res({ passthrough: true }) res: Response,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.auth.changePassword(user.id, dto.currentPassword, dto.newPassword, {
      ip: clientIp(req),
      userAgent: userAgent(req),
    });
    // La session courante est revoquee elle aussi : on force une reconnexion
    // plutot que de laisser un cookie orphelin.
    res.clearCookie(REFRESH_COOKIE, this.cookieOptions(0));
  }

  @Post('set-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Definir un premier mot de passe (compte cree via Google)',
  })
  async setPassword(
    @Body() dto: SetPasswordDto,
    @Req() req: RequestWithUser,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.auth.setInitialPassword(user.id, dto.newPassword, {
      ip: clientIp(req),
      userAgent: userAgent(req),
    });
  }

  // ---------------------------------------------------------------------------

  /**
   * Le refresh token part en cookie httpOnly : inaccessible au JavaScript,
   * donc inexploitable par une XSS. L'access token, lui, est renvoye dans le
   * corps et reste en memoire cote client (jamais localStorage).
   */
  private respond(res: Response, result: AuthenticatedResult) {
    const ttl = this.config.get<string>('jwt.refreshTtl') ?? '7d';
    res.cookie(REFRESH_COOKIE, result.refreshToken, this.cookieOptions(parseDuration(ttl)));
    return {
      accessToken: result.accessToken,
      expiresIn: this.config.get<string>('jwt.accessTtl'),
      user: result.user,
    };
  }

  private cookieOptions(maxAgeMs: number): CookieOptions {
    const secure = this.config.get<boolean>('cookie.secure') ?? false;
    const domain = this.config.get<string | null>('cookie.domain');
    const options: CookieOptions = {
      httpOnly: true,
      secure,
      // SameSite=None impose secure=true, ce que la config refuse hors
      // production. En dev (localhost:3000 -> localhost:4000, meme site),
      // Lax suffit et evite d'exiger HTTPS en local.
      sameSite: secure ? 'none' : 'lax',
      // Le cookie n'est envoye qu'aux routes d'authentification : aucune
      // raison qu'il accompagne un GET /api/transactions.
      path: '/api/auth',
      maxAge: maxAgeMs,
    };
    // On n'ajoute l'attribut Domain que s'il est defini : un cookie host-only
    // est le comportement correct en local.
    if (domain) options.domain = domain;
    return options;
  }
}
