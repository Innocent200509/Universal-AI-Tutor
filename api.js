// API Server for Universal AI Tutor with Email Confirmation
import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';
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

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Email verification storage (in production, use a database like PostgreSQL)
const pendingVerifications = new Map();
const verifiedEmails = new Map();

// Load existing verified emails from file
const VERIFIED_FILE = path.join(__dirname, 'verified-emails.json');
try {
    if (fs.existsSync(VERIFIED_FILE)) {
        const data = fs.readFileSync(VERIFIED_FILE, 'utf8');
        const saved = JSON.parse(data);
        saved.forEach(item => {
            if (typeof item === 'string') {
                verifiedEmails.set(item, { verifiedAt: Date.now() });
            } else {
                verifiedEmails.set(item.email, item);
            }
        });
        console.log(`📧 Loaded ${verifiedEmails.size} verified emails`);
    }
} catch(e) {
    console.log('No existing verified emails file');
}

// Save verified emails to file
function saveVerifiedEmails() {
    const data = Array.from(verifiedEmails.entries()).map(([email, info]) => ({
        email,
        verifiedAt: info.verifiedAt
    }));
    fs.writeFileSync(VERIFIED_FILE, JSON.stringify(data, null, 2));
}

// ==================== AI TUTOR ENDPOINT ====================
app.post('/api/tutor', async (req, res) => {
    const { message, subject, conversationHistory, email } = req.body;
    
    if (!message) {
        return res.status(400).json({ error: 'No message provided' });
    }
    
    // Check if user has free sessions (if not premium)
    if (email && verifiedEmails.has(email)) {
        const userData = verifiedEmails.get(email);
        if (!userData.premium && userData.remainingSessions !== undefined && userData.remainingSessions <= 0) {
            return res.status(403).json({ 
                error: 'You have used all your free sessions. Please upgrade to Pro for unlimited access.',
                requiresUpgrade: true
            });
        }
    }
    
    if (!OPENAI_API_KEY) {
        return res.status(500).json({ 
            reply: "⚠️ AI tutor is being set up. Please try again in a few minutes.\n\nIn the meantime, feel free to ask about any subject - I'll do my best to help!" 
        });
    }
    
    try {
        const systemPrompt = `You are a friendly, patient AI tutor. Help students learn ${subject || 'any subject'}.
                              Use simple language, give examples, and be encouraging.
                              Break down complex topics step by step.
                              Use emojis occasionally to keep it friendly.
                              If the student is struggling, offer hints rather than direct answers.
                              Keep explanations clear and concise (under 200 words).`;
        
        const messages = [
            { role: 'system', content: systemPrompt },
            ...(conversationHistory || []).slice(-10).map(msg => ({
                role: msg.role,
                content: msg.content
            })),
            { role: 'user', content: message }
        ];
        
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${OPENAI_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'gpt-3.5-turbo',
                messages: messages,
                temperature: 0.7,
                max_tokens: 600
            })
        });
        
        const data = await response.json();
        
        if (data.error) {
            console.error('OpenAI error:', data.error);
            return res.status(500).json({ error: data.error.message });
        }
        
        const reply = data.choices[0].message.content;
        
        // Deduct session if user is on free tier
        if (email && verifiedEmails.has(email)) {
            const userData = verifiedEmails.get(email);
            if (!userData.premium && userData.remainingSessions !== undefined) {
                userData.remainingSessions--;
                verifiedEmails.set(email, userData);
                saveVerifiedEmails();
            }
        }
        
        res.json({ reply });
        
    } catch (error) {
        console.error('Server error:', error);
        res.status(500).json({ error: 'AI tutor temporarily unavailable' });
    }
});

