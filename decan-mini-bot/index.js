// Core Node.js modules
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');

// Channel info for messages
const channelInfo = {
    contextInfo: {
        externalAdReply: {
            title: "DECAN XMD BOT",
            body: "The Ultimate WhatsApp Bot",
            thumbnail: fs.readFileSync('decan.jpg'),
            mediaType: 1,
            mediaUrl: 'https://whatsapp.com/channel/0029VbBv1fxBKfi72JZzbz3u',
            sourceUrl: 'https://whatsapp.com/channel/0029VbBv1fxBKfi72JZzbz3u',
            showAdAttribution: true
        }
    }
};

// Load environment variables
require('dotenv').config({ path: path.join(__dirname, '.env') });

// Debug log environment variables
console.log('Environment variables loaded:');
console.log('ADMIN_NUMBER:', process.env.ADMIN_NUMBER);
console.log('PREFIX:', process.env.PREFIX);

// Third-party dependencies
// Third-party dependencies
const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason,
    downloadMediaMessage,
    downloadContentFromMessage
} = require('@whiskeysockets/baileys');

// Import antidelete handlers
const { 
    handleAntideleteCommand,
    handleMessageRevocation,
    storeMessage,
    loadAntideleteConfig,
    saveAntideleteConfig
} = require('./handlers/antidelete');

// Import helpers
const checkAdmin = require('./helpers/isAdmin');
const { incrementMessageCount, topMembers } = require('./helpers/messageCounter');
const qrcode = require('qrcode-terminal');
const { promisify } = require('util');

// Configuration
const CONFIG = {
    ADMIN_NUMBER: process.env.ADMIN_NUMBER || '254103305583',
    PREFIX: process.env.PREFIX || '.',
    SESSION_NAME: 'session',
    MAX_RETRIES: 5,
    RETRY_DELAY: 5000, // 5 seconds
    COMMAND_COOLDOWN: 2000, // 2 seconds
    MAX_MESSAGE_LENGTH: 1000,
    LOG_LEVEL: process.env.LOG_LEVEL || 'info',
    AUTH_DIR: path.join(__dirname, 'auth_info'),
    CHANNEL_LINK: 'https://whatsapp.com/channel/0029VbBv1fxBKfi72JZzbz3u'
};

// Wrapper function to add channel link to text messages
function sendMessageWithChannelLink(sock, jid, content, options = {}) {
    // If it's a text message, add the channel link
    if (content && typeof content === 'object' && content.text) {
        // Don't modify if it's a view once message or already contains the channel link
        if (!content.viewOnce && !content.text.includes(CONFIG.CHANNEL_LINK)) {
            content.text = `${content.text}\n\n📢 *DECAN XMD OFFICIAL CHANNEL*\n\n🔔 *Why Join?*\n• Get the latest updates and news\n• Exclusive content and announcements\n• First to know about new features\n• Community events and more!\n\n👉 Join now: ${CONFIG.CHANNEL_LINK}\n\n#DecanXMD #StayUpdated`;
        }
    }
    
    // Forward the call to the original sendMessage
    return sock.sendMessage(jid, content, options);
}

// Logger setup
const logger = {
    levels: { error: 0, warn: 1, info: 2, debug: 3 },
    level: CONFIG.LOG_LEVEL,
    
    log(level, ...args) {
        if (this.levels[level] <= this.levels[this.level]) {
            const timestamp = new Date().toISOString();
            console[level](`[${timestamp}] [${level.toUpperCase()}]`, ...args);
        }
    },
    
    error: function(...args) { this.log('error', ...args); },
    warn: function(...args) { this.log('warn', ...args); },
    info: function(...args) { this.log('info', ...args); },
    debug: function(...args) { this.log('debug', ...args); }
};

// State management
class BotState {
    constructor() {
        this.deletedMessages = new Map();
        this.antiLinkGroups = new Set();
        this.memberActivity = new Map();
        this.messageCooldown = new Map();
        this.botNumber = null;
        this.viewOnceMedia = new Map();
        this.botAdmins = new Set([CONFIG.ADMIN_NUMBER]);
        this.groups = new Map();
        this.pairedDevices = new Map();
        this.welcomedUsers = new Set();
        this.autoBioInterval = null;
    }

    isAdmin(userId) {
        return this.botAdmins.has(userId.split('@')[0]);
    }
}

const state = new BotState();

// Command handlers
const commandHandlers = {
    // View once message handler
    async viewonce(sock, msg, from, sender, args) {
        try {
            // Get quoted message with better error handling
            const quotedMessage = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage ||
                                msg.message?.imageMessage ||
                                msg.message?.videoMessage;

            if (!quotedMessage) {
                await sock.sendMessage(from, { 
                    text: '🛑 _Please reply to a view once message!_',
                    ...channelInfo
                });
                return;
            }

            // Enhanced view once detection
            const isViewOnceImage = quotedMessage.imageMessage?.viewOnce === true || 
                                quotedMessage.viewOnceMessage?.message?.imageMessage ||
                                msg.message?.viewOnceMessage?.message?.imageMessage;
                                    
            const isViewOnceVideo = quotedMessage.videoMessage?.viewOnce === true || 
                                quotedMessage.viewOnceMessage?.message?.videoMessage ||
                                msg.message?.viewOnceMessage?.message?.videoMessage;

            // Get the actual message content
            let mediaMessage;
            if (isViewOnceImage) {
                mediaMessage = quotedMessage.imageMessage || 
                            quotedMessage.viewOnceMessage?.message?.imageMessage ||
                            msg.message?.viewOnceMessage?.message?.imageMessage;
            } else if (isViewOnceVideo) {
                mediaMessage = quotedMessage.videoMessage || 
                            quotedMessage.viewOnceMessage?.message?.videoMessage ||
                            msg.message?.viewOnceMessage?.message?.videoMessage;
            }

            if (!mediaMessage) {
                logger.debug('Message structure:', JSON.stringify(msg, null, 2));
                await sock.sendMessage(from, { 
                    text: ' 🛑 Could not detect view once message! Please make sure you replied to a view once image/video.',
                    ...channelInfo
                });
                return;
            }

            // Handle view once image
            if (isViewOnceImage) {
                try {
                    logger.debug('Processing view once image...');
                    const stream = await downloadContentFromMessage(mediaMessage, 'image');
                    let buffer = Buffer.from([]);
                    for await (const chunk of stream) {
                        buffer = Buffer.concat([buffer, chunk]);
                    }

                    const caption = mediaMessage.caption || '';
                    
                    await sock.sendMessage(from, { 
                        image: buffer,
                        caption: `*𝐉ᴜɴᴇ 𝐌ᴅ*\n\n*ViewOnce:* Image 📸\n${caption ? `*Caption:* ${caption}` : ''}`,
                        ...channelInfo
                    });
                    logger.debug('View once image processed successfully');
                    return;
                } catch (err) {
                    logger.error('Error downloading image:', err);
                    await sock.sendMessage(from, { 
                        text: '🛑 Failed to process view once image! Error: ' + err.message,
                        ...channelInfo
                    });
                    return;
                }
            }

            // Handle view once video
            if (isViewOnceVideo) {
                try {
                    logger.debug('Processing view once video...');
                    
                    // Create temp directory if it doesn't exist
                    const tempDir = path.join(__dirname, 'temp');
                    if (!fs.existsSync(tempDir)) {
                        fs.mkdirSync(tempDir);
                    }

                    const tempFile = path.join(tempDir, `temp_${Date.now()}.mp4`);
                    const stream = await downloadContentFromMessage(mediaMessage, 'video');
                    const writeStream = fs.createWriteStream(tempFile);
                    
                    for await (const chunk of stream) {
                        writeStream.write(chunk);
                    }
                    writeStream.end();

                    // Wait for file to be written
                    await new Promise((resolve) => writeStream.on('finish', resolve));

                    const caption = mediaMessage.caption || '';

                    await sock.sendMessage(from, { 
                        video: fs.readFileSync(tempFile),
                        caption: `*𝐉ᴜɴᴇ 𝐌ᴅ*\n\n*ViewOnce* Video 📹\n${caption ? `*Caption:* ${caption}` : ''}`,
                        ...channelInfo
                    });

                    // Clean up temp file
                    fs.unlinkSync(tempFile);
                    
                    logger.debug('View once video processed successfully');
                    return;
                } catch (err) {
                    logger.error('Error processing video:', err);
                    await sock.sendMessage(from, { 
                        text: ' 🛑 Failed to process view once video! Error: ' + err.message,
                        ...channelInfo
                    });
                    return;
                }
            }

            // If we get here, it wasn't a view once message
            await sock.sendMessage(from, { 
                text: '🛑 This is not a view once message! Please reply to a view once image/video.',
                ...channelInfo
            });

        } catch (error) {
            logger.error('Error in viewonce command:', error);
            await sock.sendMessage(from, { 
                text: '🛑 Error processing view once message! Error: ' + error.message,
                ...channelInfo
            });
        }
    },
    // Will be populated with command handler functions
};

// Initialize groups and other shared state
state.groups = new Map();
state.pairedDevices = new Map();
state.welcomedUsers = new Set();

/**
 * Initialize and start the WhatsApp bot
 * @returns {Promise<Object>} The WhatsApp socket instance
 */
