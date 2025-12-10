const express = require('express');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const qrcode = require('qrcode');

const app = express();
const PORT = process.env.PORT || 3000;

// Serve static files
app.use(express.static('public'));
app.use(express.json());

// Store active codes (in production, use a database)
const activeCodes = new Map();

// API endpoint to generate a code
app.post('/api/generate-code', (req, res) => {
    const { phone } = req.body;
    
    if (!phone) {
        return res.status(400).json({ error: 'Phone number is required' });
    }
    
    // Generate a random 8-digit code
    const code = Math.floor(10000000 + Math.random() * 90000000).toString();
    
    // Store the code with a 1-hour expiration
    activeCodes.set(code, {
        phone,
        expiresAt: Date.now() + (60 * 60 * 1000) // 1 hour from now
    });
    
    // Clean up expired codes
    cleanupExpiredCodes();
    
    res.json({ code });
});

// API endpoint to verify a code
app.post('/api/verify-code', (req, res) => {
    const { code } = req.body;
    
    if (!code) {
        return res.status(400).json({ error: 'Code is required' });
    }
    
    const codeData = activeCodes.get(code);
    
    if (!codeData) {
        return res.status(404).json({ error: 'Invalid or expired code' });
    }
    
    if (Date.now() > codeData.expiresAt) {
        activeCodes.delete(code);
        return res.status(400).json({ error: 'Code has expired' });
    }
    
    // Code is valid, delete it so it can't be used again
    activeCodes.delete(code);
    
    res.json({ 
        success: true,
        phone: codeData.phone
    });
});

// Serve the main page
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

function cleanupExpiredCodes() {
    const now = Date.now();
    for (const [code, data] of activeCodes.entries()) {
        if (now > data.expiresAt) {
            activeCodes.delete(code);
        }
    }
}

// Start the server
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    
    // Open the default browser (Windows)
    try {
        exec(`start http://localhost:${PORT}`);
    } catch (error) {
        console.log(`Please open http://localhost:${PORT} in your browser`);
    }
});
