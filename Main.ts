import validator from "validator";
import {request} from "undici";
import fetch from "node-fetch";

import Express from 'express';
const app = Express();

import dotenv from "dotenv";
const auth = dotenv.config({path: "./.env"});
if (!auth?.parsed || auth?.error) {
  throw "Unable to access .env file";
};

const bunnyEndpoint = `https://se.storage.bunnycdn.com/${auth.parsed["STORAGE_ZONE_NAME"]}`;

// basic security
import helmet from "helmet";
app.use(helmet());
app.use(Express.json({strict: true, type: "application/json"}))

// OK
app.get("/", (_, res) => {
  return res.sendStatus(200);
});

// post content to cdn
app.post("/", async (req, res) => {
  try {
    // we use a simple authorization, whoever had the key will be able to post content to cdn
    if (process.env.npm_lifecycle_event !== "dev") { // ignore auth if dev mode
      if (!auth?.parsed?.["AUTH"]) {
        return res.status(500).send("unable to retrieve private key from backend");
      };
  
      const authorization = req.headers.authorization;
      if (!authorization || authorization !== auth.parsed["AUTH"]) {
        return res.status(403).send("unauthorized");
      };
    };

    // because this server is specialized for discord bot, we use guild ID as a folder name
    if (!req.body?.guildID?.match(/^(\d){15,21}$/gim)) {
      return res.status(400).send("invalid discord guild id");
    };

    // the value of "content" is url
    if (!req.body.content || !validator.isURL(req.body.content, { require_protocol: true })) {
      return res.status(400).send("invalid url");
    };

    let mimeType = {
      "image/jpg": "jpg",
      "image/jpeg": "jpeg",
      "image/png": "png",
      "image/webp": "webp",
      "video/mp4": "mp4",
      "video/mpeg": "mpeg",
      "video/webm": "webm"
    };

    // content processing
    const content = await request(req.body.content);
    if (!content || content.statusCode >= 400) {
      console.error("content error", content.statusCode, await content.body.text());
      return res.status(400).send("unable to fetch the content");
    };

    if (!content?.headers?.["content-type"] || !mimeType[content.headers["content-type"]]) {
      return res.status(400).send("invalid content type");
    };

    const processedContent = Buffer.from(await content.body.arrayBuffer());

    // upload to bunny
    if (!auth?.parsed?.BUNNY_API_PASS) {
      return res.status(500).send("unable to retrieve centre private key");
    };

    const randomFileName = generateString(randomNumber(8, 16)) + "." + mimeType[content.headers["content-type"]];
    const bunnyPost = await fetch(bunnyEndpoint + `/discord/${req.body.guildID}` + `/${randomFileName}`, {
      method: 'PUT',
      body: processedContent,
      headers: {
        "AccessKey": auth.parsed.BUNNY_API_PASS,
        "content-type": "application/octet-stream"
      }
    });

    if (!bunnyPost || bunnyPost.status >= 400) {
      console.error("centre error", await bunnyPost.text());
      return res.status(500).send("unable to post the content to centre");
    };

    // console.log(bunnyPost.status, await bunnyPost.json());
    return res.status(200).send(`https://cdn.cdev.shop/discord/${req.body.guildID}/${randomFileName}`);
  } catch (error) {
    console.error(error);
    return res.status(500).send("something went wrong in the background");
  };
});

const PORT = +auth.parsed.PORT;
app.listen(PORT, () => {
  console.log("Media: Connected with port", PORT)
});

function generateString(length: number) {
  const characters = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-";
  return [...Array(length || 16)].map(_ => characters[~~(Math.random() * characters.length)]).join('');
};

function randomNumber(min: number, max: number) {
  return Math.floor(Math.random() * (Math.floor(max) - Math.ceil(min)) + Math.ceil(min));
};