async function startBot(retryCount = 0) {
    try {
        logger.info('🔧 Initializing bot...');
        
        // Ensure auth directory exists
        if (!fs.existsSync(CONFIG.AUTH_DIR)) {
            await fsp.mkdir(CONFIG.AUTH_DIR, { recursive: true });
        }

        const { state: authState, saveCreds } = await useMultiFileAuthState(CONFIG.AUTH_DIR);

        // Configure socket with retry and timeout settings
        // Configure socket with retry and timeout settings
        const sock = makeWASocket({
            auth: authState,
            printQRInTerminal: true,
            syncFullHistory: false,
            logger: {
                // Use a simple console logger that Baileys can use
                debug: (message, ...args) => CONFIG.LOG_LEVEL === 'debug' && console.debug(message, ...args),
                info: (message, ...args) => console.log(message, ...args),
                warn: (message, ...args) => console.warn(message, ...args),
                error: (message, ...args) => console.error(message, ...args),
                fatal: (message, ...args) => console.error('FATAL:', message, ...args),
                trace: (message, ...args) => CONFIG.LOG_LEVEL === 'debug' && console.trace(message, ...args),
                // Add child method that returns a new logger instance
                child: () => ({
                    debug: (message, ...args) => CONFIG.LOG_LEVEL === 'debug' && console.debug(message, ...args),
                    info: (message, ...args) => console.log(message, ...args),
                    warn: (message, ...args) => console.warn(message, ...args),
                    error: (message, ...args) => console.error(message, ...args),
                    fatal: (message, ...args) => console.error('FATAL:', message, ...args),
                    trace: (message, ...args) => CONFIG.LOG_LEVEL === 'debug' && console.trace(message, ...args),
                    child: () => this // Return self for chaining
                })
            },
            markOnlineOnConnect: true,
            browser: ['Decan XMD', 'Chrome', '1.0.0'],
            connectTimeoutMs: 60000, // 60 seconds
            keepAliveIntervalMs: 30000, // 30 seconds
            maxRetries: CONFIG.MAX_RETRIES,
            retryRequestDelayMs: CONFIG.RETRY_DELAY,
            // Disable newsletter and other non-essential features
            shouldSyncNewsletter: false,
            shouldSyncHistory: false,
            shouldSyncStatus: false,
            // Additional stability options
            syncFullHistory: false,
            linkPreviewImageThumbnailWidth: 0, // Disable link previews
            getMessage: async () => ({}), // Disable message history
            // Reduce memory usage
            maxCachedMessages: 10,
            maxMsgCacheSize: 50
        });

        // Store bot number
        state.botNumber = sock.authState.creds.me?.id?.replace(/:[0-9]+$/, '');
        logger.info(`🤖 Bot started with number: ${state.botNumber || 'Unknown'}`);

        // Handle connection updates
        sock.ev.on('connection.update', (update) => {
            logger.debug('Connection update:', JSON.stringify(update));
            handleConnectionUpdate(sock, update);
        });
        
        // Save credentials when updated
        sock.ev.on('creds.update', saveCreds);
        
        // Handle message updates (including deletions)
        sock.ev.on('messages.upsert', async ({ messages }) => {
            const msg = messages[0];
            if (!msg.message) return;

            // Store message for anti-delete functionality
            await storeMessage(msg);

            // Handle incoming messages
            await handleIncomingMessage(sock, msg);
        });

        // Handle message deletions
        sock.ev.on('messages.update', async (updates) => {
            for (const update of updates) {
                if (update.update.messageStubType === 'REVOKE') {
                    await handleMessageRevocation(sock, update);
                }
            }
        });

        // Handle incoming messages with rate limiting
        sock.ev.on('messages.upsert', async ({ messages, type }) => {
            if (type !== 'notify') return;
            
            for (const msg of messages) {
                try {
                    const from = msg.key.remoteJid;
                    if (!from) continue;

                    // Check if message is from a group
                    const isGroup = from.endsWith('@g.us');
                    const limiter = isGroup ? rateLimiters.group : rateLimiters.private;
                    const { limited, timeToWait } = limiter.isLimited(from);

                    if (limited) {
                        if (isGroup) {
                            // Don't respond in groups to avoid spam
                            logger.warn(`Rate limit exceeded in ${from}, ignoring message`);
                            continue;
                        } else {
                            await sock.sendMessage(from, { 
                                text: `⏳ Please wait ${Math.ceil(timeToWait/1000)} seconds before sending another message.` 
                            }).catch(err => logger.error('Failed to send rate limit message:', err));
                            continue;
                        }
                    }

                    // Process the message normally
                    await handleIncomingMessage(sock, msg);
                } catch (error) {
                    logger.error('Error handling message:', error);
                    
                    // Notify admin of critical errors
                    if (error.isCritical && state.botNumber) {
                        await sock.sendMessage(`${CONFIG.ADMIN_NUMBER}@s.whatsapp.net`, {
                            text: `❌ Critical error in message handling:\n${error.message}\n\n${error.stack}`
                        }).catch(logger.error);
                    }
                }
            }
        });

        // Handle connection errors
        sock.ev.on('connection.recv', (data) => {
            if (data.error) {
                logger.error('Connection error:', data.error);
                
                // Handle rate limiting
                if (data.error.message?.includes('rate-overlimit')) {
                    const retryAfter = parseInt(data.error.message.match(/retry_after=([0-9]+)/)?.[1] || '60');
                    logger.warn(`Rate limited. Retrying after ${retryAfter} seconds...`);
                    setTimeout(() => startBot(), (retryAfter * 1000) + 1000);
                    return;
                }
                
                // Handle reconnection
                if (data.error.message?.includes('reconnect')) {
                    const delay = Math.min(1000 * Math.pow(2, retryCount), 30000); // Exponential backoff
                    logger.warn(`Connection lost. Reconnecting in ${delay/1000} seconds...`);
                    setTimeout(() => startBot(retryCount + 1), delay);
                }
            }
        });

        // Handle unexpected disconnections
        sock.ev.on('connection.close', ({ isReconnecting }) => {
            if (!isReconnecting) {
                logger.warn('Connection closed unexpectedly. Attempting to reconnect...');
                setTimeout(() => startBot(retryCount + 1), CONFIG.RETRY_DELAY);
            }
        });

        logger.info('✅ Bot initialization complete');
        return sock;
        
    } catch (error) {
        logger.error('Failed to start bot:', error);
        
        // Implement exponential backoff for retries
        const delay = Math.min(1000 * Math.pow(2, retryCount), 30000); // Max 30 seconds
        
        if (retryCount < CONFIG.MAX_RETRIES) {
            logger.warn(`Retrying in ${delay/1000} seconds... (Attempt ${retryCount + 1}/${CONFIG.MAX_RETRIES})`);
            await new Promise(resolve => setTimeout(resolve, delay));
            return startBot(retryCount + 1);
        }
        
        logger.error('Max retries reached. Giving up.');
        throw error;
    }
}

function handleConnectionUpdate(sock, { connection, lastDisconnect, qr }) {
    if (qr) {
        console.log('🔑 Scan QR below:');
        qrcode.generate(qr, { small: true });
    }
    
    if (connection === 'close') {
        const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
        console.log('🔌 Connection closed due to ', lastDisconnect?.error?.message || 'unknown reason');
        
        if (shouldReconnect) {
            console.log('🔄 Reconnecting...');
            setTimeout(() => startBot(), 5000);
        } else {
            console.log('❌ Not reconnecting, logged out');
            process.exit(1);
        }
    } else if (connection === 'open') {
        console.log('✅ Successfully connected to WhatsApp');
        
        // Get the bot's number
        sock.user = sock.user || {};
        sock.user.id = sock.user.id || sock.authState?.creds?.me?.id || null;
        if (sock.user.id) {
            state.botNumber = sock.user.id.split('@')[0];
            console.log('🤖 Bot number:', state.botNumber);
            
            // Send a message to admin when bot starts
            if (CONFIG.ADMIN_NUMBER) {
                const now = new Date();
                const adminMessage = `┏❐═⭔ *BOT STARTED* ⭔═❐
┃⭔ *Bot:* DECAN XMD
┃⭔ *Time:* ${now.toLocaleString()}
┃⭔ *Status:* 🟢 Online
┃⭔ *Bot Number:* ${state.botNumber}
┗❐═⭔════════⭔═❐

Type *.menu* to see commands.
https://whatsapp.com/channel/0029VbBv1fxBKfi72JZzbz3u`;
                
                sock.sendMessage(
                    `${CONFIG.ADMIN_NUMBER}@s.whatsapp.net`, 
                    { text: adminMessage }
                ).catch(console.error);
            }
        }
    }
}

// Rate limiting
class RateLimiter {
    constructor(maxRequests, timeWindow) {
        this.maxRequests = maxRequests;
        this.timeWindow = timeWindow;
        this.requests = new Map();
    }

    isLimited(key) {
        const now = Date.now();
        const userRequests = this.requests.get(key) || [];
        
        // Remove old requests outside the time window
        const recentRequests = userRequests.filter(time => now - time < this.timeWindow);
        this.requests.set(key, recentRequests);

        if (recentRequests.length >= this.maxRequests) {
            const oldestRequest = recentRequests[0];
            const timeToWait = this.timeWindow - (now - oldestRequest);
            return { limited: true, timeToWait };
        }

        recentRequests.push(now);
        this.requests.set(key, recentRequests);
        return { limited: false };
    }
}

// Rate limit configuration
const RATE_LIMIT = {
    // Max 5 messages per 10 seconds per chat
    GROUP: { max: 5, window: 10000 },
    // Max 10 messages per 10 seconds for private chats
    PRIVATE: { max: 10, window: 10000 }
};

// Initialize rate limiters
const rateLimiters = {
    group: new RateLimiter(RATE_LIMIT.GROUP.max, RATE_LIMIT.GROUP.window),
    private: new RateLimiter(RATE_LIMIT.PRIVATE.max, RATE_LIMIT.PRIVATE.window)
};

// Track rate limited messages for logging
const rateLimitCounts = new Map();

// Ping handler
async function handlePing(sock, to) {
    const start = Date.now();
    const sentMsg = await sock.sendMessage(to, { text: 'Pong! 🏓' });
    const latency = Date.now() - start;
    
    await sock.sendMessage(to, {
        text: `🏓 Pong! Latency: ${latency}ms`,
        edit: sentMsg.key
    });
}

// Show bot information
async function showBotInfo(sock, to) {
    const uptime = formatUptime(process.uptime());
    await sock.sendMessage(to, {
        text: `🤖 *Bot Information*\n\n` +
              `• *Version:* 1.0.0\n` +
              `• *Uptime:* ${uptime}\n` +
              `• *Admin:* ${CONFIG.ADMIN_NUMBER}\n` +
              `• *Commands:* .menu to see all commands`
    });
}

// Show current time
async function showCurrentTime(sock, to) {
    await sock.sendMessage(to, {
        text: `⏰ Current time: ${new Date().toLocaleString()}`
    });
}

