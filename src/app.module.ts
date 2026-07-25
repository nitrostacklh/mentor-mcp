import { McpApp, Module, ConfigModule } from '@nitrostack/core';
import { SentinelModule } from './modules/sentinel/sentinel.module.js';
import { LedgerModule } from './modules/ledger/ledger.module.js';
import { VerdictModule } from './modules/verdict/verdict.module.js';
import { RelayModule } from './modules/relay/relay.module.js';
import { AegisModule } from './modules/aegis/aegis.module.js';
import { CommandModule } from './modules/command/command.module.js';
import { MentorModule } from './modules/mentor/mentor.module.js';
import { SystemHealthCheck } from './health/system.health.js';

/**
 * Root Application Module — the COMMAND platform.
 *
 * Six standalone commanders (SENTINEL·DevOps, LEDGER·FinOps, VERDICT·Legal,
 * RELAY·Civic, AEGIS·Trust, MENTOR·Education) share one engine core, plus a
 * COMMAND coordinator that runs the fleet as one governed operation.
 *
 * MENTOR is the odd one out and the reason the core/adapter split earns its keep:
 * the other five resolve an incident by changing something, MENTOR resolves one by
 * *explaining* it and refusing to change anything. Same engine, inverted intent —
 * see `modules/mentor/mentor.adapter.ts`.
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
  description:
    'COMMAND — autonomous enterprise OS (SENTINEL · LEDGER · VERDICT · RELAY · AEGIS · MENTOR)',
  imports: [
    ConfigModule.forRoot(),
    SentinelModule,
    LedgerModule,
    VerdictModule,
    RelayModule,
    AegisModule,
    CommandModule,
    MentorModule
  ],
  providers: [
    // Health Checks
    SystemHealthCheck,
  ]
})
export class AppModule {}

