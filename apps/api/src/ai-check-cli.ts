import { configuredProvider } from './modules/ai/index.js';

// Explicit, synthetic model connectivity check. No app/employee/SQL data is read.
try {
  const provider = configuredProvider(process.env);
  if (!provider || provider.name !== 'azure') throw Error('Configure the Azure AI provider first.');
  const answer = await provider.complete(
    [
      {
        role: 'user',
        content: 'Reply with exactly AZURE_AI_OK. This is a synthetic connectivity test.',
      },
    ],
    [],
    AbortSignal.timeout(35000),
    { maxOutputTokens: 1200 },
  );
  if (answer.calls.length || answer.content.trim() !== 'AZURE_AI_OK')
    throw Error('Azure returned an unexpected connectivity-test answer.');
  console.log(
    JSON.stringify({
      status: 'ok',
      provider: provider.name,
      model: process.env.AI_MODEL,
      usage: answer.usage,
    }),
  );
} catch (error) {
  // Provider errors are already sanitized; never dump credentials or SDK stacks.
  console.error(error instanceof Error ? error.message : 'Azure AI check failed.');
  process.exitCode = 1;
}