// Main command handler
async function handleCommand(sock, msg, from, senderId, command, args, isGroupChat) {
    try {
        const isAdmin = state.botAdmins.has(senderId.split('@')[0]);
        const sender = senderId.split('@')[0];
        
        // Status features
        if (msg.message?.viewOnceMessage) {
            await handleViewOnce(sock, msg);
        }

        switch(command) {
            case 'menu':
            case 'help':
                await showMenu(sock, from);
                break;

            case 'ping':
                await handlePing(sock, from);
                break;

            case 'antidelete':
                await toggleAntiDelete(sock, from, isAdmin);
                break;

            case 'info':
                await showBotInfo(sock, from);
                break;

            case 'time':
                await showCurrentTime(sock, from);
                break;
                
            case 'vv':
                await handleViewOnceRetrieve(sock, from, msg);
                break;
                
            case 'autoviewstatus':
                await toggleAutoViewStatus(sock, from, sender);
                break;
                
            case 'autoreactstatus':
                await toggleAutoReactStatus(sock, from, sender);
                break;
                
            case 'tostatus':
                await handleToStatus(sock, from, msg);
                break;
                
            case 'autoreact':
                await toggleAutoReact(sock, from, sender);
                break;
                
            case 'autotyping':
                await toggleAutoTyping(sock, from, sender);
                break;
                
            case 'autorecording':
                await toggleAutoRecording(sock, from, sender);
                break;
                
            case 'getpp':
                await handleGetProfilePicture(sock, from, msg);
                break;
                
            case 'repo':
                await sock.sendMessage(from, {
                    text: '📂 *Bot Repository*\n\n🔗 https://github.com/lenvartica/decan-mini-bot\n\n⭐ Star the repo if you like it!',
                    detectLinks: true
                });
                break;
                
            case 'sudo':
                await listAdmins(sock, from);
                break;
                
            case 'addsudo':
                await addAdmin(sock, from, args[0], sender);
                break;
                
            case 'pair':
                const phoneNumber = args[0];
                if (!phoneNumber) {
                    return await sock.sendMessage(from, {
                        text: '❌ Please provide a phone number to pair (e.g., .pair 254123456789)'
                    });
                }
                await handlePairDevice(sock, from, phoneNumber, senderId);
                break;
                
            case 'delete':
                await deleteMessage(sock, from, msg, isAdmin);
                break;

            default:
                await sock.sendMessage(from, {
                    text: `❌ Unknown command: .${command}\n\nType .menu to see available commands.`
                });
        }
    } catch (error) {
        console.error(`Error in handleCommand (${command}):`, error);
        await sock.sendMessage(from, {
            text: '❌ An error occurred while processing your command.'
        });
    }
}

function formatUptime(seconds) {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    const parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);
    
    return parts.join(' ');
}

async function handleIncomingMessage(sock, msg) {
    // Initialize all variables at function scope with default values
    let senderJid = '';
    let isGroupChat = false;
    let isBroadcast = false;
    let from = '';
    let senderId = '';
    let text = '';
    let command = '';
    let args = [];
    
    // Check if this is a new user and send welcome message
    if (msg.key && msg.key.remoteJid && !msg.key.fromMe && !msg.key.remoteJid.endsWith('@g.us') && !msg.key.remoteJid.endsWith('@broadcast')) {
        const userJid = msg.key.remoteJid;
        if (!state.welcomedUsers.has(userJid)) {
            state.welcomedUsers.add(userJid);
            const userNumber = userJid.split('@')[0];
            const welcomeMessage = `┏❐═⭔ *WELCOME* ⭔═❐
┃⭔ *Bot:* DECAN XMD
┃⭔ *Time:* ${new Date().toLocaleString()}
┃⭔ *Status:* Online
┃⭔ *Your Number:* ${userNumber}
┗❐═⭔════════⭔═❐

Type *.menu* to see available commands.
https://whatsapp.com/channel/0029VbBv1fxBKfi72JZzbz3u`;

            try {
                await sock.sendMessage(userJid, { text: welcomeMessage });
                console.log(`✅ Sent welcome message to ${userNumber}`);
            } catch (error) {
                console.error('❌ Error sending welcome message:', error);
            }
        }
    }
    
    try {
        // Basic message validation
        if (!msg || typeof msg !== 'object' || !msg.key || typeof msg.key !== 'object') {
            console.warn('Invalid message format:', msg);
            return;
        }

        const { key } = msg;
        if (!key.remoteJid || typeof key.remoteJid !== 'string') {
            console.warn('Invalid remoteJid in message:', msg);
            return;
        }
        
        // Initialize message properties
        senderJid = key.remoteJid;
        from = senderJid;
        isGroupChat = senderJid.endsWith('@g.us');
        isBroadcast = senderJid.endsWith('@broadcast');
        senderId = key.participant || senderJid;
        
        // Skip if no message content
        if (!msg.message || typeof msg.message !== 'object') {
            return;
        }

        // Additional validation for group messages
        if (isGroupChat && (!key.participant || typeof key.participant !== 'string')) {
            console.warn('Invalid participant in group message:', msg);
            return;
        }

        // Rate limiting with different limits for different chat types
        const limiter = isGroupChat 
            ? rateLimiters.group 
            : isBroadcast 
                ? rateLimiters.private  // Using private for broadcast as fallback
                : rateLimiters.private;
        
        const { limited, timeToWait } = limiter.isLimited(senderJid);

        if (limited) {
            // Track rate limit hits for monitoring
            const count = (rateLimitCounts.get(senderJid) || 0) + 1;
            rateLimitCounts.set(senderJid, count);
            
            // Only log every 10th rate limit for same sender to avoid log spam
            if (count % 10 === 1) {
                console.log(`⚠️ Rate limited: ${senderJid} (${count} times, wait time: ${timeToWait}ms)`);
            }
            return;
        }
        
        // Get message text and check for commands
        text = getMessageText(msg) || '';
        
        // Handle deleted messages in groups
        if (isGroupChat && msg.message?.protocolMessage?.type === 'REVOKE') {
            await handleDeletedMessage(sock, msg, from, senderId);
            return;
        }
        
        // Handle deleted message (anti-delete)
        if (msg.message?.protocolMessage?.type === 6) {
            await handleDeletedMessage(sock, msg, from, senderId);
            return;
        }

        // Track group activity
        if (isGroupChat) {
            trackGroupActivity(from, senderId);
            
            // Increment message count
            incrementMessageCount(from, senderId);
        }

        // Handle anti-link in groups
        if (isGroupChat && state.antiLinkGroups?.has(from) && /https?:\/\//i.test(text)) {
            await handleAntiLink(sock, msg, from, senderId);
            return;
        }

        // Handle PAIR code before processing other commands
        if (text.match(/^PAIR\s+\d{6}$/i)) {
            await handlePairCode(sock, msg, from, senderId);
            return;
        }
        
        // Process command if message starts with a dot
        if (text.startsWith('.')) {
            const parts = text.slice(1).trim().split(/\s+/);
            command = parts[0]?.toLowerCase() || '';
            args = parts.slice(1);
            
            // Process command with rate limiting
            if (!state.messageCooldown) {
                state.messageCooldown = new Map();
            }
            
            const now = Date.now();
            const lastCommandTime = state.messageCooldown.get(senderId) || 0;
            const cooldownTime = 3000; // Increased to 3 seconds
            
            if (now - lastCommandTime < cooldownTime) {
                const remaining = Math.ceil((cooldownTime - (now - lastCommandTime)) / 1000);
                console.log(`⚠️ Rate limited: ${senderId} (wait ${remaining}s)`);
                return; // Rate limit in effect
            }
            
            state.messageCooldown.set(senderId, now);
            
            // Ensure all required parameters are defined before calling handleCommand
            if (command && from && senderId) {
                await handleCommand(sock, msg, from, senderId, command, args, isGroupChat);
            }
        }
    } catch (error) {
        console.error('❌ Error in handleIncomingMessage:', error);
        
        // Handle rate limit errors specifically
        if (error.message && error.message.includes('Rate limited')) {
            console.warn('⚠️ Rate limit hit, backing off...');
            // Add a longer cooldown for this user
            state.messageCooldown.set(senderId, Date.now() + 10000); // 10 second cooldown
            return;
        }
        
        // Optionally send an error message to the admin
        if (CONFIG.ADMIN_NUMBER && sock) {
            try {
                await sock.sendMessage(`${CONFIG.ADMIN_NUMBER}@s.whatsapp.net`, {
                    text: `❌ Error in handleIncomingMessage: ${error.message}\n\nStack: ${error.stack || 'No stack trace available'}`
                });
            } catch (err) {
                console.error('Failed to send error notification:', err);
            }
        }
    }
}

function trackGroupActivity(groupId, senderId) {
    if (!state.memberActivity.has(groupId)) {
        state.memberActivity.set(groupId, new Map());
    }
    const groupActivity = state.memberActivity.get(groupId);
    const userId = senderId.split('@')[0];
    groupActivity.set(userId, (groupActivity.get(userId) || 0) + 1);
}

async function handleDeletedMessage(sock, msg, groupId, senderId) {
    if (!state.deletedMessages.has(groupId)) return;

    try {
        const revokedKey = msg.message.protocolMessage.key;
        const original = await sock.loadMessage(groupId, revokedKey.id);
        if (!original) return;

        const content = getMessageContent(original);
        const name = original.pushName || senderId.split('@')[0];

        await sock.sendMessage(groupId, {
            text: `Deleted Message Retrieved\n\nFrom: *${name}*\nMessage: ${content}`,
            mentions: [senderId]
        });
    } catch (error) {
        console.error('Error handling message:', {
            error: error.message,
            stack: error.stack,
            messageId: msg?.key?.id,
            remoteJid: msg?.key?.remoteJid,
            participant: msg?.key?.participant
        });
    }
}

