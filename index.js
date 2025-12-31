import { Client, GatewayIntentBits } from "discord.js";
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
    GatewayIntentBits.MessageContent,
  ],
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

    // console.log(rows);
    
    return {
      POTD_CHANNEL_ID : rows[0][1],
      TEST_CHANNEL_ID : rows[1][1],
      DEBUG : rows[2][1],
      LEADER_CHANNEL_ID : rows[3][1],
      LEADERBOARD : rows[4][1],
      POTD_ROLE_ID_1 : rows[5][1],
      POTD_ROLE_ID_2 : rows[6][1],
    };
  } catch (error) {
    console.error("Something went wrong in fetching settings.");
    exit();
  }
}

async function initBot(){
  ({
    POTD_CHANNEL_ID,
    TEST_CHANNEL_ID,
    DEBUG,
    LEADER_CHANNEL_ID,
    LEADERBOARD,
    POTD_ROLE_ID_1,
    POTD_ROLE_ID_2
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

    // first row is the number of questions
    if (!rows || rows.length <= 1) {
      console.log("No data found.");
      return { questions: [], potdNumber };
    }

    // first row has the count of questions to send
    const q_count = 2;

    // index tell the row number in the sheet starting from which the questions will be fetched
    if (
      rows
        .slice(index - 1, index)[0][0]
        .toLowerCase()
        .trim() === "holiday"
    ) {
      saveLastFetchedData(index + 1, potdNumber);
      return { questions: [], potdNumber: -1 };
    }

    const nextQuestions = rows.slice(index - 1, index - 1 + q_count);
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
      // const msg = await channel.send(message);
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
    questionString += `🔸 **Task ${i}:** [${questions[i - 1][0]}](<${
      questions[i - 1][1]
    }>)\n`;
  }

  const reactlist = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣"];

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
  } catch (error) {
    console.error("Error sending message:", error);
  }
}

const reactionCount = new Map();

async function getLeaderboard() {
  const channel = await client.channels.fetch(POTD_CHANNEL_ID);
  const messages = await channel.messages.fetch({ limit: 50 });
  for (const message of messages.values()) {
    for (const reaction of message.reactions.cache.values()) {
      const users = await reaction.users.fetch();

      for (const user of users.values()) {
        if (user.bot) continue;
        reactionCount.set(user.id, (reactionCount.get(user.id) || 0) + 1);
      }
    }
  }
  const sorted = [...reactionCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 50);
  return sorted;
}

async function sendLeaderboard() {
  const leaderboard = await getLeaderboard();
  let CHANNEL_ID = DEBUG === "TRUE" ? TEST_CHANNEL_ID : LEADER_CHANNEL_ID;
  let message = "# Leaderboard\n";
  for (let i = 0; i < leaderboard.length; i++) {
    message += `<@${leaderboard[i][0]}> : ${leaderboard[i][1]}\n`;
  }
  try {
    const channel = await client.channels.fetch(CHANNEL_ID);
    await channel.send(message);
  } catch (error) {
    console.log("Error sending leaderboard.");
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
    console.log("Cron job triggered at:", new Date().toLocaleString()); // Logs the time when the cron job runs
    await initBot();
    await sendProblemOfTheDay();
  },
  {
    timezone: "Asia/Kolkata",
  }
);

client.once("ready", () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.login(process.env.TOKEN);

process.stdin.resume();
process.stdin.setEncoding("utf8");
process.stdin.on("data", async (data) => {
  const cmd = data.toString().trim();
  if (cmd === "leaderboard") {
    console.log("Manual trigger leaderboard");
    await initBot();
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
    await initBot();
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
