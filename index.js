const mineflayer = require('mineflayer');
const { Client, GatewayIntentBits, Events, SlashCommandBuilder, REST, Routes } = require('discord.js');
const { mineflayer: mineflayerViewer } = require('prismarine-viewer');
const inventoryViewer = require('mineflayer-web-inventory');
const { pathfinder, Movements, goals: { GoalFollow } } = require('mineflayer-pathfinder');
const fs = require('fs');
const express = require('express');
const http = require('http');
const { Server: SocketIOServer } = require('socket.io');

// Load config
let config = {
  host: '127.0.0.1',
  port: 25565,
  username: 'Bot',
  auth: 'offline',
  discord_token: '',
  discord_channel: '',
  discord_status: 'Playing Minecraft',
  enable_discord: false,
  discord_admin_id: '',
  enable_web_controller: false,
  web_controller_port: 3000,
  viewer_port: 3001,
  enable_inventory: false,
  inventory_port: 3001,
  enable_daily_restart: true,
  restart_timezone: 'America/New_York',
  enable_chat_reactions: false,
  enable_follow: false,
  follow_player: ''
};

if (fs.existsSync('config.json')) {
  // Read file as text first to handle large numbers
  const configText = fs.readFileSync('config.json', 'utf8');
  // Convert large numbers to strings before parsing (Discord IDs)
  const fixedConfigText = configText.replace(/:[ ]*([0-9]{15,})([,\n\r}])/g, ': "$1"$2');
  const loadedConfig = JSON.parse(fixedConfigText);
  config = { ...config, ...loadedConfig };
  // Convert string booleans to actual booleans
  if (typeof config.enable_discord === 'string') {
    config.enable_discord = config.enable_discord === 'true';
  }
  if (typeof config.enable_web_controller === 'string') {
    config.enable_web_controller = config.enable_web_controller === 'true';
  }
  if (typeof config.enable_inventory === 'string') {
    config.enable_inventory = config.enable_inventory === 'true';
  }
  if (typeof config.enable_daily_restart === 'string') {
    config.enable_daily_restart = config.enable_daily_restart === 'true';
  }
  if (typeof config.enable_chat_reactions === 'string') {
    config.enable_chat_reactions = config.enable_chat_reactions === 'true';
  }
  if (typeof config.enable_follow === 'string') {
    config.enable_follow = config.enable_follow === 'true';
  }
  config.web_controller_port = parseInt(config.web_controller_port) || 3000;
  config.viewer_port = parseInt(config.viewer_port) || 3001;
  config.inventory_port = parseInt(config.inventory_port) || 3001;
  config.port = parseInt(config.port) || 25565;
  // Ensure discord_channel and discord_admin_id are always strings
  config.discord_channel = String(config.discord_channel || '');
  config.discord_admin_id = String(config.discord_admin_id || '');
}

console.log('Starting Mineflayer bot...');
console.log('Discord enabled:', config.enable_discord);
console.log('Discord channel:', config.discord_channel);
console.log('Discord admin ID:', config.discord_admin_id);
console.log('Web Controller enabled:', config.enable_web_controller);
console.log('Web Controller port:', config.web_controller_port);
console.log('Viewer port:', config.viewer_port);
console.log('Inventory enabled:', config.enable_inventory);
console.log('Chat reactions enabled:', config.enable_chat_reactions);
console.log('Follow enabled:', config.enable_follow);
console.log('Follow player:', config.follow_player);

// Global variables
let bot = null;
let discordClient = null;
let discordChannel = null;
let scheduleInterval = null;
let followInterval = null;
let manuallyDisconnected = false;
let webControllerServer = null;
let webControllerIO = null;
let inventoryServer = null;

