// patterns.js — Engagement bait detection engine
// Loaded before content.js as a shared module via content_scripts array

const BAIT_PATTERNS = [
  // ── HIGH CONFIDENCE (score: 3 each) ─────────────────────────────────────

  // "Comment X to get / below / for / and I'll send"
  {
    score: 3,
    re: /comment\s+.{1,30}\s+(below|to\s+get|to\s+receive|and\s+i['']?ll\s+(send|dm|share)|for\s+(the|a|free|your))/i,
    label: 'comment-bait'
  },
  // "Comment YES / NO / 1 / DONE / INTERESTED"
  {
    score: 3,
    re: /^\s*comment\s+(yes|no|done|interested|send|me|fire|in|below)\b/im,
    label: 'comment-word-bait'
  },
  // "Comment [quoted word]" — e.g. Comment "CLAUDE", Comment 'YES', Comment «GO»
  {
    score: 3,
    re: /^\s*\d*\.?\s*comment\s+["""''«»][\w\s]{1,20}["""''«»]\s*$/im,
    label: 'comment-quoted-word'
  },
  // Numbered list CTA with comment as a step — "2. Comment X" or "Step 2: Comment X"
  {
    score: 3,
    re: /^\s*(?:step\s*)?\d+[.):\-]\s*comment\s+.{1,30}$/im,
    label: 'numbered-comment-step'
  },
  // "Comment X" anywhere + "I'll send" later in same post (multiline)
  {
    score: 3,
    re: /comment\s+.{1,40}[\s\S]{0,300}i['']ll\s+send/i,
    label: 'comment-ill-send'
  },
  // "Drop a [word] in the comments / below"
  {
    score: 3,
    re: /drop\s+(a|an|your)\s+.{1,25}\s+(in\s+the\s+comments?|below)/i,
    label: 'drop-bait'
  },
  // "Type YES / 1 / agree in the comments / below"
  {
    score: 3,
    re: /type\s+(yes|no|1|agree|done|me)\s+(if|below|in\s+the\s+comments?)/i,
    label: 'type-bait'
  },
  // "DM me for / to get / and I'll send"
  {
    score: 3,
    re: /dm\s+me\s+(for|to\s+get|to\s+receive|and\s+i['']?ll)/i,
    label: 'dm-bait'
  },
  // "Like and comment / Like + share / Like + repost"
  {
    score: 3,
    re: /\blike\s*[+&and]+\s*(comment|share|repost|follow)\b/i,
    label: 'like-and-bait'
  },
  // "Save this post / save the carousel / save this thread"
  {
    score: 3,
    re: /\bsave\s+(this|the)\s+(post|carousel|thread|article)\b/i,
    label: 'save-bait'
  },
  // "Tag someone who / tag a friend who"
  {
    score: 3,
    re: /\btag\s+(someone|a\s+friend|your|a\s+colleague|a\s+person).{0,30}(who|that)\b/i,
    label: 'tag-bait'
  },
  // "Share this if / share with someone who"
  {
    score: 3,
    re: /\bshare\s+this\s+(if|with|post|now)\b/i,
    label: 'share-bait'
  },
  // "Follow me / follow us for more / for daily"
  {
    score: 3,
    re: /\bfollow\s+(me|us|my\s+page)\s+for\s+(more|daily|weekly|free|tips|updates)/i,
    label: 'follow-bait'
  },
  // "Repost this / repost if you"
  {
    score: 3,
    re: /\brepost\s+(this|if\s+you)\b/i,
    label: 'repost-bait'
  },
  // "React with 🔥 if / react with a heart if"
  {
    score: 3,
    re: /\breact\s+with\s+.{1,20}\s+if\b/i,
    label: 'react-bait'
  },

  // ── MEDIUM CONFIDENCE (score: 2 each — strict mode only) ───────────────
  // These are suppressed in Moderate and Loose modes to avoid false positives.

  // "Link in comments / bio / first comment"
  {
    score: 2,
    strictOnly: true,
    re: /link\s+in\s+(the\s+)?(comments?|bio|first\s+comment)/i,
    label: 'link-in-comments'
  },
  // "Get the free [resource] — comment below"
  {
    score: 2,
    strictOnly: true,
    re: /\bget\s+(the\s+)?(free|full|complete)\s+\w+\s*[—–-]\s*comment\b/i,
    label: 'get-free-comment'
  },
  // "Grab your free copy / guide / cheat sheet"
  {
    score: 2,
    strictOnly: true,
    re: /\bgrab\s+your\s+(free|full)\s+(copy|guide|cheat\s+sheet|template|toolkit|pdf)/i,
    label: 'grab-free'
  },
  // "I made a free [resource]" + call to action cue
  {
    score: 2,
    strictOnly: true,
    re: /\bi\s+(made|created|built|wrote|compiled)\s+a\s+free\b/i,
    label: 'i-made-free'
  },
  // "Double tap / double-tap if"
  {
    score: 2,
    strictOnly: true,
    re: /\bdouble[\s-]?tap\s+(if|this|to)\b/i,
    label: 'double-tap'
  },
  // Emoji-only padding lines (3+ consecutive lines of only emoji/spaces)
  {
    score: 2,
    strictOnly: true,
    re: /^[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\s]+$\n^[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\s]+$\n^[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\s]+$/mu,
    label: 'emoji-padding'
  },

  // ── LOW CONFIDENCE (score: 1 each) ──────────────────────────────────────

  // "Agree?" at end of post (standalone)
  {
    score: 1,
    re: /\bagree\s*\?[\s]*$/i,
    label: 'agree-question'
  },
  // "Yes or no?" at end of post
  {
    score: 1,
    re: /\byes\s+or\s+no\s*\?[\s]*$/i,
    label: 'yes-or-no'
  },
  // "What do you think?" with nothing substantive
  {
    score: 1,
    re: /what\s+do\s+you\s+think\s*\?[\s]*$/i,
    label: 'what-do-you-think'
  },
];

