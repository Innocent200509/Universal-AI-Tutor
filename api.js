// API Server for Universal AI Tutor
// Handles any subject - math, science, history, languages, etc.

import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// ==================== UNIVERSAL AI TUTOR ENDPOINT ====================
app.post('/api/tutor', async (req, res) => {
    const { message, subject, conversationHistory } = req.body;
    
    if (!message) {
        return res.status(400).json({ error: 'No message provided' });
    }
    
    if (!OPENAI_API_KEY) {
        return res.status(500).json({ 
            reply: "⚠️ AI tutor is being set up. Please try again in a few minutes.\n\nIn the meantime, feel free to ask about any subject - I'll do my best to help!" 
        });
    }
    
    try {
        // Build system prompt based on subject
        const systemPrompt = getSystemPrompt(subject);
        
        // Build conversation context
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
                max_tokens: 800
            })
        });
        
        const data = await response.json();
        
        if (data.error) {
            console.error('OpenAI error:', data.error);
            return res.status(500).json({ error: data.error.message });
        }
        
        const reply = data.choices[0].message.content;
        res.json({ reply });
        
    } catch (error) {
        console.error('Server error:', error);
        res.status(500).json({ error: 'AI tutor temporarily unavailable' });
    }
});

function getSystemPrompt(subject) {
    const prompts = {
        'General': `You are a friendly, patient AI tutor. Help students learn any subject.
                    Use simple language, give examples, and be encouraging.
                    If a question is complex, break it down step by step.
                    Use emojis occasionally to keep it friendly.`,
        
        'Mathematics': `You are a math tutor specializing in algebra, calculus, geometry, and statistics.
                       Explain step-by-step. Show formulas. Use examples.
                       If the student is stuck, guide them with hints rather than giving the answer immediately.`,
        
        'Physics': `You are a physics tutor covering mechanics, thermodynamics, quantum physics, and electromagnetism.
                   Use real-world examples. Explain equations clearly.
                   Relate concepts to everyday experiences.`,
        
        'Chemistry': `You are a chemistry tutor specializing in organic chemistry, biochemistry, and the periodic table.
                     Explain chemical reactions, molecular structures, and lab concepts.
                     Use analogies to make complex concepts accessible.`,
        
        'Biology': `You are a biology tutor covering cell biology, genetics, human anatomy, and ecology.
                   Explain life sciences with clear examples.
                   Use diagrams in text format when helpful.`,
        
        'Computer Science': `You are a computer science tutor covering programming, algorithms, data structures, and web development.
                            Write code examples when relevant.
                            Explain concepts like a mentor teaching a junior developer.`,
        
        'History': `You are a history tutor covering world history, US history, and ancient civilizations.
                   Provide context, key dates, and explain cause-and-effect.
                   Make history engaging with stories and connections to today.`,
        
        'Literature': `You are a literature tutor covering poetry, novels, and literary analysis.
                      Help with essay structure, thesis statements, and literary devices.
                      Quote relevant passages when helpful.`,
        
        'Economics': `You are an economics tutor covering microeconomics, macroeconomics, and finance.
                     Explain supply/demand, market structures, and economic theories.
                     Use current events as examples.`,
        
        'Psychology': `You are a psychology tutor covering cognitive psychology, behavioral science, and neuroscience.
                      Explain theories and experiments clearly.
                      Connect concepts to real-life behavior.`,
        
        'Languages': `You are a language tutor for Spanish, French, Mandarin, English, and more.
                     Help with grammar, vocabulary, pronunciation, and conversation.
                     Provide examples and practice exercises.`
    };
    
    return prompts[subject] || prompts['General'];
}

// ==================== EMAIL SUBSCRIPTION ====================
app.post('/api/subscribe', async (req, res) => {
    const { email, source } = req.body;
    console.log(`New subscriber: ${email} from ${source}`);
    res.json({ success: true });
});

// ==================== STRIPE CHECKOUT (Optional) ====================
// Uncomment when ready
/*
import Stripe from 'stripe';
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

app.post('/api/create-checkout', async (req, res) => {
    try {
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [{
                price_data: {
                    currency: 'usd',
                    product_data: { name: 'AI Tutor Pro' },
                    unit_amount: 999,
                    recurring: { interval: 'month' }
                },
                quantity: 1
            }],
            mode: 'subscription',
            success_url: 'https://YOUR_DOMAIN.com',
            cancel_url: 'https://YOUR_DOMAIN.com'
        });
        res.json({ url: session.url });
    } catch (error) {
        res.status(500).json({ error: 'Failed to create checkout' });
    }
});
*/

// ==================== HEALTH CHECK ====================
app.get('/api/health', (req, res) => {
    res.json({ status: 'healthy', subjects: 'all', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
    console.log(`AI Tutor API running on port ${PORT}`);
});