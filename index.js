const mineflayer = require('mineflayer');
const { Client, GatewayIntentBits, Events, SlashCommandBuilder, REST, Routes } = require('discord.js');
const { mineflayer: mineflayerViewer } = require('prismarine-viewer');
const inventoryViewer = require('mineflayer-web-inventory');
const { pathfinder, Movements, goals: { GoalFollow } } = require('mineflayer-pathfinder');
const fs = require('fs');
const express = require('express');
const http = require('http');
const { Server: SocketIOServer } = require('socket.io');
const readline = require('readline');

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
  follow_player: '',
  enable_autoclicker: false,
  enable_player_list: false,
  player_list_channel: '',
  enable_auto_pay: false,
  auto_pay_player: ''
};

if (fs.existsSync('config.json')) {
  const configText = fs.readFileSync('config.json', 'utf8');
  const fixedConfigText = configText.replace(/:[ ]*([0-9]{15,})([,\n\r}])/g, ': "$1"$2');
  const loadedConfig = JSON.parse(fixedConfigText);
  config = { ...config, ...loadedConfig };
  if (typeof config.enable_discord === 'string') config.enable_discord = config.enable_discord === 'true';
  if (typeof config.enable_web_controller === 'string') config.enable_web_controller = config.enable_web_controller === 'true';
  if (typeof config.enable_inventory === 'string') config.enable_inventory = config.enable_inventory === 'true';
  if (typeof config.enable_daily_restart === 'string') config.enable_daily_restart = config.enable_daily_restart === 'true';
  if (typeof config.enable_chat_reactions === 'string') config.enable_chat_reactions = config.enable_chat_reactions === 'true';
  if (typeof config.enable_follow === 'string') config.enable_follow = config.enable_follow === 'true';
  if (typeof config.enable_autoclicker === 'string') config.enable_autoclicker = config.enable_autoclicker === 'true';
  if (typeof config.enable_player_list === 'string') config.enable_player_list = config.enable_player_list === 'true';
  if (typeof config.enable_auto_pay === 'string') config.enable_auto_pay = config.enable_auto_pay === 'true';
  config.player_list_channel = String(config.player_list_channel || '');
  config.auto_pay_player = String(config.auto_pay_player || '');
  config.web_controller_port = parseInt(config.web_controller_port) || 3000;
  config.viewer_port = parseInt(config.viewer_port) || 3001;
  config.inventory_port = parseInt(config.inventory_port) || 3001;
  config.port = parseInt(config.port) || 25565;
  config.discord_channel = String(config.discord_channel || '');
  config.discord_admin_id = String(config.discord_admin_id || '');
}

console.log('Starting Mineflayer bot...');
console.log('Discord enabled:', config.enable_discord);
console.log('Web Controller enabled:', config.enable_web_controller);
console.log('Autoclicker enabled:', config.enable_autoclicker);
console.log('Auto Pay enabled:', config.enable_auto_pay);
console.log('Auto Pay player:', config.auto_pay_player);

// Global variables
let bot = null;
let discordClient = null;
let discordChannel = null;
let scheduleInterval = null;
let followInterval = null;
let autoclickerInterval = null;
let playerListInterval = null;
let autoPayInterval = null;
let playerListChannel = null;
let manuallyDisconnected = false;
let webControllerServer = null;
let webControllerIO = null;
let inventoryServer = null;
let httpServer = null;
let viewerServer = null;

// Console input for sending messages as the bot
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.on('line', (input) => {
  if (bot && input.trim()) {
    console.log(`[Console] Sending: ${input}`);
    bot.chat(input);
  }
});

// Function to forcefully close all servers
function closeViewerServers() {
  return new Promise((resolve) => {
    console.log('Closing viewer servers...');
    
    // Disconnect all socket.io clients first
    if (webControllerIO) {
      webControllerIO.disconnectSockets(true);
      webControllerIO.close();
      webControllerIO = null;
    }
    
    let pending = 0;
    const checkDone = () => { pending--; if (pending <= 0) resolve(); };
    
    if (httpServer) {
      pending++;
      httpServer.closeAllConnections();
      httpServer.close(() => { console.log('HTTP server closed'); checkDone(); });
      httpServer = null;
    }
    
    if (viewerServer && viewerServer.close) {
      pending++;
      try {
        viewerServer.close(() => { console.log('Viewer server closed'); checkDone(); });
      } catch(e) { checkDone(); }
      viewerServer = null;
    }
    
    if (inventoryServer && inventoryServer.close) {
      pending++;
      try {
        inventoryServer.close(() => { console.log('Inventory server closed'); checkDone(); });
      } catch(e) { checkDone(); }
      inventoryServer = null;
    }
    
    webControllerServer = null;
    
    if (pending === 0) resolve();
    else setTimeout(resolve, 3000); // Force resolve after 3s
  });
}