async function handlePairDevice(sock, chatId, phoneNumber, requesterId) {
    try {
        // Only allow bot admins to pair devices
        if (!state.botAdmins.has(requesterId.split('@')[0])) {
            return await sock.sendMessage(chatId, {
                text: '❌ Only bot admins can pair devices.'
            });
        }

        // Validate phone number format (remove any non-digit characters)
        const cleanNumber = phoneNumber.replace(/\D/g, '');
        
        if (!cleanNumber || cleanNumber.length < 10) {
            return await sock.sendMessage(chatId, {
                text: '❌ Please provide a valid phone number (e.g., .pair 254123456789)'
            });
        }

        // Generate a random 6-digit pairing code
        const pairCode = Math.floor(100000 + Math.random() * 900000).toString();
        
        // Store the pairing information (expires in 5 minutes)
        state.pairedDevices.set(cleanNumber, {
            code: pairCode,
            expiresAt: Date.now() + 300000, // 5 minutes from now
            paired: false,
            pairedAt: null
        });

        // Send the pairing code to the admin
        await sock.sendMessage(chatId, {
            text: `📱 *Device Pairing*\n\n` +
                  `Pairing code for ${cleanNumber}:\n` +
                  `🔢 *${pairCode}*\n\n` +
                  `This code will expire in 5 minutes.\n` +
                  `Share this code with the device to complete pairing.`
        });

        // If the admin is pairing their own number, provide instructions
        if (cleanNumber === CONFIG.ADMIN_NUMBER) {
            await sock.sendMessage(chatId, {
                text: `📲 *How to complete pairing*\n\n` +
                      `1. On the device you want to pair, send:\n` +
                      `   *PAIR ${pairCode}*\n` +
                      `   to this bot's number.\n\n` +
                      `2. The device will be linked and ready to use!`
            });
        }
    } catch (error) {
        console.error('Error in handlePairDevice:', error);
        await sock.sendMessage(chatId, {
            text: '❌ An error occurred while processing your request.'
        });
    }
}

async function handlePairCode(sock, msg, from, sender) {
    try {
        const text = getMessageText(msg);
        if (!text) return;
        
        const match = text.match(/^PAIR\s+(\d{6})$/i);
        if (!match) return;
        
        const [, code] = match;
        const phoneNumber = sender.split('@')[0];
        
        // Find if this code exists and is not expired
        for (const [number, data] of state.pairedDevices.entries()) {
            if (data.code === code && !data.paired) {
                if (Date.now() > data.expiresAt) {
                    state.pairedDevices.delete(number);
                    return await sock.sendMessage(from, {
                        text: '❌ This pairing code has expired. Please request a new one.'
                    });
                }
                
                // Mark as paired
                data.paired = true;
                data.pairedAt = new Date().toISOString();
                data.deviceId = `device_${Date.now()}`;
                
                // Notify both the device and the admin
                await sock.sendMessage(from, {
                    text: '✅ *Device Paired Successfully!*\n\n' +
                          'This device is now connected to the bot.\n' +
                          `Device ID: ${data.deviceId}`
                });
                
                // Notify the admin if they're not the one who paired
                if (number !== CONFIG.ADMIN_NUMBER) {
                    const adminJid = `${CONFIG.ADMIN_NUMBER}@s.whatsapp.net`;
                    await sock.sendMessage(adminJid, {
                        text: `📱 *New Device Paired*\n\n` +
                              `• Number: ${phoneNumber}\n` +
                              `• Device ID: ${data.deviceId}\n` +
                              `• Paired at: ${new Date().toLocaleString()}`
                    });
                }
                
                return;
            }
        }
        
        await sock.sendMessage(from, {
            text: '❌ Invalid or expired pairing code. Please request a new one.'
        });
    } catch (error) {
        console.error('Error in handlePairCode:', error);
    }
}

async function handleAntiLink(sock, msg, groupId, senderId) {
    try {
        await sock.sendMessage(groupId, { delete: msg.key });
        await sock.sendMessage(groupId, { 
            text: `@${senderId.split('@')[0]} Links not allowed!`, 
            mentions: [senderId] 
        });
    } catch (error) {
        console.error('Error handling anti-link:', error);
    }
}

function getMessageText(msg) {
    if (!msg?.message) return '';

    if (msg.message.conversation) return msg.message.conversation;
    if (msg.message.extendedTextMessage?.text) return msg.message.extendedTextMessage.text;
    if (msg.message.imageMessage?.caption) return msg.message.imageMessage.caption;
    if (msg.message.videoMessage?.caption) return msg.message.videoMessage.caption;

    return '';
}

function getMessageContent(msg) {
    const text = getMessageText(msg);
    if (text) return text;

    if (msg.message?.imageMessage) return '[Image]' + (msg.message.imageMessage.caption ? ' ' + msg.message.imageMessage.caption : '');
    if (msg.message?.videoMessage) return '[Video]' + (msg.message.videoMessage.caption ? ' ' + msg.message.videoMessage.caption : '');

    return '[Media]';
}


// Initialize data directory if it doesn't exist
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

// Bot settings and state
const botSettings = {
    // Status features
    status: {
        autoView: new Set(),
        autoReact: new Set(),
        viewOnceCache: new Map()
    },
    
    // Automation
    automation: {
        autoReact: new Set(),
        autoTyping: new Set(),
        autoRecording: new Set()
    },
    
    // Admin management
    admins: new Set([CONFIG.ADMIN_NUMBER]),
    botAdmins: new Set([CONFIG.ADMIN_NUMBER]),
    
    // Group settings cache
    groups: new Map()
};

// View once handler
async function handleViewOnce(sock, msg) {
    if (msg.message?.viewOnceMessage) {
        const message = msg.message.viewOnceMessage.message;
        const from = msg.key.remoteJid;
        const sender = msg.key.participant || msg.key.remoteJid;
        
        // Store the message in cache
        const messageId = msg.key.id;
        statusSettings.viewOnceCache.set(messageId, message);
        
        // Notify user
        await sock.sendMessage(from, {
            text: '🔍 View once message captured! Use .vv to view it.'
        }, { quoted: msg });
    }
}

