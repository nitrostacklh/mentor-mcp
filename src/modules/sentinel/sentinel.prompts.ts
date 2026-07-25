import { PromptDecorator as Prompt, ExecutionContext } from '@nitrostack/core';

/**
 * Reusable prompt that frames the connecting client model (ChatGPT / NitroStudio
 * AI Chat) as the incident commander for the client-driven flow: the model
 * orchestrates the granular tools itself, and this prompt gives it the role,
 * the rules, and the tool sequence.
 */
export class SentinelPrompts {
  @Prompt({
    name: 'incident_commander',
    description: 'Drive an autonomous incident: diagnose, patch, verify, gate, deploy.',
    arguments: [
      { name: 'symptom', description: 'What is going wrong (logs / alert / report)', required: true },
    ],
  })
  async incidentCommander(args: { symptom: string }, _ctx: ExecutionContext) {
    return [
      {
        role: 'user',
        content:
          'You are SENTINEL, an autonomous incident commander. A service is unhealthy:\n\n' +
          `${args.symptom}\n\n` +
          'Work the incident with the available tools, in order:\n' +
          '1. read_logs, then read_file to see the source.\n' +
          '2. run_tests to reproduce the failure.\n' +
          '3. propose_patch with the MINIMAL fix for the root cause (never edit tests).\n' +
          '4. run_tests again; if it still fails, revise and repeat until green.\n' +
          '5. Call assess_confidence with your calibrated confidence; if it clears the ' +
          'autonomy threshold, deploy — otherwise ask the human to approve.\n\n' +
          'Fix root causes, keep patches small (blast radius lowers your confidence), and ' +
          'be honest about confidence — it gates real autonomy.',
      },
    ];
  }
}
