// API Server for AI Tutor with PayPal Payments
import express from 'express';
import cors from 'cors';
import { GoogleGenerativeAI } from '@google/generative-ai';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import paypal from '@paypal/checkout-server-sdk';

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

// Initialize PayPal
const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID;
const PAYPAL_CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET;
let paypalClient = null;

if (PAYPAL_CLIENT_ID && PAYPAL_CLIENT_SECRET) {
    // Sandbox environment for testing
    const environment = new paypal.core.SandboxEnvironment(PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET);
    paypalClient = new paypal.core.PayPalHttpClient(environment);
    console.log('✅ PayPal initialized (Sandbox mode)');
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
                verifiedEmails.set(item, { verifiedAt: Date.now(), remainingSessions: 10, premium: false });
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
        premium: info.premium || false,
        paypalSubscriptionId: info.paypalSubscriptionId
    }));
    fs.writeFileSync(VERIFIED_FILE, JSON.stringify(data, null, 2));
}

// ==================== PAYPAL PAYMENT ENDPOINTS ====================

// Create PayPal Order
app.post('/api/create-paypal-order', async (req, res) => {
    const { email } = req.body;
    
    if (!email) {
        return res.status(400).json({ error: 'Email required' });
    }
    
    if (!paypalClient) {
        return res.status(500).json({ error: 'PayPal not configured' });
    }
    
    const request = new paypal.orders.OrdersCreateRequest();
    request.requestBody({
        intent: 'CAPTURE',
        purchase_units: [{
            amount: {
                currency_code: 'USD',
                value: '9.99',
                breakdown: {
                    item_total: {
                        currency_code: 'USD',
                        value: '9.99'
                    }
                }
            },
            description: 'AI Tutor Pro - Monthly Subscription',
            payee: {
                email_address: process.env.PAYPAL_PAYEE_EMAIL || 'your-business@email.com'
            }
        }],
        payer: {
            email_address: email,
            name: {
                given_name: email.split('@')[0]
            }
        },
        application_context: {
            brand_name: 'AI Tutor',
            landing_page: 'BILLING',
            user_action: 'PAY_NOW',
            return_url: 'https://innocent200509.github.io/Universal-AI-Tutor/success.html',
            cancel_url: 'https://innocent200509.github.io/Universal-AI-Tutor/'
        }
    });
    
    try {
        const order = await paypalClient.execute(request);
        console.log(`💰 PayPal order created: ${order.result.id} for ${email}`);
        res.json({ 
            id: order.result.id,
            links: order.result.links
        });
    } catch (error) {
        console.error('PayPal order error:', error);
        res.status(500).json({ error: 'Failed to create payment order' });
    }
});

// Capture PayPal Order (after user pays)
app.post('/api/capture-paypal-order', async (req, res) => {
    const { orderID, email } = req.body;
    
    if (!orderID) {
        return res.status(400).json({ error: 'Order ID required' });
    }
    
    if (!paypalClient) {
        return res.status(500).json({ error: 'PayPal not configured' });
    }
    
    const request = new paypal.orders.OrdersCaptureRequest(orderID);
    request.requestBody({});
    
    try {
        const capture = await paypalClient.execute(request);
        
        if (capture.result.status === 'COMPLETED') {
            // Activate premium for user
            if (email && verifiedEmails.has(email)) {
                const userData = verifiedEmails.get(email);
                userData.premium = true;
                userData.premiumSince = new Date().toISOString();
                userData.paypalSubscriptionId = capture.result.id;
                userData.paypalPayerId = capture.result.payer.payer_id;
                verifiedEmails.set(email, userData);
                saveVerifiedEmails();
                console.log(`✅ Premium activated for: ${email} (PayPal)`);
            } else if (email) {
                // Create new verified user with premium
                verifiedEmails.set(email, {
                    email: email,
                    verifiedAt: Date.now(),
                    remainingSessions: 999,
                    premium: true,
                    premiumSince: new Date().toISOString(),
                    paypalSubscriptionId: capture.result.id
                });
                saveVerifiedEmails();
                console.log(`✅ New premium user: ${email} (PayPal)`);
            }
            
            res.json({ 
                success: true,
                message: 'Payment successful! Premium activated.'
            });
        } else {
            console.log(`⚠️ Payment not completed: ${capture.result.status}`);
            res.json({ 
                success: false, 
                message: 'Payment not completed. Please try again.'
            });
        }
    } catch (error) {
        console.error('PayPal capture error:', error);
        res.status(500).json({ error: 'Failed to capture payment' });
    }
});

