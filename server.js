import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import Parser from 'rss-parser';
import OpenAI from 'openai';

// init1
dotenv.config();
const app = express();
const PORT = process.env.PORT || 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(express.static(__dirname)); 

// parser
const parser = new Parser({
  headers: { 'User-Agent': 'Mozilla/5.0 (compatible; sentiment-bot/1.0)' },
  timeout: 10000
});

// init
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});
let openaiCallCount = 0;
const MAX_OPENAI_CALLS = 500;
setInterval(() => {
  openaiCallCount = 0;
  console.log("🔄 OpenAI call counter reset.");
}, 60 * 60 * 1000);

// keyword scoring
const popularSubreddits = ['news', 'worldnews', 'funny', 'mentalhealth', 'askreddit'];

const positiveWords = [
  'happy', 'joy', 'excited', 'love', 'inspired', 'grateful',
  'amazing', 'proud', 'confident', 'hopeful', 'hope', 'peace', 'freedom',
  'great', 'cheerful', 'uplifted', 'accomplished', 'peaceful', 'motivated', 'encouraged',
  'better', 'progress', 'good life', 'success', 'wins', 'celebrates', 'growth', 'breakthrough',
  'improves', 'achieves', 'strong', 'record-high', 'optimistic', 'thriving', 'surges',
  'praises', 'boosts', 'innovative',  'peacetalk', 'recognition','liberation',
  'relief', 'renewed','miracle', 'win','pioneer','pioneering','inventor', 'life-saving','ceasefire'
];
const negativeWords = [
  'sad', 'angry', 'hate', 'depressed','deadly','dead', 'frustrated', 'hopeless', 'anxious',
  'scared', 'tired', 'lonely', 'miserable', 'worthless', 'failure', 'afraid',
  'numb', 'crying', 'helpless', 'guilt', 'ashamed', 'stressed', 'death', 'ache',
  'pain', 'grief', 'loss', 'broken', 'suffering', 'unworthy', 'hopelessness',
  'horror', 'dangerous','mourning', 'war', 'crisis', 'fails', 'scandal', 'decline',
  'warns', 'crash', 'struggles', 'falls', 'controversy', 'outrage', 'disaster',
  'accused', 'backlash', 'threat', 'blockage', 'controversial','warn','fears',
  'kill', 'attack', 'virus','killed','malnourishment', 'starvation',
  'starved','wildfires','kills','chaotic','desperately','hungry','hunger','famine'
];
const contrastWords = [
  'but','despite','shocking', 'unbelievable', 'inspiring', 'devastating', 'kills',
  'heartbreaking', 'outrageous', 'promising', 'terrifying', 'major', 'brutal', 'deadly','blockade',
  'bombardments','Horrors','wildfires','kills','starved','strikes'
];
const negativePhrases = [
  "give up", "suicide", "trauma","child abuse", "brutality", "Authorities warn","breaks the ceasefire", 
  "breaking the ceasefire","urgently","get you killed","mass starvation","mass hunger",
  "mass killing", "mass shooting","mass grave","malnourished","more dead","horrors",
  "seeking aid","didn't stop the killing", "real difficulties", "very difficult","starving children","sexually harassed"
];
const positivePhrases = ['liberated','pressure to end', 'agree to']; 

const NEGATIVE_WEIGHT = 1.3;
const PHRASE_PENALTY_PER_MATCH = 2;
const CONTRAST_PENALTY_FACTOR = 0.4;
const PHRASE_BONUS_WEIGHT = 0.7;

// Local scoring fallback
function localSentimentScore(text) {
  let positiveCount = 0;
  let negativeCount = 0;
  let positivePhraseBonus = 0;
  const lowerText = text.toLowerCase();

  positiveWords.forEach(word => {
    if (new RegExp(`\\b${word}\\b`, 'i').test(lowerText)) positiveCount++;
  });

  negativeWords.forEach(word => {
    if (new RegExp(`\\b${word}\\b`, 'i').test(lowerText)) negativeCount++;
  });

  for (const contrast of contrastWords) {
    const index = lowerText.indexOf(contrast);
    if (index !== -1) {
      const before = lowerText.slice(0, index);
      for (const word of positiveWords) {
        if (before.includes(word)) {
          positiveCount = Math.ceil(positiveCount * CONTRAST_PENALTY_FACTOR);
          break;
        }
      }
    }
  }

  let phrasePenalty = 0;
  for (const phrase of negativePhrases) {
    if (new RegExp(`\\b${phrase}\\b`, 'i').test(lowerText)) phrasePenalty += PHRASE_PENALTY_PER_MATCH;
  }

  for (const phrase of positivePhrases) {
    if (new RegExp(`\\b${phrase}\\b`, 'i').test(lowerText)) positivePhraseBonus += PHRASE_BONUS_WEIGHT;
  }

  const weightedPositives = positiveCount + positivePhraseBonus;
  const weightedNegatives = (negativeCount * NEGATIVE_WEIGHT) + phrasePenalty;
  const totalWeighted = weightedPositives + weightedNegatives;

  const score = totalWeighted === 0 ? 0 : (weightedPositives - weightedNegatives) / totalWeighted;
  const signalStrength = weightedPositives + weightedNegatives;
  const sentimentCertainty = Math.abs(score);
  const lengthFactor = Math.min(1, text.length / 200);
  const confidence = Math.min(1, (signalStrength / 10) * sentimentCertainty * lengthFactor);

  return { score, confidence };
}