// Function to close viewer servers
function closeViewerServers() {
  return new Promise((resolve) => {
    let pending = 0;
    const checkDone = () => {
      pending--;
      if (pending <= 0) resolve();
    };
    
    if (webControllerServer) {
      pending++;
      try {
        const server = webControllerServer;
        webControllerServer = null;
        server.close((err) => {
          if (err) console.error('Error closing web controller server:', err.message);
          else console.log('Web controller server closed');
          checkDone();
        });
      } catch (err) {
        console.error('Error closing web controller server:', err.message);
        webControllerServer = null;
        checkDone();
      }
    }
    
    if (inventoryServer) {
      pending++;
      try {
        const server = inventoryServer;
        inventoryServer = null;
        server.close((err) => {
          if (err) console.error('Error closing inventory server:', err.message);
          else console.log('Inventory server closed');
          checkDone();
        });
      } catch (err) {
        console.error('Error closing inventory server:', err.message);
        inventoryServer = null;
        checkDone();
      }
    }
    
    if (pending === 0) resolve();
  });
}

// Setup custom web controller with movement controls
function setupWebController(bot, port, viewerPort) {
  const app = express();
  const server = http.createServer(app);
  const io = new SocketIOServer(server, { cors: { origin: '*' } });
  webControllerIO = io;
  let viewerServer = null;
  
  // Start the prismarine viewer on viewer port
  try {
    viewerServer = mineflayerViewer(bot, { port: viewerPort, firstPerson: true });
    console.log('3D Viewer available on port ' + viewerPort);
  } catch (err) {
    console.error('Failed to start prismarine viewer:', err.message);
  }
  
  // HTML page with controls - viewer in iframe pointing to viewer port
  app.get('/', (req, res) => {
    const vp = viewerPort;
    res.send('<!DOCTYPE html><html><head><title>Mineflayer Bot Controller</title><style>*{margin:0;padding:0;box-sizing:border-box}body{background:#1a1a2e;color:#eee;font-family:Arial,sans-serif;overflow:hidden}#container{width:100vw;height:100vh;display:flex;flex-direction:column}#viewer-frame{flex:1;width:100%;border:none;background:#111}#controls-overlay{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.7);padding:15px 25px;border-radius:10px;display:flex;gap:20px;align-items:center;z-index:1000}.key{display:inline-block;padding:8px 12px;background:#333;border:2px solid #555;border-radius:5px;min-width:40px;text-align:center;font-weight:bold}.key.active{background:#4CAF50;border-color:#4CAF50}#status{position:fixed;top:10px;left:10px;background:rgba(0,0,0,0.7);padding:10px 15px;border-radius:5px;z-index:1000}#instructions{position:fixed;top:10px;right:10px;background:rgba(0,0,0,0.7);padding:10px 15px;border-radius:5px;z-index:1000;font-size:12px;max-width:200px}#pointer-lock-msg{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:rgba(0,0,0,0.9);padding:30px;border-radius:10px;z-index:2000;text-align:center}#pointer-lock-msg h2{margin-bottom:15px}.keys-row{display:flex;gap:5px;justify-content:center}.keys-col{display:flex;flex-direction:column;gap:5px;align-items:center}#viewer-notice{background:#333;color:#fff;padding:10px;text-align:center}#viewer-notice a{color:#4CAF50}#chat-box{position:fixed;bottom:80px;left:20px;width:350px;max-height:200px;background:rgba(0,0,0,0.7);border-radius:5px;z-index:1000;display:flex;flex-direction:column}#chat-messages{flex:1;overflow-y:auto;padding:10px;font-size:13px;max-height:150px}#chat-messages p{margin:3px 0;word-wrap:break-word}.chat-msg{color:#fff}.chat-input-container{display:none;padding:8px;border-top:1px solid #444}#chat-input{width:100%;padding:8px;background:#222;border:1px solid #555;border-radius:3px;color:#fff;font-size:13px}#chat-input:focus{outline:none;border-color:#4CAF50}.chat-hint{color:#888;font-size:11px;padding:5px 10px;text-align:center}</style></head><body><div id="container"><div id="viewer-notice"><p>3D Viewer: <a href="http://'+req.hostname+':'+vp+'" target="_blank" id="viewer-link">Open in new tab</a> (Requires port '+vp+' exposed in Pterodactyl)</p></div><iframe id="viewer-frame" src="http://'+req.hostname+':'+vp+'"></iframe></div><div id="status">Connected: <span id="conn-status">Connecting...</span></div><div id="instructions"><b>Click page to enable controls</b><br>WASD - Move<br>Space - Jump<br>Shift - Sneak<br>Ctrl - Sprint<br>Mouse - Look<br>T - Chat<br>Enter - Send<br>ESC - Release mouse</div><div id="controls-overlay"><div class="keys-col"><div class="keys-row"><span class="key" id="key-w">W</span></div><div class="keys-row"><span class="key" id="key-a">A</span><span class="key" id="key-s">S</span><span class="key" id="key-d">D</span></div></div><div class="keys-col"><span class="key" id="key-space">SPACE</span><span class="key" id="key-shift">SHIFT</span><span class="key" id="key-ctrl">CTRL</span></div></div><div id="chat-box"><div id="chat-messages"><p class="chat-hint">Press T to chat, Enter to send</p></div><div class="chat-input-container" id="chat-input-container"><input type="text" id="chat-input" placeholder="Type a message and press Enter..." maxlength="256"></div></div><div id="pointer-lock-msg"><h2>Click anywhere to control the bot</h2><p>Use WASD to move, mouse to look around</p></div><script src="/socket.io/socket.io.js"></script><script>const socket=io();let isLocked=false;const keys={w:false,a:false,s:false,d:false,space:false,shift:false,ctrl:false};socket.on("connect",()=>{document.getElementById("conn-status").textContent="Yes";document.getElementById("conn-status").style.color="#4CAF50"});socket.on("disconnect",()=>{document.getElementById("conn-status").textContent="No";document.getElementById("conn-status").style.color="#f44336"});socket.on("chat",(msg)=>{const chatMsgs=document.getElementById("chat-messages");const p=document.createElement("p");p.className="chat-msg";p.textContent=msg;chatMsgs.appendChild(p);while(chatMsgs.children.length>50)chatMsgs.removeChild(chatMsgs.firstChild);chatMsgs.scrollTop=chatMsgs.scrollHeight});let chatOpen=false;const chatInput=document.getElementById("chat-input");const chatContainer=document.getElementById("chat-input-container");function openChat(){chatOpen=true;chatContainer.style.display="block";chatInput.focus();document.exitPointerLock()}function closeChat(){chatOpen=false;chatContainer.style.display="none";chatInput.value="";document.body.requestPointerLock()}function sendChat(){const msg=chatInput.value.trim();if(msg){socket.emit("chat",msg)}closeChat()}chatInput.addEventListener("keydown",(e)=>{if(e.key==="Enter"){e.preventDefault();sendChat()}else if(e.key==="Escape"){closeChat()}e.stopPropagation()});chatInput.addEventListener("keyup",(e)=>e.stopPropagation());function updateKeyDisplay(){document.getElementById("key-w").classList.toggle("active",keys.w);document.getElementById("key-a").classList.toggle("active",keys.a);document.getElementById("key-s").classList.toggle("active",keys.s);document.getElementById("key-d").classList.toggle("active",keys.d);document.getElementById("key-space").classList.toggle("active",keys.space);document.getElementById("key-shift").classList.toggle("active",keys.shift);document.getElementById("key-ctrl").classList.toggle("active",keys.ctrl)}function sendControls(){socket.emit("controls",{forward:keys.w,back:keys.s,left:keys.a,right:keys.d,jump:keys.space,sneak:keys.shift,sprint:keys.ctrl})}document.addEventListener("click",(e)=>{if(e.target.tagName==="A"||e.target.tagName==="INPUT")return;if(!isLocked&&!chatOpen)document.body.requestPointerLock()});document.addEventListener("pointerlockchange",()=>{isLocked=document.pointerLockElement===document.body;document.getElementById("pointer-lock-msg").style.display=isLocked?"none":"block"});document.addEventListener("keydown",(e)=>{if(chatOpen)return;if(!isLocked)return;e.preventDefault();let changed=false;if(e.code==="KeyW"&&!keys.w){keys.w=true;changed=true}if(e.code==="KeyA"&&!keys.a){keys.a=true;changed=true}if(e.code==="KeyS"&&!keys.s){keys.s=true;changed=true}if(e.code==="KeyD"&&!keys.d){keys.d=true;changed=true}if(e.code==="Space"&&!keys.space){keys.space=true;changed=true}if(e.code==="ShiftLeft"&&!keys.shift){keys.shift=true;changed=true}if(e.code==="ControlLeft"&&!keys.ctrl){keys.ctrl=true;changed=true}if(e.code==="KeyT"){openChat();return}if(changed){updateKeyDisplay();sendControls()}});document.addEventListener("keyup",(e)=>{if(chatOpen)return;let changed=false;if(e.code==="KeyW"){keys.w=false;changed=true}if(e.code==="KeyA"){keys.a=false;changed=true}if(e.code==="KeyS"){keys.s=false;changed=true}if(e.code==="KeyD"){keys.d=false;changed=true}if(e.code==="Space"){keys.space=false;changed=true}if(e.code==="ShiftLeft"){keys.shift=false;changed=true}if(e.code==="ControlLeft"){keys.ctrl=false;changed=true}if(changed){updateKeyDisplay();sendControls()}});document.addEventListener("mousemove",(e)=>{if(!isLocked)return;socket.emit("look",{x:e.movementX,y:e.movementY})});</script></body></html>');
  });
  
  // Handle Socket.IO connections
  io.on('connection', (socket) => {
    console.log('Web controller client connected');
    
    socket.on('chat', (msg) => {
      if (!bot || typeof msg !== 'string') return;
      bot.chat(msg.substring(0, 256));
    });
    
    socket.on('controls', (data) => {
      if (!bot || !bot.entity) return;
      bot.setControlState('forward', data.forward);
      bot.setControlState('back', data.back);
      bot.setControlState('left', data.left);
      bot.setControlState('right', data.right);
      bot.setControlState('jump', data.jump);
      bot.setControlState('sneak', data.sneak);
      bot.setControlState('sprint', data.sprint);
    });
    
    socket.on('look', (data) => {
      if (!bot || !bot.entity) return;
      const sensitivity = 0.003;
      const yaw = bot.entity.yaw - (data.x * sensitivity);
      const pitch = Math.max(-Math.PI/2, Math.min(Math.PI/2, bot.entity.pitch - (data.y * sensitivity)));
      bot.look(yaw, pitch, true);
    });
    
    socket.on('disconnect', () => {
      console.log('Web controller client disconnected');
      if (bot && bot.entity) {
        bot.setControlState('forward', false);
        bot.setControlState('back', false);
        bot.setControlState('left', false);
        bot.setControlState('right', false);
        bot.setControlState('jump', false);
        bot.setControlState('sneak', false);
        bot.setControlState('sprint', false);
      }
    });
  });
  
  server.listen(port, '0.0.0.0', () => {
    console.log('Web controller listening on 0.0.0.0:' + port);
  });
  
  server.on('error', (err) => {
    console.error('Web controller server error:', err.message);
  });
  
  // Store both servers for cleanup
  webControllerServer = {
    close: function(callback) {
      let pending = 2;
      const done = () => { if (--pending === 0 && callback) callback(); };
      server.close(() => { console.log('Control server closed'); done(); });
      if (viewerServer && viewerServer.close) {
        viewerServer.close(() => { console.log('Viewer server closed'); done(); });
      } else {
        done();
      }
      setTimeout(() => { io.close(); webControllerIO = null; if (callback && pending > 0) callback(); }, 1000);
    }
  };
}

