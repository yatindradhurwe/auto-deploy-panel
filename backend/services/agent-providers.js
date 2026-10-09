import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { GoogleGenAI } from '@google/genai'

/**
 * Model adapters for the project agent. Each adapter keeps its conversation history in its
 * own API's native format and exposes the same three operations to the shared loop:
 *
 *   step(ctx)                -> { texts, thoughts, toolCalls: [{ id, name, input, parseError }],
 *                                 stop: 'tool_use' | 'end' | 'refusal' | 'max_tokens' | 'pause' | 'empty',
 *                                 detail, usage, assistantMessage }
 *   toolResultsMessage(calls, results) -> history entry/entries carrying the tool results
 *   pendingToolCalls(lastMessage)      -> calls left without results (after an interruption)
 *
 * The tools are the same everywhere: Claude gets its Anthropic-defined text editor and bash
 * tools; ChatGPT and Gemini get JSON-schema function tools with the same names and inputs.
 */

// --- Shared function-tool definitions (OpenAI / Gemini) --------------------------------------

const EDITOR_DESCRIPTION = `View, create and edit files in the project.
Commands:
- view: show a file with line numbers (optional view_range [start, end], end -1 = end of file), or list a directory
- create: write file_text to path (creates or overwrites the file)
- str_replace: replace old_str with new_str; old_str must match exactly once (copy it from a view, including whitespace)
- insert: insert insert_text after line insert_line (0 = top of file)
Paths are relative to the project root.`

const EDITOR_SCHEMA = {
  type: 'object',
  properties: {
    command: { type: 'string', enum: ['view', 'create', 'str_replace', 'insert'] },
    path: { type: 'string', description: 'File or directory path relative to the project root' },
    file_text: { type: 'string', description: 'create: full file contents' },
    old_str: { type: 'string', description: 'str_replace: exact text to replace (must be unique in the file)' },
    new_str: { type: 'string', description: 'str_replace: replacement text' },
    insert_line: { type: 'integer', description: 'insert: line number after which to insert (0 = top)' },
    insert_text: { type: 'string', description: 'insert: text to insert' },
    view_range: { type: 'array', items: { type: 'integer' }, description: 'view: [start_line, end_line]' }
  },
  required: ['command', 'path']
}

const BASH_DESCRIPTION = 'Run one allowlisted command in the project root without a shell (no pipes, redirects, &&, globs). Returns combined output and exit code.'
const BASH_SCHEMA = {
  type: 'object',
  properties: { command: { type: 'string', description: 'The command line, e.g. "npm run build" or "grep -rn Hero src"' } },
  required: ['command']
}

const httpError = (status, message) => Object.assign(new Error(message), { status })

// --- Claude --------------------------------------------------------------------------------

