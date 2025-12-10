async function isGroupAdmin(sock, group, user) {
    try {
        const g = await sock.groupMetadata(group);
        return g.participants.some(p => p.id === user && ['admin', 'superadmin'].includes(p.admin));
    } catch (error) {
        console.error('Error checking group admin status:', error);
        return false;
    }
}

async function isAdmin(sock, chatId, senderId) {
    try {
        const isSenderAdmin = await isGroupAdmin(sock, chatId, senderId);
        const isBotAdmin = sock.user?.id ? await isGroupAdmin(sock, chatId, sock.user.id) : false;
        
        return {
            isSenderAdmin,
            isBotAdmin
        };
    } catch (error) {
        console.error('Error checking admin status:', error);
        return {
            isSenderAdmin: false,
            isBotAdmin: false
        };
    }
}

module.exports = isAdmin;
