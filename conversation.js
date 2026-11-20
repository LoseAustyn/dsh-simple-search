/**
 * Human-visible conversation extraction and matching for one Session.
 *
 * The search surface is what the user actually read in a conversation: direct
 * human prompts and the assistant's visible text. Reasoning ("thinking")
 * blocks, tool calls, tool results, synthetic context messages and
 * system/developer prompts are deliberately excluded, so a hit always points at
 * something that was said rather than at the model's intermediate work.
 *
 * Pure module: it never touches ctx, HTTP or the filesystem. `index.js` owns
 * the Session observation and the route; `search.js` owns `SearchError`.
 */

import { SearchError } from './search.js'

/** Newest messages kept for search; older ones are dropped and flagged. */
export const MAX_CONVERSATION_MESSAGES = 5_000
/** Hard cap on returned matches. */
export const MAX_CONVERSATION_MATCHES = 200
/** Matches counted in one message before its count is reported as capped. */
export const MAX_CONVERSATION_COUNT_PER_MESSAGE = 50
/** Longest per-message prefix that takes part in matching. */
export const MAX_CONVERSATION_STORED_TEXT_CHARS = 20_000
/**
 * Total characters retained per conversation. The newest messages win; this
 * bounds the host's per-session extraction cache independently of the message
 * count (a handful of huge pastes must not pin tens of megabytes).
 */
export const MAX_CONVERSATION_TOTAL_CHARS = 2_000_000
/** Longest message text returned for copying. */
export const MAX_CONVERSATION_TEXT_CHARS = 4_000
/** Longest excerpt returned around the first hit. */
export const MAX_CONVERSATION_SNIPPET_CHARS = 260
/** Default page size when the caller names no limit. */
const DEFAULT_LIMIT = 120

/**
 * Concatenate the plain text blocks of one message, dropping everything else.
 * @param {unknown} blocks - message content array.
 * @returns {string} text blocks joined with newlines, trimmed.
 */
function textOf(blocks) {
  if (!Array.isArray(blocks)) return ''
  const parts = []
  for (const block of blocks) {
    if (block === null || typeof block !== 'object') continue
    if (block.type !== 'text' || typeof block.text !== 'string') continue
    if (block.text.trim() === '') continue
    parts.push(block.text)
  }
  return parts.join('\n').trim()
}

/**
 * Clip one string to a character budget, marking that it was cut.
 * @param {string} text - source text.
 * @param {number} max - maximum characters.
 * @returns {string} the original text or a clipped copy.
 */
function clip(text, max) {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}

/**
 * Build the searchable document for one event, or null when the event carries
 * no user-visible conversation text.
 * @param {object} event - one raw Session event.
 * @returns {{seq: number, role: 'user'|'assistant', time: number, text: string}|null} document.
 */
function readableDocument(event, turn) {
  if (event === null || typeof event !== 'object') return null
  const data = event.data
  if (event.type === 'user/message') {
    // Synthetic context (AGENTS.md, skill bodies, cron notices, reminders) is a
    // user-role message too; only the human's own prompt carries kind 'user'.
    if (data?.source?.kind !== 'user') return null
    const text = textOf(data.content)
    if (text === '') return null
    return {
      seq: Number(event.seq) || 0,
      role: 'user',
      time: Number(event.time) || 0,
      ...(Number.isSafeInteger(turn) && turn > 0 ? { turn } : {}),
      ...(typeof data.id === 'string' && data.id !== '' ? { messageId: data.id } : {}),
      text: clip(text, MAX_CONVERSATION_STORED_TEXT_CHARS),
    }
  }
  if (event.type === 'assistant/message') {
    // Only text blocks: reasoning blocks are the model's thinking, and
    // tool-call blocks are intermediate work rather than conversation.
    const text = textOf(data?.message?.content)
    if (text === '') return null
    const eventTurn = Number(data?.turn)
    const eventStep = Number(data?.step)
    return {
      seq: Number(event.seq) || 0,
      role: 'assistant',
      time: Number(event.time) || 0,
      ...(Number.isSafeInteger(eventTurn) && eventTurn >= 0 ? { turn: eventTurn } : {}),
      ...(Number.isSafeInteger(eventStep) && eventStep >= 0 ? { step: eventStep } : {}),
      ...(typeof data?.message?.id === 'string' && data.message.id !== '' ? { messageId: data.message.id } : {}),
      text: clip(text, MAX_CONVERSATION_STORED_TEXT_CHARS),
    }
  }
  return null
}

/**
 * Extract the human-visible conversation and its latest title from a log.
 * @param {unknown} events - raw Session events in log order.
 * @returns {{title: string, documents: Array<object>, dropped: number}} extracted conversation.
 */
export function conversationDocuments(events) {
  const documents = []
  let title = ''
  let turn = 0
  for (const event of Array.isArray(events) ? events : []) {
    if (event?.type === 'turn/start') {
      const next = Number(event.data?.turn)
      if (Number.isSafeInteger(next) && next > 0) turn = next
      continue
    }
    if (event?.type === 'session/title' && typeof event.data?.title === 'string') {
      title = event.data.title
      continue
    }
    const document = readableDocument(event, turn)
    if (document !== null) documents.push(document)
  }
  let dropped = Math.max(0, documents.length - MAX_CONVERSATION_MESSAGES)
  if (dropped > 0) documents.splice(0, dropped)
  let total = 0
  for (const document of documents) total += document.text.length
  while (documents.length > 0 && total > MAX_CONVERSATION_TOTAL_CHARS) {
    total -= documents[0].text.length
    documents.shift()
    dropped += 1
  }
  return { title, documents, dropped }
}

