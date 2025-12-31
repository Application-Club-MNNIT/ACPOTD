import { Client, GatewayIntentBits, parseEmoji } from "discord.js";
import { google } from "googleapis";
import cron from "node-cron";
import dotenv from "dotenv";
import fs from "fs";
import { exit } from "process";

dotenv.config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.MessageContent,
  ],
  partials: ["MESSAGE", "REACTION", "CHANNEL"],
});

// Load Google Sheets API credentials
const auth = new google.auth.GoogleAuth({
  keyFile: "credentials.json", // Your service account key
  scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
});
const sheets = google.sheets({ version: "v4", auth });

const SPREADSHEET_ID = process.env.SPREADSHEET_ID; // Replace with your sheet ID
const QUESTIONS_RANGE = "ACPOTD!A10:B"; // Adjust the range if needed
const SETTINGS_RANGE = "ACPOTD!A2:B8";
const LAST_FETCHED_FILE = "lastFetchedIndex.json"; // File to store the index of the last fetched question
const MESSAGE_STORAGE = "potdMessageIds.json"; // File to store the IDs of all the messages sent in POTD channel

let POTD_CHANNEL_ID = "";
let TEST_CHANNEL_ID = "";
let DEBUG = "FALSE";
let LEADER_CHANNEL_ID = "";
let LEADERBOARD = "FALSE";
let POTD_ROLE_ID_1 = "";
let POTD_ROLE_ID_2 = "";

/**
 * Function that fetches bot settings from the spreadsheet
 *
 * @returns An object containing the bot setting in this order:
 * POTD_CHANNEL_ID : Channel Id in which potds will be send
 * TEST_CHANNEL_ID : Channel Id in which messages will be send if DEBUG is TRUE
 * DEBUG : If TRUE, messages are send in TEST_CHANNEL
 * LEADER_CHANNEL_ID : Channel Id in which leaderboard will be send
 * LEADERBOARD : Send leaderbaord daily if set to TRUE otherwise not if set to FALSE
 * POTD_ROLE_ID_1 : Role 1 to tag in potd message
 * POTD_ROLE_ID_2 : Role 2 to tag in potd message
 */
async function getSettings() {
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: SETTINGS_RANGE,
    });
    const rows = response.data.values;
    if (!rows || rows.length < 7) {
      console.error("Missing Settings!");
      exit();
    }

    console.log(rows);

    return {
      POTD_CHANNEL_ID: rows[0][1],
      TEST_CHANNEL_ID: rows[1][1],
      DEBUG: rows[2][1],
      LEADER_CHANNEL_ID: rows[3][1],
      LEADERBOARD: rows[4][1],
      POTD_ROLE_ID_1: rows[5][1],
      POTD_ROLE_ID_2: rows[6][1],
    };
  } catch (error) {
    console.error("Something went wrong in fetching settings.");
    exit();
  }
}

async function updateSettings() {
  ({
    POTD_CHANNEL_ID,
    TEST_CHANNEL_ID,
    DEBUG,
    LEADER_CHANNEL_ID,
    LEADERBOARD,
    POTD_ROLE_ID_1,
    POTD_ROLE_ID_2,
  } = await getSettings());
}

// Load the last fetched index and POTD number from the file (or default to 0 and 1)
function loadLastFetchedData() {
  try {
    const data = fs.readFileSync(LAST_FETCHED_FILE, "utf-8");
    const parsedData = JSON.parse(data);
    return {
      index: parsedData.index || 1,
      potdNumber: parsedData.potdNumber || 1,
    };
  } catch (error) {
    return { index: 1, potdNumber: 1 }; // Default values
  }
}

// Save the last fetched index and POTD number to the file
function saveLastFetchedData(index, potdNumber) {
  fs.writeFileSync(
    LAST_FETCHED_FILE,
    JSON.stringify({ index, potdNumber }),
    "utf-8"
  );
}

