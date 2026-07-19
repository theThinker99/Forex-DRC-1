import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory, Reflector } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { PrismaService } from './prisma/prisma.service';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // Le body des uploads est gere par Multer, pas par le body-parser JSON.
    bodyParser: true,
  });

  const config = app.get(ConfigService);
  const logger = new Logger('Bootstrap');

  app.setGlobalPrefix('api');

  // Necessaire pour que req.ip refletent l'IP reelle derriere Nginx/Traefik,
  // et donc pour que le journal d'audit soit exploitable.
  app.set('trust proxy', 1);

  app.use(cookieParser());
  app.use(
    helmet({
      // L'API sert des PDF consultes dans un iframe du frontend.
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      contentSecurityPolicy: config.get<boolean>('isProduction') ? undefined : false,
    }),
  );

  app.enableCors({
    origin: config.get<string[]>('corsOrigins'),
    // Indispensable : le refresh token voyage en cookie httpOnly.
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      // Un champ inconnu est une erreur, pas un silence : evite qu'un client
      // croie avoir modifie un champ qui a ete ignore.
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  app.useGlobalFilters(new AllExceptionsFilter());

  const swaggerConfig = new DocumentBuilder()
    .setTitle('API Forex DRC')
    .setDescription(
      'API REST de la plateforme de change manuel pour la Republique Democratique du Congo. ' +
        'Authentification par Bearer token (access token). Le refresh token circule en cookie httpOnly.',
    )
    .setVersion('1.0')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      'access-token',
    )
    .addTag('Authentification')
    .addTag('Utilisateurs')
    .addTag('Agences')
    .addTag('Clients')
    .addTag('Taux de change')
    .addTag('Transactions')
    .addTag('Bordereaux')
    .addTag('Pieces jointes')
    .addTag('Alertes')
    .addTag('Statistiques')
    .addTag('Audit')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: { persistAuthorization: true },
  });

  const prisma = app.get(PrismaService);
  prisma.enableShutdownHooks(app);
  app.enableShutdownHooks();

  const port = config.get<number>('port') ?? 4000;
  await app.listen(port);

  logger.log(`API demarree sur http://localhost:${port}/api`);
  logger.log(`Documentation Swagger sur http://localhost:${port}/api/docs`);
  if (!config.get<boolean>('google.enabled')) {
    logger.warn(
      'GOOGLE_CLIENT_ID non configure : la connexion Google est desactivee (login email/mot de passe uniquement).',
    );
  }
}

void bootstrap();
