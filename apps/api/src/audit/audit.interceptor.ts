import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, tap } from 'rxjs';
import { AUDIT_KEY, AuditMetadata } from '../common/decorators/audit.decorator';
import { RequestWithUser } from '../common/types/authenticated-user';
import { AuditService } from './audit.service';
import { clientIp } from '../common/utils/request';

/**
 * Journalise automatiquement les routes annotees @Audit.
 *
 * N'ecrit qu'en cas de succes : `tap` ne se declenche pas sur erreur, donc
 * une action refusee par un guard ou invalidee ne laisse pas de trace
 * mensongere d'execution. Les echecs qui doivent etre traces (connexion
 * refusee, par ex.) sont ecrits explicitement par leur service.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly auditService: AuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const metadata = this.reflector.getAllAndOverride<AuditMetadata>(AUDIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!metadata) return next.handle();

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const user = request.user;

    return next.handle().pipe(
      tap((result) => {
        const idParam = metadata.idParam ?? 'id';
        const entityId =
          (request.params?.[idParam] as string | undefined) ??
          (isRecord(result) && typeof result.id === 'string' ? result.id : null);

        void this.auditService.log({
          actor: user ? { id: user.id, email: user.email, role: user.role } : null,
          action: metadata.action,
          entity: metadata.entity,
          entityId,
          after: result,
          ip: clientIp(request),
          userAgent: request.headers['user-agent'] ?? null,
        });
      }),
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
