import { McpApp, Module, ConfigModule } from '@nitrostack/core';
import { SentinelModule } from './modules/sentinel/sentinel.module.js';
import { LedgerModule } from './modules/ledger/ledger.module.js';
import { VerdictModule } from './modules/verdict/verdict.module.js';
import { RelayModule } from './modules/relay/relay.module.js';
import { AegisModule } from './modules/aegis/aegis.module.js';
import { CommandModule } from './modules/command/command.module.js';
import { SystemHealthCheck } from './health/system.health.js';

/**
 * Root Application Module — the COMMAND platform.
 *
 * Five standalone commanders (SENTINEL·DevOps, LEDGER·FinOps, VERDICT·Legal,
 * RELAY·Civic, AEGIS·Trust) share one engine core, plus a COMMAND coordinator
 * that runs the whole fleet as one governed operation.
 */
@McpApp({
  module: AppModule,
  server: {
    name: 'command-platform',
    version: '1.0.0'
  },
  logging: {
    level: 'info'
  }
})
@Module({
  name: 'app',
  description: 'COMMAND — autonomous enterprise OS (SENTINEL · LEDGER · VERDICT · RELAY · AEGIS)',
  imports: [
    ConfigModule.forRoot(),
    SentinelModule,
    LedgerModule,
    VerdictModule,
    RelayModule,
    AegisModule,
    CommandModule
  ],
  providers: [
    // Health Checks
    SystemHealthCheck,
  ]
})
export class AppModule {}

