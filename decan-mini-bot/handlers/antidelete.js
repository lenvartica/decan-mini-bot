const fs = require('fs');
const path = require('path');
const { tmpdir } = require('os');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const { writeFile } = require('fs/promises');

const messageStore = new Map();
const CONFIG_PATH = path.join(__dirname, '../data/antidelete.json');
const TEMP_MEDIA_DIR = path.join(tmpdir(), 'decan-bot-media');

// Ensure directories exist
if (!fs.existsSync(path.dirname(CONFIG_PATH))) {
    fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
}

if (!fs.existsSync(TEMP_MEDIA_DIR)) {
    fs.mkdirSync(TEMP_MEDIA_DIR, { recursive: true });
}

// Load config
function loadAntideleteConfig() {
    try {
        if (!fs.existsSync(CONFIG_PATH)) {
            return { enabled: false };
        }
        return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    } catch (error) {
        console.error('Error loading antidelete config:', error);
        return { enabled: false };
    }
}

// Save config
function saveAntideleteConfig(config) {
    try {
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
        return true;
    } catch (error) {
        console.error('Error saving antidelete config:', error);
        return false;
    }
}

// Clean up old media files
async function cleanupOldMedia() {
    try {
        const files = fs.readdirSync(TEMP_MEDIA_DIR);
        const now = Date.now();
        const maxAge = 24 * 60 * 60 * 1000; // 24 hours

        for (const file of files) {
            const filePath = path.join(TEMP_MEDIA_DIR, file);
            const stats = fs.statSync(filePath);
            
            if (now - stats.mtimeMs > maxAge) {
                fs.unlinkSync(filePath);
            }
        }
    } catch (error) {
        console.error('Error cleaning up old media:', error);
    }
}

// Schedule cleanup
setInterval(cleanupOldMedia, 60 * 60 * 1000); // Run every hour

// Command handler
async function handleAntideleteCommand(sock, chatId, message, match) {
    if (!message.key.fromMe) {
        return await sock.sendMessage(chatId, { 
            text: '*❌ Only the bot owner can use this command.*' 
        });
    }

    const config = loadAntideleteConfig();

    if (!match) {
        return await sock.sendMessage(chatId, {
            text: `*🔒 ANTIDELETE SETTINGS*\n\n` +
                  `Status: ${config.enabled ? '✅ Enabled' : '❌ Disabled'}\n\n` +
                  `*Usage:*\n` +
                  `• ${process.env.PREFIX || '.'}antidelete on - Enable anti-delete\n` +
                  `• ${process.env.PREFIX || '.'}antidelete off - Disable anti-delete`
        });
    }

    if (match.toLowerCase() === 'on') {
        config.enabled = true;
    } else if (match.toLowerCase() === 'off') {
        config.enabled = false;
    } else {
        return await sock.sendMessage(chatId, { 
            text: '*❌ Invalid command. Use .antidelete to see usage.*' 
        });
    }

    const success = saveAntideleteConfig(config);
    if (success) {
        await sock.sendMessage(chatId, { 
            text: `*✅ Anti-delete has been ${config.enabled ? 'enabled' : 'disabled'}*` 
        });
    } else {
        await sock.sendMessage(chatId, { 
            text: '*❌ Failed to update anti-delete settings. Check logs for details.*' 
        });
    }
}

