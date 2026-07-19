import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Request, Response } from 'express';

interface ErrorBody {
  statusCode: number;
  message: string | string[];
  error: string;
  path: string;
  timestamp: string;
}

/**
 * Normalise toutes les erreurs en francais et empeche la fuite de details
 * internes (SQL, stack, contraintes) vers le client.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exception');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const body = this.toBody(exception, request);

    if (body.statusCode >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `${request.method} ${request.url} -> ${body.statusCode}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    response.status(body.statusCode).json(body);
  }

  private toBody(exception: unknown, request: Request): ErrorBody {
    const base = {
      path: request.url,
      timestamp: new Date().toISOString(),
    };

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const res = exception.getResponse();
      const message =
        typeof res === 'string'
          ? res
          : ((res as Record<string, unknown>).message as string | string[]) ??
            exception.message;
      return {
        ...base,
        statusCode: status,
        message,
        error: HttpStatus[status] ?? 'Erreur',
      };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      return { ...base, ...this.fromPrisma(exception) };
    }

    if (exception instanceof Prisma.PrismaClientValidationError) {
      return {
        ...base,
        statusCode: HttpStatus.BAD_REQUEST,
        message: 'Requete invalide : les donnees envoyees ne respectent pas le modele.',
        error: 'BAD_REQUEST',
      };
    }

    return {
      ...base,
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Une erreur interne est survenue.',
      error: 'INTERNAL_SERVER_ERROR',
    };
  }

  private fromPrisma(
    e: Prisma.PrismaClientKnownRequestError,
  ): Pick<ErrorBody, 'statusCode' | 'message' | 'error'> {
    switch (e.code) {
      case 'P2002': {
        const target = (e.meta?.target as string[] | undefined)?.join(', ');
        return {
          statusCode: HttpStatus.CONFLICT,
          message: target
            ? `Cette valeur existe deja (${target}).`
            : 'Cette valeur existe deja.',
          error: 'CONFLICT',
        };
      }
      case 'P2003':
        return {
          statusCode: HttpStatus.BAD_REQUEST,
          message: 'Reference invalide : l\'element lie n\'existe pas.',
          error: 'BAD_REQUEST',
        };
      case 'P2025':
        return {
          statusCode: HttpStatus.NOT_FOUND,
          message: 'Element introuvable.',
          error: 'NOT_FOUND',
        };
      default:
        return {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'Erreur de base de donnees.',
          error: 'INTERNAL_SERVER_ERROR',
        };
    }
  }
}
