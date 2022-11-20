import { encode } from "https://deno.land/std@0.164.0/encoding/base64.ts";
import { Buffer } from "https://deno.land/std@0.164.0/io/mod.ts";
import { Tar } from "https://deno.land/std@0.165.0/archive/tar.ts";
import { gzip } from "https://deno.land/x/compress@v0.4.5/mod.ts";
import { copy } from "https://deno.land/std@0.164.0/streams/conversion.ts";

import { Bot, Context, InlineKeyboard, session, SessionFlavor, InputFile } from "https://deno.land/x/grammy@v1.12.0/mod.ts";
import {
  hydrateReply,
  parseMode,
} from "https://deno.land/x/grammy_parse_mode@1.5.0/mod.ts";
import type { ParseModeFlavor } from "https://deno.land/x/grammy_parse_mode@1.5.0/mod.ts";

import { Prediction, database } from "./db.ts";
import { digestMessageToHex , getEnvVariable} from "./helpers.ts"
import { type PredictionItem, type Map } from "./interfaces.ts"
import { Message } from "https://deno.land/x/grammy@v1.12.0/types.deno.ts";


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

const artOrTrashInlineKeyboard = new InlineKeyboard()
  .text("Art", "user-predicts-art")
  .text("Trash", "user-predicts-trash")

const yesOrNoInlineKeyboard = new InlineKeyboard()
  .text("Yes", "user-mind-change")
  .text("No", "user-no-mind-change")

bot.command('dump', async (ctx) => {
  const predictionsPromise = database.list();
  if (ctx.message) {
    await ctx.api.sendChatAction(ctx.message.chat.id, "upload_document")
  }
  const predictions = await predictionsPromise;
  const tar = new Tar();
  const tarPromises: Promise<Buffer | undefined>[] = [];
  predictions.forEach( prediction => {
    const directory = prediction.is_art ? 'art' : 'trash'
    const promise = getFileFromTelegram(ctx, prediction.file_id)
    promise.then(async buffer => {
      await tar.append(`${directory}/${prediction.sha256}.jpg`, {
        reader: buffer,
        contentSize: buffer?.length
      })
    })
    tarPromises.push(promise)
  })

  Promise.all(tarPromises).then(async _ => {
    const reader = tar.getReader()
    const buffer = new Buffer()
    await copy(reader, buffer)
    const gzipData = gzip(buffer.bytes())
    const hash = await digestMessageToHex(gzipData)
    ctx.replyWithDocument(new InputFile(gzipData, `${hash}.tar.gz`))
  })

})

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

  await ctx.api.sendChatAction(ctx.message.chat.id, "typing") 

  const fileId = message.document ? message.document.file_id : message.photo![1].file_id;
  const buffer = await getFileFromTelegram(ctx, fileId);
  if (!buffer) {
    await ctx.reply("Could not retrieve data from Telegram")
    return
  }

  const imageData = buffer.bytes()
  const hash = await digestMessageToHex(imageData)

  const mime_type = message.document ? message.document.mime_type : "image/jpeg"
  const base64ImageString = encode(imageData)
  /* The gradio predicion fails with `request entity too large` for _some_ images
  The iamges I download from telegram are small, checked the size
  What's the pattern?
  */
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
  if (modelPredictionResult.error) {
    await ctx.reply(`Error retrieving prediction result: ${modelPredictionResult.error}`)
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

  const promise = database.exists(ctx.message.from.id, hash)
  
  await ctx.reply(responseMessage)

  let userPrediction: Prediction
  let botReplyMsg: Message.TextMessage
  const existingUserPrediction = await promise
  if (existingUserPrediction) {
    userPrediction = existingUserPrediction
    const userClassificationEmoji = userPrediction.is_art ? "🎨" : "🚮"
    let msg = 'You already told me what you think this is. '
    msg += `Last time, you said it's ${userClassificationEmoji}. `
    msg += `Did you change your mind?`
    msg = msg.replaceAll(/\./g, "\\.")
    botReplyMsg = await ctx.reply(msg, {reply_markup: yesOrNoInlineKeyboard})
  } else {
    userPrediction = {     
      chat_id: ctx.message.chat.id,
      user_id: ctx.message.from.id,
      msg_id: ctx.message.message_id,
      file_id: fileId,
      sha256: hash,
    }
    botReplyMsg = await ctx.reply("What do you think this is?", {reply_markup: artOrTrashInlineKeyboard})
  }

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

bot.callbackQuery("user-mind-change", async (ctx) => {
  const isArt = !ctx.session.userPrediction.is_art
  await answerCallback(isArt, ctx);
}) 

bot.callbackQuery("user-no-mind-change", async (ctx) => {
  const { inlineKeyboardMsg } = ctx.session
  const {chatId, msgId} = inlineKeyboardMsg 
  await bot.api.deleteMessage(chatId, msgId)
  await ctx.answerCallbackQuery("Didn't change anything - it's ok to (not) change your mind")
}) 

async function answerCallback(isArt: boolean, ctx: CustomContext) {
  let success: boolean
  let msg: string
  const { userPrediction, inlineKeyboardMsg } = ctx.session
  if (!userPrediction.id) {
    const userPrediction = ctx.session.userPrediction
    userPrediction.is_art = isArt
    success = await database.insert(userPrediction);
    msg = success ? "Your prediction has been inserted in the database" : "Error: failed inserting new record into db"
  } else {
    // UNIQUE in supabase seems to be only possible on the row level (not multiple rows combined)
    // so instead of an upsert, we do an (independent) update
    success = await database.update(userPrediction.id, isArt)
    msg = success ? "Your classification has been updated" : "Error: failed updating record in db"
  }
  await ctx.answerCallbackQuery(msg)

  if (success) {
    const {chatId, msgId} = inlineKeyboardMsg 
    await bot.api.deleteMessage(chatId, msgId)
  }
    
}

async function getFileFromTelegram(ctx: Context, fileId: string): Promise<Buffer | undefined> {
  const fileData = await ctx.api.getFile(fileId);
  const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${fileData.file_path}`;

  const fileResponse = await fetch(fileUrl)
  if (!fileResponse.body) {
    return
  }

  const telegramFileResponseReader = fileResponse.body.getReader()
  const buffer = new Buffer()
  let chunk = await telegramFileResponseReader.read()
  while (chunk.value) {
    buffer.write(chunk.value)
    chunk = await telegramFileResponseReader.read()
  }

  return buffer
}

if (STAGE === "dev") {
  bot.start();
}

export default bot
