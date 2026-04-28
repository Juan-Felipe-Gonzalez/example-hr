import { INestApplication, Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  async onModuleInit() {
    /**
     * Initializes the Prisma client connection when the module starts.
     * Ensures database connectivity before handling requests.
     */
    await this.$connect();
  }

  async enableShutdownHooks(app: INestApplication) {
    /**
     * Registers shutdown hooks to gracefully close the application.
     * Ensures proper cleanup of database connections on process termination.
     */
    const closeApp = async () => {
      await app.close();
    };

    process.once('SIGINT', closeApp);
    process.once('SIGTERM', closeApp);
    process.once('beforeExit', closeApp);
  }
}