// Function to send message to Discord
function sendToDiscord(message) {
  if (discordChannel && discordChannel.send) {
    discordChannel.send(message).catch(err => {
      console.error('Failed to send Discord message:', err.message);
    });
  }
}

// Register Discord slash commands
async function registerSlashCommands() {
  if (!config.enable_discord || !config.discord_token) return;
  
  const commands = [
    new SlashCommandBuilder()
      .setName('leave')
      .setDescription('Disconnect the bot from the Minecraft server'),
    new SlashCommandBuilder()
      .setName('connect')
      .setDescription('Connect the bot to the Minecraft server'),
    new SlashCommandBuilder()
      .setName('msg')
      .setDescription('Send a chat message or command in Minecraft')
      .addStringOption(option => 
        option.setName('message')
          .setDescription('The message or command to send (use / for commands)')
          .setRequired(true))
  ].map(cmd => cmd.toJSON());
  
  try {
    const rest = new REST({ version: '10' }).setToken(config.discord_token);
    
    // Get the the bot application ID
    const appInfo = await rest.get(Routes.oauth2CurrentApplication());
    
    console.log('Registering Discord slash commands...');
    await rest.put(
      Routes.applicationCommands(appInfo.id),
      { body: commands }
    );
    console.log('Successfully registered Discord slash commands!');
  } catch (err) {
    console.error('Failed to register slash commands:', err.message);
  }
}