// OpenAI sentiment scoring
async function getSentimentScore(text) {
  if (text.length < 20 || openaiCallCount >= MAX_OPENAI_CALLS) {
    return localSentimentScore(text);
  }

  try {
    openaiCallCount++;
    const aiResponse = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      temperature: 0.3,
      messages: [
        {
          role: "system",
          content: `Rate emotional tone only (-1 to +1) with this format: { "score": number, "confidence": number }`
        },
        {
          role: "user",
          content: text
        }
      ]
    });

    const parsed = JSON.parse(aiResponse.choices[0].message.content);
    return {
      score: parseFloat(parsed.score),
      confidence: parseFloat(parsed.confidence)
    };

  } catch (err) {
    console.error("❌ OpenAI scoring failed:", err.message);
    return localSentimentScore(text);
  }
}

// token
let redditAccessToken = null;
let tokenExpiresAt = 0;

async function getRedditAccessToken() {
  if (redditAccessToken && Date.now() < tokenExpiresAt) return redditAccessToken;

  const credentials = Buffer.from(`${process.env.REDDIT_CLIENT_ID}:${process.env.REDDIT_CLIENT_SECRET}`).toString('base64');

  const res = await fetch('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': process.env.REDDIT_USER_AGENT
    },
    body: 'grant_type=client_credentials'
  });

  if (!res.ok) throw new Error('Failed to get Reddit access token');

  const data = await res.json();
  redditAccessToken = data.access_token;
  tokenExpiresAt = Date.now() + data.expires_in * 1000;
  return redditAccessToken;
}

// API
app.get('/api/ping', (req, res) => {
  res.json({ status: 'ok' });
});

app.post('/api/data', async (req, res) => {
  const { startDate, endDate } = req.body;
  const start = new Date(startDate);
  const end = new Date(endDate);
  start.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);

  const subredditStats = {};
  const dateStats = {};
  const posts = [];

  try {
    const accessToken = await getRedditAccessToken();

    for (const subreddit of popularSubreddits) {
      const url = `https://oauth.reddit.com/r/${subreddit}/new?limit=30`;

      const redditRes = await fetch(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'User-Agent': process.env.REDDIT_USER_AGENT
        }
      });

      if (!redditRes.ok) {
        console.error(`Reddit returned ${redditRes.status} for /r/${subreddit}`);
        continue;
      }

      const data = await redditRes.json();
      const entries = data.data.children;

      for (const post of entries) {
        const { title, selftext, created_utc, id } = post.data;
        const postDate = new Date(created_utc * 1000);
        if (postDate < start || postDate > end) continue;

        const content = `${title} ${selftext}`;
        const { score } = await getSentimentScore(content);
        const emotion = score > 0 ? 'UpBeat' : score < 0 ? 'Downbeat' : 'Neutral';
        const dateStr = postDate.toISOString().split('T')[0];

        posts.push({ subreddit, title, sentimentScore: score, emotion, date: dateStr, postText: selftext, id });

        subredditStats[subreddit] = subredditStats[subreddit] || { count: 0, totalconfidence: 0 };
        subredditStats[subreddit].count++;
        subredditStats[subreddit].totalconfidence += score;

        dateStats[dateStr] = dateStats[dateStr] || { totalconfidence: 0, count: 0 };
        dateStats[dateStr].totalconfidence += score;
        dateStats[dateStr].count++;
      }
    }

    res.json({ posts, subredditStats, dateStats });
  } catch (err) {
    console.error('❌ Error in /api/data:', err);
    res.status(500).json({ error: 'Server failed to fetch Reddit data' });
  }
});


app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ---------------------- Start  ----------------------
app.listen(PORT, () => {
  console.log(`✅ Server listening on port ${PORT}`);
});