const claude = {
  id: 'claude',
  label: 'Claude',
  defaultModel: 'claude-opus-5-5',
  envKey: 'ANTHROPIC_API_KEY',
  keyPattern: /^sk-ant-[A-Za-z0-9_-]{20,}$/,
  keyHelp: 'console.anthropic.com → API Keys (starts with sk-ant-)',
  // Opus 5.5 list prices per million tokens
  price: { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },

  userMessage: (text) => ({ role: 'user', content: text }),
  noticeMessage: (text) => ({ role: 'user', content: text }),

  async step({ apiKey, model, system, messages, emit, signal }) {
    const client = new Anthropic({ apiKey })
    const stream = client.beta.messages.stream({
      model,
      max_tokens: 64000,
      system,
      tools: [
        { type: 'text_editor_20250728', name: 'str_replace_based_edit_tool' },
        { type: 'bash_20250124', name: 'bash' }
      ],
      messages,
      thinking: { type: 'adaptive', display: 'summarized' },
      output_config: { effort: 'high' },
      cache_control: { type: 'ephemeral' },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default'
    }, { signal })
    stream.on('text', (d) => emit({ type: 'text_delta', text: d }))
    stream.on('thinking', (d) => emit({ type: 'thinking_delta', text: d }))
    stream.on('streamEvent', (e) => {
      if (e.type === 'content_block_start' && e.content_block?.type === 'tool_use') emit({ type: 'tool_pending', name: e.content_block.name })
    })
    const msg = await stream.finalMessage()
    const toolCalls = msg.content.filter(b => b.type === 'tool_use').map(b => ({ id: b.id, name: b.name, input: b.input }))
    const stop = msg.stop_reason === 'refusal' ? 'refusal'
      : msg.stop_reason === 'max_tokens' && toolCalls.length ? 'max_tokens'
        : msg.stop_reason === 'pause_turn' ? 'pause'
          : toolCalls.length ? 'tool_use' : 'end'
    return {
      texts: msg.content.filter(b => b.type === 'text' && b.text).map(b => b.text),
      thoughts: msg.content.filter(b => b.type === 'thinking' && b.thinking).map(b => b.thinking),
      toolCalls,
      stop,
      detail: msg.stop_details?.category || null,
      usage: {
        input: msg.usage?.input_tokens || 0,
        output: msg.usage?.output_tokens || 0,
        cacheRead: msg.usage?.cache_read_input_tokens || 0,
        cacheWrite: msg.usage?.cache_creation_input_tokens || 0
      },
      // Appended exactly as returned (thinking blocks included)
      assistantMessage: stop === 'refusal' || stop === 'max_tokens' ? null : { role: 'assistant', content: msg.content }
    }
  },

  toolResultsMessage: (calls, results) => [{
    role: 'user',
    content: calls.map((c, i) => ({ type: 'tool_result', tool_use_id: c.id, content: results[i].output, ...(results[i].isError ? { is_error: true } : {}) }))
  }],

  pendingToolCalls(last) {
    if (last?.role !== 'assistant' || !Array.isArray(last.content)) return []
    return last.content.filter(b => b.type === 'tool_use').map(b => ({ id: b.id, name: b.name }))
  },

  describeError(err) {
    if (err instanceof Anthropic.AuthenticationError) return 'The Anthropic API key was rejected. Update it in the agent settings.'
    if (err instanceof Anthropic.RateLimitError) return 'Rate limited by Anthropic — wait a minute and send "continue".'
    if (err instanceof Anthropic.APIError) return `Anthropic API error ${err.status ?? ''}: ${err.message}`
    return null
  },
  isAbort: (err) => err instanceof Anthropic.APIUserAbortError
}

// --- ChatGPT (OpenAI Chat Completions) -------------------------------------------------------

