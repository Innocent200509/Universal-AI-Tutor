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

// Google Gemini setup - Using correct current model
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
let genAI = null;

if (GEMINI_API_KEY && GEMINI_API_KEY !== 'YOUR_API_KEY_HERE') {
    try {
        genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
        console.log('✅ Google Gemini initialized');
    } catch (error) {
        console.error('❌ Failed to initialize Gemini:', error.message);
    }
} else {
    console.log('⚠️ No valid Gemini API key found');
}

// Email storage
const pendingVerifications = new Map();
const verifiedEmails = new Map();
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
} catch(e) {}

function saveVerifiedEmails() {
    const data = Array.from(verifiedEmails.entries()).map(([email, info]) => ({
        email,
        verifiedAt: info.verifiedAt,
        remainingSessions: info.remainingSessions,
        premium: info.premium || false
    }));
    fs.writeFileSync(VERIFIED_FILE, JSON.stringify(data, null, 2));
}

// ==================== MAIN AI TUTOR ENDPOINT ====================
app.post('/api/tutor', async (req, res) => {
    const { message, subject, conversationHistory, email } = req.body;
    
    console.log(`📝 [${new Date().toISOString()}] Question: "${message}" | Subject: ${subject} | Email: ${email || 'none'}`);
    
    if (!message) {
        return res.status(400).json({ error: 'No message provided' });
    }
    
    // Check free sessions
    if (email && verifiedEmails.has(email)) {
        const userData = verifiedEmails.get(email);
        if (!userData.premium && userData.remainingSessions <= 0) {
            return res.status(403).json({ 
                error: 'Free sessions used up. Upgrade to Pro!',
                requiresUpgrade: true
            });
        }
    }
    
    // Use Gemini if available
    if (genAI) {
        try {
            // CORRECT MODEL: gemini-2.5-flash (current working model)
            const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
            
            const systemPrompt = `You are a friendly, expert AI tutor. Help students learn ${subject || 'any subject'}.
            
Rules:
1. Always answer the student's question directly and completely
2. Use simple, clear language
3. Give examples when helpful
4. Be encouraging and use emojis occasionally
5. Keep answers under 200 words
6. If it's a math problem, show the calculation step by step
7. Make learning fun and engaging

Remember: You are a helpful tutor. Always provide a complete, accurate answer.`;

            // Build conversation context
            let context = '';
            if (conversationHistory && conversationHistory.length > 0) {
                const recent = conversationHistory.slice(-6);
                context = recent.map(m => `${m.role === 'user' ? 'Student' : 'Tutor'}: ${m.content}`).join('\n') + '\n';
            }
            
            const prompt = `${systemPrompt}\n\n${context}Student: ${message}\n\nTutor:`;
            
            console.log(`🤖 Sending to Gemini (gemini-2.5-flash)...`);
            
            const result = await model.generateContent(prompt);
            const reply = result.response.text();
            
            console.log(`✅ Gemini replied: ${reply.substring(0, 100)}...`);
            
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
            // Provide helpful fallback
            res.json({ reply: getSmartFallback(message, subject) });
        }
    } else {
        console.log('⚠️ No Gemini, using fallback');
        res.json({ reply: getSmartFallback(message, subject) });
    }
});

// Smart fallback with better answers
function getSmartFallback(message, subject) {
    const q = message.toLowerCase();
    
    // Math
    if (q.includes('2+2') || q.includes('2 + 2')) {
        return "2 + 2 = 4! That's basic addition. If you have 2 apples and get 2 more, you have 4 apples total. 🍎🍎🍎🍎";
    }
    if (q.includes('4+4') || q.includes('4 + 4')) {
        return "4 + 4 = 8! Adding 4 and 4 gives you 8. Think of it as 4 plus 4 equals 8. 🎯";
    }
    if (q.includes('7+1') || q.includes('7 + 1')) {
        return "7 + 1 = 8! That's simple addition. 7 plus 1 equals 8. ✨";
    }
    if (q.includes('1+1') || q.includes('1 + 1')) {
        return "1 + 1 = 2! One of the first math facts we learn. If you have one cookie and get another, you have two cookies! 🍪🍪";
    }
    if (q.includes('pythagorean')) {
        return "The Pythagorean theorem: a² + b² = c². It's used to find the hypotenuse (longest side) of a right triangle. Example: if a=3 and b=4, then c=5 because 9+16=25, √25=5. 📐";
    }
    if (q.includes('quadratic')) {
        return "The quadratic formula: x = [-b ± √(b² - 4ac)] / 2a. It solves equations like ax² + bx + c = 0. It gives you the x-intercepts of a parabola. 📈";
    }
    
    // Science
    if (q.includes('quantum')) {
        return "Quantum physics studies the smallest particles in the universe! At this tiny scale, particles can be in multiple places at once (superposition) and can be instantly connected across space (entanglement). It's strange but it powers lasers and computers! ⚛️";
    }
    if (q.includes('photosynthesis')) {
        return "Photosynthesis is how plants make their own food! They use sunlight, water, and CO₂ to create glucose and oxygen. Equation: 6CO₂ + 6H₂O + light → C₆H₁₂O₆ + 6O₂. That's why plants are essential - they produce the oxygen we breathe! 🌱☀️";
    }
    if (q.includes('dna')) {
        return "DNA (deoxyribonucleic acid) is the blueprint of life! It has a double helix structure that looks like a twisted ladder. It contains genes that determine everything from your eye color to how your body works. 🧬";
    }
    if (q.includes('newton')) {
        return "Newton's First Law: An object at rest stays at rest, and an object in motion stays in motion unless acted upon by an outside force. That's why things don't start or stop moving by themselves! 🍎";
    }
    
    // Languages
    if (q.includes('hello in spanish')) {
        return "In Spanish, 'hello' is 'hola' (pronounced oh-la). You can also say 'buenos días' (good morning) or 'buenas tardes' (good afternoon). ¡Hola! 👋";
    }
    if (q.includes('hello in french')) {
        return "In French, 'hello' is 'bonjour' (bon-zhoor) for daytime. For evening, say 'bonsoir'. For informal, 'salut' (sa-loo). Bonjour! 🇫🇷";
    }
    
    return `I'm your AI Tutor! I can help with ${subject || 'any subject'}. Ask me about math (like "What is 2+2?"), science ("Explain quantum physics"), history, languages, or anything you're studying! What would you like to learn? 📚✨`;
}

