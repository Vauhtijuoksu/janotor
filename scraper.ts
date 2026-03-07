/**
 * Kentaa/iRaiser fundraiser donation scraper (Deno)
 *
 * Scrapes public donation data + fundraiser metadata (total raised, target amount)
 * from Kentaa (iRaiser) community fundraising pages.
 *
 * Usage:
 *   deno run --allow-net kentaa_scraper.ts <fundraiser_url>
 *   deno run --allow-net kentaa_scraper.ts https://omakerays.sairaalaklovnit.fi/fundraisers/aino-viertola
 */

import { parseHTML } from "npm:linkedom";

interface Donation {
  timestamp: string | null;
  name: string;
  amount: number;
  currency: string;
  message: string;
}

interface Fundraiser {
  title: string;
  owner: string;
  total_amount: number;
  target_amount: number;
  currency: string;
  percentage: number;
  donation_count: number;
  url: string;
  donations: Donation[];
}

// --- SJR / donation parsing (AJAX tab response) ---

function extractHtmlFromSjr(js: string): string | null {
  const match = js.match(/\.html\('(.+?)'\)\.promise\(\)/s);
  if (!match) return null;

  return match[1]
    .replace(/\\\//g, "/")
    .replace(/\\n/g, "\n")
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'")
    .replace(/\\u([0-9a-fA-F]{4})/g, (_: string, hex: string) =>
      String.fromCharCode(parseInt(hex, 16))
    );
}

function parseDate(raw: string): string | null {
  const m = raw.match(/(\d{2})-(\d{2})-(\d{4}) \| (\d{2}):(\d{2})/);
  if (!m) return null;
  const [, dd, mm, yyyy, hh, min] = m;
  return `${yyyy}-${mm}-${dd}T${hh}:${min}:00`;
}

function parseDonations(html: string): Donation[] {
  const { document } = parseHTML(`<html><body>${html}</body></html>`);
  const items = document.querySelectorAll(".list-group-item");
  const donations: Donation[] = [];

  for (const item of items) {
    const dateEl = item.querySelector(".date");
    const amountEl = item.querySelector(".amount");
    const nameEl = item.querySelector(".name");
    const descrEl = item.querySelector(".descr");

    if (!dateEl || !amountEl || !nameEl) continue;

    const rawDate = (dateEl.textContent ?? "").trim();
    const currency = amountEl.getAttribute("data-before-content") ?? "€";
    const amount =
      parseFloat((amountEl.textContent ?? "0").trim().replace(",", ".")) || 0;

    donations.push({
      timestamp: parseDate(rawDate),
      name: (nameEl.textContent ?? "").trim(),
      amount,
      currency,
      message: (descrEl?.textContent ?? "").trim(),
    });
  }

  return donations;
}

// --- Fundraiser metadata parsing (main page HTML) ---

function parseAmount(text: string): number {
  // Handle "1 000", "205", "1.000", "1,000.50" etc.
  const cleaned = text
    .replace(/[€$£\s]/g, "")
    .replace(/\u00a0/g, "") // non-breaking space
    .replace(/\./g, "")     // thousand separator (EU)
    .replace(",", ".");     // decimal separator (EU)
  return parseFloat(cleaned) || 0;
}

function parseFundraiserMeta(html: string): Partial<Fundraiser> {
  const { document } = parseHTML(html);
  const meta: Partial<Fundraiser> = {};

  // Title: first <h1> on the page (appears in the hero area)
  const h1s = document.querySelectorAll("h1");
  for (const h1 of h1s) {
    const text = (h1.textContent ?? "").trim();
    if (text && !text.match(/^(KERÄTTY|Collected|Inzameling)/i)) {
      meta.title = text;
      break;
    }
  }

  // Owner: the text right after the h1 title, often in a standalone text node
  // Kentaa puts it as a plain text/span near the title.
  // Look for the pattern: after h1 there's the owner name before the donations link.
  const body = document.body?.textContent ?? "";

  // Owner: find "Aino Viertola" style name after the title
  if (meta.title) {
    const titleIdx = body.indexOf(meta.title);
    if (titleIdx !== -1) {
      const afterTitle = body.slice(titleIdx + meta.title.length, titleIdx + meta.title.length + 200);
      const ownerMatch = afterTitle.match(/^\s*([A-ZÀ-Ž][a-zà-ž]+(?:\s+[A-ZÀ-Ž][a-zà-ž]+)+)/);
      if (ownerMatch) {
        meta.owner = ownerMatch[1].trim();
      }
    }
  }

  // Total amount: look for the progress/stats section
  // Pattern in the HTML text: "205 €Kerätty" or "205 €Collected"
  // Or in the detailed section: "KERÄTTY\n\n205"
  const totalMatch = body.match(/(\d[\d\s.,]*)\s*€\s*(?:Kerätty|Collected|Ingezameld)/);
  if (totalMatch) {
    meta.total_amount = parseAmount(totalMatch[1]);
  }

  // Target amount: "1 000 €" near "Tavoitteeni" / "My target" / "Mijn doel"
  // Pattern: "1 000 €\n\nTavoitteeni"
  const targetMatch = body.match(/([\d\s.,]+)\s*€\s*\n?\s*(?:Tavoitteeni|Tavoite|My target|Target|Mijn doel|Streefbedrag)/);
  if (targetMatch) {
    meta.target_amount = parseAmount(targetMatch[1]);
  }

  // Also try: pattern where target appears as "**1 000 €**" near "saavuttanut"
  if (!meta.target_amount) {
    const targetMatch2 = body.match(/saavuttanut\s+tavoitesummani\s*([\d\s.,]+)\s*€/);
    if (targetMatch2) {
      meta.target_amount = parseAmount(targetMatch2[1]);
    }
  }

  // Percentage
  const pctMatch = body.match(/(\d+)\s*%\s*\n?\s*(?:Saavutettu|Achieved|Behaald)/);
  if (pctMatch) {
    meta.percentage = parseInt(pctMatch[1]);
  }

  // Donation count: "6 lahjoitukset" / "6 donations" / "6 donaties"
  const countMatch = body.match(/(\d+)\s+(?:lahjoituk|donation|donatie)/i);
  if (countMatch) {
    meta.donation_count = parseInt(countMatch[1]);
  }

  meta.currency = "€";

  return meta;
}

// --- Fetching ---

async function fetchFundraiserPage(baseUrl: string): Promise<string> {
  const url = baseUrl.replace(/\/+$/, "").replace(/\/(donations|donors|updates)$/, "");

  const resp = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; donation-scraper/1.0)",
    },
  });

  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
  return resp.text();
}