// Command handlers
async function handleCommand(sock, msg, from, sender, command, args, isGroup) {
    const { isSenderAdmin } = isGroup ? await checkAdmin(sock, from, sender) : { isSenderAdmin: true };
    const isBotAdmin = state.botAdmins.has(sender.split('@')[0]);
    const isOwner = sender.startsWith(CONFIG.ADMIN_NUMBER);

    try {
        // Group commands
        if (['add','promote','demote','kick','undokick','kickall','invite','desc','name','antilink','tagall','listactive','listinactive','settings','grouppp','tagadmin'].includes(command)) {
            return await handleGroupCommand(sock, from, sender, command, args, msg);
        }

        // Status features
        if (msg.message?.viewOnceMessage) {
            await handleViewOnce(sock, msg);
        }

        // Other commands
        switch(command) {
            case 'joinchannel':
                await sock.sendMessage(from, {
                    text: '📢 *Join Our Official Channel* 📢\n\nClick the button below to join our official channel for updates and announcements!',
                    templateButtons: [
                        { urlButton: { displayText: '📢 Join Channel', url: 'https://whatsapp.com/channel/0029VbBv1fxBKfi72JZzbz3u' }}
                    ]
                });
                break;
                
            case 'menu':
            case 'help':
                await showMenu(sock, from);
                break;

            case 'ping':
                await handlePing(sock, from);
                break;

            case 'antidelete':
                await toggleAntiDelete(sock, from, isSenderAdmin);
                break;

            case 'info':
                await showBotInfo(sock, from);
                break;

            case 'time':
                await showCurrentTime(sock, from);
                break;
                
            case 'vv':
                await handleViewOnceRetrieve(sock, from, msg);
                break;
                
            case 'autoviewstatus':
                await toggleAutoViewStatus(sock, from, sender);
                break;
                
            case 'autoreactstatus':
                await toggleAutoReactStatus(sock, from, sender);
                break;
                
            case 'tostatus':
                await handleToStatus(sock, from, msg);
                break;
                
            case 'autoreact':
                await toggleAutoReact(sock, from, sender);
                break;
                
            case 'autotyping':
                await toggleAutoTyping(sock, from, sender);
                break;
                
            case 'autorecording':
                await toggleAutoRecording(sock, from, sender);
                break;
                
            case 'getpp':
                await handleGetProfilePicture(sock, from, msg);
                break;
                
            case 'repo':
                await sock.sendMessage(from, {
                    text: '📂 *Bot Repository*\n\n🔗 https://github.com/lenvartica/decan-mini-bot\n\n⭐ Star the repo if you like it!',
                    detectLinks: true
                });
                break;
                
            case 'sudo':
                await listAdmins(sock, from);
                break;
                
            case 'addsudo':
                await addAdmin(sock, from, args[0], sender);
                break;
                
            case 'pair':
                await handlePairDevice(sock, from, args[0], sender);
                break;
                
            case 'delete':
                await deleteMessage(sock, from, msg, isBotAdmin);
                break;
                
            case 'speed':
                const startTime = Date.now();
                await sock.sendMessage(from, { text: '🏃 Testing bot speed...' });
                const endTime = Date.now();
                const responseTime = endTime - startTime;
                await sock.sendMessage(from, { 
                    text: `⚡ *Bot Speed Test*\\n\\n📊 Response Time: ${responseTime}ms\\n🚀 Status: ${responseTime < 500 ? 'Excellent' : responseTime < 1000 ? 'Good' : 'Needs improvement'}` 
                });
                break;
                
            case 'owner':
                await sock.sendMessage(from, { 
                    text: `👑 *Bot Owner Information*\\n\\n📱 *Number:* +254103305583\\n👤 *Name:* Decan\\n🌐 *GitHub:* https://github.com/lenvartica\\n📢 *Channel:* https://whatsapp.com/channel/0029VbBv1fxBKfi72JZzbz3u\\n\\n💬 *Need help? Contact the owner!*` 
                });
                break;
                
            case 'donate':
                await sock.sendMessage(from, { 
                    text: `💖 *Support the Bot*\\n\\n🙏 Thank you for your interest in supporting Decan Bot!\\n\\n💳 *Donate via:*\\n• https://saweria.co/lenny\\n\\n🎁 *Your support helps us:*\\n• Keep the bot running 24/7\\n• Add new features\\n• Improve performance\\n\\n❤️ Every contribution counts!` 
                });
                break;
                
            case 'restart':
                if (!isOwner) {
                    await sock.sendMessage(from, { text: '❌ Only the bot owner can restart the bot!' });
                    return;
                }
                await sock.sendMessage(from, { text: '🔄 Restarting bot...' });
                setTimeout(() => process.exit(0), 1000);
                break;
                
            case 'status':
                const uptime = process.uptime();
                const hours = Math.floor(uptime / 3600);
                const minutes = Math.floor((uptime % 3600) / 60);
                const seconds = Math.floor(uptime % 60);
                const memoryUsage = process.memoryUsage();
                const memoryMB = Math.round(memoryUsage.heapUsed / 1024 / 1024);
                
                await sock.sendMessage(from, { 
                    text: `📊 *Bot Status*\\n\\n⏱️ *Uptime:* ${hours}h ${minutes}m ${seconds}s\\n💾 *Memory Usage:* ${memoryMB}MB\\n🔋 *Status:* Online\\n🤖 *Version:* 1.0.0\\n📱 *Connected:* Yes\\n\\n✅ Bot is running smoothly!` 
                });
                break;

            // Add more commands here as needed
            case 'shutdown':
                if (!isOwner) {
                    await sock.sendMessage(from, { text: 'Only owner can shutdown the bot!' }); return;
                }
                await sock.sendMessage(from, { text: 'Shutting down bot...' });
                await sock.disconnect?.();
                setTimeout(() => process.exit(0), 2000);
                break;

            case 'broadcast':
                if (!isOwner) {
                    await sock.sendMessage(from, { text: 'Only owner can broadcast!' }); return;
                }
                const bcText = args.join(' ');
                if (!bcText) {
                    await sock.sendMessage(from, { text: 'Please provide a message!' }); return;
                }
                const groups = Object.values(sock.chats).filter(c => c.id.endsWith('@g.us'));
                for (const group of groups) {
                    await sock.sendMessage(group.id, { text: `*BROADCAST*\n\n${bcText}` });
                }
                await sock.sendMessage(from, { text: `Broadcast sent to ${groups.length} groups!` });
                break;

            case 'eval':
                if (!isOwner) {
                    await sock.sendMessage(from, { text: 'Only owner can use eval!' }); return;
                }
                if (!args.length) {
                    await sock.sendMessage(from, { text: 'Please provide code!' }); return;
                }
                try {
                    const code = args.join(' ');
                    const result = await (new Function(`return (async () => { ${code} })()`))();
                    let output = typeof result === 'string' ? result : require('util').inspect(result, { depth: 1 });
                    output = output.slice(0, 4000);
                    await sock.sendMessage(from, { text: `*Result:*\n\`\`\`${output}\`\`\`` });
                } catch (err) {
                    await sock.sendMessage(from, { text: `*Error:*\n\`\`\`${err.message}\`\`\`` });
                }
                break;

            case 'backup':
                if (!isOwner) {
                    await sock.sendMessage(from, { text: 'Only owner can create backup!' }); return;
                }
                try {
                    const fs = require('fs');
                    const data = {
                        botAdmins: Array.from(state.botAdmins || []),
                        groups: state.groups || {},
                        timestamp: new Date().toISOString()
                    };
                    fs.writeFileSync('backup.json', JSON.stringify(data, null, 2));
                    await sock.sendMessage(from, { text: 'Backup created → backup.json' });
                } catch (e) {
                    await sock.sendMessage(from, { text: 'Backup failed!' });
                }
                break;

            case 'qr':
                try {
                    const QRCode = require('qrcode');
                    const text = args.join(' ') || 'https://github.com/lenvartica/decan-mini-bot';
                    const buffer = await QRCode.toBuffer(text);
                    await sock.sendMessage(from, { image: buffer, caption: `QR Code:\n${text}` });
                } catch {
                    await sock.sendMessage(from, { text: 'Failed to generate QR code!' });
                }
                break;

            case 'whois':
                const target = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || sender;
                try {
                    const { status, setAt } = await sock.fetchStatus(target);
                    const pp = await sock.profilePictureUrl(target, 'image').catch(() => null);
                    const info = `*User Info*\n\nNumber: ${target.split('@')[0]}\nStatus: ${status || 'None'}\nLast Updated: ${setAt ? new Date(setAt).toLocaleString() : 'Hidden'}`;
                    if (pp) {
                        await sock.sendMessage(from, { image: { url: pp }, caption: info });
                    } else {
                        await sock.sendMessage(from, { text: info });
                    }
                } catch {
                    await sock.sendMessage(from, { text: 'Could not fetch user info!' });
                }
                break;

            case 'joke':
                const jokes = [
                    "Why don't scientists trust atoms? Because they make up everything!",
                    "Why did the scarecrow win an award? He was outstanding in his field!",
                    "What do you call fake spaghetti? An impasta!",
                    "Why don't eggs tell jokes? They'd crack each other up!"
                ];
                await sock.sendMessage(from, { text: `*Joke*\n\n${jokes[Math.floor(Math.random() * jokes.length)]}` });
                break;

            case 'quote':
                const quotes = [
                    "Be yourself; everyone else is already taken. — Oscar Wilde",
                    "The only way to do great work is to love what you do. — Steve Jobs",
                    "Life is what happens when you're busy making plans. — John Lennon"
                ];
                await sock.sendMessage(from, { text: `*Quote*\n\n${quotes[Math.floor(Math.random() * quotes.length)]}` });
                break;

            case 'fact':
                const facts = [
                    "Octopuses have three hearts.",
                    "A day on Venus is longer than a year on Venus.",
                    "Honey never spoils."
                ];
                await sock.sendMessage(from, { text: `*Fact*\n\n${facts[Math.floor(Math.random() * facts.length)]}` });
                break;

            case 'shayari':
                const shayaris = [
                    "दिल की बात जुबाँ पर लाने लगी,\nजब से तुम्हें देखा है।",
                    "तेरी यादों में खोया रहता हूँ,\nहर पल बस तुझे सोचा करता हूँ।"
                ];
                await sock.sendMessage(from, { text: `*शायरी*\n\n${shayaris[Math.floor(Math.random() * shayaris.length)]}` });
                break;

            case 'play':
                if (!args.length) {
                    await sock.sendMessage(from, { text: 'Usage: play perfect ed sheeran' }); return;
                }
                await sock.sendMessage(from, { text: `Searching: ${args.join(' ')} 🎵\nComing soon...` });
                break;

            case 'dare':
                const dares = ["Do 10 push-ups!", "Sing out loud!", "Tell your crush you like them!"];
                await sock.sendMessage(from, { text: `*Dare*\n\n${dares[Math.floor(Math.random() * dares.length)]}` });
                break;

            case 'truth':
                const truths = ["What's your biggest fear?", "Who was your first crush?", "What's your most embarrassing moment?", "What's your biggest regret?"];
                await sock.sendMessage(from, { text: `*Truth*\n\n${truths[Math.floor(Math.random() * truths.length)]}` });
                break;

            case 'ip':
                try {
                    const ip = await fetch('https://api.ipify.org?format=json').then(res => res.json());
                    const ipInfo = await fetch(`http://ip-api.com/json/${ip.ip}`).then(res => res.json());
                    await sock.sendMessage(from, { 
                        text: `🌐 *IP Information*\n\n• *IP:* ${ipInfo.query}\n• *Country:* ${ipInfo.country}\n• *Region:* ${ipInfo.regionName}\n• *City:* ${ipInfo.city}\n• *ISP:* ${ipInfo.isp}` 
                    });
                } catch (e) {
                    await sock.sendMessage(from, { text: '❌ Failed to fetch IP information' });
                }
                break;

            case 'tts':
                if (!args.length) {
                    await sock.sendMessage(from, { text: '❌ Please provide text to convert to speech' });
                    return;
                }
                const text = args.join(' ');
                const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text)}&tl=en&client=tw-ob`;
                await sock.sendMessage(from, { audio: { url: ttsUrl }, mimetype: 'audio/mpeg' });
                break;

            case 'ship':
                if (args.length < 2) {
                    await sock.sendMessage(from, { text: '❌ Please mention two people to ship! Example: .ship @user1 @user2' });
                    return;
                }
                const lovePercent = Math.floor(Math.random() * 101);
                const shipEmoji = lovePercent > 80 ? '💖' : lovePercent > 50 ? '💕' : '💔';
                await sock.sendMessage(from, { 
                    text: `💘 *Love Calculator*\n\n${args[0]} ❤️ ${args[1]}\nLove: ${lovePercent}%\n${shipEmoji.repeat(Math.ceil(lovePercent/10))}${'🤍'.repeat(10-Math.ceil(lovePercent/10))}` 
                });
                break;

            case 'character':
                const characters = ['Warrior', 'Mage', 'Archer', 'Healer', 'Tank', 'Assassin'];
                const character = characters[Math.floor(Math.random() * characters.length)];
                const level = Math.floor(Math.random() * 100) + 1;
                const xp = Math.floor(Math.random() * 1000);
                await sock.sendMessage(from, { 
                    text: `🎮 *Character Info*\n\n• *Class:* ${character}\n• *Level:* ${level}\n• *XP:* ${xp}/1000\n• *HP:* ${level * 10}\n• *MP:* ${level * 5}` 
                });
                break;

            case 'simi':
                if (!args.length) {
                    await sock.sendMessage(from, { text: '❌ Please provide a message for Simi' });
                    return;
                }
                try {
                    const response = await fetch(`https://api.simsimi.net/v2/?text=${encodeURIComponent(args.join(' '))}&lc=en`);
                    const data = await response.json();
                    await sock.sendMessage(from, { text: `🤖 Simi: ${data.success || 'Hello! How can I help you?'}` });
                } catch (e) {
                    await sock.sendMessage(from, { text: '❌ Failed to get response from Simi' });
                }
                break;

            case 'calc':
                try {
                    const expression = args.join('');
                    const result = eval(expression);
                    await sock.sendMessage(from, { text: `🧮 *Calculator*\n\n*Expression:* ${expression}\n*Result:* ${result}` });
                } catch (e) {
                    await sock.sendMessage(from, { text: '❌ Invalid calculation' });
                }
                break;

            case 'greyscale':
            case 'circle':
            case 'blur':
            case 'invert':
                if (!msg.message.imageMessage) {
                    await sock.sendMessage(from, { text: '❌ Please send an image with this command' });
                    return;
                }
                await sock.sendMessage(from, { 
                    text: `🖼️ *Image Editor*\n\nThe ${command} filter has been applied to your image!\n\n*Note:* This is a placeholder. Actual image processing would be implemented with a library like Jimp or Sharp.` 
                });
                break;

            case 'setemoji':
                if (!isGroup) {
                    await sock.sendMessage(from, { text: '❌ This command only works in groups' });
                    return;
                }
                if (!isGroupAdmin) {
                    await sock.sendMessage(from, { text: '❌ You need to be an admin to use this command' });
                    return;
                }
                if (!args[0]) {
                    await sock.sendMessage(from, { text: '❌ Please provide an emoji' });
                    return;
                }
                await sock.groupUpdateSubject(from, `${args[0]} ${(await sock.groupMetadata(from)).subject}`.substring(0, 25));
                await sock.sendMessage(from, { text: `✅ Group emoji updated to ${args[0]}` });
                break;

            case 'autobio':
                const subCommand = args[0]?.toLowerCase();
                
                if (subCommand === 'on') {
                    // Start auto-bio updates
                    if (state.autoBioInterval) {
                        clearInterval(state.autoBioInterval);
                    }
                    state.autoBioInterval = setInterval(() => updateAutoBio(sock), 60000);
                    await updateAutoBio(sock); // Update immediately
                    await sock.sendMessage(from, { text: '✅ Auto-bio enabled! Your status will now update with the current time.' });
                } else if (subCommand === 'off') {
                    // Stop auto-bio updates
                    if (state.autoBioInterval) {
                        clearInterval(state.autoBioInterval);
                        state.autoBioInterval = null;
                    }
                    await sock.sendMessage(from, { text: '❌ Auto-bio disabled. Your status will no longer update automatically.' });
                } else {
                    // Show usage
                    await sock.sendMessage(from, { 
                        text: 'ℹ️ *Auto-bio Commands:*\n\n• `.autobio on` - Enable auto-updating status with time\n• `.autobio off` - Disable auto-updating status' 
                    });
                }
                break;

            case 'attp':
                if (!args[0]) {
                    await sock.sendMessage(from, { text: '❌ Please provide text' });
                    return;
                }
                const attpText = args.join(' ');
                try {
                    const attpUrl = `https://api.lolhuman.xyz/api/attp?apikey=${process.env.LOLHUMAN_API_KEY}&text=${encodeURIComponent(attpText)}`;
                    
                    // First try with the API
                    await sock.sendMessage(from, { 
                        sticker: { url: attpUrl },
                        mimetype: 'image/webp'
                    });
                } catch (error) {
                    console.error('Error with ATTP API:', error);
                    // Fallback to text if API fails
                    await sock.sendMessage(from, { 
                        text: `✨ *${attpText.toUpperCase()}*`,
                        contextInfo: {
                            mentionedJid: [sender],
                            isForwarded: true
                        }
                    });
                }
                break;

            case 'tr':
                if (args.length < 2) {
                    await sock.sendMessage(from, { text: '❌ Usage: .tr en Hello (translates to English)' });
                    return;
                }
                const [targetLang, ...textToTranslate] = args;
                const translation = await translate(textToTranslate.join(' '), { to: targetLang });
                await sock.sendMessage(from, { 
                    text: `🌐 *Translation*\n\n*From:* ${translation.from.language.iso}\n*To:* ${targetLang}\n\n*Original:* ${textToTranslate.join(' ')}\n*Translated:* ${translation.text}` 
                });
                break;

            case 'covid':
                try {
                    const covidData = await fetch('https://disease.sh/v3/covid-19/all').then(res => res.json());
                    await sock.sendMessage(from, {
                        text: `🦠 *COVID-19 Stats*\n\n• *Cases:* ${covidData.cases.toLocaleString()}\n• *Today's Cases:* ${covidData.todayCases.toLocaleString()}\n• *Deaths:* ${covidData.deaths.toLocaleString()}\n• *Recovered:* ${covidData.recovered.toLocaleString()}\n• *Active:* ${covidData.active.toLocaleString()}\n\n*Last Updated:* ${new Date(covidData.updated).toLocaleString()}`
                    });
                } catch (e) {
                    await sock.sendMessage(from, { text: '❌ Failed to fetch COVID-19 data' });
                }
                break;

            case 'github':
                if (!args[0]) {
                    await sock.sendMessage(from, { text: '❌ Please provide a GitHub username' });
                    return;
                }
                try {
                    const user = await fetch(`https://api.github.com/users/${args[0]}`).then(res => res.json());
                    if (user.message === 'Not Found') {
                        await sock.sendMessage(from, { text: '❌ User not found' });
                        return;
                    }
                    await sock.sendMessage(from, {
                        text: `👤 *GitHub Profile*\n\n*Name:* ${user.name || 'N/A'}\n*Username:* ${user.login}\n*Bio:* ${user.bio || 'N/A'}\n*Followers:* ${user.followers}\n*Following:* ${user.following}\n*Public Repos:* ${user.public_repos}\n\n[View Profile](${user.html_url})`,
                        detectLinks: true
                    });
                } catch (e) {
                    await sock.sendMessage(from, { text: '❌ Failed to fetch GitHub user' });
                }
                break;

            case 'weather':
                if (!args[0]) {
                    await sock.sendMessage(from, { text: '❌ Please provide a location' });
                    return;
                }
                try {
                    const weatherData = await fetch(`https://api.openweathermap.org/data/2.5/weather?q=${args[0]}&units=metric&appid=YOUR_API_KEY`).then(res => res.json());
                    if (weatherData.cod !== 200) {
                        throw new Error(weatherData.message);
                    }
                    await sock.sendMessage(from, {
                        text: `⛅ *Weather in ${weatherData.name}, ${weatherData.sys.country}*\n\n• *Temperature:* ${weatherData.main.temp}°C\n• *Feels Like:* ${weatherData.main.feels_like}°C\n• *Humidity:* ${weatherData.main.humidity}%\n• *Wind:* ${weatherData.wind.speed} m/s\n• *Description:* ${weatherData.weather[0].description}\n\n*Updated:* ${new Date().toLocaleTimeString()}`
                    });
                } catch (e) {
                    await sock.sendMessage(from, { text: `❌ Failed to get weather data: ${e.message}` });
                }
                break;

            default:
                await sock.sendMessage(from, {
                    text: '❌ Unknown command! Type *.menu* to see available commands.'
                });
        }
    } catch (error) {
        console.error(`Error in handleCommand (${command}):`, error);
        await sock.sendMessage(from, {
            text: '❌ An error occurred while processing your command. Please try again.'
        });
    }
}

