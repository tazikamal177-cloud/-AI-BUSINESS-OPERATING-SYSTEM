import { Module, Global } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';

const isProd = process.env.NODE_ENV === 'production';

@Global()
@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        level: isProd ? 'info' : 'debug',
        transport: isProd
          ? undefined
          : {
              target: 'pino-pretty',
              options: { singleLine: true, translateTime: 'HH:MM:ss.l', ignore: 'pid,hostname' },
            },
        // Reuse the request id set by our RequestIdInterceptor
        genReqId: (req) => (req.headers['x-request-id'] as string) || crypto.randomUUID(),
        customProps: () => ({ service: 'aibos-backend' }),
        serializers: {
          req: (req) => ({ method: req.method, url: req.url, remoteAddress: req.remoteAddress }),
          res: (res) => ({ statusCode: res.statusCode }),
        },
        redact: {
          paths: ['req.headers.authorization', 'req.headers.cookie', 'req.body.password', 'req.body.credentials'],
          censor: '[REDACTED]',
        },
        autoLogging: {
          ignore: (req) => req.url === '/api/health' || req.url === '/api/health/ready',
        },
      },
    }),
  ],
  exports: [LoggerModule],
})
export class AppLoggerModule {}