// Setup web controller
function setupWebController(bot, port, viewerPort) {
  const app = express();
  httpServer = http.createServer(app);
  const io = new SocketIOServer(httpServer, { cors: { origin: '*' } });
  webControllerIO = io;
  
  try {
    viewerServer = mineflayerViewer(bot, { port: viewerPort, firstPerson: true });
    console.log('3D Viewer on port ' + viewerPort);
  } catch (err) {
    console.error('Failed to start viewer:', err.message);
  }
  
  app.get('/', (req, res) => {
    const vp = viewerPort;
    res.send('<!DOCTYPE html><html><head><title>Bot Controller</title><style>*{margin:0;padding:0;box-sizing:border-box}body{background:#1a1a2e;color:#eee;font-family:Arial,sans-serif;overflow:hidden}#container{width:100vw;height:100vh;display:flex;flex-direction:column}#viewer-frame{flex:1;width:100%;border:none;background:#111}#controls-overlay{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.7);padding:15px 25px;border-radius:10px;display:flex;gap:20px;align-items:center;z-index:1000}.key{display:inline-block;padding:8px 12px;background:#333;border:2px solid #555;border-radius:5px;min-width:40px;text-align:center;font-weight:bold}.key.active{background:#4CAF50;border-color:#4CAF50}#status{position:fixed;top:10px;left:10px;background:rgba(0,0,0,0.7);padding:10px 15px;border-radius:5px;z-index:1000}#instructions{position:fixed;top:10px;right:10px;background:rgba(0,0,0,0.7);padding:10px 15px;border-radius:5px;z-index:1000;font-size:12px;max-width:200px}#pointer-lock-msg{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:rgba(0,0,0,0.9);padding:30px;border-radius:10px;z-index:2000;text-align:center}#pointer-lock-msg h2{margin-bottom:15px}.keys-row{display:flex;gap:5px;justify-content:center}.keys-col{display:flex;flex-direction:column;gap:5px;align-items:center}#viewer-notice{background:#333;color:#fff;padding:10px;text-align:center}#viewer-notice a{color:#4CAF50}#chat-box{position:fixed;bottom:80px;left:20px;width:350px;max-height:200px;background:rgba(0,0,0,0.7);border-radius:5px;z-index:1000;display:flex;flex-direction:column}#chat-messages{flex:1;overflow-y:auto;padding:10px;font-size:13px;max-height:150px}#chat-messages p{margin:3px 0;word-wrap:break-word}.chat-msg{color:#fff}.chat-input-container{display:none;padding:8px;border-top:1px solid #444}#chat-input{width:100%;padding:8px;background:#222;border:1px solid #555;border-radius:3px;color:#fff;font-size:13px}#chat-input:focus{outline:none;border-color:#4CAF50}.chat-hint{color:#888;font-size:11px;padding:5px 10px;text-align:center}</style></head><body><div id="container"><div id="viewer-notice"><p>3D Viewer: <a href="http://'+req.hostname+':'+vp+'" target="_blank">Open in new tab</a></p></div><iframe id="viewer-frame" src="http://'+req.hostname+':'+vp+'"></iframe></div><div id="status">Connected: <span id="conn-status">Connecting...</span></div><div id="instructions"><b>Click to enable controls</b><br>WASD-Move Space-Jump<br>Shift-Sneak Ctrl-Sprint<br>T-Chat ESC-Release</div><div id="controls-overlay"><div class="keys-col"><div class="keys-row"><span class="key" id="key-w">W</span></div><div class="keys-row"><span class="key" id="key-a">A</span><span class="key" id="key-s">S</span><span class="key" id="key-d">D</span></div></div><div class="keys-col"><span class="key" id="key-space">SPACE</span><span class="key" id="key-shift">SHIFT</span><span class="key" id="key-ctrl">CTRL</span></div></div><div id="chat-box"><div id="chat-messages"><p class="chat-hint">Press T to chat</p></div><div class="chat-input-container" id="chat-input-container"><input type="text" id="chat-input" placeholder="Type message..." maxlength="256"></div></div><div id="pointer-lock-msg"><h2>Click to control bot</h2><p>WASD to move, mouse to look</p></div><script src="/socket.io/socket.io.js"></script><script>const socket=io();let isLocked=false;const keys={w:false,a:false,s:false,d:false,space:false,shift:false,ctrl:false};socket.on("connect",()=>{document.getElementById("conn-status").textContent="Yes";document.getElementById("conn-status").style.color="#4CAF50"});socket.on("disconnect",()=>{document.getElementById("conn-status").textContent="No";document.getElementById("conn-status").style.color="#f44336"});socket.on("chat",(msg)=>{const chatMsgs=document.getElementById("chat-messages");const p=document.createElement("p");p.className="chat-msg";p.textContent=msg;chatMsgs.appendChild(p);while(chatMsgs.children.length>50)chatMsgs.removeChild(chatMsgs.firstChild);chatMsgs.scrollTop=chatMsgs.scrollHeight});let chatOpen=false;const chatInput=document.getElementById("chat-input");const chatContainer=document.getElementById("chat-input-container");function openChat(){chatOpen=true;chatContainer.style.display="block";chatInput.focus();document.exitPointerLock()}function closeChat(){chatOpen=false;chatContainer.style.display="none";chatInput.value="";document.body.requestPointerLock()}function sendChat(){const msg=chatInput.value.trim();if(msg){socket.emit("chat",msg)}closeChat()}chatInput.addEventListener("keydown",(e)=>{if(e.key==="Enter"){e.preventDefault();sendChat()}else if(e.key==="Escape"){closeChat()}e.stopPropagation()});chatInput.addEventListener("keyup",(e)=>e.stopPropagation());function updateKeyDisplay(){document.getElementById("key-w").classList.toggle("active",keys.w);document.getElementById("key-a").classList.toggle("active",keys.a);document.getElementById("key-s").classList.toggle("active",keys.s);document.getElementById("key-d").classList.toggle("active",keys.d);document.getElementById("key-space").classList.toggle("active",keys.space);document.getElementById("key-shift").classList.toggle("active",keys.shift);document.getElementById("key-ctrl").classList.toggle("active",keys.ctrl)}function sendControls(){socket.emit("controls",{forward:keys.w,back:keys.s,left:keys.a,right:keys.d,jump:keys.space,sneak:keys.shift,sprint:keys.ctrl})}document.addEventListener("click",(e)=>{if(e.target.tagName==="A"||e.target.tagName==="INPUT")return;if(!isLocked&&!chatOpen)document.body.requestPointerLock()});document.addEventListener("pointerlockchange",()=>{isLocked=document.pointerLockElement===document.body;document.getElementById("pointer-lock-msg").style.display=isLocked?"none":"block"});document.addEventListener("keydown",(e)=>{if(chatOpen)return;if(!isLocked)return;e.preventDefault();let changed=false;if(e.code==="KeyW"&&!keys.w){keys.w=true;changed=true}if(e.code==="KeyA"&&!keys.a){keys.a=true;changed=true}if(e.code==="KeyS"&&!keys.s){keys.s=true;changed=true}if(e.code==="KeyD"&&!keys.d){keys.d=true;changed=true}if(e.code==="Space"&&!keys.space){keys.space=true;changed=true}if(e.code==="ShiftLeft"&&!keys.shift){keys.shift=true;changed=true}if(e.code==="ControlLeft"&&!keys.ctrl){keys.ctrl=true;changed=true}if(e.code==="KeyT"){openChat();return}if(e.code==="Slash"){openChat();setTimeout(()=>{chatInput.value="/";},10);return}if(changed){updateKeyDisplay();sendControls()}});document.addEventListener("keyup",(e)=>{if(chatOpen)return;let changed=false;if(e.code==="KeyW"){keys.w=false;changed=true}if(e.code==="KeyA"){keys.a=false;changed=true}if(e.code==="KeyS"){keys.s=false;changed=true}if(e.code==="KeyD"){keys.d=false;changed=true}if(e.code==="Space"){keys.space=false;changed=true}if(e.code==="ShiftLeft"){keys.shift=false;changed=true}if(e.code==="ControlLeft"){keys.ctrl=false;changed=true}if(changed){updateKeyDisplay();sendControls()}});document.addEventListener("mousemove",(e)=>{if(!isLocked)return;socket.emit("look",{x:e.movementX,y:e.movementY})});</script></body></html>');
  });
  
  io.on('connection', (socket) => {
    console.log('Web controller client connected');
    socket.on('chat', (msg) => { if (bot && typeof msg === 'string') bot.chat(msg.substring(0, 256)); });
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
  
  httpServer.listen(port, '0.0.0.0', () => { console.log('Web controller on port ' + port); });
  httpServer.on('error', (err) => { console.error('Web controller error:', err.message); });
  webControllerServer = httpServer;
}

function sendToDiscord(message) {
  if (discordChannel && discordChannel.send) {
    discordChannel.send(message).catch(err => console.error('Discord error:', err.message));
  }
}

async function registerSlashCommands() {
  if (!config.enable_discord || !config.discord_token) return;
  const commands = [
    new SlashCommandBuilder().setName('leave').setDescription('Disconnect bot'),
    new SlashCommandBuilder().setName('connect').setDescription('Connect bot'),
    new SlashCommandBuilder().setName('msg').setDescription('Send message').addStringOption(o => o.setName('message').setDescription('Message').setRequired(true))
  ].map(cmd => cmd.toJSON());
  try {
    const rest = new REST({ version: '10' }).setToken(config.discord_token);
    const appInfo = await rest.get(Routes.oauth2CurrentApplication());
    await rest.put(Routes.applicationCommands(appInfo.id), { body: commands });
    console.log('Discord commands registered');
  } catch (err) { console.error('Failed to register commands:', err.message); }
}

function setupDiscord() {
  if (!config.enable_discord || !config.discord_token || !config.discord_channel) return;
  discordClient = new Client({ intents: [GatewayIntentBits.Guilds] });
  discordClient.on(Events.ClientReady, async (client) => {
    console.log(`Discord: ${client.user.tag}`);
    if (config.discord_status) client.user.setActivity(config.discord_status);
    await registerSlashCommands();
    try {
      discordChannel = await client.channels.fetch(String(config.discord_channel).trim());
      if (discordChannel) discordChannel.send('\ud83e\udd16 Bot connected!').catch(console.error);
    } catch (err) { console.error('Discord channel error:', err.message); }
  });
  
  discordClient.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    const adminId = String(config.discord_admin_id).trim();
    if (adminId && interaction.user.id !== adminId) {
      await interaction.reply({ content: '\u274c No permission.', ephemeral: true });
      return;
    }
    
    if (interaction.commandName === 'leave') {
      if (!bot) { await interaction.reply({ content: 'Bot not connected.', ephemeral: true }); return; }
      manuallyDisconnected = true;
      clearAllIntervals();
      await closeViewerServers();
      if (bot) { bot.removeAllListeners('end'); bot.quit(); bot = null; }
      await interaction.reply('\u2705 Bot disconnected.');
    }
    
    if (interaction.commandName === 'connect') {
      if (bot) { await interaction.reply({ content: 'Bot already connected.', ephemeral: true }); return; }
      manuallyDisconnected = false;
      await closeViewerServers();
      await new Promise(r => setTimeout(r, 2000));
      createBot();
      await interaction.reply('\u2705 Bot connecting...');
    }
    
    if (interaction.commandName === 'msg') {
      if (!bot) { await interaction.reply({ content: 'Bot not connected.', ephemeral: true }); return; }
      const msg = interaction.options.getString('message');
      if (msg) { bot.chat(msg); await interaction.reply(`\u2705 Sent: \`${msg}\``); }
    }
  });
  
  discordClient.login(config.discord_token).catch(err => console.error('Discord login failed:', err.message));
}