// ==================== EMAIL SUBSCRIPTION WITH CONFIRMATION ====================
app.post('/api/subscribe', async (req, res) => {
    const { email, source } = req.body;
    
    if (!email || !email.includes('@')) {
        return res.status(400).json({ error: 'Valid email address required' });
    }
    
    // Check if already verified
    if (verifiedEmails.has(email)) {
        return res.status(400).json({ 
            error: 'Email already verified! You can start learning immediately.',
            alreadyVerified: true
        });
    }
    
    // Check if pending verification exists
    let existingToken = null;
    for (const [token, data] of pendingVerifications.entries()) {
        if (data.email === email) {
            existingToken = token;
            break;
        }
    }
    
    // Generate verification token
    const token = existingToken || crypto.randomBytes(32).toString('hex');
    const expiresAt = Date.now() + 24 * 60 * 60 * 1000; // 24 hours
    
    // Store pending verification
    pendingVerifications.set(token, {
        email,
        source,
        createdAt: Date.now(),
        expiresAt
    });
    
    // Create verification URL
    const baseUrl = process.env.BASE_URL || 'https://universal-ai-tutor.onrender.com';
    const verifyUrl = `${baseUrl}/api/verify-email?token=${token}`;
    
    // Log verification URL (for testing)
    console.log(`\n📧 Verification email would be sent to: ${email}`);
    console.log(`🔗 Verification link: ${verifyUrl}`);
    console.log(`⏰ Link expires in 24 hours\n`);
    
    // Try to send actual email if Resend is configured
    let emailSent = false;
    if (process.env.RESEND_API_KEY) {
        try {
            const { Resend } = await import('resend');
            const resend = new Resend(process.env.RESEND_API_KEY);
            
            await resend.emails.send({
                from: process.env.EMAIL_FROM || 'AI Tutor <onboarding@resend.dev>',
                to: [email],
                subject: 'Confirm your email - AI Tutor Free Sessions',
                html: `
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <meta charset="UTF-8">
                        <meta name="viewport" content="width=device-width, initial-scale=1.0">
                        <title>Confirm Your Email</title>
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
                            <h1>Confirm Your Email</h1>
                            <p>Thanks for subscribing to <strong>AI Tutor</strong>! I'm excited to help you learn any subject.</p>
                            <p>Click the button below to confirm your email address and activate your <strong>10 free tutoring sessions</strong>.</p>
                            <div style="text-align: center;">
                                <a href="${verifyUrl}" class="btn">Confirm Email →</a>
                            </div>
                            <p style="font-size: 14px; color: #666;">This link will expire in 24 hours. If you didn't sign up for AI Tutor, you can safely ignore this email.</p>
                            <div class="footer">
                                <p>AI Tutor - Your Personal AI Learning Assistant</p>
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

// Email verification endpoint
app.get('/api/verify-email', (req, res) => {
    const { token } = req.query;
    
    if (!token) {
        return res.status(400).send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Email Verification - AI Tutor</title>
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
                        background: rgba(255,255,255,0.1);
                        padding: 40px;
                        border-radius: 24px;
                        backdrop-filter: blur(10px);
                    }
                    h1 { font-size: 2.5rem; margin-bottom: 1rem; }
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
                    .btn:hover { background: #f0f0f0; }
                </style>
            </head>
            <body>
                <div class="container">
                    <h1>❌ Invalid Link</h1>
                    <p>The verification link is missing or invalid.</p>
                    <a href="https://innocent200509.github.io/Universal-AI-Tutor/" class="btn">Back to AI Tutor</a>
                </div>
            </body>
            </html>
        `);
    }
    
    const verification = pendingVerifications.get(token);
    
    if (!verification) {
        return res.status(400).send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Email Verification - AI Tutor</title>
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
                        background: rgba(255,255,255,0.1);
                        padding: 40px;
                        border-radius: 24px;
                        backdrop-filter: blur(10px);
                    }
                    h1 { font-size: 2.5rem; margin-bottom: 1rem; }
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
                    <p>This verification link is invalid or has expired (24 hour limit).</p>
                    <a href="https://innocent200509.github.io/Universal-AI-Tutor/" class="btn">Subscribe Again</a>
                </div>
            </body>
            </html>
        `);
    }
    
    if (Date.now() > verification.expiresAt) {
        pendingVerifications.delete(token);
        return res.status(400).send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Email Verification - AI Tutor</title>
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
                        background: rgba(255,255,255,0.1);
                        padding: 40px;
                        border-radius: 24px;
                        backdrop-filter: blur(10px);
                    }
                    h1 { font-size: 2.5rem; margin-bottom: 1rem; }
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
    
    // Mark email as verified
    verifiedEmails.set(verification.email, {
        email: verification.email,
        verifiedAt: Date.now(),
        source: verification.source,
        remainingSessions: 10,
        premium: false
    });
    
    saveVerifiedEmails();
    pendingVerifications.delete(token);
    
    // Send success response
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
                    backdrop-filter: blur(10px);
                    animation: fadeIn 0.5s ease;
                }
                @keyframes fadeIn {
                    from { opacity: 0; transform: translateY(20px); }
                    to { opacity: 1; transform: translateY(0); }
                }
                h1 { font-size: 3rem; margin-bottom: 1rem; }
                .checkmark {
                    font-size: 4rem;
                    animation: bounce 0.5s ease;
                }
                @keyframes bounce {
                    0%, 100% { transform: scale(1); }
                    50% { transform: scale(1.2); }
                }
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
                .badge {
                    background: rgba(255,255,255,0.2);
                    padding: 8px 16px;
                    border-radius: 40px;
                    display: inline-block;
                    margin-bottom: 20px;
                    font-size: 14px;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="checkmark">✅</div>
                <h1>Email Verified!</h1>
                <div class="badge">🎁 10 FREE SESSIONS ACTIVATED</div>
                <p>Thank you for confirming your email address!</p>
                <p>Your account has been credited with <strong>10 free AI tutoring sessions</strong>.</p>
                <p>Start learning any subject right away!</p>
                <a href="https://innocent200509.github.io/Universal-AI-Tutor/" class="btn">Start Learning Now →</a>
                <p style="margin-top: 20px; font-size: 12px; opacity: 0.8;">Questions? Reply to this email - I'm here to help!</p>
            </div>
        </body>
        </html>
    `);
});

// Check email verification status
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

// Get verified emails (admin only - add auth in production)
app.get('/api/verified-emails', (req, res) => {
    const emails = Array.from(verifiedEmails.entries()).map(([email, data]) => ({
        email,
        verifiedAt: data.verifiedAt,
        remainingSessions: data.remainingSessions,
        premium: data.premium || false
    }));
    res.json({ count: emails.length, emails });
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'healthy', 
        subjects: 'all',
        verifiedEmails: verifiedEmails.size,
        pendingVerifications: pendingVerifications.size,
        timestamp: new Date().toISOString() 
    });
});

app.listen(PORT, () => {
    console.log(`🤖 AI Tutor API running on port ${PORT}`);
    console.log(`📧 Email verification system active`);
    console.log(`✅ ${verifiedEmails.size} verified emails`);
});