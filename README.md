# Sol's RNG Security Bot

A Discord moderation bot with AI-style message scanning, warning points system, automatic punishments, and slash commands. Includes keep-alive for 24/7 uptime on free hosting like Render or Replit.

---

## Features

- **AI Moderation:** Detects toxic, offensive, NSFW, or joking/mocking messages.
- **Anti-Spam / Flood Protection:** Warns and deletes spam messages automatically.
- **Warning Points System:** Tracks violations and escalates punishments.
- **Automatic Punishments:**
  - 2 WP → 1 hour mute
  - 3 WP → 12 hours mute
  - 4 WP → 1 day mute
  - 5 WP → Ban
- **User Alerts:** DM users on rule violation.
- **Slash Commands:**
  - `/warnings @user` – View user warning points
  - `/resetwarnings @user` – Reset a user's warning points (admin only)
  - `/announce "title" "content"` – Send announcement embed
  - `/topviolators` – List top users with warning points
- **Scan Links & Images:** Detect suspicious links or images.
- **Daily Report:** Sends daily summary to mod channel.
- **Embed Logs:** All actions logged in mod channel.
- **Keep-Alive:** Express server for pinging to maintain 24/7 uptime.

---

## Setup

### 1. Clone the repository
```bash
git clone https://github.com/binh1212011-spec/Security-Bot.git
cd Security-Bot
