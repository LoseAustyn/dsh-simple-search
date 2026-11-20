/**
 * Unit tests for the human-visible conversation core: which events become
 * searchable text, how reasoning and tool traffic stay out, and how the query,
 * limits, snippets and ordering behave. No ctx, HTTP or filesystem involved.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  MAX_CONVERSATION_COUNT_PER_MESSAGE,
  MAX_CONVERSATION_MESSAGES,
  MAX_CONVERSATION_TOTAL_CHARS,
  conversationDocuments,
  matchConversation,
  searchConversation,
} from '../conversation.js'
import { SearchError } from '../search.js'

let nextTime = 1_000

/**
 * One direct human prompt event.
 * @param {number} seq - event sequence.
 * @param {string} text - prompt text.
 * @returns {object} log event.
 */
function userMessage(seq, text) {
  nextTime += 1
  return {
    type: 'user/message',
    seq,
    time: nextTime,
    data: { id: `msg-${String(seq)}`, content: [{ type: 'text', text }], source: { kind: 'user' }, role: 'user' },
    surfaceOp: 'append',
  }
}

/**
 * One synthetic user-role context event, as `agent.inject` produces.
 * @param {number} seq - event sequence.
 * @param {string} text - injected text.
 * @returns {object} log event.
 */
function injectedMessage(seq, text) {
  nextTime += 1
  return {
    type: 'user/message',
    seq,
    time: nextTime,
    data: { id: `inject-${String(seq)}`, content: [{ type: 'text', text }], source: { kind: 'system-prompt' }, role: 'user' },
    surfaceOp: 'append',
  }
}

/**
 * One assistant event with the supplied content blocks.
 * @param {number} seq - event sequence.
 * @param {Array<object>} content - assistant content blocks.
 * @returns {object} log event.
 */
function assistantMessage(seq, content) {
  nextTime += 1
  return {
    type: 'assistant/message',
    seq,
    time: nextTime,
    data: { turn: 1, step: 1, message: { id: `asst-${String(seq)}`, role: 'assistant', content } },
    surfaceOp: 'append',
  }
}

/** A compact fixture covering every event kind that must be handled. */
function fixture() {
  return [
    { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } },
    { type: 'system/message', seq: 1, time: 2, data: { message: { role: 'system', content: [{ type: 'text', text: 'system needle' }] } } },
    injectedMessage(2, 'synthetic context needle'),
    userMessage(3, 'first human needle'),
    assistantMessage(4, [
      { type: 'reasoning', text: 'thinking about needle' },
      { type: 'text', text: 'visible answer needle' },
      { type: 'tool-call', id: 'call-1', name: 'read', arguments: '{"q":"needle"}' },
    ]),
    { type: 'tool/result', seq: 5, time: 6, data: { message: { role: 'tool', content: [{ type: 'text', text: 'tool needle' }] } } },
    { type: 'assistant/attempt', seq: 6, time: 7, data: { turn: 1, step: 1, stream: [] } },
    { type: 'session/title', seq: 7, time: 8, data: { title: 'Fixture title', messageSeqs: [3], source: { kind: 'user' } } },
    userMessage(8, 'second needle question'),
    assistantMessage(9, [{ type: 'reasoning', text: 'only thinking needle' }]),
    { type: 'session/title', seq: 10, time: 11, data: { title: 'Latest title', messageSeqs: [8], source: { kind: 'user' } } },
  ]
}

describe('conversationDocuments', () => {
  it('keeps only direct human prompts and assistant text blocks', () => {
    const { title, documents, dropped } = conversationDocuments(fixture())
    assert.equal(title, 'Latest title')
    assert.equal(dropped, 0)
    assert.deepEqual(documents.map((document) => [document.seq, document.role, document.text]), [
      [3, 'user', 'first human needle'],
      [4, 'assistant', 'visible answer needle'],
      [8, 'user', 'second needle question'],
    ])
  })

  it('carries the identities a chat jump needs', () => {
    const { documents } = conversationDocuments(fixture())
    const user = documents.find((document) => document.seq === 3)
    assert.equal(user.messageId, 'msg-3')
    assert.equal(user.turn, 1)
    const assistant = documents.find((document) => document.seq === 4)
    assert.equal(assistant.messageId, 'asst-4')
    assert.equal(assistant.turn, 1)
    assert.equal(assistant.step, 1)
  })

  it('ignores non-message and malformed events', () => {
    const { documents } = conversationDocuments([
      null,
      {},
      { type: 'user/message', seq: 1, data: null },
      { type: 'assistant/message', seq: 2, data: { message: { content: null } } },
      { type: 'assistant/message', seq: 3, data: { message: { content: [{ type: 'text', text: '   ' }] } } },
    ])
    assert.deepEqual(documents, [])
  })

  it('drops the oldest messages past the character budget', () => {
    const chunk = 'x'.repeat(10_000)
    const events = []
    for (let index = 0; index < 250; index += 1) {
      events.push(userMessage(index, `${String(index)} ${chunk}`))
    }
    const { documents, dropped } = conversationDocuments(events)
    const total = documents.reduce((sum, document) => sum + document.text.length, 0)
    assert.ok(total <= MAX_CONVERSATION_TOTAL_CHARS)
    assert.ok(dropped > 0)
    assert.equal(documents.at(-1).seq, 249)
  })

  it('drops the oldest messages past the message budget', () => {
    const events = []
    for (let index = 0; index < MAX_CONVERSATION_MESSAGES + 3; index += 1) {
      events.push(userMessage(index, `message ${String(index)}`))
    }
    const { documents, dropped } = conversationDocuments(events)
    assert.equal(dropped, 3)
    assert.equal(documents.length, MAX_CONVERSATION_MESSAGES)
    assert.equal(documents[0].seq, 3)
  })
})