// ==================== AI TUTOR ENDPOINT ====================
app.post('/api/tutor', async (req, res) => {
    const { message, subject, conversationHistory, email } = req.body;
    
    if (!message) {
        return res.status(400).json({ error: 'No message provided' });
    }
    
    // Check premium status
    let isPremium = false;
    if (email && verifiedEmails.has(email)) {
        const userData = verifiedEmails.get(email);
        isPremium = userData.premium || false;
        
        if (!isPremium && userData.remainingSessions <= 0) {
            return res.status(403).json({ 
                error: 'You have used all your free sessions. Upgrade to Pro for unlimited access.',
                requiresUpgrade: true
            });
        }
    } else if (!email) {
        return res.status(403).json({ 
            error: 'Please verify your email to start learning.',
            requiresVerification: true
        });
    }
    
    // Use Gemini if available
    if (genAI) {
        try {
            const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
            
            const systemPrompt = `You are a friendly, patient AI tutor. Help students learn ${subject || 'any subject'}.
                                  Use simple language, give examples, and be encouraging.
                                  Break down complex topics step by step.
                                  Use emojis occasionally to keep it friendly.
                                  Keep explanations clear and concise (under 150 words).`;
            
            let context = '';
            if (conversationHistory && conversationHistory.length > 0) {
                const recentMessages = conversationHistory.slice(-4);
                context = recentMessages.map(msg => `${msg.role === 'user' ? 'Student' : 'Tutor'}: ${msg.content}`).join('\n') + '\n';
            }
            
            const prompt = `${systemPrompt}\n\n${context}Student: ${message}\n\nTutor:`;
            
            const result = await model.generateContent(prompt);
            const reply = result.response.text();
            
            // Deduct session for free users
            if (email && verifiedEmails.has(email) && !isPremium) {
                const userData = verifiedEmails.get(email);
                if (userData.remainingSessions > 0) {
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

// Fallback responses
function getFallbackResponse(message, subject) {
    const lowerMsg = message.toLowerCase();
    
    const responses = {
        '2+2': "2 + 2 = 4! That's basic addition.",
        'pythagorean': "The Pythagorean theorem is a² + b² = c².",
        'quadratic': "The quadratic formula is x = (-b ± √(b² - 4ac)) / 2a.",
        'photosynthesis': "Photosynthesis: 6CO₂ + 6H₂O + light → C₆H₁₂O₆ + 6O₂."
    };
    
    for (const [key, value] of Object.entries(responses)) {
        if (lowerMsg.includes(key)) {
            return value;
        }
    }
    
    return `I'm your AI Tutor! I can help with ${subject || 'any subject'}. Ask me anything!`;
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
        return res.send(getErrorPage('Invalid Link', 'The verification link is missing.'));
    }
    
    const verification = pendingVerifications.get(token);
    
    if (!verification || Date.now() > verification.expiresAt) {
        pendingVerifications.delete(token);
        return res.send(getErrorPage('Invalid or Expired Link', 'This link has expired. Please subscribe again.'));
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
            <a href="https://innocent200509.github.io/Universal-AI-Tutor/" style="color:white;">Back to AI Tutor</a>
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
                <p>You now have <strong>10 free AI tutoring sessions</strong>!</p>
                <p>Upgrade to Pro for unlimited access: <strong>$9.99/month</strong></p>
                <a href="https://innocent200509.github.io/Universal-AI-Tutor/" class="btn">Start Learning →</a>
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
        paypalAvailable: !!paypalClient,
        model: 'gemini-2.5-flash',
        verifiedEmails: verifiedEmails.size,
        timestamp: new Date().toISOString() 
    });
});

app.listen(PORT, () => {
    console.log(`🤖 AI Tutor API running on port ${PORT}`);
    console.log(`📧 ${verifiedEmails.size} verified emails`);
    console.log(`🤖 Gemini: ${genAI ? 'ACTIVE' : 'INACTIVE'}`);
    console.log(`💳 PayPal: ${paypalClient ? 'ACTIVE (Sandbox)' : 'INACTIVE'}`);
});