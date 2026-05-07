'use strict';

import express from 'express';
import Redis from 'ioredis';
import cors from 'cors';
import { RateLimiterRedis } from 'rate-limiter-flexible';

const app = express();

// 1. MIDDLEWARE
app.use(cors({
    exposedHeaders: ['RateLimit-Limit', 'RateLimit-Remaining']
}));
app.use(express.json());
app.set('trust proxy', 1);
// 2. REDIS CONNECTION (Optimized for Deployment)
const redisClient = new Redis(process.env.REDIS_URL || {
    host: 'redis-16828.c212.ap-south-1-1.ec2.cloud.redislabs.com',
    port: 16828,
    username: 'default',
    password: 'yeQMN7iBLo3KY8iHzpsH88PUCuqU2QR2',
});

redisClient.on('connect', () => console.log('✅ Connected to Redis Cloud'));
redisClient.on('error', (err) => console.error('❌ Redis Error:', err));

// 3. RATE LIMITER CONFIGURATION
const tokenBucket = new RateLimiterRedis({
    storeClient: redisClient,
    keyPrefix: 'contact_form_v2',
    
    points: 100,              // 100 requests
    duration: 3600,         // 1 Hour (3600 seconds)
    
    execEvenly: false,
    execEvenlyMinDelayMs: 50,
    
    inMemoryBlockOnConsumed: 100, 
    inMemoryBlockDuration: 300, // Block locally for 5 minutes if consumed
});

// 4. RATE LIMIT MIDDLEWARE
const rateLimitMiddleware = (req, res, next) => {
    tokenBucket.consume(req.ip)
        .then((rateLimiterRes) => {
            res.setHeader('RateLimit-Limit', 10);
            res.setHeader('RateLimit-Remaining', rateLimiterRes.remainingPoints);
            next();
        })
        .catch((rateLimiterRes) => {
            res.setHeader('RateLimit-Remaining', 0);
            res.status(429).json({
                error: 'Too Many Submissions',
                message: 'Please wait 5 hours before submitting another contact request.'
            });
        });
};

// 5. CLOUDFLARE TURNSTILE MIDDLEWARE
const verifyTurnstile = async (req, res, next) => {
    try {
        const token = req.body.token;

        if (!token) {
            return res.status(400).json({ error: 'Missing Turnstile token' });
        }

        // Using built-in fetch (Node 18+) or node-fetch
        const response = await fetch(
            'https://challenges.cloudflare.com/turnstile/v0/siteverify',
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    secret: process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY || '0x4AAAAAADKl74Sam6_nKhjEK-JxsDOtwoQ',
                    response: token,
                    remoteip: req.ip
                })
            }
        );

        const data = await response.json();

        if (!data.success) {
            return res.status(403).json({
                error: 'Bot detected',
                details: data['error-codes']
            });
        }

        next();
    } catch (err) {
        console.error('Turnstile Error:', err);
        return res.status(500).json({ error: 'Turnstile verification failed' });
    }
};

// 6. ENDPOINTS
app.post('/api/contact', verifyTurnstile, rateLimitMiddleware, (req, res) => {
    const { name, email, message } = req.body;
    
    if (!name || !email || !message) {
        return res.status(400).json({ error: 'All fields are required' });
    }

    console.log(`📩 New Contact: ${name} (${email})`);
    
    res.json({ 
        success: true, 
        message: 'Thank you! Your message has been received.' 
    });
});

app.get('/health', (req, res) => res.send('OK'));

const PORT = process.env.PORT || 4001;
app.listen(PORT, () => {
    console.log(`🚀 Contact Backend running on port ${PORT}`);
});