// Store incoming messages
async function storeMessage(message) {
    try {
        const config = loadAntideleteConfig();
        if (!config.enabled) return;

        if (!message.key?.id) return;

        const messageId = message.key.id;
        const chatId = message.key.remoteJid;
        const sender = message.key.participant || message.key.remoteJid;
        
        let content = '';
        let mediaType = '';
        let mediaPath = '';

        // Extract message content
        if (message.message?.conversation) {
            content = message.message.conversation;
        } else if (message.message?.extendedTextMessage?.text) {
            content = message.message.extendedTextMessage.text;
        } else if (message.message?.imageMessage) {
            mediaType = 'image';
            content = message.message.imageMessage.caption || '';
            const buffer = await downloadContentFromMessage(message.message.imageMessage, 'image');
            mediaPath = path.join(TEMP_MEDIA_DIR, `${messageId}.jpg`);
            await writeFile(mediaPath, buffer);
        } else if (message.message?.stickerMessage) {
            mediaType = 'sticker';
            const buffer = await downloadContentFromMessage(message.message.stickerMessage, 'sticker');
            mediaPath = path.join(TEMP_MEDIA_DIR, `${messageId}.webp`);
            await writeFile(mediaPath, buffer);
        } else if (message.message?.videoMessage) {
            mediaType = 'video';
            content = message.message.videoMessage.caption || '';
            const buffer = await downloadContentFromMessage(message.message.videoMessage, 'video');
            mediaPath = path.join(TEMP_MEDIA_DIR, `${messageId}.mp4`);
            await writeFile(mediaPath, buffer);
        } else if (message.message?.audioMessage) {
            mediaType = 'audio';
            const buffer = await downloadContentFromMessage(message.message.audioMessage, 'audio');
            mediaPath = path.join(TEMP_MEDIA_DIR, `${messageId}.mp3`);
            await writeFile(mediaPath, buffer);
        }

        // Only store if there's content or media
        if (content || mediaType) {
            messageStore.set(messageId, {
                content,
                mediaType,
                mediaPath,
                sender,
                chatId,
                timestamp: new Date().toISOString()
            });
        }
    } catch (error) {
        console.error('Error storing message:', error);
    }
}

// Handle message deletion
async function handleMessageRevocation(sock, revocationMessage) {
    try {
        const config = loadAntideleteConfig();
        if (!config.enabled) return;

        const messageId = revocationMessage.message?.protocolMessage?.key?.id;
        if (!messageId) return;

        const original = messageStore.get(messageId);
        if (!original) return;

        const deletedBy = revocationMessage.participant || revocationMessage.key.participant;
        if (!deletedBy) return;

        // Don't notify if the bot deleted the message
        if (deletedBy.includes(sock.user.id.split(':')[0])) {
            messageStore.delete(messageId);
            return;
        }

        const sender = original.sender;
        const senderName = sender.split('@')[0];
        const deleterName = deletedBy.split('@')[0];
        
        const time = new Date().toLocaleString('en-US', {
            timeZone: 'Africa/Nairobi',
            hour12: true,
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
        });

        let text = `*🚨 DELETED MESSAGE DETECTED*\n\n` +
                  `*👤 Sender:* @${senderName}\n` +
                  `*🗑️ Deleted By:* @${deleterName}\n` +
                  `*🕒 Time:* ${time}\n`;

        if (original.content) {
            text += `\n*💬 Message:*\n${original.content.substring(0, 1000)}`;
            if (original.content.length > 1000) text += '...';
        }

        // Send notification to the group where message was deleted
        if (original.chatId.endsWith('@g.us')) {
            await sock.sendMessage(original.chatId, {
                text,
                mentions: [deletedBy, sender]
            });

            // Send media if exists
            if (original.mediaType && original.mediaPath && fs.existsSync(original.mediaPath)) {
                try {
                    const mediaOptions = {
                        caption: `*📎 Deleted ${original.mediaType}*\nFrom: @${senderName}\nDeleted by: @${deleterName}`,
                        mentions: [sender, deletedBy]
                    };

                    switch (original.mediaType) {
                        case 'image':
                            await sock.sendMessage(original.chatId, {
                                image: { url: original.mediaPath },
                                ...mediaOptions
                            });
                            break;
                        case 'sticker':
                            await sock.sendMessage(original.chatId, {
                                sticker: { url: original.mediaPath },
                                ...mediaOptions
                            });
                            break;
                        case 'video':
                            await sock.sendMessage(original.chatId, {
                                video: { url: original.mediaPath },
                                ...mediaOptions
                            });
                            break;
                        case 'audio':
                            await sock.sendMessage(original.chatId, {
                                audio: { url: original.mediaPath },
                                ...mediaOptions
                            });
                            break;
                    }
                } catch (mediaError) {
                    console.error('Error sending media:', mediaError);
                    await sock.sendMessage(original.chatId, {
                        text: `⚠️ Failed to send deleted ${original.mediaType}. ${mediaError.message}`
                    });
                }

                // Clean up media file
                try {
                    fs.unlinkSync(original.mediaPath);
                } catch (err) {
                    console.error('Error deleting media file:', err);
                }
            }
        }

        // Clean up
        messageStore.delete(messageId);
    } catch (error) {
        console.error('Error handling message revocation:', error);
    }
}

module.exports = {
    handleAntideleteCommand,
    handleMessageRevocation,
    storeMessage,
    loadAntideleteConfig,
    saveAntideleteConfig
};