describe('matchConversation', () => {
  it('matches case-insensitively by default, newest first', () => {
    const result = matchConversation(conversationDocuments(fixture()), { query: 'NEEDLE' })
    assert.deepEqual(result.matches.map((hit) => hit.role), ['user', 'assistant', 'user'])
    assert.deepEqual(result.matches.map((hit) => hit.seq), [8, 4, 3])
    assert.equal(result.title, 'Latest title')
    assert.equal(result.messageCount, 3)
    assert.equal(result.truncated, false)
    assert.ok(result.matches[0].snippet.includes('needle'))
  })

  it('honours case-sensitive matching', () => {
    const result = matchConversation(conversationDocuments(fixture()), {
      query: 'Needle',
      caseSensitive: true,
    })
    assert.equal(result.matches.length, 0)
  })

  it('supports regular expressions and rejects an invalid one', () => {
    const result = matchConversation(conversationDocuments(fixture()), {
      query: 'visible\\s+answer',
      regex: true,
    })
    assert.equal(result.matches.length, 1)
    assert.equal(result.matches[0].role, 'assistant')
    assert.throws(
      () => matchConversation(conversationDocuments(fixture()), { query: '(', regex: true }),
      (error) => error instanceof SearchError && error.code === 'invalid-pattern',
    )
  })

  it('ignores zero-width matches instead of looping', () => {
    const result = matchConversation(conversationDocuments(fixture()), { query: '^', regex: true })
    assert.deepEqual(result.matches, [])
  })

  it('builds a bounded one-line excerpt around the hit', () => {
    const events = [
      userMessage(1, `${'before '.repeat(40)}needle tail\nsecond line`),
    ]
    const result = matchConversation(conversationDocuments(events), { query: 'needle' })
    const hit = result.matches[0]
    assert.ok(hit.snippet.includes('needle'))
    assert.ok(!hit.snippet.includes('\n'))
    assert.ok(hit.snippet.startsWith('…'))
    assert.ok(hit.snippet.length <= 260)
  })

  it('marks a message whose copy text was truncated', () => {
    const events = [userMessage(1, `${'y'.repeat(5_000)} needle`)]
    const result = matchConversation(conversationDocuments(events), { query: 'needle' })
    assert.equal(result.matches[0].text.length, 4_000)
    assert.equal(result.matches[0].textTruncated, true)
    assert.ok(result.matches[0].snippet.includes('needle'))
  })

  it('caps matches per message and flags truncation', () => {
    const events = [userMessage(1, 'x '.repeat(MAX_CONVERSATION_COUNT_PER_MESSAGE + 10))]
    const result = matchConversation(conversationDocuments(events), { query: 'x' })
    assert.equal(result.matches.length, 1)
    assert.equal(result.matches[0].matchCount, MAX_CONVERSATION_COUNT_PER_MESSAGE)
    assert.equal(result.truncated, true)
  })

  it('honours the page limit and flags truncation', () => {
    const events = [userMessage(1, 'needle one'), userMessage(2, 'needle two'), userMessage(3, 'needle three')]
    const result = matchConversation(conversationDocuments(events), { query: 'needle', limit: 2 })
    assert.equal(result.matches.length, 2)
    assert.equal(result.truncated, true)
  })

  it('returns no matches for an empty result', () => {
    const result = matchConversation(conversationDocuments(fixture()), { query: 'absent-term' })
    assert.deepEqual(result.matches, [])
    assert.equal(result.truncated, false)
  })

  it('wraps extraction and matching for callers that do not cache', () => {
    const result = searchConversation(fixture(), { query: 'second', limit: 5 })
    assert.equal(result.matches.length, 1)
    assert.equal(result.matches[0].seq, 8)
  })
})
