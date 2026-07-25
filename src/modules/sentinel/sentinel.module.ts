import { Module } from '@nitrostack/core';
import { SentinelTools } from './sentinel.tools.js';
import { SentinelLiveTools } from './sentinel.live.js';
import { SentinelPrompts } from './sentinel.prompts.js';

/**
 * SENTINEL module — the leader app of the COMMAND platform.
 * Two ways to drive it: the one-click `self_heal` Task (SentinelTools) and the
 * client-driven granular tools (SentinelLiveTools) that let ChatGPT orchestrate
 * the loop itself. Plus the confidence gate and the incident-commander prompt.
 */
@Module({
  name: 'sentinel',
  description: 'Autonomous incident commander — detects, fixes, verifies and ships.',
  controllers: [SentinelTools, SentinelLiveTools, SentinelPrompts],
})
export class SentinelModule {}