const openai = {
  id: 'openai',
  label: 'ChatGPT',
  defaultModel: 'gpt-5.5',
  envKey: 'OPENAI_API_KEY',
  keyPattern: /^sk-[A-Za-z0-9_-]{20,}$/,
  keyHelp: 'platform.openai.com → API keys (starts with sk-)',
  price: null,

  userMessage: (text) => ({ role: 'user', content: text }),
  noticeMessage: (text) => ({ role: 'user', content: text }),

  async step({ apiKey, model, system, messages, emit, signal }) {
    const client = new OpenAI({ apiKey })
    const body = {
      model,
      messages: [{ role: 'developer', content: system }, ...messages],
      tools: [
        { type: 'function', function: { name: 'str_replace_based_edit_tool', description: EDITOR_DESCRIPTION, parameters: EDITOR_SCHEMA } },
        { type: 'function', function: { name: 'bash', description: BASH_DESCRIPTION, parameters: BASH_SCHEMA } }
      ],
      max_completion_tokens: 32000,
      stream_options: { include_usage: true }
    }
    // Reasoning models accept an effort level; other models reject the parameter
    if (/^(gpt-5|o\d)/.test(model)) body.reasoning_effort = 'high'

    const stream = client.chat.completions.stream(body, { signal })
    stream.on('content', (d) => emit({ type: 'text_delta', text: d }))
    stream.on('tool_calls.function.arguments.delta', (e) => {
      if (e.arguments_delta !== undefined && e.arguments === e.arguments_delta) emit({ type: 'tool_pending', name: e.name })
    })
    const completion = await stream.finalChatCompletion()
    const choice = completion.choices?.[0] || {}
    const m = choice.message || {}
    const rawCalls = (m.tool_calls || []).filter(tc => tc.type === 'function')
    const toolCalls = rawCalls.map(tc => {
      try {
        return { id: tc.id, name: tc.function.name, input: JSON.parse(tc.function.arguments || '{}') }
      } catch {
        return { id: tc.id, name: tc.function.name, input: null, parseError: tc.function.arguments }
      }
    })
    const refused = !!m.refusal || choice.finish_reason === 'content_filter'
    const stop = refused ? 'refusal'
      : choice.finish_reason === 'length' && toolCalls.length ? 'max_tokens'
        : toolCalls.length ? 'tool_use' : 'end'
    const u = completion.usage || {}
    return {
      texts: m.content ? [m.content] : [],
      thoughts: [],
      toolCalls,
      stop,
      detail: m.refusal || null,
      usage: {
        input: (u.prompt_tokens || 0) - (u.prompt_tokens_details?.cached_tokens || 0),
        output: u.completion_tokens || 0,
        cacheRead: u.prompt_tokens_details?.cached_tokens || 0,
        cacheWrite: 0
      },
      assistantMessage: stop === 'refusal' || stop === 'max_tokens' ? null : {
        role: 'assistant',
        content: m.content ?? null,
        ...(rawCalls.length ? { tool_calls: rawCalls.map(tc => ({ id: tc.id, type: 'function', function: { name: tc.function.name, arguments: tc.function.arguments } })) } : {})
      }
    }
  },

  toolResultsMessage: (calls, results) => calls.map((c, i) => ({ role: 'tool', tool_call_id: c.id, content: results[i].output })),

  pendingToolCalls(last) {
    if (last?.role !== 'assistant' || !Array.isArray(last.tool_calls)) return []
    return last.tool_calls.map(tc => ({ id: tc.id, name: tc.function?.name }))
  },

  describeError(err) {
    if (err instanceof OpenAI.AuthenticationError) return 'The OpenAI API key was rejected. Update it in the agent settings.'
    if (err instanceof OpenAI.RateLimitError) return 'Rate limited or out of quota at OpenAI — check your OpenAI billing, then send "continue".'
    if (err instanceof OpenAI.NotFoundError) return `OpenAI does not offer the model '${err.message.match(/`([^`]+)`/)?.[1] || 'configured'}' to this key — change the ChatGPT model in the agent settings.`
    if (err instanceof OpenAI.APIError) return `OpenAI API error ${err.status ?? ''}: ${err.message}`
    return null
  },
  isAbort: (err) => err instanceof OpenAI.APIUserAbortError
}

// --- Gemini (Google GenAI) ---------------------------------------------------------------------

const REFUSAL_REASONS = new Set(['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII', 'RECITATION', 'IMAGE_SAFETY'])

