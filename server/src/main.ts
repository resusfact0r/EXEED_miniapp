import 'reflect-metadata';
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';

import { AppModule } from './app.module';

// Prisma's BigInt (used for telegramId) is not JSON-serializable by default.
(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () {
  return this.toString();
};

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // nginx connects over loopback. Rate-limit each visitor by the address nginx observed.
  app.set('trust proxy', 'loopback');

  app.enableCors({
    origin: process.env.CORS_ORIGIN?.split(',') ?? true,
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  app.setGlobalPrefix('api');
  app.enableShutdownHooks();

  const port = process.env.PORT ? Number(process.env.PORT) : 3000;
  await app.listen(port);

  // Ensure the port is released (and DB connections closed) on Ctrl+C / kill,
  // instead of relying on the process dying uncleanly and leaving it bound.
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, async () => {
      await app.close();
      process.exit(0);
    });
  }

  // eslint-disable-next-line no-console
  console.log(`Server listening on http://localhost:${port}/api`);
}

bootstrap();