/**
 * Compile the user's query into a global regular expression.
 * @param {string} query - literal text or regular expression source.
 * @param {{regex?: boolean, caseSensitive?: boolean}} [options] - match options.
 * @returns {RegExp} a fresh global pattern for one search.
 * @throws {SearchError} `invalid-pattern` for an empty query or an invalid expression.
 */
export function compileConversationPattern(query, options = {}) {
  if (typeof query !== 'string' || query.trim() === '') {
    throw new SearchError('invalid-pattern', '搜索关键词不能为空')
  }
  const source = options.regex === true
    ? query
    : query.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  try {
    return new RegExp(source, options.caseSensitive === true ? 'gu' : 'giu')
  } catch (error) {
    throw new SearchError('invalid-pattern', `正则表达式无效：${String(error?.message ?? error)}`)
  }
}

/**
 * One excerpt around the first hit on a single line, collapsing whitespace.
 * @param {string} text - message text.
 * @param {number} index - first hit offset.
 * @param {number} length - first hit length.
 * @returns {string} bounded excerpt.
 */
function excerpt(text, index, length) {
  const start = Math.max(0, index - 60)
  const end = Math.min(text.length, index + length + 160)
  let snippet = text.slice(start, end).replace(/\s+/gu, ' ').trim()
  if (start > 0) snippet = `…${snippet}`
  if (end < text.length) snippet = `${snippet}…`
  return clip(snippet, MAX_CONVERSATION_SNIPPET_CHARS)
}

/**
 * Count hits in one document and build its excerpt.
 * @param {{text: string}} document - one conversation document.
 * @param {RegExp} pattern - compiled global pattern.
 * @returns {{count: number, capped: boolean, snippet: string}|null} hit facts, or null.
 */
function matchDocument(document, pattern) {
  pattern.lastIndex = 0
  let firstIndex = -1
  let firstLength = 0
  let count = 0
  let match
  while ((match = pattern.exec(document.text)) !== null) {
    if (match[0] === '') {
      // A zero-width match cannot advance on its own; move past it.
      pattern.lastIndex += 1
      continue
    }
    if (firstIndex === -1) {
      firstIndex = match.index
      firstLength = match[0].length
    }
    count += 1
    if (count >= MAX_CONVERSATION_COUNT_PER_MESSAGE) break
  }
  if (firstIndex === -1) return null
  return {
    count,
    capped: count >= MAX_CONVERSATION_COUNT_PER_MESSAGE,
    snippet: excerpt(document.text, firstIndex, firstLength),
  }
}

/**
 * Clamp a caller-supplied page size.
 * @param {unknown} value - raw limit.
 * @returns {number} a positive integer no larger than MAX_CONVERSATION_MATCHES.
 */
function clampLimit(value) {
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) return DEFAULT_LIMIT
  return Math.min(Math.floor(number), MAX_CONVERSATION_MATCHES)
}

/**
 * Match one already-extracted conversation, newest message first.
 * @param {{title?: string, documents?: Array<object>, dropped?: number}} extracted - conversationDocuments output.
 * @param {{query: string, regex?: boolean, caseSensitive?: boolean, limit?: number}} request - search request.
 * @returns {{title: string, matches: Array<object>, scanned: number, messageCount: number, truncated: boolean}} result.
 */
export function matchConversation(extracted, request) {
  const documents = Array.isArray(extracted?.documents) ? extracted.documents : []
  const title = typeof extracted?.title === 'string' ? extracted.title : ''
  const pattern = compileConversationPattern(request?.query ?? '', request ?? {})
  const limit = clampLimit(request?.limit)
  const matches = []
  let truncated = Number(extracted?.dropped ?? 0) > 0
  for (let index = documents.length - 1; index >= 0; index -= 1) {
    if (matches.length >= limit) {
      truncated = true
      break
    }
    const document = documents[index]
    const found = matchDocument(document, pattern)
    if (found === null) continue
    if (found.capped) truncated = true
    matches.push({
      seq: document.seq,
      role: document.role,
      time: document.time,
      ...(document.turn === undefined ? {} : { turn: document.turn }),
      ...(document.step === undefined ? {} : { step: document.step }),
      ...(document.messageId === undefined ? {} : { messageId: document.messageId }),
      text: clip(document.text, MAX_CONVERSATION_TEXT_CHARS),
      textTruncated: document.text.length > MAX_CONVERSATION_TEXT_CHARS,
      snippet: found.snippet,
      matchCount: found.count,
    })
  }
  return {
    title,
    matches,
    scanned: documents.length,
    messageCount: documents.length,
    truncated,
  }
}

/**
 * Convenience wrapper: extract a log and match it in one call.
 * @param {unknown} events - raw Session events.
 * @param {{query: string, regex?: boolean, caseSensitive?: boolean, limit?: number}} request - search request.
 * @returns {{title: string, matches: Array<object>, scanned: number, messageCount: number, truncated: boolean}} result.
 */
export function searchConversation(events, request) {
  return matchConversation(conversationDocuments(events), request)
}