function clearAllIntervals() {
  if (scheduleInterval) { clearInterval(scheduleInterval); scheduleInterval = null; }
  if (followInterval) { clearInterval(followInterval); followInterval = null; }
  if (autoclickerInterval) { clearInterval(autoclickerInterval); autoclickerInterval = null; }
  if (playerListInterval) { clearInterval(playerListInterval); playerListInterval = null; }
  if (autoPayInterval) { clearInterval(autoPayInterval); autoPayInterval = null; }
}

// Auto Pay function
async function doAutoPay() {
  if (!bot || !config.enable_auto_pay || !config.auto_pay_player) return;
  console.log('Auto Pay: Running /bal...');
  
  return new Promise((resolve) => {
    let balanceFound = false;
    const balListener = (jsonMsg) => {
      const msg = jsonMsg.toString();
      // Match Balance: $X,XXX.XX format
      const match = msg.match(/Balance:\s*\$([\d,]+\.?\d*)/i);
      if (match && !balanceFound) {
        balanceFound = true;
        const balance = match[1];
        console.log(`Auto Pay: Balance is $${balance}`);
        bot.removeListener('message', balListener);
        
        // Run /pay twice
        setTimeout(() => {
          console.log(`Auto Pay: /pay ${config.auto_pay_player} ${balance}`);
          bot.chat(`/pay ${config.auto_pay_player} ${balance}`);
          setTimeout(() => {
            console.log(`Auto Pay: /pay ${config.auto_pay_player} ${balance} (2nd)`);
            bot.chat(`/pay ${config.auto_pay_player} ${balance}`);
            resolve();
          }, 1500);
        }, 1000);
      }
    };
    
    bot.on('message', balListener);
    bot.chat('/bal');
    
    // Timeout after 10 seconds
    setTimeout(() => {
      bot.removeListener('message', balListener);
      if (!balanceFound) console.log('Auto Pay: Timeout waiting for balance');
      resolve();
    }, 10000);
  });
}