// Thresholds per sensitivity level
const THRESHOLDS = {
  strict: 2,    // hide anything that matches even one medium pattern
  moderate: 3,  // hide clear high-confidence bait
  loose: 5,     // only hide when multiple strong patterns match
};

/**
 * Score a piece of text against all patterns.
 * Patterns marked strictOnly are skipped unless sensitivity === 'strict'.
 * Returns { score, labels[] }
 */
function scoreText(text, sensitivity = 'moderate') {
  let total = 0;
  const labels = [];
  for (const pattern of BAIT_PATTERNS) {
    if (pattern.strictOnly && sensitivity !== 'strict') continue;
    if (pattern.re.test(text)) {
      total += pattern.score;
      labels.push(pattern.label);
    }
  }
  return { score: total, labels };
}

/**
 * Returns true if this post should be hidden given the current sensitivity.
 */
function isBait(text, sensitivity = 'moderate') {
  const threshold = THRESHOLDS[sensitivity] ?? THRESHOLDS.moderate;
  const { score } = scoreText(text, sensitivity);
  return score >= threshold;
}

// ── Debug helpers (callable from DevTools console) ────────────────────────────
// Usage:  BlockBaiters.test("Comment YES to get the PDF")
// Usage:  BlockBaiters.scan()  — re-score every visible post text on the page

window.BlockBaiters = {
  test(text, sensitivity = 'moderate') {
    const result = scoreText(text, sensitivity);
    const threshold = THRESHOLDS[sensitivity] ?? 3;
    console.log(`[BlockBaiters] score=${result.score}/${threshold} labels=[${result.labels.join(', ')}] → ${result.score >= threshold ? '🚫 BAIT' : '✅ CLEAN'}`);
    return result;
  },
  scoreText,
  isBait,
  THRESHOLDS,
};
