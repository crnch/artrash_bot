import { encode } from "https://deno.land/std@0.163.0/encoding/base64.ts";
import { Buffer } from "https://deno.land/std@0.163.0/io/mod.ts";
import { Bot, Context, InlineKeyboard, session, SessionFlavor } from "https://deno.land/x/grammy@v1.12.0/mod.ts";
import {
  hydrateReply,
  parseMode,
} from "https://deno.land/x/grammy_parse_mode@1.5.0/mod.ts";
import type { ParseModeFlavor } from "https://deno.land/x/grammy_parse_mode@1.5.0/mod.ts";

import { Prediction, database } from "./db.ts";
import { digestMessageToHex , getEnvVariable} from "./helpers.ts"
import { type PredictionItem, type Map } from "./interfaces.ts"


const BOT_TOKEN = getEnvVariable("BOT_TOKEN")!; 
const PREDICTOR_URL = getEnvVariable("PREDICTOR_URL")!;
const STAGE = getEnvVariable("STAGE")! // dev | prod

type MyContext = Context & SessionFlavor<Prediction>;

const bot = new Bot<ParseModeFlavor<MyContext>>(BOT_TOKEN);
bot.use(hydrateReply).use(session());
bot.api.config.use(parseMode("MarkdownV2"));

const inlineKeyboard = new InlineKeyboard()
  .text("Art", "user-predicts-art")
  .text("Trash", "user-predicts-trash")

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

  const imageData = buffer.bytes()
  const hash = await digestMessageToHex(imageData)

  const mime_type = message.document ? message.document.mime_type : "image/jpeg"
  const base64ImageString = encode(imageData)
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

  const modelPrediction = predictionResult.data[0];
  const confidences: PredictionItem[] = modelPrediction?.confidences;
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
  let responseMessage = `This is **${modelPrediction.label}**\n`
  responseMessage += '\nConfidences:\n'
  responseMessage += listItems.join('\n')
  responseMessage = responseMessage.replaceAll(/\./g, "\\.")

  await ctx.reply(responseMessage)
  
  const userPrediction: Prediction = {     
    chat_id: ctx.message.chat.id,
    user_id: ctx.message.from.id,
    msg_id: ctx.message.message_id,
    file_id: fileId,
    sha256: hash,
  }
  ctx.session = userPrediction

  await ctx.reply("What do you think this is?", {reply_markup: inlineKeyboard})
})

bot.callbackQuery("user-predicts-art", async (ctx) => {
  const userPrediction = ctx.session
  userPrediction.is_art = true
  await database.insert(userPrediction);
  await ctx.answerCallbackQuery("Your prediction has been inserted in the database")
}) 

bot.callbackQuery("user-predicts-trash", async (ctx) => {
  const userPrediction = ctx.session
  userPrediction.is_art = false
  const success = await database.insert(userPrediction);
  const msg = success ? "Your prediction has been inserted in the database" : "Error: failed inserting new record into db"
  await ctx.answerCallbackQuery(msg)
}) 


if (STAGE === "dev") {
  bot.start();
}

export default bot
