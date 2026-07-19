/**
 * Configuration centralisee, validee au demarrage.
 *
 * Un secret JWT manquant ou trop court doit faire echouer le boot, pas
 * produire des tokens signes avec une valeur par defaut devinable.
 */

export interface AppConfig {
  env: string;
  isProduction: boolean;
  port: number;
  corsOrigins: string[];
  jwt: {
    accessSecret: string;
    refreshSecret: string;
    accessTtl: string;
    refreshTtl: string;
  };
  cookie: {
    secure: boolean;
    /** Null = cookie host-only. Requis car "Domain=localhost" est rejete par certains navigateurs. */
    domain: string | null;
  };
  google: {
    clientId: string | null;
    enabled: boolean;
  };
  storage: {
    driver: 'local' | 's3';
    localPath: string;
    s3: {
      endpoint: string;
      region: string;
      bucket: string;
      accessKeyId: string;
      secretAccessKey: string;
      forcePathStyle: boolean;
    };
  };
}

const MIN_SECRET_LENGTH = 32;

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(
      `Variable d'environnement manquante : ${name}. Voir .env.example.`,
    );
  }
  return value;
}

function requiredSecret(name: string): string {
  const value = required(name);
  if (value.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `${name} doit faire au moins ${MIN_SECRET_LENGTH} caracteres. ` +
        `Generer avec : node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`,
    );
  }
  if (value.startsWith('remplacer-par')) {
    throw new Error(
      `${name} contient encore la valeur d'exemple de .env.example. Generer un vrai secret.`,
    );
  }
  return value;
}

function bool(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  return value === 'true' || value === '1';
}

export default (): AppConfig => {
  const env = process.env.NODE_ENV ?? 'development';
  const isProduction = env === 'production';

  const accessSecret = requiredSecret('JWT_ACCESS_SECRET');
  const refreshSecret = requiredSecret('JWT_REFRESH_SECRET');

  if (accessSecret === refreshSecret) {
    throw new Error(
      'JWT_ACCESS_SECRET et JWT_REFRESH_SECRET doivent etre differents : ' +
        'sinon un access token vole peut etre presente comme refresh token.',
    );
  }

  const cookieSecure = bool('COOKIE_SECURE', isProduction);
  if (isProduction && !cookieSecure) {
    throw new Error(
      'COOKIE_SECURE=false est interdit en production : le refresh token transiterait en clair.',
    );
  }

  const googleClientId = process.env.GOOGLE_CLIENT_ID?.trim() || null;

  const driver = (process.env.STORAGE_DRIVER ?? 'local') as 'local' | 's3';
  if (driver !== 'local' && driver !== 's3') {
    throw new Error(`STORAGE_DRIVER invalide : "${driver}". Attendu "local" ou "s3".`);
  }

  return {
    env,
    isProduction,
    port: Number(process.env.API_PORT ?? 4000),
    corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:3000')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
    jwt: {
      accessSecret,
      refreshSecret,
      accessTtl: process.env.JWT_ACCESS_TTL ?? '15m',
      refreshTtl: process.env.JWT_REFRESH_TTL ?? '7d',
    },
    cookie: {
      secure: cookieSecure,
      // "localhost" comme valeur de Domain est rejete par plusieurs navigateurs :
      // on le traite comme "pas de domaine" (cookie host-only), ce qui est le
      // comportement voulu en developpement.
      domain:
        !process.env.COOKIE_DOMAIN || process.env.COOKIE_DOMAIN === 'localhost'
          ? null
          : process.env.COOKIE_DOMAIN,
    },
    google: {
      clientId: googleClientId,
      // Le bouton Google est masque cote frontend si non configure :
      // mieux vaut pas de bouton qu'un bouton qui echoue.
      enabled: googleClientId !== null,
    },
    storage: {
      driver,
      localPath: process.env.STORAGE_LOCAL_PATH ?? './storage',
      s3: {
        endpoint: process.env.S3_ENDPOINT ?? '',
        region: process.env.S3_REGION ?? 'us-east-1',
        bucket: process.env.S3_BUCKET ?? '',
        accessKeyId: process.env.S3_ACCESS_KEY_ID ?? '',
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? '',
        forcePathStyle: bool('S3_FORCE_PATH_STYLE', true),
      },
    },
  };
};
