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
    
    points: 10,              // Max budget: 10 requests
    duration: 60,            // Per 60 seconds (1 minute)
    
    execEvenly: false,       // REMOVED DELAY: Allows instant submissions
    execEvenlyMinDelayMs: 50, // Allow micro-bursts (20 req/sec)
    
    inMemoryBlockOnConsumed: 10, 
    inMemoryBlockDuration: 5, 
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
                message: 'Please wait an hour before submitting another contact request.'
            });
        });
};

// 5. ENDPOINTS
app.post('/api/contact', rateLimitMiddleware, (req, res) => {
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