async function getQuestions() {
  const { index, potdNumber } = loadLastFetchedData();

  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: QUESTIONS_RANGE,
    });
    const rows = response.data.values;

    if (!rows || rows.length < 1) {
      console.error("No questions found.");
      return { questions: [], potdNumber };
    }

    const q_count = 2;

    if (
      rows
        .slice(index, index + 1)[0][0]
        .toLowerCase()
        .trim() === "holiday"
    ) {
      saveLastFetchedData(index + 1, potdNumber);
      return { questions: [], potdNumber: -1 };
    }

    const nextQuestions = rows.slice(index, index + q_count);
    saveLastFetchedData(index + q_count, potdNumber + 1); // Increment by number of questions

    return { questions: nextQuestions, potdNumber };
  } catch (error) {
    console.error("Error fetching data from Google Sheets:", error);
    return { questions: [], potdNumber };
  }
}

async function sendProblemOfTheDay() {
  const { questions, potdNumber } = await getQuestions();

  let CHANNEL_ID = DEBUG === "TRUE" ? TEST_CHANNEL_ID : POTD_CHANNEL_ID;

  if (potdNumber === -1) {
    const message = `We are not posting any POTD today!
Prepare well for OPC and revise previous POTDs!!!
Best of Luck 🤞🤞`;

    try {
      const channel = await client.channels.fetch(CHANNEL_ID);
      const msg = await channel.send(message);
    } catch (error) {
      console.error("Error sending message:", error);
    }

    return;
  }

  if (questions.length === 0) return;

  const today = new Date().toLocaleDateString("en-GB");

  let questionString = "";
  let reactionString = "";

  for (let i = 1; i <= questions.length; i++) {
    questionString += `🔸 **Task ${i}:** [${questions[i - 1][0]}](<${questions[i - 1][1]}>)\n`;
  }

  const reactlist = ["1️⃣","2️⃣","3️⃣","4️⃣","5️⃣","6️⃣","7️⃣","8️⃣","9️⃣"];

  for (let i = 1; i <= questions.length; i++) {
    reactionString += `${reactlist[i - 1]} if you completed Task ${i}\n`;
  }

  const message =
`
🎯 **Problem of the Day (POTD #${potdNumber})**
📆 **Date: ${today}**  
<@&${POTD_ROLE_ID_1}> <@&${POTD_ROLE_ID_2}>

` +
    questionString +
`
React with:
` +
    reactionString;

  try {
    const channel = await client.channels.fetch(CHANNEL_ID);
    const msg = await channel.send(message);
    for (let i = 1; i <= questions.length; i++) {
      await msg.react(reactlist[i - 1]);
    }

    /* --------- APPEND MESSAGE ID TO MESSAGE_STORAGE --------- */
    if (DEBUG === "FALSE") {
      try {
        let data = { messageList: [] };

        if (fs.existsSync(MESSAGE_STORAGE)) {
          data = JSON.parse(fs.readFileSync(MESSAGE_STORAGE, "utf-8"));
        }

        data.messageList.push(msg.id);

        fs.writeFileSync(
          MESSAGE_STORAGE,
          JSON.stringify(data),
          "utf-8"
        );
      } catch (err) {
        console.error("Error updating message storage:", err);
      }
    }
    /* ------------------------------------------------------- */

  } catch (error) {
    console.error("Error sending message:", error);
  }
}

const reactionCount = new Map();

