// API Server for AI Tutor - Powered by Google Gemini (Free!)
import express from 'express';
import cors from 'cors';
import { GoogleGenerativeAI } from '@google/generative-ai';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Initialize Google Gemini
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
let genAI = null;

if (GEMINI_API_KEY) {
    genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    console.log('✅ Google Gemini initialized');
} else {
    console.log('⚠️ No Gemini API key found. Using fallback mode.');
}

// Email verification storage
const pendingVerifications = new Map();
const verifiedEmails = new Map();

// Load existing verified emails
const VERIFIED_FILE = path.join(__dirname, 'verified-emails.json');
try {
    if (fs.existsSync(VERIFIED_FILE)) {
        const data = fs.readFileSync(VERIFIED_FILE, 'utf8');
        const saved = JSON.parse(data);
        saved.forEach(item => {
            if (typeof item === 'string') {
                verifiedEmails.set(item, { verifiedAt: Date.now(), remainingSessions: 10 });
            } else {
                verifiedEmails.set(item.email, item);
            }
        });
        console.log(`📧 Loaded ${verifiedEmails.size} verified emails`);
    }
} catch(e) {
    console.log('No existing verified emails file');
}

function saveVerifiedEmails() {
    const data = Array.from(verifiedEmails.entries()).map(([email, info]) => ({
        email,
        verifiedAt: info.verifiedAt,
        remainingSessions: info.remainingSessions,
        premium: info.premium || false
    }));
    fs.writeFileSync(VERIFIED_FILE, JSON.stringify(data, null, 2));
}

// ==================== AI TUTOR ENDPOINT ====================
app.post('/api/tutor', async (req, res) => {
    const { message, subject, conversationHistory, email } = req.body;
    
    if (!message) {
        return res.status(400).json({ error: 'No message provided' });
    }
    
    // Check free sessions
    if (email && verifiedEmails.has(email)) {
        const userData = verifiedEmails.get(email);
        if (!userData.premium && userData.remainingSessions <= 0) {
            return res.status(403).json({ 
                error: 'You have used all your free sessions. Please upgrade to Pro.',
                requiresUpgrade: true
            });
        }
    }
    
    // Use Gemini if available, otherwise fallback
    if (genAI) {
        try {
            const model = genAI.getGenerativeModel({ model: 'gemini-pro' });
            
            const systemPrompt = `You are a friendly, patient AI tutor. Help students learn ${subject || 'any subject'}.
                                  Use simple language, give examples, and be encouraging.
                                  Break down complex topics step by step.
                                  Use emojis occasionally to keep it friendly.
                                  Keep explanations clear and concise (under 200 words).
                                  If the student is struggling, offer hints.
                                  Format your response with bullet points or numbered steps when helpful.`;
            
            let context = '';
            if (conversationHistory && conversationHistory.length > 0) {
                const recentMessages = conversationHistory.slice(-4);
                context = recentMessages.map(msg => `${msg.role === 'user' ? 'Student' : 'Tutor'}: ${msg.content}`).join('\n') + '\n';
            }
            
            const prompt = `${systemPrompt}\n\n${context}Student: ${message}\n\nTutor:`;
            
            const result = await model.generateContent(prompt);
            const reply = result.response.text();
            
            // Deduct session
            if (email && verifiedEmails.has(email)) {
                const userData = verifiedEmails.get(email);
                if (!userData.premium && userData.remainingSessions > 0) {
                    userData.remainingSessions--;
                    verifiedEmails.set(email, userData);
                    saveVerifiedEmails();
                }
            }
            
            res.json({ reply });
            
        } catch (error) {
            console.error('Gemini error:', error);
            res.status(500).json({ error: 'AI tutor temporarily unavailable. Please try again.' });
        }
    } else {
        // Fallback responses (no API key)
        const fallbackResponses = {
            'math': "I can help with math! What specific topic? Algebra, calculus, geometry, or statistics?",
            'physics': "Physics is fascinating! Are you studying mechanics, thermodynamics, or quantum physics?",
            'chemistry': "Chemistry is all around us! Need help with organic chemistry, reactions, or the periodic table?",
            'biology': "Biology is the study of life. What topic interests you - cells, genetics, or anatomy?",
            'history': "History helps us understand today. Which period are you studying?",
            'default': "I'm your AI Tutor! I can help with math, science, history, languages, and more. What would you like to learn?"
        };
        
        const subjectKey = (subject || '').toLowerCase();
        const reply = fallbackResponses[subjectKey] || fallbackResponses.default;
        
        res.json({ reply });
    }
});