// Setup Discord if enabled
function setupDiscord() {
  if (!config.enable_discord || !config.discord_token || !config.discord_channel) {
    console.log('Discord not enabled or missing token/channel');
    return;
  }
  
  console.log('Setting up Discord bot...');
  
  discordClient = new Client({
    intents: [
      GatewayIntentBits.Guilds
    ]
  });
  
  discordClient.on(Events.ClientReady, async (client) => {
    console.log(`Discord bot logged in as ${client.user.tag}`);
    
    // Set bot status
    if (config.discord_status) {
      client.user.setActivity(config.discord_status);
    }
    
    // Register slash commands
    await registerSlashCommands();
    
    // Get the channel
    try {
      const channelId = String(config.discord_channel).trim();
      console.log(`Discord channel ID from config: ${config.discord_channel}`);
      console.log(`Discord channel ID (as string): ${channelId}`);
      console.log(`Discord channel ID length: ${channelId.length}`);
      
      // Try fetching directly
      discordChannel = await client.channels.fetch(channelId);
      
      if (discordChannel) {
        console.log(`Successfully connected to Discord channel: #${discordChannel.name}`);
        discordChannel.send('🤖 Minecraft bot connected!').catch(console.error);
      } else {
        console.error('Channel fetch returned null');
      }
    } catch (err) {
      console.error('Error getting Discord channel:', err);
      console.error('Verify:');
      console.error('1. Channel ID is correct (right-click channel -> Copy ID)');
      console.error('2. Bot is in the server');
      console.error('3. Bot has View Channel and Send Messages permissions');
    }
  });
  
  // Handle slash commands
  discordClient.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    
    const adminId = String(config.discord_admin_id).trim();
    
    // Check if user is the admin
    if (adminId && interaction.user.id !== adminId) {
      await interaction.reply({ content: '❌ You do not have permission to use this command.', ephemeral: true });
      return;
    }
    
    if (interaction.commandName === 'leave') {
      if (!bot) {
        await interaction.reply({ content: '⚠️ Bot is not currently connected.', ephemeral: true });
        return;
      }
      
      manuallyDisconnected = true;
      
      // Clear any existing schedule
      if (scheduleInterval) {
        clearInterval(scheduleInterval);
        scheduleInterval = null;
      }
      if (followInterval) {
        clearInterval(followInterval);
        followInterval = null;
      }
      
      // Close viewer servers and wait for them to close
      await closeViewerServers();
      
      bot.removeAllListeners('end');
      bot.quit();
      bot = null;
      
      await interaction.reply('✅ Bot disconnected from Minecraft server.');
      console.log('Bot manually disconnected via Discord /leave command');
    }
    
    if (interaction.commandName === 'connect') {
      if (bot) {
        await interaction.reply({ content: '⚠️ Bot is already connected.', ephemeral: true });
        return;
      }
      
      manuallyDisconnected = false;
      createBot();
      
      await interaction.reply('✅ Bot is connecting to Minecraft server...');
      console.log('Bot connecting via Discord /connect command');
    }
    
    if (interaction.commandName === 'msg') {
      if (!bot) {
        await interaction.reply({ content: '⚠️ Bot is not currently connected.', ephemeral: true });
        return;
      }
      
      const message = interaction.options.getString('message');
      if (!message) {
        await interaction.reply({ content: '❌ Please provide a message.', ephemeral: true });
        return;
      }
      
      try {
        bot.chat(message);
        await interaction.reply(`✅ Sent: \`${message}\``);
        console.log(`Discord /msg command: ${message}`);
      } catch (err) {
        await interaction.reply({ content: `❌ Failed to send message: ${err.message}`, ephemeral: true });
      }
    }
  });
  
  discordClient.on(Events.Error, (err) => {
    console.error('Discord client error:', err.message);
  });
  
  discordClient.login(config.discord_token).catch(err => {
    console.error('Failed to login to Discord:', err.message);
  });
}

