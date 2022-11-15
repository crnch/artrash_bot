# Telegram Bot to recognize true art

This PoC demonstrates how to run a simple Telegram echo bot with on AWS Lambda and API Gateway using the Serverless Framework. All photos sent to the bot are sent to a self-trained image model hostet on [Hugging Face](https://huggingface.co/spaces/msc/artrash). The bot answers in Telegram with the prediction result.

## Usage

After installing dependencies (using `npm install` or the similar), the following commands are available:

```shell
npm run serverless # alias for the serverless binary
npm run release
npm run purge
npm run set-webhook
```

Copy `.env.example` to `.env` and replace the `BOT_TOKEN` with the one you've received from the Telegram Botfather.
Replace `PREDICTOR_URL` with the API URL from Hugging Face. Voila!

After running `npm run release` your code is deployed at AWS and you should be able to see it in the console.
The next step is to tell the [Telegram Bot API your endpoint](https://core.telegram.org/bots/api#setwebhook).
To use the Telegraf helper, you must copy the full URL from the deployment step and run:

```shell
npm run set-webhook -- -t $BOT_TOKEN -D '{ "url": $FULL_URL_TO_FUNCTION }'
```

If you publish to AWS Lambda with a CI, you can run this npm script from your CI instead.

For more details, consult

- [serverless framework documentation](https://www.serverless.com)
- [Telegraf.js](https://telegraf.js.org/index.html)
- [Telegram Bot API Docs](https://core.telegram.org/bots/api)
- [fast.ai course: Lesson 2](https://course.fast.ai/Lessons/lesson2.html)
- [gradio Docs](https://www.gradio.app/docs/)
- [React WebApp talking to the same predictor](https://github.com/maschlr/artrash)