function setupAutoPay() {
  if (!config.enable_auto_pay || !config.auto_pay_player) return;
  console.log('Setting up auto pay (every hour)');
  if (autoPayInterval) clearInterval(autoPayInterval);
  // Run every hour
  autoPayInterval = setInterval(doAutoPay, 60 * 60 * 1000);
  // Also run once after 30 seconds
  setTimeout(doAutoPay, 30000);
}

function createBot() {
  console.log(`Connecting to ${config.host}:${config.port}`);
  bot = mineflayer.createBot({
    host: config.host,
    port: config.port,
    username: config.username,
    auth: config.auth,
    version: false
  });
  bot.loadPlugin(pathfinder);
  
  bot.on('error', (err) => { console.error('Bot error:', err.message); sendToDiscord(`\u274c Error: ${err.message}`); });
  bot._client.on('error', (err) => { console.error('Connection error:', err.message); });
  
  bot.once('spawn', () => {
    console.log('Bot spawned');
    sendToDiscord('\u2705 Bot spawned!');
    
    if (config.enable_web_controller) {
      try { setupWebController(bot, config.web_controller_port, config.viewer_port); }
      catch (err) { console.error('Web controller error:', err.message); }
    }
    if (config.enable_inventory) {
      try { inventoryServer = inventoryViewer(bot, { port: config.inventory_port }); }
      catch (err) { console.error('Inventory error:', err.message); }
    }
    if (config.enable_daily_restart) setupDailyRestartSchedule();
    if (config.enable_follow && config.follow_player) setupFollowPlayer();
    if (config.enable_autoclicker) setupAutoclicker();
    if (config.enable_player_list && config.player_list_channel) setupPlayerList();
    if (config.enable_auto_pay && config.auto_pay_player) setupAutoPay();
    
    setTimeout(() => console.log('Bot ready!'), 500);
  });
  
  bot.on('message', (jsonMsg) => {
    const message = jsonMsg.toString();
    console.log(`[Chat] ${message}`);
    if (message && message.trim()) {
      sendToDiscord(message);
      if (webControllerIO) webControllerIO.emit('chat', message);
    }
    if (config.enable_chat_reactions && message.includes('Chat Reaction')) {
      if (message.includes('No one typed') || message.includes('was first')) return;
      const match = message.match(/type \"(.+?)\"/);
      if (match && match[1] && Math.random() < 0.2) {
        setTimeout(() => { if (bot) bot.chat(match[1]); }, 1000 + Math.random() * 2000);
      }
    }
  });
  
  bot.on('kicked', (reason) => { console.log('Kicked:', reason); sendToDiscord(`\u274c Kicked: ${reason}`); });
  
  bot.on('end', (reason) => {
    console.log('Disconnected:', reason);
    clearAllIntervals();
    closeViewerServers();
    if (manuallyDisconnected) { console.log('Manual disconnect, not reconnecting.'); return; }
    sendToDiscord('\u26a0\ufe0f Disconnected. Reconnecting in 20s...');
    setTimeout(() => { console.log('Reconnecting...'); createBot(); }, 20000);
  });
}

function setupFollowPlayer() {
  if (followInterval) clearInterval(followInterval);
  const defaultMove = new Movements(bot);
  followInterval = setInterval(() => {
    if (!bot || !config.follow_player) return;
    const target = bot.players[config.follow_player]?.entity;
    if (target) { bot.pathfinder.setMovements(defaultMove); bot.pathfinder.setGoal(new GoalFollow(target, 2), true); }
  }, 1000);
  console.log(`Following ${config.follow_player}`);
}

// Autoclicker - LEFT CLICK ONLY
function setupAutoclicker() {
  if (autoclickerInterval) clearInterval(autoclickerInterval);
  console.log('Autoclicker: LEFT CLICK ONLY every 10 min');
  
  autoclickerInterval = setInterval(async () => {
    if (!bot || !bot.entity) return;
    try {
      const signs = bot.findBlocks({ matching: (b) => b.name.includes('sign'), maxDistance: 3, count: 20 });
      if (signs.length === 0) { console.log('Autoclicker: No signs'); return; }
      
      let bestSign = null, highestY = -Infinity;
      for (const pos of signs) { if (pos.y > highestY) { highestY = pos.y; bestSign = pos; } }
      
      if (bestSign) {
        const block = bot.blockAt(bestSign);
        if (block) {
          await bot.lookAt(bestSign.offset(0.5, 0.5, 0.5));
          await new Promise(r => setTimeout(r, 50));
          bot.swingArm('right');
          // LEFT CLICK ONLY
          bot._client.write('block_dig', { status: 0, location: block.position, face: 1 });
          setTimeout(() => { bot._client.write('block_dig', { status: 1, location: block.position, face: 1 }); }, 50);
          console.log('Autoclicker: Left-clicked sign');
        }
      }
    } catch (err) { console.log('Autoclicker error:', err.message); }
  }, 600000);
}

async function setupPlayerList() {
  if (playerListInterval) clearInterval(playerListInterval);
  if (discordClient && config.player_list_channel) {
    try { playerListChannel = await discordClient.channels.fetch(String(config.player_list_channel).trim()); }
    catch (err) { console.error('Player list channel error:', err.message); return; }
  }
  const sendPlayerList = async () => {
    if (!bot || !bot.players || !playerListChannel) return;
    try {
      const players = Object.keys(bot.players).join(', ');
      await playerListChannel.send('----start player list----');
      await playerListChannel.send(players || 'No players');
      await playerListChannel.send('----end player list----');
    } catch (err) { console.error('Player list error:', err.message); }
  };
  setTimeout(sendPlayerList, 5000);
  playerListInterval = setInterval(sendPlayerList, 60000);
}

function setupDailyRestartSchedule() {
  if (scheduleInterval) clearInterval(scheduleInterval);
  scheduleInterval = setInterval(async () => {
    const now = new Date();
    const estTime = new Date(now.toLocaleString('en-US', { timeZone: config.restart_timezone || 'America/New_York' }));
    if (estTime.getHours() === 23 && estTime.getMinutes() === 56) {
      console.log('Daily restart: Logging out...');
      sendToDiscord('\ud83d\udd04 Daily restart - Logging out');
      clearAllIntervals();
      
      // Run auto pay before restart
      if (config.enable_auto_pay && config.auto_pay_player) {
        await doAutoPay();
      }
      
      await closeViewerServers();
      if (bot) { bot.removeAllListeners('end'); bot.quit(); }
      setTimeout(() => {
        console.log('Daily restart: Reconnecting...');
        sendToDiscord('\ud83d\udd04 Reconnecting...');
        createBot();
      }, 8 * 60 * 1000);
    }
  }, 60 * 1000);
  console.log('Daily restart schedule enabled');
}

process.on('SIGINT', async () => {
  console.log('Shutting down...');
  clearAllIntervals();
  await closeViewerServers();
  if (bot) { bot.removeAllListeners('end'); bot.quit(); }
  if (discordClient) discordClient.destroy();
  process.exit(0);
});

process.on('uncaughtException', (err) => console.error('Uncaught:', err.message));
process.on('unhandledRejection', (reason) => console.error('Unhandled:', reason));

setupDiscord();
createBot();