async function showMenu(sock, to) {
    const menuText = `
╔═══════════════════════╗
🚀*DECAN XMD BOT MENU*🚀
╚═══════════════════════╝\n\n` +
    '┏━━━━━━━━━━━━━━━━━━━━━━━┓\n' +
    '┃🎭 *AI&IMAGE COMMANDS* ┃\n' +
    '┗━━━━━━━━━━━━━━━━━━━━━━━┛\n' +
    '│➤ .ai <query> - AI chat\n\n' +
    '│➽ .imagine <prompt> - Generate AI image\n' +
    '│➽ .emojimix <emoji1+emoji2> - Mix emojis\n' +
    '│➽ .toimg - Convert sticker to image\n' +
    '│➽ .sticker - Convert image to sticker\n' +
    '┏▣ ◈ 𝙼𝙴𝙳𝙸𝙰 & 𝙴𝙽𝚃𝙴𝚁𝚃𝙰𝙸𝙽𝙼𝙴𝙽𝚃 ◈\n' +
    '│➽ .play <song> - Play music\n' +
    '│➽ .lyrics <song> - Get song lyrics\n' +
    '│➽ .meme - Random meme\n' +
    '│➽ .joke - Random joke\n' +
    '│➽ .quote - Random quote\n\n' +
    '┏━━━━━━━━━━━━━━━━━━━━━┓\n' +
    '┃🎮 *FUN & GAMES*     ┃\n' +
    '┗━━━━━━━━━━━━━━━━━━━━━┛\n' +
    '│➽ .fact - Random fact\n' +
    '│➽ .dare - Random dare\n' +
    '│➽ .shayari - Romantic shayari\n\n' +
    '┏━━━━━━━━━━━━━━━━━━━━━━┓\n' +
    '┃👥 *GROUP MANAGEMENT* ┃\n' +
    '┗━━━━━━━━━━━━━━━━━━━━━━┛\n' +
    '│➽ .add <number> - Add user\n' +
    '│➽ .kick @user - Remove user\n' +
    '│➽ .promote @user - Make admin\n' +
    '│➽ .demote @user - Remove admin\n' +
    '│➽ .mute <time> - Mute group\n' +
    '│➽ .unmute - Unmute group\n\n' +
    '│➽ .antilink - Toggle link protection\n' +
    '│➽ .antibadword - Toggle bad word filter\n' +
    '│➽ .antidelete - Toggle anti-delete\n' +
    '│➽ .tagall - Mention all members\n' +
    '│➽ .resetlink - Reset group link\n\n' +
    '┏━━━━━━━━━━━━━━━━━━━━━┓\n' +
    '┃ℹ️ *BOT INFO & UTILS*┃\n' +
    '┗━━━━━━━━━━━━━━━━━━━━━┛\n' +
    '│➽ .ping - Check bot status\n' +
    '│➽ .time - Current time\n' +
    '│➽ .owner - Bot owner info\n' +
    '│➽ .github <user> - GitHub info\n\n' +
    '│➽ .weather <city> - Weather info\n' +
    '│➽ .covid <country> - COVID-19 stats\n' +
    '│➽ .tr <lang> <text> - Translate\n\n' +
    '┏━━━━━━━━━━━━━━━━━━━━━━━┓\n' +
    '┃🎨 *STICKERS & EFFECTS*┃\n' +
    '┗━━━━━━━━━━━━━━━━━━━━━━━┛\n' +
    '│➽ .attp <text> - Text to sticker\n' +
    '│➽ .semoji <emoji> - Emoji sticker\n' +
    '│➽ .blur - Blur image\n' +
    '│➽ .circle - Circle image\n' +
    '│➽ .invert - Invert colors\n' +
    '│➽ .greyscale - Greyscale image\n\n' +
    '┏▣ ◈ ►►►◄◄◄𝚄𝚃𝙸𝙻𝙸𝚃𝙸𝙴𝚂►►►◄◄◄ ◈\n' +
    '│➽ .tts <text> - Text to speech\n' +
    '│➽ .qr <text> - Generate QR code\n' +
    '│➽ .calc <expression> - Calculator\n' +
    '│➽ .shorturl <url> - Shorten URL\n' +
    '│➽ .whois <domain> - Domain info\n' +
    '│➽ .ip <ip> - IP lookup\n' +
    '┏▣ ◈ ►►►◄◄◄𝙵𝚄𝙽 & 𝙶𝙰𝙼𝙴𝚂►►►◄◄◄ ◈\n' +
    '│➽ .ship <@user1> <@user2> - Ship users\n' +
    '│➽ .pair <@user> - Pair with user\n' +
    '│➽ .character <name> - Character info\n' +
    '│➽ .hangman - Play hangman\n' +
    '│➽ .tictactoe - Play Tic Tac Toe\n' +
    '│➽ .simi <text> - Chat with Simsimi\n' +
    '┏▣ ◈ ►►►◄◄◄𝙾𝚆𝙽𝙴𝚁 𝙾𝙽𝙻𝚈►►►◄◄◄ ◈\n' +
    '│➽ .eval <code> - Execute code\n' +
    '│➽ .exec <command> - Execute shell\n' +
    '│➽ .backup - Backup database\n' +
    '│➽ .restart - Restart bot\n' +
    '│➽ .shutdown - Shutdown bot\n' +
    '│➽ .broadcast <text> - Broadcast\n' +
    '┏▣ ◈ ►►►◄◄◄𝙱𝙾𝚃 𝙸𝙽𝙵𝙾►►►◄◄◄ ◈\n' +
    '│➽ .menu - Show this menu\n' +
    '│➽ .help - Show help\n' +
    '│➽ .speed - Bot speed test\n' +
    '│➽ .status - Bot status\n' +
    '│➽ .donate - Support the bot\n' +
    '┏▣ ◈ ►►►◄◄◄𝙲𝙾𝙽𝚃𝙰𝙲𝚃 & 𝚂𝚄𝙿𝙿𝙾𝚁𝚃►►►◄◄◄ ◈\n' +
    '│📱 Owner: +254103305583\n' +
    '│🌐 Support Group: https://chat.whatsapp.com/GC8GGZa4FeIHP1Wz8iheV8\n' +
    '│📢 Channel: https://whatsapp.com/channel/0029VbBv1fxBKfi72JZzbz3u\n' +
    '│💻 GitHub: https://github.com/lenvartica\n' +
    '│💖 Donate: https://saweria.co/lenny\n' +
    '┗▣\n\n' +
    '►►►►►►►►►►►►►►►►►►►►►◄◄◄◄◄◄◄◄◄◄◄◄◄◄◄◄◄◄◄◄◄\n' +
    '> DECAN XMD\n' +
    '> https://whatsapp.com/channel/0029VbBv1fxBKfi72JZzbz3u';

    try {
        // Send image and menu text in one message
        await sock.sendMessage(to, { 
            image: { url: 'decan.jpg' },
            caption: `🚀 *WELCOME TO DECAN XMD BOT* 🚀

${menuText}`,
            ...channelInfo
        });
    } catch (error) {
        console.error('Error sending menu:', error);
    }
}