async function fetchDonationPage(
  baseUrl: string,
  page = 1
): Promise<{ donations: Donation[]; hasMore: boolean }> {
  let url = baseUrl.replace(/\/+$/, "").replace(/\/(donations|donors|updates)$/, "");
  url += "/donations";
  if (page > 1) url += `?page=${page}`;

  const resp = await fetch(url, {
    headers: {
      "X-Requested-With": "XMLHttpRequest",
      Accept: "text/javascript, application/javascript",
      "User-Agent": "Mozilla/5.0 (compatible; donation-scraper/1.0)",
    },
  });

  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);

  const js = await resp.text();
  const html = extractHtmlFromSjr(js);
  if (!html) return { donations: [], hasMore: false };

  const donations = parseDonations(html);

  const { document } = parseHTML(`<html><body>${html}</body></html>`);
  const loadMore = document.querySelector(".js-load-more-holder");
  const pagination = document.querySelector(".pagination");
  const hasMore = !!(
    (loadMore && (loadMore.textContent ?? "").trim()) ||
    (pagination && pagination.querySelector("a"))
  );

  return { donations, hasMore };
}

async function fetchAll(baseUrl: string, maxPages = 50): Promise<Fundraiser> {
  // Fetch metadata from the main fundraiser page
  const pageHtml = await fetchFundraiserPage(baseUrl);
  const meta = parseFundraiserMeta(pageHtml);

  // Fetch all donation pages
  const allDonations: Donation[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const { donations, hasMore } = await fetchDonationPage(baseUrl, page);
    if (donations.length === 0) break;
    allDonations.push(...donations);
    if (!hasMore) break;
  }

  const cleanUrl = baseUrl.replace(/\/+$/, "").replace(/\/(donations|donors|updates)$/, "");

  return {
    title: meta.title ?? "",
    owner: meta.owner ?? "",
    total_amount: meta.total_amount ?? 0,
    target_amount: meta.target_amount ?? 0,
    currency: meta.currency ?? "€",
    percentage: meta.percentage ?? 0,
    donation_count: meta.donation_count ?? allDonations.length,
    url: cleanUrl,
    donations: allDonations,
  };
}

// --- main ---

const url = Deno.args[0];
if (!url) {
  console.error(
    "Usage: deno run --allow-net kentaa_scraper.ts <fundraiser_url>"
  );
  Deno.exit(1);
}

const result = await fetchAll(url);
console.log(JSON.stringify(result, null, 2));
