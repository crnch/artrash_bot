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

interface SessionData {
  inlineKeyboardMsg: {
    msgId: number,
    chatId: number
  },
  userPrediction: Prediction
}

type CustomContext = Context & SessionFlavor<SessionData>;

const bot = new Bot<ParseModeFlavor<CustomContext>>(BOT_TOKEN);
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
  const buffer = await getFileFromTelegram(ctx, fileId);
  if (!buffer) {
    await ctx.reply("Could not retrieve data from Telegram")
    return
  }

  const imageData = buffer.bytes()
  const hash = await digestMessageToHex(imageData)

  const mime_type = message.document ? message.document.mime_type : "image/jpeg"
  const base64ImageString = encode(imageData)
  const modelPredictionResponse = await fetch(
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
  const modelPredictionResult = await modelPredictionResponse.json()
  if ("error" in modelPredictionResult) {
    await ctx.reply("Could not read data")
    return
  }

  const modelPrediction = modelPredictionResult.data[0];
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

  const botReplyMsg = await ctx.reply("What do you think this is?", {reply_markup: inlineKeyboard})
  ctx.session = { 
    userPrediction,
    inlineKeyboardMsg: {
      chatId: botReplyMsg.chat.id,
      msgId: botReplyMsg.message_id
    }
  }
})

bot.callbackQuery("user-predicts-art", async (ctx) => {
  await answerCallback(true, ctx);
}) 

bot.callbackQuery("user-predicts-trash", async (ctx) => {
  await answerCallback(false, ctx);
}) 

async function answerCallback(isArt: boolean, ctx: CustomContext) {
  const userPrediction = ctx.session.userPrediction
  userPrediction.is_art = isArt
  const success = await database.insert(userPrediction);
  const msg = success ? "Your prediction has been inserted in the database" : "Error: failed inserting new record into db"
  await ctx.answerCallbackQuery(msg)

  if (success) {
    const {chatId, msgId} = ctx.session.inlineKeyboardMsg 
    await bot.api.deleteMessage(chatId, msgId)
  } 
    
}

/* TODOs
 - outsource this method to helpers?
 - implement compression/archive generation of all images in db
 - upload to telegram for user who requested dump
 - https://github.com/deno-library/compress
 - https://deno.land/std@0.164.0/archive/tar.ts
*/
async function getFileFromTelegram(ctx: Context, fileId: string): Promise<Buffer | undefined> {
  const fileData = await ctx.api.getFile(fileId);
  const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${fileData.file_path}`;

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

  return buffer
}

if (STAGE === "dev") {
  bot.start();
}

export default bot
