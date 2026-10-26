// FILE: spam.ts
// WEBSITE FEATURE: spam filtering for the "Request a Consultation" form and the
// video library gate form. Gives each submission a score; at or above
// SPAM_SCORE_THRESHOLD the lead is flagged (logged, not sent on).
// USED BY: routes/lead.ts and routes/library.ts.
//
// Throwaway-email services. +4 points each. Add domains (lowercase) here.
// A small, easily-extended list — not exhaustive. Add domains as real spam
// patterns are observed in the audit log.
const DISPOSABLE_EMAIL_DOMAINS = new Set([
  'mailinator.com', 'guerrillamail.com', 'tempmail.com', '10minutemail.com',
  'yopmail.com', 'throwawaymail.com', 'trashmail.com', 'getnada.com',
  'sharklasers.com', 'dispostable.com',
]);

// Phrases often seen in spam messages. +3 points for EACH one found in the
// message (case-insensitive). Be careful adding phrases a real client might
// write (e.g. "wire transfer" could appear in a genuine tax question).
const SPAM_KEYWORDS = [
  'seo services', 'backlink', 'crypto investment', 'bitcoin opportunity',
  'work from home', 'click here to claim', 'viagra', 'weight loss pill',
  'guaranteed loan', 'wire transfer', 'inheritance fund', 'casino bonus',
];

// A score of 5 or more = spam. Lower it to be stricter (more false alarms),
// raise it to be more lenient (more spam gets through).
export const SPAM_SCORE_THRESHOLD = 5;

// What the routes pass in for scoring.
export interface SpamCheckInput {
  // The hidden "honeypot" field: invisible to people, so only bots fill it in.
  honeypot: string;
  userAgent: string | null;
  email: string;
  message: string;
}

// score = total points; reasons = short labels saved to the audit log.
export interface SpamCheckResult {
  score: number;
  reasons: string[];
  isHoneypot: boolean;
}

// Adds up spam points for one submission. Input: honeypot, browser user-agent,
// email, message. Returns: { score, reasons, isHoneypot }. No side effects.
export function computeSpamScore(input: SpamCheckInput): SpamCheckResult {
  const reasons: string[] = [];
  let score = 0;

  const isHoneypot = input.honeypot.trim().length > 0;
  if (isHoneypot) {
    // Caller short-circuits on this — scoring the rest is unnecessary once a
    // honeypot fires, but we still report it for the audit log.
    reasons.push('honeypot_filled');
    return { score: 100, reasons, isHoneypot: true };
  }

  // Rule: no browser identification (typical of scripts) -> +2.
  if (!input.userAgent || input.userAgent.trim().length < 5) {
    score += 2;
    reasons.push('missing_or_short_user_agent');
  }

  // Rule: throwaway email domain -> +4.
  const emailDomain = input.email.split('@')[1]?.toLowerCase();
  if (emailDomain && DISPOSABLE_EMAIL_DOMAINS.has(emailDomain)) {
    score += 4;
    reasons.push('disposable_email_domain');
  }

  // Rule: each spam phrase in the message -> +3.
  const lowerMessage = input.message.toLowerCase();
  for (const kw of SPAM_KEYWORDS) {
    if (lowerMessage.includes(kw)) {
      score += 3;
      reasons.push(`spam_keyword:${kw}`);
    }
  }

  // Rule: 2 or more web links in the message -> +3.
  const linkCount = (input.message.match(/https?:\/\//gi) || []).length;
  if (linkCount >= 2) {
    score += 3;
    reasons.push('multiple_links_in_message');
  }

  return { score, reasons, isHoneypot: false };
}
