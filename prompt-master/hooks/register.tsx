import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { PromptMasterStatus } from '../types'

const status = atom({ plugin: 'prompt-master', key: 'status' } as const, 'idle' as PromptMasterStatus)
const original = atom({ plugin: 'prompt-master', key: 'original' } as const, null as string | null)

const SYSTEM = `You are Prompt Master, an expert prompt engineer. The user gives you a rough prompt they are about to send to Claude, an AI assistant. Rewrite it into a clearer, more effective prompt.

Rules:
- Keep the user's intent, facts, names, code, file paths and constraints exactly. Never invent requirements, data or context they did not give.
- Make the goal explicit, state the desired output (format, length, depth) when it can be inferred, and add relevant context or success criteria implied by the request.
- Organise longer requests with short sections or bullet points; keep simple requests short. Don't pad.
- Write in the user's voice (first person, addressed to Claude). Keep their language.
- Where something essential is ambiguous, leave a short [bracketed placeholder] for them to fill rather than guessing.
- Output ONLY the rewritten prompt: no preamble, no quotes, no explanation.`

async function run($: EngineInterface): Promise<void> {
  if ((await read($, status)) === 'working') return
  const { text } = await $.prompt.read()
  const draft = text.trim()
  if (!draft) {
    $.ui.toast('Prompt Master: type a rough prompt first')
    return
  }

  await update($, status, () => 'working')
  $.ui.status('Prompt Master: rewriting…')
  try {
    const r = await $.model.complete({
      model: 'sonnet',
      system: SYSTEM,
      prompt: `Rough prompt to rewrite:\n\n<rough_prompt>\n${draft}\n</rough_prompt>`,
      maxTokens: 2000,
      timeoutMs: 60000,
    })
    if (!r.isAnswered || !r.text.trim()) {
      $.ui.toast(`Prompt Master couldn't rewrite it (${r.isAnswered ? 'empty reply' : r.reason})`)
      return
    }
    const filled = await $.prompt.fill({ text: r.text.trim(), mode: 'replace' })
    if (filled.isFilled) {
      await update($, original, () => text)
      $.ui.toast('Prompt rewritten. Review it, then send.')
    } else {
      $.ui.toast('Prompt Master: the prompt box is busy, try again')
    }
  } finally {
    await update($, status, () => 'idle')
    $.ui.status(undefined)
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'prompt-master',
      description: 'Rewrite the prompt in the box into a better one',
    })
    return next(e)
  })

  on('command.run', { command: 'prompt-master' }, async $ => {
    void run($)
    return { text: '' }
  })

  // Forget the undo copy once the prompt is sent.
  on('prompt.submit', ($, e, next) => {
    void update($, original, () => null).catch(() => undefined)
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    const isWorking = (await read($, status)) === 'working'
    const before = await read($, original)

    return (
      <Box flexDirection="row" gap={1}>
        {isWorking ? (
          <Text dimColor>✨ Prompt Master is rewriting your prompt…</Text>
        ) : (
          <Button key="rewrite" label="✨ Prompt Master" variant="primary" onPress={() => run($)} />
        )}
        {!isWorking && before !== null ? (
          <Button
            key="undo"
            label="Undo"
            dimColor
            onPress={async () => {
              await $.prompt.fill({ text: before, mode: 'replace' })
              await update($, original, () => null)
            }}
          />
        ) : null}
      </Box>
    )
  })
}