// Create and setup the Minecraft bot
function createBot() {
  console.log(`Creating bot to connect to ${config.host}:${config.port}`);
  
  bot = mineflayer.createBot({
    host: config.host,
    port: config.port,
    username: config.username,
    auth: config.auth,
    version: false
  });
  
  // Load pathfinder plugin
  bot.loadPlugin(pathfinder);
  
  // Handle connection errors - retry after 20 seconds
  bot.on('error', (err) => {
    console.error('Bot error:', err.message);
    sendToDiscord(`❌ Bot error: ${err.message}`);
  });
  
  // Handle login errors specifically
  bot._client.on('error', (err) => {
    console.error('Connection error:', err.message);
  });
  
  bot.once('spawn', () => {
    console.log('Bot spawned in game');
    
    sendToDiscord('✅ Bot spawned in Minecraft server!');
    
    // Setup web controller if enabled (3D first-person view with controls)
    if (config.enable_web_controller) {
      try {
        setupWebController(bot, config.web_controller_port, config.viewer_port);
        console.log(`Web controller started on port ${config.web_controller_port}`);
        console.log('Open in browser - Use WASD to move, Space to jump, Shift to sneak, mouse to look around');
      } catch (err) {
        console.error('Failed to start web controller:', err.message);
      }
    }
    
    // Setup inventory viewer if enabled
    if (config.enable_inventory) {
      try {
        inventoryServer = inventoryViewer(bot, { port: config.inventory_port });
        // Handle inventory viewer errors to prevent crashes
        if (inventoryServer) {
          inventoryServer.on('error', (err) => {
            console.error('Inventory viewer error:', err.message);
          });
        }
        console.log(`Web inventory started on port ${config.inventory_port}`);
      } catch (err) {
        console.error('Failed to start inventory viewer:', err.message);
      }
    }
    
    // Setup daily restart schedule if enabled
    if (config.enable_daily_restart) {
      setupDailyRestartSchedule();
    }
    
    // Setup follow player if enabled
    if (config.enable_follow && config.follow_player) {
      setupFollowPlayer();
    }
    
    // Bot ready! - printed after a delay to ensure it's last
    setTimeout(() => console.log('Bot ready!'), 500);
  });
  
  // Handle all chat messages using the 'message' event for full message text
  // Log ALL messages - no filtering
  bot.on('message', (jsonMsg) => {
    const message = jsonMsg.toString();
    
    // Log everything
    console.log(`[Chat] ${message}`);
    
    // Send to Discord (skip empty)
    if (message && message.trim()) {
      sendToDiscord(message);
      // Send to web controller clients
      if (webControllerIO) {
        webControllerIO.emit('chat', message);
      }
    }
    
    // Chat reactions - handle "Chat Reaction »" format
    if (config.enable_chat_reactions && message.includes('Chat Reaction')) {
      if (message.includes('No one typed') || message.includes('was first')) return;
      
      const match = message.match(/type [""]([^""]+)[""]/) || message.match(/type "([^"]+)"/);
      if (match && match[1]) {
        if (Math.random() < 0.2) {
          setTimeout(() => {
            if (bot) {
              bot.chat(match[1]);
              console.log(`Chat reaction sent: ${match[1]}`);
            }
          }, 1000 + Math.random() * 2000);
        }
      }
    }
  });
  