async function handlePing(sock, from) {
    const start = Date.now();
    await sock.sendMessage(from, { 
        text: '►►►◄◄◄Pong! 🏓►►►◄◄◄' 
    });
    const latency = Date.now() - start;
    await sock.sendMessage(from, { 
        text: `🏓 Pong! Response time: *${latency}ms*` 
    });
}

async function toggleAntiDelete(sock, from, isAdmin) {
    if (!isAdmin) {
        return await sock.sendMessage(from, { 
            text: '❌ You need to be an admin to use this command!' 
        });
    }

    const config = loadAntideleteConfig();
    
    if (config.enabled) {
        config.enabled = false;
        saveAntideleteConfig(config);
        return await sock.sendMessage(from, { 
            text: '❌ Anti-delete has been disabled.' 
        });
    } else {
        config.enabled = true;
        saveAntideleteConfig(config);
        return await sock.sendMessage(from, { 
            text: '✅ Anti-delete has been enabled. Deleted messages will be retrieved.' 
        });
    }
}

// Status feature handlers
async function handleViewOnceRetrieve(sock, from, msg) {
    if (!msg.quoted || !statusSettings.viewOnceCache.has(msg.quoted.id)) {
        return await sock.sendMessage(from, {
            text: '❌ No view once message found. Please reply to a view once message.'
        });
    }
    
    const message = statusSettings.viewOnceCache.get(msg.quoted.id);
    await sock.sendMessage(from, {
        ...message,
        viewOnce: false
    });
    
    // Clear from cache after viewing
    statusSettings.viewOnceCache.delete(msg.quoted.id);
}

async function toggleAutoViewStatus(sock, from, sender) {
    if (statusSettings.autoView.has(sender)) {
        statusSettings.autoView.delete(sender);
        await sock.sendMessage(from, {
            text: '❌ Auto-view status disabled.'
        });
    } else {
        statusSettings.autoView.add(sender);
        await sock.sendMessage(from, {
            text: '✅ Auto-view status enabled. I will automatically view all status updates.'
        });
    }
}

async function toggleAutoReactStatus(sock, from, sender) {
    if (statusSettings.autoReact.has(sender)) {
        statusSettings.autoReact.delete(sender);
        await sock.sendMessage(from, {
            text: '❌ Auto-react to status disabled.'
        });
    } else {
        statusSettings.autoReact.add(sender);
        await sock.sendMessage(from, {
            text: '✅ Auto-react to status enabled. I will react to all status updates.'
        });
    }
}

async function handleToStatus(sock, from, msg) {
    if (!msg.message?.imageMessage && !msg.message?.videoMessage) {
        return await sock.sendMessage(from, {
            text: '❌ Please send an image or video with the command.'
        });
    }
    
    try {
        // Forward the media to status
        const media = await sock.downloadMediaMessage(msg);
        await sock.updateProfilePicture('status@broadcast', media);
        await sock.sendMessage(from, {
            text: '✅ Successfully updated your status!'
        });
    } catch (error) {
        console.error('Error updating status:', error);
        await sock.sendMessage(from, {
            text: '❌ Failed to update status. Please try again.'
        });
    }
}

async function showBotInfo(sock, from) {
    const infoText = `🤖 *Bot Information*
►►►►►►►►►►►►►►►◄◄◄◄◄◄◄◄◄◄◄◄◄◄◄
• *Version*: 2.0.0
• *Uptime*: ${formatUptime(process.uptime())}
• *Memory Usage*: ${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)}MB
• *Node.js*: ${process.version}
• *Platform*: ${process.platform}
►►►►►►►►►►►►►►►◄◄◄◄◄◄◄◄◄◄◄◄◄◄◄
👨‍💻 *Developer*: Lenny Decan
📞 *WhatsApp*: +254103305583
📧 *Email*: lennymuriuki7@gmail.com

🔗 *Support Groups*:
• https://chat.whatsapp.com/GC8GGZa4FeIHP1Wz8iheV8
• https://chat.whatsapp.com/JCIpz9XkxsTCIvi0Gg8WEE

🌐 *Official Channel*:
https://whatsapp.com/channel/0029VbBv1fxBKfi72JZzbz3u`;

    await sock.sendMessage(from, { text: infoText });
}

async function showCurrentTime(sock, to) {
    const now = new Date();
    const timeString = now.toLocaleTimeString('en-US', {
        timeZone: 'Africa/Nairobi',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
    });

    const dateString = now.toLocaleDateString('en-US', {
        timeZone: 'Africa/Nairobi',
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });

    await sock.sendMessage(to, {
        text: `🕒 *Current Time*: ${timeString}\n📅 *Date*: ${dateString}`
    });
}

function formatUptime(seconds) {
    const days = Math.floor(seconds / (3600 * 24));
    const hours = Math.floor((seconds % (3600 * 24)) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    const parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);

    return parts.join(' ');
}

