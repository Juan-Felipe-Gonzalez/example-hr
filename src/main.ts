import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { PrismaService } from './prisma/prisma.service';
import { ProblemDetailsFilter } from './problem-details-filter';

async function bootstrap() {
  /**
   * Bootstraps the NestJS application with necessary configurations.
   * Sets up global prefix, exception filters, shutdown hooks, and starts the server.
   * Listens on PORT environment variable or defaults to 3000.
   */
  const app = await NestFactory.create(AppModule);
  const prismaService = app.get(PrismaService);

  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new ProblemDetailsFilter());

  await prismaService.enableShutdownHooks(app);
  await app.listen(process.env.PORT ?? 3000);
}

void bootstrap();