async function createLeaderboard() {
  reactionCount.clear();
  if (LEADERBOARD == "FALSE") return;
  let messageList = [];
  try {
    const data = fs.readFileSync(MESSAGE_STORAGE, "utf-8");
    const parsedData = JSON.parse(data);
    messageList = parsedData.messageList;
  } catch (error) {
    console.error("Error fetching message list: ", error);
    return;
  }

  const ALLOWED_EMOJIS = new Set([
    "1️⃣","2️⃣","3️⃣","4️⃣","5️⃣","6️⃣","7️⃣","8️⃣","9️⃣",
  ]);

  const channel = await client.channels.fetch(POTD_CHANNEL_ID);

  for (const messageId of messageList) {
    let message;
    try {
      message = await channel.messages.fetch(messageId);
    } catch {
      continue; // SKIP DELETED MESSAGE
    }

    if (message.partial) await message.fetch();

    for (const reaction of message.reactions.cache.values()) {
      if (!ALLOWED_EMOJIS.has(reaction.emoji.name)) continue;

      if (reaction.partial) await reaction.fetch();

      let lastId;

      while (true) {
        const users = await reaction.users.fetch({
          limit: 100,
          after: lastId,
        });

        if (users.size === 0) break;

        for (const user of users.values()) {
          if (user.bot) continue;
          reactionCount.set(user.id, (reactionCount.get(user.id) || 0) + 1);
        }

        lastId = users.last().id;
      }
    }
    // throttle to avoid
    await new Promise((r) => setTimeout(r, 250));
  }



  console.log("Leaderboard created successfully!!");
}

// async function getLeaderboard() {
//   const channel = await client.channels.fetch(POTD_CHANNEL_ID);
//   const messages = await channel.messages.fetch({ limit: 50 });
//   for (const message of messages.values()) {
//     for (const reaction of message.reactions.cache.values()) {
//       const users = await reaction.users.fetch();

//       for (const user of users.values()) {
//         if (user.bot) continue;
//         reactionCount.set(user.id, (reactionCount.get(user.id) || 0) + 1);
//       }
//     }
//   }
  
//   return sorted;
// }

/* ---------------- LIVE REACTION TRACKING ---------------- */

const ALLOWED_EMOJIS = new Set([
  "1️⃣","2️⃣","3️⃣","4️⃣","5️⃣","6️⃣","7️⃣","8️⃣","9️⃣",
]);

client.on("messageReactionAdd", async (reaction, user) => {
  if (user.bot) return;

  try {
    if (reaction.partial) await reaction.fetch();
    if (reaction.message.partial) await reaction.message.fetch();

    if (reaction.message.channel.id !== POTD_CHANNEL_ID) return;
    if (!ALLOWED_EMOJIS.has(reaction.emoji.name)) return;

    reactionCount.set(
      user.id,
      (reactionCount.get(user.id) || 0) + 1
    );
  } catch (err) {
    console.error("Error in reaction add handler:", err);
  }
});

client.on("messageReactionRemove", async (reaction, user) => {
  if (user.bot) return;

  try {
    if (reaction.partial) await reaction.fetch();
    if (reaction.message.partial) await reaction.message.fetch();

    if (reaction.message.channel.id !== POTD_CHANNEL_ID) return;
    if (!ALLOWED_EMOJIS.has(reaction.emoji.name)) return;

    reactionCount.set(
      user.id,
      Math.max(0, (reactionCount.get(user.id) || 0) - 1)
    );
  } catch (err) {
    console.error("Error in reaction remove handler:", err);
  }
});

