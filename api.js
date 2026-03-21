// API Server for AI Tutor - Google Gemini (Working Version)
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
    try {
        genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
        console.log('✅ Google Gemini initialized');
    } catch (error) {
        console.log('❌ Failed to initialize Gemini:', error.message);
    }
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
    
    // Use Gemini if available
    if (genAI) {
        try {
            // Use the correct model - gemini-2.5-flash (stable version from the list)
            const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
            
            const systemPrompt = `You are a friendly, patient AI tutor. Help students learn ${subject || 'any subject'}.
                                  Use simple language, give examples, and be encouraging.
                                  Break down complex topics step by step.
                                  Use emojis occasionally to keep it friendly.
                                  Keep explanations clear and concise (under 150 words).
                                  If the student is struggling, offer hints.
                                  Format with bullet points or numbered steps when helpful.`;
            
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
            console.error('Gemini error:', error.message);
            // Fallback response
            res.json({ reply: getFallbackResponse(message, subject) });
        }
    } else {
        // Fallback responses
        const reply = getFallbackResponse(message, subject);
        res.json({ reply });
    }
});

// Fallback responses
function getFallbackResponse(message, subject) {
    const lowerMsg = message.toLowerCase();
    
    const responses = {
        '2+2': "2 + 2 = 4! That's basic addition.",
        'pythagorean': "The Pythagorean theorem is a² + b² = c². It's used to find the hypotenuse of a right triangle.",
        'quadratic': "The quadratic formula is x = (-b ± √(b² - 4ac)) / 2a.",
        'photosynthesis': "Photosynthesis: 6CO₂ + 6H₂O + light → C₆H₁₂O₆ + 6O₂.",
        'dna': "DNA (deoxyribonucleic acid) carries genetic instructions with a double helix structure.",
        'newton': "Newton's First Law: An object at rest stays at rest unless acted upon by force.",
        'hello in spanish': "In Spanish, 'hello' is 'hola'.",
        'hello in french': "In French, 'hello' is 'bonjour'.",
        'quantum': "Quantum physics studies the smallest particles in the universe."
    };
    
    for (const [key, value] of Object.entries(responses)) {
        if (lowerMsg.includes(key)) {
            return value;
        }
    }
    
    return `I'm your AI Tutor! I can help with ${subject || 'any subject'}. Ask me about math, science, history, or languages!`;
}

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
    
    const baseUrl = process.env.BASE_URL || 'https://universal-ai-tutor-2.onrender.com';
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
            <head><title>Email Verification</title></head>
            <body style="font-family:sans-serif;text-align:center;padding:50px;background:linear-gradient(135deg,#667eea,#764ba2);color:white;">
                <h1>❌ Invalid Link</h1>
                <a href="https://innocent200509.github.io/Universal-AI-Tutor/" style="color:white;">Back to AI Tutor</a>
            </body>
            </html>
        `);
    }
    
    const verification = pendingVerifications.get(token);
    
    if (!verification || Date.now() > verification.expiresAt) {
        pendingVerifications.delete(token);
        return res.send(`
            <!DOCTYPE html>
            <html>
            <head><title>Email Verification</title></head>
            <body style="font-family:sans-serif;text-align:center;padding:50px;background:linear-gradient(135deg,#667eea,#764ba2);color:white;">
                <h1>❌ Invalid or Expired Link</h1>
                <a href="https://innocent200509.github.io/Universal-AI-Tutor/" style="color:white;">Subscribe Again</a>
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
            <title>Email Verified!</title>
            <style>
                body {
                    font-family: sans-serif;
                    text-align: center;
                    padding: 50px;
                    background: linear-gradient(135deg, #667eea, #764ba2);
                    color: white;
                    min-height: 100vh;
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
                h1 { font-size: 2.5rem; }
                .btn {
                    display: inline-block;
                    background: #10b981;
                    color: white;
                    padding: 12px 24px;
                    border-radius: 8px;
                    text-decoration: none;
                    margin-top: 20px;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>✅ Email Verified!</h1>
                <p>You now have <strong>10 free AI tutoring sessions</strong>!</p>
                <a href="https://innocent200509.github.io/Universal-AI-Tutor/" class="btn">Start Learning →</a>
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
        model: 'gemini-2.5-flash',
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