const gemini = {
  id: 'gemini',
  label: 'Gemini',
  defaultModel: 'gemini-pro-latest',
  envKey: 'GEMINI_API_KEY',
  keyPattern: /^[A-Za-z0-9_-]{30,}$/,
  keyHelp: 'aistudio.google.com/apikey',
  price: null,

  userMessage: (text) => ({ role: 'user', parts: [{ text }] }),
  noticeMessage: (text) => ({ role: 'user', parts: [{ text }] }),

  async step({ apiKey, model, system, messages, emit, signal }) {
    const ai = new GoogleGenAI({ apiKey })
    const stream = await ai.models.generateContentStream({
      model,
      contents: messages,
      config: {
        systemInstruction: system,
        tools: [{
          functionDeclarations: [
            { name: 'str_replace_based_edit_tool', description: EDITOR_DESCRIPTION, parametersJsonSchema: EDITOR_SCHEMA },
            { name: 'bash', description: BASH_DESCRIPTION, parametersJsonSchema: BASH_SCHEMA }
          ]
        }],
        thinkingConfig: { includeThoughts: true },
        maxOutputTokens: 32000,
        abortSignal: signal
      }
    })

    // Every streamed part is kept verbatim: function-call parts carry thought signatures
    // that Gemini requires back in the history.
    const parts = []
    let finishReason = null
    let usage = null
    let blockReason = null
    for await (const chunk of stream) {
      if (signal.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' })
      const cand = chunk.candidates?.[0]
      for (const p of cand?.content?.parts || []) {
        parts.push(p)
        if (p.text && p.thought) emit({ type: 'thinking_delta', text: p.text })
        else if (p.text) emit({ type: 'text_delta', text: p.text })
        else if (p.functionCall) emit({ type: 'tool_pending', name: p.functionCall.name })
      }
      if (cand?.finishReason) finishReason = cand.finishReason
      if (chunk.usageMetadata) usage = chunk.usageMetadata
      if (chunk.promptFeedback?.blockReason) blockReason = chunk.promptFeedback.blockReason
    }

    const toolCalls = parts.filter(p => p.functionCall).map((p, i) => ({
      id: p.functionCall.id || `call_${Date.now()}_${i}`,
      rawId: p.functionCall.id || null,
      name: p.functionCall.name,
      input: p.functionCall.args || {}
    }))
    const refused = !!blockReason || REFUSAL_REASONS.has(finishReason)
    const stop = refused ? 'refusal'
      : finishReason === 'MAX_TOKENS' && toolCalls.length ? 'max_tokens'
        : toolCalls.length ? 'tool_use'
          : parts.length ? 'end' : 'empty'

    return {
      texts: [parts.filter(p => p.text && !p.thought).map(p => p.text).join('')].filter(Boolean),
      thoughts: [parts.filter(p => p.text && p.thought).map(p => p.text).join('')].filter(Boolean),
      toolCalls,
      stop,
      detail: blockReason || finishReason,
      usage: {
        input: (usage?.promptTokenCount || 0) - (usage?.cachedContentTokenCount || 0),
        output: (usage?.candidatesTokenCount || 0) + (usage?.thoughtsTokenCount || 0),
        cacheRead: usage?.cachedContentTokenCount || 0,
        cacheWrite: 0
      },
      assistantMessage: stop === 'refusal' || stop === 'max_tokens' || !parts.length ? null : { role: 'model', parts }
    }
  },

  toolResultsMessage: (calls, results) => [{
    role: 'user',
    parts: calls.map((c, i) => ({
      functionResponse: {
        ...(c.rawId ? { id: c.rawId } : {}),
        name: c.name,
        response: results[i].isError ? { error: results[i].output } : { output: results[i].output }
      }
    }))
  }],

  pendingToolCalls(last) {
    if (last?.role !== 'model' || !Array.isArray(last.parts)) return []
    return last.parts.filter(p => p.functionCall).map(p => ({ id: p.functionCall.id, rawId: p.functionCall.id || null, name: p.functionCall.name }))
  },

  describeError(err) {
    if (typeof err?.status === 'number') {
      if (err.status === 400 && /API key/i.test(err.message)) return 'The Gemini API key was rejected. Update it in the agent settings.'
      if (err.status === 401 || err.status === 403) return 'The Gemini API key was rejected or lacks access. Update it in the agent settings.'
      if (err.status === 404) return 'Gemini does not offer the configured model to this key — change the Gemini model in the agent settings.'
      if (err.status === 429) return 'Rate limited or out of quota at Google — wait, then send "continue".'
      return `Gemini API error ${err.status}: ${err.message}`
    }
    return null
  },
  isAbort: (err) => err?.name === 'AbortError'
}

export const PROVIDERS = { claude, openai, gemini }

export function getProvider(id) {
  const p = PROVIDERS[id]
  if (!p) throw httpError(400, `Unknown provider '${id}'. Choose claude, openai or gemini.`)
  return p
}
