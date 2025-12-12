
# Mineflayer Discord Bot

Mineflayer Discord Bot is a professional Minecraft automation tool that integrates Mineflayer with Discord, providing a web-based 3D viewer, remote control, and advanced automation features.

## Features

- **Discord Integration**: Bridge Minecraft chat to Discord and control the bot with slash commands.
- **Web Controller**: Control the bot in first-person using your browser with keyboard and mouse.
- **Web Inventory Viewer**: View the bot's inventory in real time.
- **Autoclicker**: Automatically left-click signs in-game.
- **Follow Player**: GPS pathfinder to follow a specific player.
- **Player List**: Send a list of online players to Discord.
- **Auto Pay**: Automatically pay your balance to a player.
- **Daily Restart**: Scheduled logout/login for server restarts.
- **Chat Reactions**: Respond to chat reaction minigames.

## Installation

1. Clone this repository.
2. Install dependencies:
	```bash
	npm install
	```
3. Copy the example environment file and edit your settings:
	```bash
	cp .env.example .env
	# Edit .env with your preferred configuration
	```

## Configuration

All configuration is managed via the `.env` file. See `.env.example` for all available options.

### Key Settings

- `MC_HOST`: Minecraft server IP
- `MC_PORT`: Minecraft server port
- `BOT_USERNAME`: Bot's username
- `AUTH_TYPE`: `offline`, `microsoft`, or `mojang`
- `ENABLE_DISCORD`: Enable Discord integration (`true` or `false`)
- `DISCORD_TOKEN`: Discord bot token
- `DISCORD_CHANNEL`: Discord channel ID for chat relay
- `DISCORD_ADMIN_ID`: Discord user ID for admin commands
- `ENABLE_WEB_CONTROLLER`: Enable the web controller (`true` or `false`)
- `WEB_CONTROLLER_PORT`: Port for the web controller (default: 3000)
- `VIEWER_PORT`: Port for the 3D viewer (default: 3001)

## Usage

To start the bot:

```bash
npm start
```

### Discord Commands

- `/leave` - Disconnect the bot
- `/connect` - Reconnect the bot
- `/msg <message>` - Send a chat message as the bot

### Web Controller

If enabled, access the web controller at `http://localhost:3000` (or your configured port).

**Controls:**
- Click to capture mouse
- WASD - Move
- Space - Jump
- Shift - Sneak
- Ctrl - Sprint
- T - Open chat
- ESC - Release mouse

### Canvas Prebuilt Binaries

The `canvas` package is required for the 3D viewer. On Node.js 18+ and most modern Linux distributions, prebuilt binaries are used automatically. If you encounter errors about missing `canvas` or native modules, ensure your system includes:

- libcairo2
- libjpeg-turbo8
- libpango-1.0-0
- libgif7
- libpng16-16

If you still have issues, try running:

```bash
npm rebuild canvas
```

Or use a different Node.js version (18+ recommended).

## License

This project is licensed under the MIT License. See the LICENSE file for details.

### Pterodactyl Deployment

This project is Pterodactyl-friendly and works with the standard Node.js egg.

1. Create a new Node.js server in Pterodactyl
2. Set the GitHub repository URL (or upload files directly)
3. Main file: `index.js`
4. Configure environment variables in the Startup tab
5. Install and start the server

The project uses only pure JavaScript packages and requires no native compilation.

### Discord Commands
- `/leave` - Disconnect the bot
- `/connect` - Reconnect the bot
- `/msg <message>` - Send a chat message as the bot

### Web Controller

If enabled, access the web controller at `http://localhost:3000` (or your configured port).

Controls:
- Click to capture mouse
- WASD - Move
- Space - Jump
- Shift - Sneak
- Ctrl - Sprint
- T - Open chat
- ESC - Release mouse

### Canvas Prebuilt Binaries

This project requires the `canvas` package for the 3D viewer. On Node.js 18+ and most modern Linux distros, prebuilt binaries are used automatically. If you see errors about missing `canvas` or native modules, make sure your Pterodactyl image includes:
- libcairo2
- libjpeg-turbo8
- libpango-1.0-0
- libgif7
- libpng16-16

The default Node.js yolks images include these. If you use a custom image, install these libraries first.

If you still have issues, try running:
```
npm rebuild canvas
```

Or use a different Node.js version (18+ recommended).

## License

MIT
