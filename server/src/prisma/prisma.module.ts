import { Global, Logger, Module, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { RequestContextService } from '../common/context/request-context';

/**
 * Global, so no feature module has to remember to import it.
 *
 * `RequestContextService` is provided here rather than in `CommonModule`
 * because `PrismaService` cannot be constructed without it — the tenant guard
 * reads the ambient context on every query, and a module graph where the two
 * can be wired up separately is a module graph where someone eventually wires
 * up only one.
 */
@Global()
@Module({
  providers: [RequestContextService, PrismaService],
  exports: [RequestContextService, PrismaService],
})
export class PrismaModule implements OnModuleDestroy {
  private readonly logger = new Logger(PrismaModule.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Shutdown lives here, not on the service: `PrismaService`'s constructor
   * returns the extension-wrapped client, so Nest never holds an instance of
   * that class and would never call a hook declared on it. This module is an
   * ordinary class, so this one does run.
   */
  async onModuleDestroy(): Promise<void> {
    await this.prisma.$disconnect();
    this.logger.log('Prisma disconnected');
  }
}
