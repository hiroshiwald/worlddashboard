const AD_TITLE_PATTERNS = [
  /^ad:/i,
  /^sponsored/i,
  /^promoted/i,
  /^advertisement/i,
  /^underscored/i,
  /cnn underscored/i,
  // Commerce / affiliate content
  /best .{0,30} deals/i,
  /best .{0,30} to buy/i,
  /best .{0,30} for 20\d\d/i,
  /best .{0,30} we'?ve tested/i,
  /our favorite .{0,40} of 20\d\d/i,
  /top \d+ .{0,30} (deals|products|gifts)/i,
  /shop .{0,30} sale/i,
  /\d+% off .{0,30}/i,
  /coupon code/i,
  /promo code/i,
  /gift guide/i,
  /deals of the day/i,
  /sale alert/i,
  /save \$?\d+/i,
  /discount code/i,
  /black friday/i,
  /cyber monday/i,
  /prime day/i,
  /where to buy/i,
  /buying guide/i,
  /price drop/i,
  // CNN financial product ads injected into RSS
  /cash ?back card/i,
  /home equity (loan|line|into cash)/i,
  /home equity$/i,
  /into cash you can use/i,
  /cash out of your home/i,
  /credit card interest/i,
  /avoid .{0,20}credit card/i,
  /intro apr/i,
  /\d+% apr/i,
  /0% .{0,15}(apr|interest|intro)/i,
  /balance transfer/i,
  /best .{0,20} card of/i,
  /best .{0,20} credit card/i,
  /best .{0,20} rewards card/i,
  /best .{0,20} travel card/i,
  /best .{0,20} savings (account|rate)/i,
  /high.yield savings/i,
  /refinanc(e|ing) (your|a|the)/i,
  /mortgage rate/i,
  /insurance (rate|quote|plan)/i,
  /personal loan/i,
  /debt (consolidat|relief|pay)/i,
  /student loan (refin|forgiv|rate)/i,
  /experts:.{0,30}(card|loan|rate|account|insur)/i,
  /it'?s official:.{0,30}(card|credit|interest|rate|apr)/i,
  /dream big with/i,
  /rising .{0,15}equity/i,
  /turn your .{0,30}(equity|home)/i,
  /want cash .{0,20}(out|from) .{0,15}home/i,
  /\b(visa|mastercard|amex|discover)\b.{0,20}(card|offer|reward)/i,
  // Newsletter / subscription nags
  /subscribe (now|today|to)/i,
  /sign up for .{0,20} newsletter/i,
  /download our app/i,
  // Horoscopes, lifestyle filler
  /^horoscope/i,
  /^daily horoscope/i,
  /^your .{0,15} horoscope/i,
  /^crossword/i,
  /^wordle/i,
  /^today.s puzzle/i,
];

const AD_LINK_PATTERNS = [
  "/cnn-underscored",
  "/deals/",
  "/shopping/",
  "/ad/",
  "/sponsored/",
  "/partner-content/",
  "/brandcontent/",
  "/paid-partner/",
  "/commerce/",
  "/coupons/",
  "/product-reviews/",
  "affiliate",
  "/buy/",
  "/shop/",
];

const FINANCIAL_AD_PATTERNS = [
  /credit card/i,
  /cash ?back/i,
  /home equity/i,
  /\bapr\b/i,
  /\bloan\b/i,
  /\bmortgage\b/i,
  /\brefinanc/i,
  /\binsurance\b.{0,15}(rate|quote|plan|cost)/i,
  /\bsavings (account|rate)/i,
  /\binterest rate/i,
  /\bdebt (consolidat|relief|pay)/i,
  /your (home|money|credit|debt|rate|savings|equity)/i,
  /experts:.{0,5}(this|the|best)/i,
  /it'?s official/i,
  /dream big/i,
  /cash (out|you can)/i,
  /turn your/i,
  /\b(visa|mastercard|amex)\b/i,
  /\bintro (rate|apr|offer)/i,
  /\b0%.{0,10}(apr|interest|intro)/i,
  /best .{0,20}(card|rate|account)/i,
  /avoid .{0,15}(interest|fee|charge)/i,
  /high.yield/i,
  /\bCD rate/i,
  /balance transfer/i,
  /personal (loan|finance)/i,
  /student loan/i,
];

export function isAdContent(title: string, summary: string, link: string): boolean {
  // Check link patterns
  const linkLower = link.toLowerCase();
  for (const pattern of AD_LINK_PATTERNS) {
    if (linkLower.includes(pattern)) return true;
  }

  // Check title patterns
  for (const pattern of AD_TITLE_PATTERNS) {
    if (pattern.test(title)) return true;
  }

  // Check combined text for paid content markers
  const text = `${title} ${summary}`.toLowerCase();
  if (/paid (content|partner|post|promotion)/i.test(text)) return true;
  if (/\baffiliate\b/i.test(text) && /\b(link|commission|earn)\b/i.test(text)) return true;

  return false;
}

export function isFinancialAd(title: string): boolean {
  for (const pattern of FINANCIAL_AD_PATTERNS) {
    if (pattern.test(title)) return true;
  }
  return false;
}
