// Curated project bank for resume personalization.
// Source of truth: D:\portfolio\src\constants.ts
// Each project includes the metadata the AI personalizer needs to pick + tailor bullets.

export interface ProjectBankItem {
  slug: string;
  title: string;
  subtitle: string;
  tagline: string;
  oneLiner: string;
  problem: string;
  approach: string;
  outcome: string;
  techStack: string[];
  repoUrl: string;
  liveUrl?: string;
  year: string;
  featured: boolean;
}

export const PROJECT_BANK: ProjectBankItem[] = [
  {
    slug: "homeheart",
    title: "HomeHeart",
    subtitle: "Real Estate Platform",
    tagline: "The listing platform that ships its own price model.",
    oneLiner:
      "A real-estate listing platform unifying rent/buy/plot in one schema with an in-house XGBoost price-prediction model served behind a Next.js API.",
    problem:
      "Indian real-estate classifieds split rent, buy, and plot listings into separate verticals; first-time sellers have no way to sanity-check pricing without a broker.",
    approach:
      "Collapsed all three modes into a shared schema with mode-aware filters; trained an XGBoost regressor on local listings served from a Python sidecar with response caching.",
    outcome:
      "Unified rent/buy/plot into a single flow with working price predictions from the XGBoost sidecar. Submitted to Rubix '25 with all acceptance criteria met and still live on Vercel.",
    techStack: ["Next.js 14", "Sanity CMS", "NextAuth.js", "Tailwind CSS", "Shadcn UI", "Geoapify", "Python", "XGBoost"],
    repoUrl: "https://github.com/varun-101/rubix25_71_backlog",
    liveUrl: "https://rubix25-71-backlog.vercel.app/",
    year: "2025",
    featured: true,
  },
  {
    slug: "hackorchestrate",
    title: "HackerRank Orchestrate",
    subtitle: "AI Ticket Triage Agent",
    tagline: "A 4-stage RAG pipeline that routes support tickets without hallucinating.",
    oneLiner:
      "Terminal AI agent that triages support tickets across HackerRank/Claude/Visa product domains via a 4-layer pipeline with injection guards, hybrid retrieval, grounded generation, and a hallucination validator.",
    problem:
      "Support teams waste hours triaging tickets across multiple product ecosystems; unchecked LLMs fabricate policies and route incorrectly.",
    approach:
      "Four isolated layers: L1 injection-guard + language detect, L2 hybrid BM25 + dense embedding retrieval with reranker, L3 DeepSeek-driven grounded generation, L4 schema and hallucination validator. Per-stage observability traces.",
    outcome:
      "Processed all provided tickets with zero hallucinated policy claims; operates entirely on a local corpus (no external data calls), meeting the hackathon's hard constraint.",
    techStack: ["Python", "DeepSeek API", "BM25", "Vector Embeddings", "Hybrid RAG", "Reranker"],
    repoUrl: "https://github.com/varun-101/hackerrank-orchestrate-may26",
    year: "2026",
    featured: true,
  },
  {
    slug: "devmeet",
    title: "DevMeet AI",
    subtitle: "Google Meet Bot → GitHub PR",
    tagline: "Joins the meeting, speaks up, ships the code, opens the PR.",
    oneLiner:
      "Autonomous Google Meet bot that joins, participates via TTS, records audio, transcribes it, hands the transcript to Gemini CLI which implements discussed changes and opens a GitHub PR — no human in the loop.",
    problem:
      "Remote teams discuss code changes in meetings then spend hours manually implementing them; meeting notes rarely translate to merged PRs.",
    approach:
      "Two-phase pipeline. Phase 1: Selenium browser with a virtual ALSA audio stack — ffmpeg records, pyttsx3 routes TTS through a virtual mic; a stealth layer evades bot detection. Phase 2: transcript → Gemini CLI → code edits → automated GitHub PR.",
    outcome:
      "Closes the loop from meeting invite to merged PR with zero human intervention; successfully joins live Meet sessions undetected and produces a structured PR with the full diff.",
    techStack: ["Python", "Selenium", "pyttsx3", "ffmpeg", "Linux ALSA", "Gemini CLI", "GitHub API"],
    repoUrl: "https://github.com/varun-101/gmeet_bot",
    year: "2025",
    featured: true,
  },
  {
    slug: "gmailotp",
    title: "Gmail OTP Auto-Copy",
    subtitle: "Chrome Extension",
    tagline: "Zero-friction OTP copying, straight from Gmail.",
    oneLiner:
      "Chrome extension that uses Gmail Push Notifications via Google Cloud Pub/Sub to detect 4–8 digit OTPs in real time, copy them to clipboard, and fire desktop notifications — no polling, no delay.",
    problem:
      "Switching between Gmail and the app you're authenticating against to copy OTPs breaks focus, especially during automated test flows.",
    approach:
      "OAuth2 once, then Pub/Sub webhooks deliver new email events; regex extracts OTPs and writes to clipboard automatically.",
    outcome:
      "Eliminates manual OTP copying entirely; codes are detected and copied within seconds of email arrival across common OTP formats.",
    techStack: ["JavaScript", "Chrome Extension API", "Gmail API", "OAuth2", "Google Cloud Pub/Sub", "Node.js"],
    repoUrl: "https://github.com/varun-101/Email-Auto-fill-Extension",
    year: "2024",
    featured: false,
  },
  {
    slug: "expensesharing",
    title: "Expense Sharing App",
    subtitle: "Python Desktop App",
    tagline: "Split bills fairly, settle smarter.",
    oneLiner:
      "Offline-first Tkinter + SQLite desktop app for group expenses with mixed equal/exact/percentage splits, Azure receipt OCR, and a greedy settlement optimizer.",
    problem:
      "Group expense apps either lock split modes or force cloud signup; teams need flexible offline tooling.",
    approach:
      "Tkinter GUI + SQLite for offline storage; Azure Document Intelligence for receipt OCR; greedy algorithm minimizes the transaction count needed to settle group debts.",
    outcome:
      "Mixable split modes within a single expense; greedy optimizer reduces required transfers by 40–60% vs naive pair-wise settlement.",
    techStack: ["Python", "Tkinter", "SQLite", "Azure Document Intelligence"],
    repoUrl: "https://github.com/varun-101/expense-sharing-app",
    year: "2024",
    featured: false,
  },
  {
    slug: "aicrawler",
    title: "AI Web Crawler",
    subtitle: "Schema-driven Scraper",
    tagline: "Describe the data you want. Get structured JSON.",
    oneLiner:
      "Python GUI scraper that takes a URL plus a JSON schema and uses Gemini to extract structured data — no selectors, no brittle XPath.",
    problem:
      "Traditional scrapers depend on brittle CSS/XPath that breaks on redesigns; non-developers can't extract data from arbitrary sites.",
    approach:
      "Tkinter GUI for URL + schema input; BeautifulSoup strips to readable text; Gemini extracts only the requested schema fields.",
    outcome:
      "Works on pages that would require dozens of hand-crafted selectors; new sites require zero additional code.",
    techStack: ["Python", "Gemini API", "BeautifulSoup", "Tkinter", "JSON Schema"],
    repoUrl: "https://github.com/varun-101/ai_crawler",
    year: "2024",
    featured: false,
  },
];

export function getProject(slug: string): ProjectBankItem | undefined {
  return PROJECT_BANK.find((p) => p.slug === slug);
}
