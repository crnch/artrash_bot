import { Bot } from "https://deno.land/x/grammy@v1.12.0/mod.ts";
import * as base64 from "https://denopkg.com/chiefbiiko/base64@master/mod.ts";
import { config } from "https://deno.land/std@0.163.0/dotenv/mod.ts";
import { Buffer } from "https://deno.land/std@0.163.0/io/mod.ts";

const envConfig = await config()

function getEnvVariable(key: string): (string | undefined) {
  return (envConfig[key] || Deno.env.get(key))
}

const BOT_TOKEN = getEnvVariable("BOT_TOKEN")!; 
const PREDICTOR_URL = getEnvVariable("PREDICTOR_URL")!;
const STAGE = getEnvVariable("STAGE")! // dev | prod

interface PredictionItem {
  label: string,
  confidence: number
}

interface Map {
  [key: string]: string
}

const bot = new Bot(BOT_TOKEN)

bot.on('message', async (ctx) => {
  const mime_type_pattern = /image\/.+/
  const message = ctx.update.message;
  if (!message) {
    return
  }
  // only process photos or messages containing images
  if (
    !(
      message.photo ||
      message.document?.mime_type?.match(mime_type_pattern)
    )
  ) {
    return
  }

  const fileId = message.document ? message.document.file_id : message.photo![2].file_id;
  const file = await ctx.api.getFile(fileId);
  const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`;

  const fileResponse = await fetch(fileUrl)
  if (!fileResponse.body) {
    return
  }

  const reader = fileResponse.body.getReader()
  const buffer = new Buffer()
  let chunk = await reader.read()
  let data = chunk.value
  while (data) {
    buffer.write(data)
    chunk = await reader.read()
    data = chunk.value
  }

  const mime_type = message.document ? message.document.mime_type : "image/jpeg"
  const base64ImageString = base64.fromUint8Array(buffer.bytes())
  const predictionResponse = await fetch(
    PREDICTOR_URL,
    {
      method: 'POST',
      body: JSON.stringify({
        data: [
          `data:${mime_type};base64,${base64ImageString}`,
        ],
      }),
      headers: { 'Content-Type': 'application/json' },
    },
  )
  const predictionResult = await predictionResponse.json()
  if ("error" in predictionResult) {
    await ctx.reply("Could not read data")
    return
  }

  const prediction = predictionResult.data[0];
  const confidences: PredictionItem[] = prediction.confidences;
  if (!confidences) {
    return
  }

  const labelToEmoji: Map = {
    'modern conceptual art': "🎨",
    "junk": "🚮"
  }
  const listItems = confidences.map(
    (item: PredictionItem) => `${labelToEmoji[item.label]} ${(item.confidence * 100).toFixed(2)} %`,
  )
  let responseMessage = `This is **${prediction.label}**\n`
  responseMessage += '\nConfidences:\n'
  responseMessage += listItems.join('\n')
  responseMessage = responseMessage.replaceAll(/\./g, "\\.")

  await ctx.reply(responseMessage, { parse_mode: "MarkdownV2" })
})


if (STAGE === "dev") {
  bot.start();
}
