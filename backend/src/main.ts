import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, VersioningType, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import compression from 'compression';
import { AppModule } from './app.module';
import { HttpErrorFilter } from './common/filters/http-error.filter';
import { RequestIdInterceptor } from './common/interceptors/request-id.interceptor';
import { ZodValidationPipe } from './common/pipes/zod-validation.pipe';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule, { bufferLogs: true, rawBody: true });

  const config = app.get(ConfigService);
  const port = config.get<number>('PORT') ?? 3001;
  const frontend = config.get<string>('FRONTEND_URL') ?? 'http://localhost:3000';
  const env = config.get<string>('NODE_ENV') ?? 'development';

  // Security headers
  app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));

  // Response compression
  app.use(compression());

  // CORS
  app.enableCors({
    origin: env === 'production' ? [frontend] : true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Organization-Id', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id'],
  });

  // API prefix + versioning
  app.setGlobalPrefix(config.get<string>('API_GLOBAL_PREFIX') ?? 'api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  // Global validation (class-validator for class DTOs, Zod pipe for explicit Zod schemas)
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
    new ZodValidationPipe(),
  );

  // Global interceptor (request-id, logging)
  app.useGlobalInterceptors(app.get(RequestIdInterceptor));

  // Global error filter (enveloppe { success, error })
  app.useGlobalFilters(new HttpErrorFilter());

  // Swagger (only in non-production)
  if (env !== 'production') {
    const swagger = new DocumentBuilder()
      .setTitle('AIBOS API')
      .setDescription('AI Business Operating System — REST API')
      .setVersion('0.1.0')
      .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' })
      .addApiKey({ type: 'apiKey', name: 'X-Organization-Id', in: 'header' }, 'X-Organization-Id')
      .build();
    const document = SwaggerModule.createDocument(app, swagger);
    SwaggerModule.setup('api/docs', app, document, {
      swaggerOptions: { persistAuthorization: true },
    });
  }

  // Graceful shutdown
  app.enableShutdownHooks();

  await app.listen(port);
  logger.log(`AIBOS Backend running at http://localhost:${port}/api/v1`);
  logger.log(`Swagger UI:            http://localhost:${port}/api/docs`);
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal bootstrap error:', err);
  process.exit(1);
});