bot.on('kicked', (reason) => {
    console.log('Bot was kicked:', reason);
    sendToDiscord(`❌ Bot was kicked: ${reason}`);
  });
  
  bot.on('end', (reason) => {
    console.log('Bot disconnected:', reason);
    
    // Clear any existing schedule
    if (scheduleInterval) {
      clearInterval(scheduleInterval);
      scheduleInterval = null;
    }
    if (followInterval) {
      clearInterval(followInterval);
      followInterval = null;
    }
    
    // Close viewer servers
    closeViewerServers();
    
    // Don't auto-reconnect if manually disconnected
    if (manuallyDisconnected) {
      console.log('Bot was manually disconnected, not auto-reconnecting.');
      return;
    }
    
    // Auto-reconnect after 20 seconds
    sendToDiscord('⚠️ Bot disconnected. Reconnecting in 20 seconds...');
    
    setTimeout(() => {
      console.log('Attempting to reconnect...');
      createBot();
    }, 20000);
  });
}

// Follow player function
function setupFollowPlayer() {
  console.log(`Setting up follow for player: ${config.follow_player}`);
  
  // Clear any existing interval
  if (followInterval) {
    clearInterval(followInterval);
  }
  
  const defaultMove = new Movements(bot);
  
  followInterval = setInterval(() => {
    if (!bot || !config.follow_player) return;
    
    const target = bot.players[config.follow_player]?.entity;
    if (target) {
      bot.pathfinder.setMovements(defaultMove);
      bot.pathfinder.setGoal(new GoalFollow(target, 2), true);
    }
  }, 1000);
  
  console.log(`Now following ${config.follow_player}`);
}

