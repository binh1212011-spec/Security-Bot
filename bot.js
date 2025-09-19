const { Client, GatewayIntentBits, EmbedBuilder, PermissionsBitField } = require("discord.js");
const fetch = require("node-fetch");
const Database = require("better-sqlite3");
const fs = require("fs");
require("dotenv").config();

// ==== INIT BOT ====
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

// ==== DATABASE ====
const db = new Database("warnings.db");
db.prepare(
  "CREATE TABLE IF NOT EXISTS warnings (userId TEXT, guildId TEXT, points INTEGER, PRIMARY KEY (userId, guildId))"
).run();

// ==== LOAD RULES ====
const rules = JSON.parse(fs.readFileSync("rules.json", "utf8"));

// ==== HELPER FUNCTIONS ====
async function checkModeration(text) {
  const response = await fetch("https://api-inference.huggingface.co/models/KoalaAI/Text-Moderation", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.HUGGINGFACE_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ inputs: text }),
  });

  if (!response.ok) return null;
  return await response.json();
}

function addWarning(userId, guildId, points) {
  const existing = db.prepare("SELECT * FROM warnings WHERE userId=? AND guildId=?").get(userId, guildId);
  if (existing) {
    db.prepare("UPDATE warnings SET points=? WHERE userId=? AND guildId=?").run(existing.points + points, userId, guildId);
    return existing.points + points;
  } else {
    db.prepare("INSERT INTO warnings (userId, guildId, points) VALUES (?, ?, ?)").run(userId, guildId, points);
    return points;
  }
}

function getRuleByName(name) {
  return rules.rules.find(r => r.name.toLowerCase() === name.toLowerCase());
}

async function punish(member, rule, channel) {
  let actionText = "";
  if (rule.warningLevel === "instant") {
    await member.ban({ reason: rule.name }).catch(() => {});
    actionText = "Banned instantly";
  } else if (rule.additionalPunishment?.toLowerCase().includes("mute")) {
    await member.timeout(60 * 60 * 1000, rule.name).catch(() => {});
    actionText = "Muted 1h";
  } else {
    actionText = "Warning applied";
  }

  // Log
  const embed = new EmbedBuilder()
    .setTitle("⚠️ Rule Violation Detected")
    .setDescription(`**User:** ${member.user.tag}\n**Rule:** ${rule.name}\n**Action:** ${actionText}`)
    .setColor("Red")
    .setTimestamp();

  const logChannel = channel.guild.channels.cache.get(process.env.LOG_CHANNEL_ID);
  if (logChannel) logChannel.send({ embeds: [embed] });

  // DM
  member.send({ embeds: [embed] }).catch(() => {});
}

// ==== ON MESSAGE ====
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (message.channel.nsfw) return; // skip NSFW channels

  const text = message.content;
  if (!text) return;

  // Hugging Face moderation
  const result = await checkModeration(text);
  if (!result || !Array.isArray(result)) return;

  // result ví dụ: [{label: "toxic", score: 0.9}, ...]
  const top = result[0];
  if (!top) return;

  let matchedRule = null;

  if (top.label.includes("toxic")) matchedRule = getRuleByName("Toxicity");
  if (top.label.includes("nsfw")) matchedRule = getRuleByName("NSFW");
  if (top.label.includes("hate")) matchedRule = getRuleByName("Hate Speech/Racism");

  if (matchedRule) {
    const member = await message.guild.members.fetch(message.author.id);
    const newPoints = addWarning(message.author.id, message.guild.id, matchedRule.warningLevel === "instant" ? 999 : matchedRule.warningLevel);
    await punish(member, matchedRule, message.channel);

    console.log(`User ${message.author.tag} violated ${matchedRule.name}, total warnings: ${newPoints}`);
  }
});

// ==== LOGIN ====
client.once("ready", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

client.login(process.env.DISCORD_TOKEN);
