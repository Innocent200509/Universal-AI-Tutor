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
    
    console.log(`📝 Received message: "${message}" for subject: ${subject}`);
    
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
            // Use the correct model - gemini-2.0-flash (faster and works well)
            const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
            
            const systemPrompt = `You are a friendly, patient AI tutor. Help students learn ${subject || 'any subject'}.
                                  Use simple language, give examples, and be encouraging.
                                  Break down complex topics step by step.
                                  Use emojis occasionally to keep it friendly.
                                  Keep explanations clear and concise (under 200 words).
                                  If the student is struggling, offer hints.
                                  Always provide a direct answer to the student's question.`;
            
            // Build conversation context
            let context = '';
            if (conversationHistory && conversationHistory.length > 0) {
                const recentMessages = conversationHistory.slice(-6);
                context = recentMessages.map(msg => `${msg.role === 'user' ? 'Student' : 'Tutor'}: ${msg.content}`).join('\n') + '\n';
            }
            
            const prompt = `${systemPrompt}\n\n${context}Student: ${message}\n\nTutor:`;
            
            console.log(`🤖 Sending to Gemini: ${prompt.substring(0, 200)}...`);
            
            const result = await model.generateContent(prompt);
            const reply = result.response.text();
            
            console.log(`✅ Gemini response: ${reply.substring(0, 100)}...`);
            
            // Deduct session for free users
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
            console.error('❌ Gemini error:', error.message);
            // Send fallback response
            res.json({ reply: getFallbackResponse(message, subject) });
        }
    } else {
        console.log('⚠️ No Gemini API key, using fallback');
        const reply = getFallbackResponse(message, subject);
        res.json({ reply });
    }
});

// Fallback responses (only used if Gemini fails)
function getFallbackResponse(message, subject) {
    const lowerMsg = message.toLowerCase();
    
    // Simple math
    if (lowerMsg.includes('2+2') || lowerMsg.includes('2 + 2')) {
        return "2 + 2 = 4! That's basic addition. When you have 2 apples and get 2 more, you have 4 apples total. 🍎🍎🍎🍎";
    }
    
    if (lowerMsg.includes('1+1') || lowerMsg.includes('1 + 1')) {
        return "1 + 1 = 2! That's one of the first math facts we learn. If you have one cookie and get another, you have two cookies! 🍪🍪";
    }
    
    if (lowerMsg.includes('pythagorean')) {
        return "The Pythagorean theorem is a² + b² = c². It's used to find the length of the hypotenuse (the longest side) of a right triangle. For example, if a=3 and b=4, then c=5 because 3² + 4² = 9 + 16 = 25, and √25 = 5.";
    }
    
    if (lowerMsg.includes('quantum')) {
        return "Quantum physics is the study of matter and energy at the smallest scales - atoms and subatomic particles. It's strange because particles can be in multiple places at once (superposition) and can be instantly connected across space (entanglement)! It's the foundation of modern technology like lasers, computers, and MRI machines.";
    }
    
    if (lowerMsg.includes('photosynthesis')) {
        return "Photosynthesis is how plants make their own food! They use sunlight, water, and carbon dioxide to create glucose (sugar) and oxygen. The equation is: 6CO₂ + 6H₂O + light → C₆H₁₂O₆ + 6O₂. That's why plants are so important - they produce the oxygen we breathe! 🌱☀️";
    }
    
    return `I'm your AI Tutor! I can help with ${subject || 'any subject'}. Ask me about math, science, history, languages, or anything you're studying! What would you like to learn?`;
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
    
    // Try to send email if Resend is configured
    let emailSent = false;
    if (process.env.RESEND_API_KEY) {
        try {
            const { Resend } = await import('resend');
            const resend = new Resend(process.env.RESEND_API_KEY);
            
            await resend.emails.send({
                from: process.env.EMAIL_FROM || 'Universal Smart AI <onboarding@resend.dev>',
                to: [email],
                subject: 'Verify Your Email - Universal Smart AI',
                html: `
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <meta charset="UTF-8">
                        <title>Verify Your Email</title>
                    </head>
                    <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                        <div style="background: linear-gradient(135deg, #667eea, #764ba2); padding: 30px; border-radius: 16px; text-align: center; color: white;">
                            <h1 style="margin: 0;">🎁 10 FREE SESSIONS</h1>
                        </div>
                        <div style="background: white; padding: 30px; border-radius: 16px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); margin-top: 20px;">
                            <h2 style="color: #333;">Verify Your Email</h2>
                            <p>Thanks for signing up for <strong>Universal Smart AI</strong>! I'm excited to help you learn any subject.</p>
                            <p>Click the button below to confirm your email address and activate your <strong>10 free tutoring sessions</strong>.</p>
                            <div style="text-align: center; margin: 30px 0;">
                                <a href="${verifyUrl}" style="background: linear-gradient(135deg, #6366f1, #4f46e5); color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold;">Confirm Email →</a>
                            </div>
                            <p style="color: #666; font-size: 12px;">This link will expire in 24 hours. If you didn't sign up for Universal Smart AI, you can safely ignore this email.</p>
                        </div>
                        <div style="text-align: center; margin-top: 20px; color: #666; font-size: 12px;">
                            <p>Universal Smart AI - Your Personal AI Learning Assistant</p>
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
        message: emailSent ? 'Verification email sent! Check your inbox.' : 'Verification link created.',
        requiresVerification: true,
        ...(process.env.NODE_ENV !== 'production' && { debugUrl: verifyUrl })
    });
});

// ==================== EMAIL VERIFICATION ====================
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
        <head><title>${title}</title></head>
        <body style="font-family:sans-serif;text-align:center;padding:50px;background:linear-gradient(135deg,#667eea,#764ba2);color:white;">
            <h1>❌ ${title}</h1>
            <p>${message}</p>
            <a href="https://universalsmartai.com/" style="color:white;">Back to Universal Smart AI</a>
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
                h1 { font-size: 2.5rem; margin-bottom: 1rem; }
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
                <p>Thank you for confirming your email address!</p>
                <p>You now have <strong>10 free AI tutoring sessions</strong>!</p>
                <a href="https://universalsmartai.com/" class="btn">Start Learning →</a>
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
        emailServiceAvailable: !!process.env.RESEND_API_KEY,
        verifiedEmails: verifiedEmails.size,
        pendingVerifications: pendingVerifications.size,
        timestamp: new Date().toISOString() 
    });
});

app.listen(PORT, () => {
    console.log(`🤖 Universal Smart AI API running on port ${PORT}`);
    console.log(`📧 ${verifiedEmails.size} verified emails`);
    console.log(`🤖 Gemini: ${genAI ? 'ACTIVE' : 'INACTIVE'}`);
    console.log(`📧 Email Service: ${process.env.RESEND_API_KEY ? 'ACTIVE' : 'INACTIVE'}`);
});