// Daily restart schedule function
function setupDailyRestartSchedule() {
  // Clear any existing interval
  if (scheduleInterval) {
    clearInterval(scheduleInterval);
  }
  
  const checkSchedule = () => {
    const now = new Date();
    const estTime = new Date(now.toLocaleString('en-US', { timeZone: config.restart_timezone || 'America/New_York' }));
    const hours = estTime.getHours();
    const minutes = estTime.getMinutes();
    
    // Logout at 11:56 PM EST (23:56)
    if (hours === 23 && minutes === 56) {
      console.log('Daily restart: Logging out at 11:56 PM EST...');
      sendToDiscord('🔄 Daily server restart - Logging out at 11:56 PM EST');
      
      // Clear the schedule interval
      if (scheduleInterval) {
        clearInterval(scheduleInterval);
        scheduleInterval = null;
      }
      if (followInterval) {
        clearInterval(followInterval);
        followInterval = null;
      }
      
      // Close viewer servers and disconnect bot
      closeViewerServers().then(() => {
        // Disconnect the bot
        if (bot) {
          bot.removeAllListeners('end');
          bot.quit();
        }
        
        // Rejoin at 12:04 AM EST (8 minutes later)
        setTimeout(() => {
          console.log('Daily restart: Reconnecting at 12:04 AM EST...');
          sendToDiscord('🔄 Reconnecting after daily restart...');
          createBot();
        }, 8 * 60 * 1000);
      });
    }
  };
  
  // Check every minute
  scheduleInterval = setInterval(checkSchedule, 60 * 1000);
  console.log('Daily restart schedule enabled');
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down...');
  if (scheduleInterval) {
    clearInterval(scheduleInterval);
  }
  if (followInterval) {
    clearInterval(followInterval);
  }
  await closeViewerServers();
  if (bot) {
    bot.removeAllListeners('end');
    bot.quit();
  }
  if (discordClient) {
    discordClient.destroy();
  }
  process.exit(0);
});

// Global error handlers to prevent crashes
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err.message);
  // Don't exit, try to keep running
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // Don't exit, try to keep running
});

// Start the bot
setupDiscord();
createBot();