// ==================== EMAIL SUBSCRIPTION ====================
app.post('/api/subscribe', async (req, res) => {
    const { email, source } = req.body;
    
    if (!email || !email.includes('@')) {
        return res.status(400).json({ error: 'Valid email address required' });
    }
    
    if (verifiedEmails.has(email)) {
        return res.status(400).json({ 
            error: 'Email already verified! You can start learning immediately.',
            alreadyVerified: true
        });
    }
    
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = Date.now() + 24 * 60 * 60 * 1000;
    
    pendingVerifications.set(token, {
        email,
        source,
        createdAt: Date.now(),
        expiresAt
    });
    
    const baseUrl = process.env.BASE_URL || 'https://universal-ai-tutor.onrender.com';
    const verifyUrl = `${baseUrl}/api/verify-email?token=${token}`;
    
    console.log(`\n📧 Verification for: ${email}`);
    console.log(`🔗 Link: ${verifyUrl}`);
    console.log(`⏰ Expires in 24 hours\n`);
    
    res.json({ 
        success: true, 
        message: 'Verification link created!',
        debugUrl: verifyUrl
    });
});

// ==================== EMAIL VERIFICATION ====================
app.get('/api/verify-email', (req, res) => {
    const { token } = req.query;
    
    if (!token) {
        return res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Email Verification</title>
                <style>
                    body {
                        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                        text-align: center;
                        padding: 50px;
                        background: linear-gradient(135deg, #667eea, #764ba2);
                        color: white;
                        min-height: 100vh;
                        margin: 0;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                    }
                    .container {
                        max-width: 500px;
                        background: rgba(255,255,255,0.15);
                        padding: 40px;
                        border-radius: 24px;
                    }
                    h1 { font-size: 2rem; margin-bottom: 1rem; }
                    .btn {
                        display: inline-block;
                        background: white;
                        color: #6366f1;
                        padding: 12px 24px;
                        border-radius: 8px;
                        text-decoration: none;
                        margin-top: 20px;
                        font-weight: bold;
                    }
                </style>
            </head>
            <body>
                <div class="container">
                    <h1>❌ Invalid Link</h1>
                    <p>The verification link is missing.</p>
                    <a href="https://innocent200509.github.io/Universal-AI-Tutor/" class="btn">Back to AI Tutor</a>
                </div>
            </body>
            </html>
        `);
    }
    
    const verification = pendingVerifications.get(token);
    
    if (!verification) {
        return res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Email Verification</title>
                <style>
                    body {
                        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                        text-align: center;
                        padding: 50px;
                        background: linear-gradient(135deg, #667eea, #764ba2);
                        color: white;
                        min-height: 100vh;
                        margin: 0;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                    }
                    .container {
                        max-width: 500px;
                        background: rgba(255,255,255,0.15);
                        padding: 40px;
                        border-radius: 24px;
                    }
                    h1 { font-size: 2rem; margin-bottom: 1rem; }
                    .btn {
                        display: inline-block;
                        background: white;
                        color: #6366f1;
                        padding: 12px 24px;
                        border-radius: 8px;
                        text-decoration: none;
                        margin-top: 20px;
                        font-weight: bold;
                    }
                </style>
            </head>
            <body>
                <div class="container">
                    <h1>❌ Invalid or Expired Link</h1>
                    <p>This verification link is invalid or has expired.</p>
                    <a href="https://innocent200509.github.io/Universal-AI-Tutor/" class="btn">Subscribe Again</a>
                </div>
            </body>
            </html>
        `);
    }
    
    if (Date.now() > verification.expiresAt) {
        pendingVerifications.delete(token);
        return res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Email Verification</title>
                <style>
                    body {
                        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                        text-align: center;
                        padding: 50px;
                        background: linear-gradient(135deg, #667eea, #764ba2);
                        color: white;
                        min-height: 100vh;
                        margin: 0;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                    }
                    .container {
                        max-width: 500px;
                        background: rgba(255,255,255,0.15);
                        padding: 40px;
                        border-radius: 24px;
                    }
                    h1 { font-size: 2rem; margin-bottom: 1rem; }
                    .btn {
                        display: inline-block;
                        background: white;
                        color: #6366f1;
                        padding: 12px 24px;
                        border-radius: 8px;
                        text-decoration: none;
                        margin-top: 20px;
                        font-weight: bold;
                    }
                </style>
            </head>
            <body>
                <div class="container">
                    <h1>⏰ Link Expired</h1>
                    <p>The verification link expired after 24 hours.</p>
                    <a href="https://innocent200509.github.io/Universal-AI-Tutor/" class="btn">Subscribe Again</a>
                </div>
            </body>
            </html>
        `);
    }
    
    // Mark as verified
    verifiedEmails.set(verification.email, {
        email: verification.email,
        verifiedAt: Date.now(),
        source: verification.source,
        remainingSessions: 10,
        premium: false
    });
    
    saveVerifiedEmails();
    pendingVerifications.delete(token);
    
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Email Verified! - AI Tutor</title>
            <style>
                body {
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                    text-align: center;
                    padding: 50px;
                    background: linear-gradient(135deg, #667eea, #764ba2);
                    color: white;
                    min-height: 100vh;
                    margin: 0;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }
                .container {
                    max-width: 500px;
                    background: rgba(255,255,255,0.15);
                    padding: 40px;
                    border-radius: 24px;
                    animation: fadeIn 0.5s ease;
                }
                @keyframes fadeIn {
                    from { opacity: 0; transform: translateY(20px); }
                    to { opacity: 1; transform: translateY(0); }
                }
                h1 { font-size: 2.5rem; margin-bottom: 1rem; }
                .checkmark { font-size: 4rem; margin-bottom: 1rem; }
                .btn {
                    display: inline-block;
                    background: #10b981;
                    color: white;
                    padding: 14px 28px;
                    border-radius: 8px;
                    text-decoration: none;
                    margin-top: 20px;
                    font-weight: bold;
                    transition: transform 0.2s;
                }
                .btn:hover {
                    transform: scale(1.05);
                    background: #059669;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="checkmark">✅</div>
                <h1>Email Verified!</h1>
                <p>Thank you for confirming your email address!</p>
                <p>Your account has been credited with <strong>10 free AI tutoring sessions</strong>.</p>
                <a href="https://innocent200509.github.io/Universal-AI-Tutor/" class="btn">Start Learning Now →</a>
                <p style="margin-top: 20px; font-size: 12px; opacity: 0.8;">Get help with any subject - math, science, history, languages, and more!</p>
            </div>
        </body>
        </html>
    `);
});

// ==================== CHECK VERIFICATION ====================
app.post('/api/check-verified', (req, res) => {
    const { email } = req.body;
    
    if (!email) {
        return res.json({ verified: false });
    }
    
    const userData = verifiedEmails.get(email);
    
    if (userData) {
        res.json({
            verified: true,
            remainingSessions: userData.remainingSessions,
            isPremium: userData.premium || false
        });
    } else {
        res.json({ verified: false });
    }
});

// ==================== HEALTH CHECK ====================
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'healthy',
        geminiAvailable: !!genAI,
        verifiedEmails: verifiedEmails.size,
        pendingVerifications: pendingVerifications.size,
        timestamp: new Date().toISOString() 
    });
});

app.listen(PORT, () => {
    console.log(`🤖 AI Tutor API running on port ${PORT}`);
    console.log(`📧 ${verifiedEmails.size} verified emails`);
    console.log(`🤖 Gemini: ${genAI ? 'ACTIVE' : 'INACTIVE (fallback mode)'}`);
});