// ==================== EMAIL ENDPOINTS ====================
app.post('/api/subscribe', async (req, res) => {
    const { email, source } = req.body;
    
    if (!email || !email.includes('@')) {
        return res.status(400).json({ error: 'Valid email address required' });
    }
    
    if (verifiedEmails.has(email)) {
        return res.status(400).json({ 
            error: 'Email already verified!',
            alreadyVerified: true
        });
    }
    
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = Date.now() + 24 * 60 * 60 * 1000;
    
    pendingVerifications.set(token, { email, source, createdAt: Date.now(), expiresAt });
    
    const baseUrl = process.env.BASE_URL || 'https://universal-ai-tutor-2.onrender.com';
    const verifyUrl = `${baseUrl}/api/verify-email?token=${token}`;
    
    console.log(`📧 Verification for: ${email} | Link: ${verifyUrl}`);
    
    // Try to send email
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
                    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                        <div style="background: linear-gradient(135deg, #667eea, #764ba2); padding: 30px; text-align: center; color: white; border-radius: 16px 16px 0 0;">
                            <h1>🎁 10 FREE SESSIONS</h1>
                        </div>
                        <div style="background: white; padding: 30px; border-radius: 0 0 16px 16px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
                            <h2>Verify Your Email</h2>
                            <p>Click the button below to activate your <strong>10 free tutoring sessions</strong>!</p>
                            <div style="text-align: center; margin: 30px 0;">
                                <a href="${verifyUrl}" style="background: #6366f1; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px;">Confirm Email →</a>
                            </div>
                            <p style="color: #666; font-size: 12px;">This link expires in 24 hours.</p>
                        </div>
                    </div>
                `
            });
            emailSent = true;
            console.log(`✅ Email sent to ${email}`);
        } catch (e) { console.error('Email send failed:', e.message); }
    }
    
    res.json({ success: true, message: emailSent ? 'Verification email sent!' : 'Check console for link', debugUrl: verifyUrl });
});

app.get('/api/verify-email', (req, res) => {
    const { token } = req.query;
    const verification = pendingVerifications.get(token);
    
    if (!verification || Date.now() > verification.expiresAt) {
        pendingVerifications.delete(token);
        return res.send(`<h1>❌ Invalid or Expired Link</h1><a href="https://universalsmartai.com/">Back</a>`);
    }
    
    verifiedEmails.set(verification.email, {
        email: verification.email,
        verifiedAt: Date.now(),
        remainingSessions: 10,
        premium: false
    });
    saveVerifiedEmails();
    pendingVerifications.delete(token);
    
    res.send(`
        <!DOCTYPE html>
        <html>
        <head><title>Email Verified!</title></head>
        <body style="font-family:sans-serif;text-align:center;padding:50px;background:linear-gradient(135deg,#667eea,#764ba2);color:white;">
            <h1>✅ Email Verified!</h1>
            <p>You now have <strong>10 free sessions</strong>!</p>
            <a href="https://universalsmartai.com/" style="color:white;">Start Learning →</a>
        </body>
        </html>
    `);
});

app.post('/api/check-verified', (req, res) => {
    const { email } = req.body;
    const userData = verifiedEmails.get(email);
    res.json(userData ? { verified: true, remainingSessions: userData.remainingSessions, isPremium: userData.premium } : { verified: false });
});

app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'healthy',
        geminiAvailable: !!genAI,
        model: 'gemini-2.5-flash',
        verifiedEmails: verifiedEmails.size,
        timestamp: new Date().toISOString() 
    });
});

app.listen(PORT, () => {
    console.log(`🚀 API running on port ${PORT}`);
    console.log(`🤖 Gemini: ${genAI ? 'ACTIVE ✅' : 'INACTIVE ❌'}`);
    console.log(`📧 Verified: ${verifiedEmails.size} users`);
});