// ==== IMPORT MODULES ====
const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  REST,
  Routes,
  SlashCommandBuilder,
} = require("discord.js");
const fs = require("fs");
const fetch = require("node-fetch");
require("dotenv").config();

// ==== LOAD CONFIG ====
const TOKEN = process.env.TOKEN;
const BOT_ID = process.env.BOT_ID;
const GUILD_ID = process.env.GUILD_ID;
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID;
const API_KEY = process.env.API_KEY;

// ==== INIT BOT ====
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

// ==== WARNING SYSTEM ====
let warnings = {};
const WARN_FILE = "./warnings.json";
if (fs.existsSync(WARN_FILE)) {
  warnings = JSON.parse(fs.readFileSync(WARN_FILE));
}

function saveWarnings() {
  fs.writeFileSync(WARN_FILE, JSON.stringify(warnings, null, 2));
}

async function addWarning(userId, guild, reason) {
  if (!warnings[userId]) warnings[userId] = { points: 0, history: [] };
  warnings[userId].points += 1;
  warnings[userId].history.push({ reason, date: Date.now() });
  saveWarnings();

  const points = warnings[userId].points;
  let member;
  try {
    member = await guild.members.fetch(userId);
  } catch (err) {
    console.error("Failed to fetch member:", err);
    return;
  }

  // Punishments
  try {
    if (points === 2) {
      await member.timeout(60 * 60 * 1000, "Mute 1h (2 warns)");
    } else if (points === 3) {
      await member.timeout(12 * 60 * 60 * 1000, "Mute 12h (3 warns)");
    } else if (points === 4) {
      await member.timeout(24 * 60 * 60 * 1000, "Mute 1d (4 warns)");
    } else if (points >= 5) {
      await member.ban({ reason: "5 warns = ban" });
    }
  } catch (err) {
    console.error("Failed to punish member:", err);
  }

  // Log
  const logChannel = guild.channels.cache.get(LOG_CHANNEL_ID);
  if (logChannel) {
    const embed = new EmbedBuilder()
      .setTitle("⚠️ Cảnh cáo")
      .setDescription(
        `<@${userId}> bị cảnh cáo. Lý do: **${reason}**\nTổng điểm: **${points}**`
      )
      .setColor("Yellow");
    logChannel.send({ embeds: [embed] }).catch(() => {});
  }
}

// ==== MODERATION API CHECK ====
async function checkMessage(content) {
  if (!API_KEY) return null;
  try {
    const res = await fetch(
      "https://api.moderationapi.com/v1/models/68ccdda94f14cc53a429a009/68cd094c4f14cc53a429a00b/predict",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ input: content }),
      }
    );

    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.error("API error:", err);
    return null;
  }
}

// ==== ON MESSAGE ====
client.on("messageCreate", async (msg) => {
  if (!msg.guild || msg.author.bot) return;
  if (msg.channel.nsfw) return;

  const result = await checkMessage(msg.content);
  if (result && result.label && result.label !== "safe") {
    await msg.delete().catch(() => {});
    await addWarning(msg.author.id, msg.guild, result.label);
  }
});

// ==== SLASH COMMANDS ====
const commands = [
  new SlashCommandBuilder()
    .setName("report")
    .setDescription("Report a user")
    .addUserOption((opt) =>
      opt.setName("user").setDescription("Người vi phạm").setRequired(true)
    )
    .addStringOption((opt) =>
      opt.setName("reason").setDescription("Lý do").setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName("mute")
    .setDescription("Mute một user")
    .addUserOption((opt) =>
      opt.setName("user").setDescription("Người cần mute").setRequired(true)
    )
    .addStringOption((opt) =>
      opt.setName("reason").setDescription("Lý do").setRequired(true)
    )
    .addIntegerOption((opt) =>
      opt.setName("minutes").setDescription("Thời gian mute (phút)").setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName("ban")
    .setDescription("Ban một user")
    .addUserOption((opt) =>
      opt.setName("user").setDescription("Người cần ban").setRequired(true)
    )
    .addStringOption((opt) =>
      opt.setName("reason").setDescription("Lý do").setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName("blacklist")
    .setDescription("Blacklist một user")
    .addUserOption((opt) =>
      opt.setName("user").setDescription("Người cần blacklist").setRequired(true)
    )
    .addStringOption((opt) =>
      opt.setName("reason").setDescription("Lý do").setRequired(true)
    ),
].map((cmd) => cmd.toJSON());

// ==== DEPLOY SLASH COMMANDS ====
const rest = new REST({ version: "10" }).setToken(TOKEN);
(async () => {
  try {
    await rest.put(Routes.applicationGuildCommands(BOT_ID, GUILD_ID), {
      body: commands,
    });
    console.log("✅ Slash commands loaded!");
  } catch (err) {
    console.error("Slash command error:", err);
  }
})();

// ==== ON SLASH COMMAND ====
client.on("interactionCreate", async (i) => {
  if (!i.isChatInputCommand()) return;

  const user = i.options.getUser("user");
  const reason = i.options.getString("reason");

  try {
    if (i.commandName === "report") {
      await addWarning(user.id, i.guild, `Report: ${reason}`);
      i.reply({ content: `✅ Đã report ${user.tag}`, ephemeral: true });
    } else if (i.commandName === "mute") {
      const minutes = i.options.getInteger("minutes");
      const member = await i.guild.members.fetch(user.id);
      await member.timeout(minutes * 60 * 1000, reason);
      i.reply({ content: `🔇 ${user.tag} đã bị mute ${minutes} phút.`, ephemeral: true });
    } else if (i.commandName === "ban") {
      await i.guild.members.ban(user.id, { reason });
      i.reply({ content: `⛔ ${user.tag} đã bị ban.`, ephemeral: true });
    } else if (i.commandName === "blacklist") {
      if (!warnings[user.id]) warnings[user.id] = { points: 0, history: [] };
      warnings[user.id].blacklisted = true;
      saveWarnings();
      i.reply({ content: `🚫 ${user.tag} đã bị blacklist.`, ephemeral: true });
    }
  } catch (err) {
    console.error("Slash command action failed:", err);
    i.reply({ content: `❌ Không thể thực hiện lệnh: ${err.message}`, ephemeral: true });
  }
});

// ==== READY ====
client.once("ready", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

// ==== OPTIONAL: EXPRESS KEEP-ALIVE (Render) ====
const express = require("express");
const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => res.send("Bot is alive!"));
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

// ==== LOGIN BOT ====
client.login(TOKEN);
