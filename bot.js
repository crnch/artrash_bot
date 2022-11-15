import { Buffer } from 'node:buffer'

import * as dotenv from 'dotenv' // see https://github.com/motdotla/dotenv#how-do-i-use-dotenv-with-import
import { Telegraf, Telegram } from 'telegraf'
import fetch from 'node-fetch'

dotenv.config()

const bot = new Telegraf(process.env.BOT_TOKEN)
const api = new Telegram(process.env.BOT_TOKEN)

bot.command('quit', async (ctx) => {
  // Using context shortcut
  await ctx.leaveChat()
})

bot.on('message', async (ctx) => {
  const mime_type_pattern = /image\/.+/
  const message = ctx.update.message;
  if (
    !(
      message.photo ||
      (message.document &&
        message.document.mime_type.match(mime_type_pattern))
    )
  ) {
    return
  }

  const fileId = message.document ? message.document.file_id : message.photo[2].file_id
  const file = await api.getFile(fileId)
  const fileUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${file.file_path}`

  const fileResponse = await fetch(fileUrl)
  const chunks = []
  const stream = fileResponse.body
  // 'stream' may be triggered multiple times as data is buffered in

  for await (const chunk of stream.iterator({ destroyOnReturn: false })) {
    chunks.push(chunk) //
  }
  const buf = Buffer.concat(chunks)

  const mime_type = message.document ? message.document.mime_type : "image/jpeg"
  const predictionResponse = await fetch(
    'https://hf.space/embed/msc/artrash/+/api/predict',
    {
      method: 'POST',
      body: JSON.stringify({
        data: [
          `data:${mime_type};base64,${buf.toString(
            'base64',
          )}`,
        ],
      }),
      headers: { 'Content-Type': 'application/json' },
    },
  )
  const result = await predictionResponse.json()

  const prediction = result.data[0]
  const labelToEmoji = {
    "modern conceptual art": "🎨",
    "junk": "🚮"
  }
  const listItems = prediction.confidences.map(
    (item) => `${labelToEmoji[item.label]} ${(item.confidence * 100).toFixed(2)} %`,
  )
  let responseMessage = `This is *${prediction.label}*\n`
  responseMessage += '\nConfidences:\n'
  responseMessage += listItems.join('\n')

  await ctx.replyWithMarkdown(responseMessage)
})

bot.launch()

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'))
process.once('SIGTERM', () => bot.stop('SIGTERM'))
