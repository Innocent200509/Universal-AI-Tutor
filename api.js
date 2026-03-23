// api.js - Updated with Resend email integration
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

// Initialize Resend for emails
let resend = null;
if (process.env.RESEND_API_KEY) {
    try {
        const { Resend } = await import('resend');
        resend = new Resend(process.env.RESEND_API_KEY);
        console.log('✅ Resend email service initialized');
    } catch (error) {
        console.log('❌ Failed to initialize Resend:', error.message);
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

// ==================== EMAIL SUBSCRIPTION WITH REAL EMAIL ====================
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
    
    // Check for existing pending verification
    let existingToken = null;
    for (const [token, data] of pendingVerifications.entries()) {
        if (data.email === email) {
            existingToken = token;
            break;
        }
    }
    
    const token = existingToken || crypto.randomBytes(32).toString('hex');
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
    
    // Send real email if Resend is configured
    let emailSent = false;
    if (resend) {
        try {
            await resend.emails.send({
                from: process.env.EMAIL_FROM || 'Universal Smart AI <onboarding@resend.dev>',
                to: [email],
                subject: 'Verify Your Email - Universal Smart AI',
                html: `
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <meta charset="UTF-8">
                        <meta name="viewport" content="width=device-width, initial-scale=1.0">
                        <title>Verify Your Email</title>
                        <style>
                            body {
                                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
                                line-height: 1.6;
                                color: #333;
                                max-width: 600px;
                                margin: 0 auto;
                                padding: 20px;
                                background: #f5f5f5;
                            }
                            .container {
                                background: white;
                                border-radius: 16px;
                                padding: 40px;
                                box-shadow: 0 2px 10px rgba(0,0,0,0.1);
                            }
                            h1 {
                                color: #6366f1;
                                font-size: 28px;
                                margin-bottom: 20px;
                                text-align: center;
                            }
                            .btn {
                                display: inline-block;
                                background: linear-gradient(135deg, #6366f1, #4f46e5);
                                color: white;
                                padding: 14px 28px;
                                text-decoration: none;
                                border-radius: 8px;
                                margin: 20px 0;
                                font-weight: 600;
                                text-align: center;
                            }
                            .btn:hover {
                                background: linear-gradient(135deg, #4f46e5, #4338ca);
                            }
                            .footer {
                                text-align: center;
                                margin-top: 30px;
                                font-size: 12px;
                                color: #666;
                            }
                            .badge {
                                display: inline-block;
                                background: #10b981;
                                color: white;
                                padding: 4px 12px;
                                border-radius: 20px;
                                font-size: 12px;
                                margin-bottom: 20px;
                            }
                        </style>
                    </head>
                    <body>
                        <div class="container">
                            <div style="text-align: center;">
                                <div class="badge">🎁 10 FREE SESSIONS</div>
                            </div>
                            <h1>Verify Your Email</h1>
                            <p>Thanks for signing up for <strong>Universal Smart AI</strong>! I'm excited to help you learn any subject.</p>
                            <p>Click the button below to confirm your email address and activate your <strong>10 free tutoring sessions</strong>.</p>
                            <div style="text-align: center;">
                                <a href="${verifyUrl}" class="btn">Confirm Email →</a>
                            </div>
                            <p style="font-size: 14px; color: #666;">This link will expire in 24 hours. If you didn't sign up for Universal Smart AI, you can safely ignore this email.</p>
                            <div class="footer">
                                <p>Universal Smart AI - Your Personal AI Learning Assistant</p>
                                <p>Questions? Reply to this email - I'd love to hear from you!</p>
                            </div>
                        </div>
                    </body>
                    </html>
                `
            });
            emailSent = true;
            console.log(`✅ Email sent to ${email}`);
        } catch (emailError) {
            console.error('Failed to send email:', emailError.message);
        }
    }
    
    res.json({ 
        success: true, 
        message: emailSent ? 'Verification email sent! Check your inbox.' : 'Verification link created. (Email service not configured)',
        requiresVerification: true,
        // Only include in development/testing
        ...(process.env.NODE_ENV !== 'production' && { debugUrl: verifyUrl })
    });
});

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
            const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
            
            const systemPrompt = `You are a friendly, patient AI tutor. Help students learn ${subject || 'any subject'}.
                                  Use simple language, give examples, and be encouraging.
                                  Break down complex topics step by step.
                                  Use emojis occasionally to keep it friendly.
                                  Keep explanations clear and concise.
                                  If the student is struggling, offer hints.`;
            
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
            res.json({ reply: getFallbackResponse(message, subject) });
        }
    } else {
        const reply = getFallbackResponse(message, subject);
        res.json({ reply });
    }
});

function getFallbackResponse(message, subject) {
    const lowerMsg = message.toLowerCase();
    const responses = {
        '2+2': "2 + 2 = 4! That's basic addition.",
        'pythagorean': "The Pythagorean theorem is a² + b² = c².",
        'quadratic': "The quadratic formula is x = (-b ± √(b² - 4ac)) / 2a.",
        'photosynthesis': "Photosynthesis: 6CO₂ + 6H₂O + light → C₆H₁₂O₆ + 6O₂.",
        'dna': "DNA carries genetic instructions with a double helix structure.",
        'quantum': "Quantum physics studies the smallest particles in the universe."
    };
    for (const [key, value] of Object.entries(responses)) {
        if (lowerMsg.includes(key)) return value;
    }
    return `I'm your AI Tutor! I can help with ${subject || 'any subject'}. Ask me anything!`;
}

// ==================== EMAIL VERIFICATION ENDPOINT ====================
app.get('/api/verify-email', (req, res) => {
    const { token } = req.query;
    
    if (!token) {
        return res.send(getErrorPage('Invalid Link', 'The verification link is missing.'));
    }
    
    const verification = pendingVerifications.get(token);
    
    if (!verification) {
        return res.send(getErrorPage('Invalid or Expired Link', 'This link is invalid or has expired. Please subscribe again.'));
    }
    
    if (Date.now() > verification.expiresAt) {
        pendingVerifications.delete(token);
        return res.send(getErrorPage('Link Expired', 'This verification link expired after 24 hours. Please subscribe again.'));
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
    
    res.send(getSuccessPage());
});

function getErrorPage(title, message) {
    return `
        <!DOCTYPE html>
        <html>
        <head>
            <title>${title}</title>
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
                <h1>❌ ${title}</h1>
                <p>${message}</p>
                <a href="https://universalsmartai.com/" class="btn">Back to Universal Smart AI</a>
            </div>
        </body>
        </html>
    `;
}

function getSuccessPage() {
    return `
        <!DOCTYPE html>
        <html>
        <head>
            <title>Email Verified!</title>
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
                }
                .btn:hover {
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
                <a href="https://universalsmartai.com/" class="btn">Start Learning Now →</a>
            </div>
        </body>
        </html>
    `;
}

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
        emailServiceAvailable: !!resend,
        verifiedEmails: verifiedEmails.size,
        pendingVerifications: pendingVerifications.size,
        timestamp: new Date().toISOString() 
    });
});

app.listen(PORT, () => {
    console.log(`🤖 Universal Smart AI API running on port ${PORT}`);
    console.log(`📧 ${verifiedEmails.size} verified emails`);
    console.log(`🤖 Gemini: ${genAI ? 'ACTIVE' : 'INACTIVE'}`);
    console.log(`📧 Email Service: ${resend ? 'ACTIVE' : 'INACTIVE'}`);
});