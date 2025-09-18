const { Client, GatewayIntentBits, EmbedBuilder, SlashCommandBuilder, REST, Routes } = require("discord.js");
const fs = require("fs");
const express = require("express");
require("dotenv").config();

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

// --- Keep-alive server ---
const app = express();
app.get("/", (req, res) => res.send("Bot is alive!"));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Keep-alive server running on port ${PORT}`));

// --- Load rules & warnings ---
const rules = JSON.parse(fs.readFileSync("rules.json"));
const warningsFile = "warnings.json";
let warnings = fs.existsSync(warningsFile) ? JSON.parse(fs.readFileSync(warningsFile)) : {};
function saveWarnings() { fs.writeFileSync(warningsFile, JSON.stringify(warnings, null, 2)); }

// --- Slash Commands ---
const commands = [
  new SlashCommandBuilder().setName("warnings").setDescription("View user warning points")
    .addUserOption(opt => opt.setName("user").setDescription("Target user").setRequired(true)),
  new SlashCommandBuilder().setName("resetwarnings").setDescription("Reset a user's warning points")
    .addUserOption(opt => opt.setName("user").setDescription("Target user").setRequired(true)),
  new SlashCommandBuilder().setName("announce").setDescription("Send an embed announcement")
    .addStringOption(opt => opt.setName("title").setDescription("Title").setRequired(true))
    .addStringOption(opt => opt.setName("content").setDescription("Content").setRequired(true)),
  new SlashCommandBuilder().setName("topviolators").setDescription("Show top 10 users with warning points")
];

const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);
client.once("ready", async () => {
  try {
    await rest.put(Routes.applicationGuildCommands(client.user.id, process.env.GUILD_ID), { body: commands });
    console.log(`${client.user.tag} is ready!`);
  } catch (e) { console.log("Error registering commands:", e); }
});

// --- Message moderation ---
client.on("messageCreate", async message => {
  if (message.author.bot) return;

  let violationDetected = false, severity = 0, matchedRule = "";

  for (const rule of rules) {
    for (const kw of rule.keywords) {
      if (message.content.toLowerCase().includes(kw.toLowerCase())) {
        violationDetected = true; severity = rule.severity; matchedRule = rule.title; break;
      }
    }
    if (rule.regex && new RegExp(rule.regex, "i").test(message.content)) {
      violationDetected = true; severity = rule.severity; matchedRule = rule.title;
    }
    if (violationDetected) break;
  }

  if (/https?:\/\/[^\s]+/i.test(message.content)) {
    violationDetected = true; severity = 1; matchedRule = "Suspicious Link";
  }

  if (message.attachments.size > 0) {
    message.attachments.forEach(att => {
      const url = att.url.toLowerCase();
      if (url.endsWith(".jpg") || url.endsWith(".png") || url.endsWith(".gif")) {
        violationDetected = true; severity = 1; matchedRule = "Image Uploaded";
      }
    });
  }

  if (violationDetected) {
    const uid = message.author.id;
    warnings[uid] = (warnings[uid] || 0) + severity;
    saveWarnings();

    message.reply(`⚠️ Violation detected: **${matchedRule}**. Warning points: ${warnings[uid]}`);

    const embed = new EmbedBuilder()
      .setTitle("⚠️ Violation Detected")
      .addFields(
        { name: "User", value: `<@${uid}>` },
        { name: "Rule", value: matchedRule },
        { name: "Warning Points", value: warnings[uid].toString() }
      )
      .setColor("#FF0000")
      .setTimestamp();
    const logChannel = await client.channels.fetch(process.env.MOD_LOG_CHANNEL_ID);
    logChannel.send({ embeds: [embed] });

    try {
      if (warnings[uid] === 2) message.member.timeout(60 * 60 * 1000, "2 WP Mute");
      else if (warnings[uid] === 3) message.member.timeout(12 * 60 * 60 * 1000, "3 WP Mute");
      else if (warnings[uid] === 4) message.member.timeout(24 * 60 * 60 * 1000, "4 WP Mute");
      else if (warnings[uid] >= 5) message.member.ban({ reason: "5 WP Ban" });
    } catch (err) { console.log(err); }
  }
});

// --- Slash command handling ---
client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const uid = interaction.options.getUser("user")?.id;

  if (interaction.commandName === "warnings") {
    await interaction.reply(`User has ${warnings[uid] || 0} warning points.`);
  } else if (interaction.commandName === "resetwarnings") {
    warnings[uid] = 0; saveWarnings();
    await interaction.reply(`Reset warning points for <@${uid}>.`);
  } else if (interaction.commandName === "announce") {
    const title = interaction.options.getString("title");
    const content = interaction.options.getString("content");
    const embed = new EmbedBuilder().setTitle(title).setDescription(content).setColor("#303030").setTimestamp();
    await interaction.channel.send({ embeds: [embed] });
    await interaction.reply({ content: "Announcement sent!", ephemeral: true });
  } else if (interaction.commandName === "topviolators") {
    const sorted = Object.entries(warnings).sort((a, b) => b[1] - a[1]).slice(0, 10);
    let desc = sorted.map(([id, pts]) => `<@${id}>: ${pts}`).join("\n") || "No violators yet.";
    const embed = new EmbedBuilder().setTitle("Top Violators").setDescription(desc).setColor("#FFAA00").setTimestamp();
    await interaction.reply({ embeds: [embed] });
  }
});

client.login(process.env.DISCORD_TOKEN);
