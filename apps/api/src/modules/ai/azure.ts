import { DefaultAzureCredential, ManagedIdentityCredential } from '@azure/identity';
import { AccessError } from '../../shared/errors.js';
import type { Message, Provider } from './assistant.js';
import { responsesUsage } from './usage.js';

type TokenProvider = (signal: AbortSignal) => Promise<string>;
type Item = Record<string, any>;

function responseInput(messages: Message[]): Item[] {
  return messages.flatMap((message): Item[] => {
    // These items originate only from this adapter, within the authorized tool
    // loop. Public chat input never accepts provider state or file attachments.
    if (message.role === 'assistant' && message.providerParts)
      return message.providerParts as Item[];
    if (message.role === 'tool') {
      if (!message.tool_call_id) throw Error('Missing tool call ID');
      return [
        { type: 'function_call_output', call_id: message.tool_call_id, output: message.content },
      ];
    }
    const content: Item[] = [{ type: 'input_text', text: message.content }];
    for (const file of message.attachments ?? []) {
      if (message.role !== 'user') throw Error('Invalid attachment role');
      const data = `data:${file.mimeType};base64,${file.data}`;
      if (file.mimeType === 'application/pdf')
        content.push({ type: 'input_file', filename: file.fileName, file_data: data });
      else if (['image/png', 'image/jpeg', 'image/webp'].includes(file.mimeType))
        content.push({ type: 'input_image', image_url: data, detail: 'auto' });
      else throw Error('Unsupported AI attachment');
    }
    const items: Item[] = [];
    if (message.content || message.attachments?.length)
      items.push({
        role: message.role,
        content: message.attachments?.length ? content : message.content,
      });
    for (const call of message.tool_calls ?? [])
      items.push({
        type: 'function_call',
        call_id: call.id,
        name: call.function.name,
        arguments: call.function.arguments,
      });
    return items;
  });
}

/** Azure-hosted Responses only; app-owned tools and access checks stay local. */
export function azureResponsesProvider(
  env: NodeJS.ProcessEnv,
  transport: typeof fetch = fetch,
  tokenProvider?: TokenProvider,
): Provider {
  const url = new URL(env.AI_ENDPOINT ?? '');
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash ||
    !/^[a-z0-9-]+\.(openai|services\.ai)\.azure\.com$/.test(url.hostname) ||
    !['/', '/openai/v1', '/openai/v1/'].includes(url.pathname)
  )
    throw Error('Use the Azure model HTTPS endpoint, not a project endpoint.');
  const model = env.AI_MODEL!;
  if (!/^[a-zA-Z0-9_.-]{1,128}$/.test(model)) throw Error('Invalid Azure deployment name.');
  const auth = env.AI_AZURE_AUTH || 'entra';
  if (!['entra', 'managed-identity', 'api-key'].includes(auth))
    throw Error('Invalid AI_AZURE_AUTH.');
  if (auth === 'api-key' && !env.AI_API_KEY) throw Error('Azure API key is not configured.');
  const effort = env.AI_AZURE_REASONING_EFFORT || 'low';
  if (!['none', 'low', 'medium', 'high'].includes(effort))
    throw Error('Invalid Azure reasoning effort.');
  const endpoint = new URL('/openai/v1/responses', url).toString();
  const credential =
    auth === 'api-key' || tokenProvider
      ? undefined
      : auth === 'managed-identity'
        ? new ManagedIdentityCredential(
            env.AI_AZURE_MANAGED_IDENTITY_CLIENT_ID
              ? { clientId: env.AI_AZURE_MANAGED_IDENTITY_CLIENT_ID }
              : {},
          )
        : new DefaultAzureCredential({ tenantId: env.AI_AZURE_TENANT_ID });
  const token =
    tokenProvider ??
    (async (signal: AbortSignal) => {
      const result = await credential!.getToken('https://ai.azure.com/.default', {
        abortSignal: signal,
      });
      if (!result?.token) throw Error('Azure identity is unavailable');
      return result.token;
    });
  return {
    name: 'azure',
    supportsCertificateFiles: true,
    async complete(messages, tools, signal, options) {
      try {
        signal.throwIfAborted();
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (auth === 'api-key') headers['api-key'] = env.AI_API_KEY!;
        else {
          try {
            headers.Authorization = `Bearer ${await token(signal)}`;
          } catch {
            throw new AccessError(
              503,
              'Azure AI sign-in is unavailable. Sign in to the configured company tenant locally, or check the deployed managed identity.',
            );
          }
        }
        signal.throwIfAborted();
        const response = await transport(endpoint, {
          method: 'POST',
          headers,
          signal,
          redirect: 'error',
          body: JSON.stringify({
            model,
            input: responseInput(messages),
            store: false,
            include: ['reasoning.encrypted_content'],
            reasoning: { effort },
            max_output_tokens: options?.maxOutputTokens ?? 2400,
            // Preserve optional fields in existing schemas. Validators in the
            // tool registry remain authoritative; no new tools are enabled.
            tools: tools.map(({ function: tool }) => ({
              type: 'function',
              ...tool,
              strict: false,
            })),
          }),
        });
        if (response.status === 429)
          throw new AccessError(
            429,
            'Azure AI quota is exhausted. Wait or check the deployment quota.',
          );
        if ([401, 403].includes(response.status))
          throw new AccessError(
            503,
            'Azure AI access was rejected. Check the server identity and model access.',
          );
        if (!response.ok) throw Error('Azure request failed');
        const data = await response.json();
        const usage = responsesUsage(data.usage);
        options?.onUsage?.(usage);
        // Never execute a truncated function call or display a partial answer.
        if (data.status !== 'completed' || !Array.isArray(data.output))
          throw Error('Incomplete response');
        const calls: Awaited<ReturnType<Provider['complete']>>['calls'] = [];
        const texts: string[] = [];
        const ids = new Set<string>();
        for (const item of data.output as Item[]) {
          if (item.type === 'function_call') {
            if (
              typeof item.call_id !== 'string' ||
              !item.call_id ||
              ids.has(item.call_id) ||
              typeof item.name !== 'string' ||
              typeof item.arguments !== 'string' ||
              !tools.some(tool => tool.function.name === item.name)
            )
              throw Error('Invalid function call');
            const args = JSON.parse(item.arguments);
            if (!args || typeof args !== 'object' || Array.isArray(args))
              throw Error('Invalid arguments');
            ids.add(item.call_id);
            calls.push({
              id: item.call_id,
              type: 'function',
              function: { name: item.name, arguments: item.arguments },
            });
          } else if (item.type === 'message') {
            if (item.role !== 'assistant' || !Array.isArray(item.content))
              throw Error('Invalid message');
            for (const part of item.content) {
              if (part.type !== 'output_text' || typeof part.text !== 'string')
                throw Error('Unusable answer');
              texts.push(part.text);
            }
          } else if (item.type !== 'reasoning') throw Error('Unsupported output item');
        }
        const content = texts.join('\n');
        if (!content.trim() && !calls.length) throw Error('Empty response');
        // Replay reasoning and calls in order on the next tool round without
        // relying on stored upstream responses. Never return these to the UI.
        return { content, calls, providerParts: data.output, usage };
      } catch (error) {
        if (signal.aborted) throw new AccessError(504, 'AI took too long. Please try again.');
        if (error instanceof AccessError) throw error;
        throw new AccessError(
          502,
          'Azure AI could not complete this request. Check the server identity, deployment and output budget.',
        );
      }
    },
  };
}
