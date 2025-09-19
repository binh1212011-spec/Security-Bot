const { 
  Client, 
  GatewayIntentBits, 
  EmbedBuilder, 
  Partials 
} = require("discord.js");
const fs = require("fs");
const fetch = require("node-fetch");
const express = require("express");
const sqlite3 = require("sqlite3").verbose();
require("dotenv").config();

// === Discord Client ===
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Message, Partials.Channel, Partials.User]
});

// === Keep Alive ===
const app = express();
app.get("/", (_, res) => res.send("Bot is alive!"));
app.listen(process.env.PORT || 3000, () => 
  console.log("Keep-alive server running")
);

// === Database ===
const db = new sqlite3.Database("warnings.db");
db.run(`
  CREATE TABLE IF NOT EXISTS warnings (
    userId TEXT,
    guildId TEXT,
    points INTEGER,
    PRIMARY KEY (userId, guildId)
  )
`);

// === Rules ===
const rules = JSON.parse(fs.readFileSync("rules.json", "utf8")).rules;

// === Helper DB functions ===
function addWarning(userId, guildId, points, callback) {
  db.get("SELECT * FROM warnings WHERE userId=? AND guildId=?", [userId, guildId], (err, row) => {
    if (row) {
      const newPoints = row.points + points;
      db.run("UPDATE warnings SET points=? WHERE userId=? AND guildId=?", [newPoints, userId, guildId]);
      callback(newPoints);
    } else {
      db.run("INSERT INTO warnings (userId, guildId, points) VALUES (?, ?, ?)", [userId, guildId, points]);
      callback(points);
    }
  });
}

function resetWarnings(userId, guildId) {
  db.run("DELETE FROM warnings WHERE userId=? AND guildId=?", [userId, guildId]);
}

function getWarnings(userId, guildId, callback) {
  db.get("SELECT points FROM warnings WHERE userId=? AND guildId=?", [userId, guildId], (err, row) => {
    callback(row ? row.points : 0);
  });
}

// === Hugging Face API ===
async function checkMessageAI(content) {
  const res = await fetch("https://api-inference.huggingface.co/models/KoalaAI/Text-Moderation", {
    method: "POST",
    headers: { 
      "Authorization": `Bearer ${process.env.HF_API_KEY}`, 
      "Content-Type": "application/json" 
    },
    body: JSON.stringify({ inputs: content })
  });

  if (!res.ok) return null;
  return await res.json();
}

// === Punishment ===
async function punish(member, rule, channel) {
  let actionTaken = "";
  try {
    if (rule.warningLevel === "instant") {
      await member.ban({ reason: rule.name });
      actionTaken = "🚨 Banned (instant rule)";
    } else {
      switch (rule.warningLevel) {
        case 2:
          await member.timeout(60 * 60 * 1000, "2 WP Mute");
          actionTaken = "⏱️ Muted 1h";
          break;
        case 3:
          await member.timeout(12 * 60 * 60 * 1000, "3 WP Mute");
          actionTaken = "⏱️ Muted 12h";
          break;
        case 4:
          await member.timeout(24 * 60 * 60 * 1000, "4 WP Mute");
          actionTaken = "⏱️ Muted 1d";
          break;
        default:
          actionTaken = "⚠️ Warning only";
      }
    }
  } catch (e) {
    console.log("Punishment error:", e);
  }

  // Log
  if (actionTaken) {
    const embed = new EmbedBuilder()
      .setTitle("🛡️ Action Taken")
      .addFields(
        { name: "User", value: `<@${member.id}>`, inline: true },
        { name: "Action", value: actionTaken, inline: true },
        { name: "Rule", value: rule.name, inline: false }
      )
      .setColor("Orange")
      .setTimestamp();
    const logChannel = await client.channels.fetch(process.env.LOG_CHANNEL_ID);
    logChannel.send({ embeds: [embed] });
  }
}

// === Message Event ===
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (message.channel.nsfw) return; // ❌ Bỏ qua kênh NSFW

  let matchedRule = null;

  // 1. Check rules.json
  for (const rule of rules) {
    if (message.content.toLowerCase().includes(rule.name.toLowerCase())) {
      matchedRule = rule;
      break;
    }
  }

  // 2. Check AI
  try {
    const result = await checkMessageAI(message.content);
    if (result && Array.isArray(result) && result[0]?.label) {
      matchedRule = matchedRule || {
        name: result[0].label,
        warningLevel: 1
      };
    }
  } catch (err) {
    console.log("AI check error:", err);
  }

  if (matchedRule) {
    const member = await message.guild.members.fetch(message.author.id);
    addWarning(message.author.id, message.guild.id, matchedRule.warningLevel === "instant" ? 999 : matchedRule.warningLevel, (newPoints) => {
      punish(member, matchedRule, message.channel);
      console.log(`⚠️ ${message.author.tag} violated ${matchedRule.name} | Total WP: ${newPoints}`);
    });
  }
});

// === Ready ===
client.once("ready", () => {
  console.log(`${client.user.tag} is online ✅`);
});

// === Login ===
client.login(process.env.DISCORD_TOKEN);
