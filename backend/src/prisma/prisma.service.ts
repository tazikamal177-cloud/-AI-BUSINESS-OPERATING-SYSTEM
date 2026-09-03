import { Global, Injectable, Module, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { AsyncLocalStorage } from 'node:async_hooks';

interface TenantStore {
  organizationId?: string;
  userId?: string;
  isService?: boolean;
}

const tenantAls = new AsyncLocalStorage<TenantStore>();

@Injectable()
export class TenantStoreService {
  get(): TenantStore {
    return tenantAls.getStore() ?? {};
  }
  run<T>(store: TenantStore, fn: () => Promise<T> | T): Promise<T> | T {
    return tenantAls.run(store, fn);
  }
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super({
      log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
    });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  /**
   * Run a callback with a tenant context bound.
   * Every Prisma query inside `fn` will set `app.current_user_id` and
   * `app.current_org_id` on the connection so RLS policies apply.
   */
  async withTenant<T>(
    store: TenantStore,
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return tenantAls.run(store, async () => {
      return this.$transaction(async (tx) => {
        if (store.userId) {
          await tx.$executeRawUnsafe(
            `SELECT set_config('app.current_user_id', $1, true)`,
            store.userId,
          );
        }
        if (store.organizationId) {
          await tx.$executeRawUnsafe(
            `SELECT set_config('app.current_org_id', $1, true)`,
            store.organizationId,
          );
        }
        await tx.$executeRawUnsafe(
          `SELECT set_config('app.is_service', $1, true)`,
          store.isService ? 'true' : 'false',
        );
        return fn(tx);
      });
    });
  }

  /**
   * Same as withTenant, but for read-only queries that don't need a transaction.
   * Falls back to the same SQL helpers.
   */
  async runWithTenant<T>(store: TenantStore, fn: () => Promise<T>): Promise<T> {
    return tenantAls.run(store, async () => {
      if (store.userId) {
        await this.$executeRawUnsafe(
          `SELECT set_config('app.current_user_id', $1, true)`,
          store.userId,
        );
      }
      if (store.organizationId) {
        await this.$executeRawUnsafe(
          `SELECT set_config('app.current_org_id', $1, true)`,
          store.organizationId,
        );
      }
      await this.$executeRawUnsafe(
        `SELECT set_config('app.is_service', $1, true)`,
        store.isService ? 'true' : 'false',
      );
      return fn();
    });
  }
}

@Global()
@Module({
  providers: [PrismaService, TenantStoreService],
  exports: [PrismaService, TenantStoreService],
})
export class PrismaModule {}