async function sendLeaderboard() {
  if (LEADERBOARD == "FALSE") return;

  try {
    const sorted = [...reactionCount.entries()]
      .sort((a, b) => b[1] - a[1]);

    if (sorted.length === 0) return;

    const leaderboard = sorted.slice(0, 50);
    const CHANNEL_ID = DEBUG === "TRUE" ? TEST_CHANNEL_ID : LEADER_CHANNEL_ID;

    // Total from full reactionCount map
    const totalSubmissions = [...reactionCount.values()].reduce(
      (sum, count) => sum + count,
      0
    );

    const channel = await client.channels.fetch(CHANNEL_ID);

    /* -------- HEADER MESSAGE (ROLE PING ONLY) -------- */
    let header =
`## 🏆 POTD Leaderboard 🏆

<@&${POTD_ROLE_ID_1}>
🔥 We are so proud of you for achieving **${totalSubmissions} total POTD submissions** so far!
🌱 *Keep solving. Keep growing.*  
🚀 *Tomorrow’s POTD is another chance to climb!*

`;

    await channel.send({
      content: header,
      allowedMentions: {
        users: [],
        roles: [POTD_ROLE_ID_1],
      },
    });

    /* -------- FULL LEADERBOARD (CODEFORCES RANKING) -------- */
    const CHUNK_SIZE = 25;

    let prevCount = null;
    let currentRank = 0;

    for (let i = 0; i < leaderboard.length; i += CHUNK_SIZE) {
      let block = "";

      for (let j = i; j < Math.min(i + CHUNK_SIZE, leaderboard.length); j++) {
        const [userId, count] = leaderboard[j];

        // Codeforces-style ranking
        if (prevCount === null) {
          currentRank = 1;
        } else if (count < prevCount) {
          currentRank = j + 1; // <-- rank skipping happens here
        }

        block += `**${currentRank}.** <@${userId}> : \`${count} POTDs\`\n`;

        prevCount = count;
      }

      await channel.send({
        content: block,
        allowedMentions: { users: [] }, // no user ping spam
      });
    }

  } catch (error) {
    console.error("Error sending leaderboard:", error);
  }
}

async function fetchMessageList(maxMessages = 200) {
  let fetched = [];
  let lastId;
  try {
    const channel = await client.channels.fetch(POTD_CHANNEL_ID);
    while (fetched.length < maxMessages) {
      const messages = await channel.messages.fetch({
        limit: 100,
        before: lastId,
      });

      if (messages.size === 0) break;

      for (const msg of messages.values()) {
        fetched.push(msg.id);
      }

      lastId = messages.last().id;
    }
  } catch (error) {
    console.log("Error fetching message IDs: ", error);
    return [];
  }

  return fetched.slice(0, maxMessages);
}

async function createMessageStorage() {
  const messageList = await fetchMessageList();
  fs.writeFileSync(MESSAGE_STORAGE, JSON.stringify({ messageList }), "utf-8");
}

// Run the cron job at midnight daily
cron.schedule(
  "0 0 * * *",
  async () => {
    console.log("Cron job triggered at:", new Date().toLocaleString());
    await updateSettings();
    await sendProblemOfTheDay();
    await sendLeaderboard();
  },
  {
    timezone: "Asia/Kolkata",
  }
);

client.once("ready", () => {
  console.log(`Logged in as ${client.user.tag}`);
});

await client.login(process.env.TOKEN);

await updateSettings();
await createLeaderboard();

/* ----------------- Manual Trigger Commands ------------------- */
process.stdin.resume();
process.stdin.setEncoding("utf8");
process.stdin.on("data", async (data) => {
  const cmd = data.toString().trim();
  if (cmd === "leaderboard") {
    console.log("Manual trigger leaderboard");
    await updateSettings();
    await sendLeaderboard();
  }
  if (cmd === "make-msgfile") {
    console.log("Fetching Data......");
    await createMessageStorage();
    console.log(
      "Message List fetched successfully and saved to ",
      MESSAGE_STORAGE
    );
  }
  if (cmd === "run-potd") {
    console.log("Manual trigger via stdin");
    await updateSettings();
    await sendProblemOfTheDay();

    // For editing an already sent message

    /*const channel = await client.channels.fetch(CHANNEL_ID);
const message = await channel.messages.fetch(MESSAGE_ID);

await message.edit(`🎯 **Problem of the Day (POTD #26)**
📆 **Date: 28/12/2025**  
<@&1422660941626998784> <@&1441479212182671591>

🔸 **Task 1:** [Circular Queue](<https://leetcode.com/problems/design-circular-queue/description/>)  
🔸 **Task 2:** [First Non-Repeating Character in a Stream](<https://practice.geeksforgeeks.org/problems/first-non-repeating-character-in-a-stream/1>)  

React with:
1️⃣ if you completed Task 1  
2️⃣ if you completed Task 2`);*/
  }
});