async function handleGroupCommand(sock, from, sender, command, args, msg) {
    const isGroup = from.endsWith('@g.us');
    if (!isGroup) {
        return await sock.sendMessage(from, { 
            text: "❌ This command can only be used in groups!" 
        });
    }

    const { isSenderAdmin: isUserAdmin } = await checkAdmin(sock, from, sender);
    const adminRequired = ['add', 'promote', 'demote', 'kick', 'desc', 'name', 'settings', 'antilink'].includes(command);
    if (adminRequired && !isUserAdmin) {
        return await sock.sendMessage(from, {
            text: "❌ You need to be an admin to use this command!"
        });
    }

    try {
        switch(command) {
            case 'add':
                if (args.length === 0) {
                    return await sock.sendMessage(from, {
                        text: "❌ Please provide a phone number to add (e.g., .add 1234567890)"
                    });
                }
                try {
                    const number = args[0].replace(/[^0-9]/g, '') + '@s.whatsapp.net';
                    await sock.groupParticipantsUpdate(from, [number], 'add');
                    await sock.sendMessage(from, {
                        text: `✅ Successfully added ${number} to the group!`
                    });
                } catch (error) {
                    console.error('Error adding participant:', error);
                    await sock.sendMessage(from, {
                        text: "❌ Failed to add participant. Please check the number and try again."
                    });
                }
                break;

            case 'promote':
                if (msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.length > 0) {
                    const mentioned = msg.message.extendedTextMessage.contextInfo.mentionedJid[0];
                    try {
                        await sock.groupParticipantsUpdate(from, [mentioned], 'promote');
                        await sock.sendMessage(from, {
                            text: `✅ Successfully promoted @${mentioned.split('@')[0]} to admin!`,
                            mentions: [mentioned]
                        });
                    } catch (error) {
                        console.error('Error promoting user:', error);
                        await sock.sendMessage(from, {
                            text: "❌ Failed to promote user. They may already be an admin."
                        });
                    }
                } else {
                    await sock.sendMessage(from, {
                        text: "❌ Please mention a user to promote (e.g., @username)"
                    });
                }
                break;

            case 'demote':
                if (msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.length > 0) {
                    const mentioned = msg.message.extendedTextMessage.contextInfo.mentionedJid[0];
                    try {
                        await sock.groupParticipantsUpdate(from, [mentioned], 'demote');
                        await sock.sendMessage(from, {
                            text: `✅ Successfully demoted @${mentioned.split('@')[0]}`,
                            mentions: [mentioned]
                        });
                    } catch (error) {
                        console.error('Error demoting user:', error);
                        await sock.sendMessage(from, {
                            text: "❌ Failed to demote user. They may not be an admin."
                        });
                    }
                } else {
                    await sock.sendMessage(from, {
                        text: "❌ Please mention an admin to demote (e.g., @username)"
                    });
                }
                break;

            case 'kick':
                if (msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.length > 0) {
                    const mentioned = msg.message.extendedTextMessage.contextInfo.mentionedJid[0];
                    try {
                        await sock.groupParticipantsUpdate(from, [mentioned], 'remove');
                        await sock.sendMessage(from, {
                            text: `👢 @${mentioned.split('@')[0]} has been kicked from the group!`,
                            mentions: [mentioned]
                        });
                    } catch (error) {
                        console.error('Error kicking user:', error);
                        await sock.sendMessage(from, {
                            text: "❌ Failed to kick user. They may be an admin or the group creator."
                        });
                    }
                } else {
                    await sock.sendMessage(from, {
                        text: "❌ Please mention a user to kick (e.g., @username)"
                    });
                }
                break;

            case 'invite':
                try {
                    const inviteCode = await sock.groupInviteCode(from);
                    const inviteLink = `https://chat.whatsapp.com/${inviteCode}`;
                    await sock.sendMessage(from, {
                        text: `📨 Group invite link:\n${inviteLink}`
                    });
                } catch (error) {
                    console.error('Error generating invite link:', error);
                    await sock.sendMessage(from, {
                        text: "❌ Failed to generate invite link. I may not have the necessary permissions."
                    });
                }
                break;

            case 'desc':
                if (args.length === 0) {
                    return await sock.sendMessage(from, {
                        text: "❌ Please provide a description for the group"
                    });
                }
                try {
                    const newDesc = args.join(' ');
                    await sock.groupUpdateDescription(from, newDesc);
                    await sock.sendMessage(from, {
                        text: `✅ Group description has been updated!`
                    });
                } catch (error) {
                    console.error('Error updating group description:', error);
                    await sock.sendMessage(from, {
                        text: "❌ Failed to update group description."
                    });
                }
                break;

            case 'name':
                if (args.length === 0) {
                    return await sock.sendMessage(from, {
                        text: "❌ Please provide a new name for the group"
                    });
                }
                try {
                    const newName = args.join(' ');
                    await sock.groupUpdateSubject(from, newName);
                    await sock.sendMessage(from, {
                        text: `✅ Group name has been updated to: ${newName}`
                    });
                } catch (error) {
                    console.error('Error updating group name:', error);
                    await sock.sendMessage(from, {
                        text: "❌ Failed to update group name."
                    });
                }
                break;

            case 'settings':
                const settingsMenu = `====⚙️ *Group Settings*====\n
• .add <number> - Add someone to the group
• .promote @user - Make someone admin
• .demote @user - Remove admin rights
• .kick @user - Remove someone from group
• .invite - Get group invite link
• .desc <text> - Set group description
• .name <text> - Change group name
• .antilink - Toggle anti-link protection
• .tagall - Mention all group members
• .listactive - Show most active members
• .listinactive - Show inactive members
• .settings - Show this menu
https://whatsapp.com/channel/0029VbBv1fxBKfi72JZzbz3u`;
                
                await sock.sendMessage(from, { text: settingsMenu });
                break;

            case 'antilink':
                if (state.antiLinkGroups.has(from)) {
                    state.antiLinkGroups.delete(from);
                    await sock.sendMessage(from, {
                        text: '❌ Anti-link has been disabled in this group.'
                    });
                } else {
                    state.antiLinkGroups.add(from);
                    await sock.sendMessage(from, {
                        text: '✅ Anti-link has been enabled in this group. Links will be deleted and users will be warned.'
                    });
                }
                break;

            case 'tagall':
                try {
                    const groupMetadata = await sock.groupMetadata(from);
                    const participants = groupMetadata.participants;
                    const mentions = [];
                    let text = '';
                    
                    for (const participant of participants) {
                        if (!participant.id.endsWith('@s.whatsapp.net')) continue;
                        mentions.push(participant.id);
                        text += `@${participant.id.split('@')[0]} `;
                    }
                    
                    await sock.sendMessage(from, {
                        text: text.trim(),
                        mentions: mentions
                    });
                } catch (error) {
                    console.error('Error in tagall:', error);
                    await sock.sendMessage(from, {
                        text: '❌ Failed to tag all members.'
                    });
                }
                break;

            case 'listactive':
                try {
                    const groupActivity = state.memberActivity.get(from);
                    if (!groupActivity || groupActivity.size === 0) {
                        return await sock.sendMessage(from, {
                            text: 'No activity data available for this group yet.'
                        });
                    }
                    
                    const sorted = Array.from(groupActivity.entries())
                        .sort((a, b) => b[1] - a[1])
                        .slice(0, 10);
                    
                    let text = '🏆 *Most Active Members* 🏆\n\n';
                    for (const [userId, count] of sorted) {
                        text += `@${userId}: ${count} messages\n`;
                    }
                    
                    await sock.sendMessage(from, {
                        text: text.trim(),
                        mentions: sorted.map(([userId]) => `${userId}@s.whatsapp.net`)
                    });
                } catch (error) {
                    console.error('Error in listactive:', error);
                    await sock.sendMessage(from, {
                        text: '❌ Failed to get active members list.'
                    });
                }
                break;

            case 'listinactive':
                try {
                    const groupMetadata = await sock.groupMetadata(from);
                    const groupActivity = state.memberActivity.get(from) || new Map();
                    const inactiveMembers = [];

                    for (const participant of groupMetadata.participants) {
                        const userId = participant.id.split('@')[0];
                        if (!groupActivity.has(userId) && participant.id.endsWith('@s.whatsapp.net')) {
                            inactiveMembers.push(participant.id);
                        }
                    }

                    if (inactiveMembers.length === 0) {
                        return await sock.sendMessage(from, {
                            text: 'All members have sent messages in this group.'
                        });
                    }

                    let text = '😴 *Inactive Members* (no messages)\n\n';
                    for (const member of inactiveMembers) {
                        text += `@${member.split('@')[0]}\n`;
                    }

                    await sock.sendMessage(from, {
                        text: text.trim(),
                        mentions: inactiveMembers
                    });
                } catch (error) {
                    console.error('Error in listinactive:', error);
                    await sock.sendMessage(from, {
                        text: '❌ Failed to get inactive members list.'
                    });
                }
                break;

            default:
                await sock.sendMessage(from, { text: '❌ Unknown group command.' });
        }
    } catch (error) {
        console.error('Error in handleGroupCommand:', error);
        await sock.sendMessage(from, {
            text: "❌ An error occurred while processing your command. Please try again."
        });
    }
}

// Function to update bio with current time in EAT
async function updateAutoBio(sock) {
    try {
        const options = {
            timeZone: 'Africa/Nairobi', // East Africa Time (EAT)
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
        };
        
        const timeString = new Date().toLocaleTimeString('en-US', options);
        const bio = `DECAN XMD Online (${timeString} EAT)`;
        
        // Try updating both status and profile name to ensure it works
        try {
            // Update status (if available in the API)
            if (sock.updateProfileStatus) {
                await sock.updateProfileStatus(bio);
            }
            
            // Also update profile name as a fallback
            await sock.updateProfileName('DECAN XMD');
            
            // Log the update
            console.log('Updated status to:', bio);
        } catch (updateError) {
            console.error('Error updating profile:', updateError);
            throw updateError; // Re-throw to be caught by the outer catch
        }
    } catch (error) {
        console.error('Error in updateAutoBio:', error);
    }
}

// Start the app
async function main() {
    try {
        const sock = await startBot();
        
        // Auto-bio is now controlled by the .autobio command
        // It won't start automatically on bot startup
    } catch (error) {
        console.error('Failed to start bot:', error);
        process.exit(1);
    }
}

// List all bot admins
async function listAdmins(sock, to) {
    try {
        const admins = Array.from(state.botAdmins);
        let message = '👑 *Bot Admins*\n\n';
        
        if (admins.length === 0) {
            message += 'No admins configured yet. Use .addsudo to add an admin.';
        } else {
            message += admins.map(admin => `• ${admin}`).join('\n');
        }
        
        await sock.sendMessage(to, { text: message });
    } catch (error) {
        console.error('Error in listAdmins:', error);
        await sock.sendMessage(to, { 
            text: '❌ An error occurred while fetching admin list.' 
        });
    }
}

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    console.error('🚨 Uncaught Exception:', error);
    // Attempt to restart after error
    setTimeout(() => process.exit(1), 1000);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
    console.error('🚨 Unhandled Rejection at:', promise, 'reason:', reason);
});

// Handle process termination
process.on('SIGINT', () => {
    console.log('\n🛑 Received SIGINT. Shutting down gracefully...');
    process.exit(0);
});

// Start the bot
console.log('🚀 Starting WhatsApp Bot...');
main().catch(err => {
    console.error('❌ Unhandled error in main:', err);
    // Attempt to restart after error
    setTimeout(() => process.exit(1), 1000);
});
