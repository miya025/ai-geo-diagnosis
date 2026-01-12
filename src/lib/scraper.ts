import * as cheerio from 'cheerio';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import dns from 'dns/promises';

// ========================================
// SSRF対策: URLバリデーション
// ========================================

// プライベートIPレンジの正規表現パターン
const PRIVATE_IP_PATTERNS = [
  /^10\./,                          // 10.0.0.0/8
  /^172\.(1[6-9]|2[0-9]|3[01])\./,  // 172.16.0.0/12
  /^192\.168\./,                    // 192.168.0.0/16
  /^169\.254\./,                    // Link-local (AWS metadata等)
  /^127\./,                         // Loopback
  /^0\./,                           // 0.0.0.0/8
  /^100\.(6[4-9]|[7-9][0-9]|1[0-2][0-7])\./,  // Carrier-grade NAT
  /^198\.1[89]\./,                  // Benchmark testing
  /^::1$/,                          // IPv6 loopback
  /^fc/i,                           // IPv6 private
  /^fd/i,                           // IPv6 private
  /^fe80:/i,                        // IPv6 link-local
];

// 禁止ホスト名
const BLOCKED_HOSTNAMES = [
  'localhost',
  '127.0.0.1',
  '::1',
  '0.0.0.0',
  'metadata.google.internal',       // GCP metadata
  'metadata.google.cloud',
];

// 禁止ドメインパターン（AWSメタデータなど）
const BLOCKED_DOMAIN_PATTERNS = [
  /^169\.254\.169\.254$/,           // AWS/GCP/Azure metadata
  /^metadata\./i,
  /\.internal$/i,
  /\.local$/i,
];

/**
 * IPアドレスがプライベートレンジかどうかを検証
 */
function isPrivateIP(ip: string): boolean {
  return PRIVATE_IP_PATTERNS.some(pattern => pattern.test(ip));
}

/**
 * ホスト名が禁止リストに含まれているかを検証
 */
function isBlockedHostname(hostname: string): boolean {
  const lowerHostname = hostname.toLowerCase();

  // 完全一致チェック
  if (BLOCKED_HOSTNAMES.includes(lowerHostname)) {
    return true;
  }

  // パターンマッチチェック
  if (BLOCKED_DOMAIN_PATTERNS.some(pattern => pattern.test(lowerHostname))) {
    return true;
  }

  return false;
}

/**
 * URLのセキュリティ検証（SSRF対策）
 * @throws Error 安全でないURLの場合
 */
async function validateUrlSecurity(url: string): Promise<void> {
  let parsed: URL;

  try {
    parsed = new URL(url);
  } catch {
    throw new Error('無効なURL形式です');
  }

  // 1. プロトコル検証
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('HTTP/HTTPSプロトコルのみ許可されています');
  }

  // 2. ホスト名検証
  const hostname = parsed.hostname;

  if (!hostname) {
    throw new Error('ホスト名が指定されていません');
  }

  if (isBlockedHostname(hostname)) {
    throw new Error('このホストへのアクセスは許可されていません');
  }

  // 3. IPアドレス形式の場合はプライベートIP検証
  if (isPrivateIP(hostname)) {
    throw new Error('プライベートIPアドレスへのアクセスは許可されていません');
  }

  // 4. DNS解決してIPアドレスを検証（DNS rebinding対策）
  try {
    // IPv4アドレスを取得
    const addresses = await dns.resolve4(hostname).catch(() => []);

    for (const addr of addresses) {
      if (isPrivateIP(addr)) {
        throw new Error('このドメインが解決するIPアドレスへのアクセスは許可されていません');
      }
    }

    // IPv6アドレスも検証
    const ipv6Addresses = await dns.resolve6(hostname).catch(() => []);

    for (const addr of ipv6Addresses) {
      if (isPrivateIP(addr)) {
        throw new Error('このドメインが解決するIPアドレスへのアクセスは許可されていません');
      }
    }
  } catch (dnsError) {
    // DNS解決エラーの場合は処理を続行（Puppeteerがエラーを処理する）
    if (dnsError instanceof Error && dnsError.message.includes('許可されていません')) {
      throw dnsError;
    }
    // その他のDNSエラーは無視（ホスト名が存在しない場合など）
  }

  // 5. ポート検証（標準ポート以外を制限する場合）
  const port = parsed.port;
  if (port && !['80', '443', '8080', '8443', '3000', '5000'].includes(port)) {
    console.warn(`Non-standard port detected: ${port}`);
    // 非標準ポートは警告のみ（必要に応じてブロック）
  }
}

// Vercelサーバーレス環境かどうかを判定
const isVercel = process.env.VERCEL === '1' || process.env.AWS_LAMBDA_FUNCTION_NAME;

export interface StructuredLP {
  url: string;
  hero: {
    headline: string;
    subHeadline: string;
    cta: string;
    hasHeroImage: boolean;
  };
  valueProps: string[];
  proof: {
    testimonials: string[];
    stats: string[];
    hasLogos: boolean;
    media: string[];
  };
  pricing: {
    displayed: boolean;
    text: string;
  };
  faq: string[];
  trustSignals: {
    hasCompanyInfo: boolean;
    hasPrivacyPolicy: boolean;
    hasTokushoho: boolean;
    hasContact: boolean;
  };
  urgency: string[];
  ctas: string[];
  meta: {
    title: string;
    description: string;
  };
  screenshot: string; // Base64 image
  bodyText: string; // 記事本文テキスト
  codeBlocks: string[]; // コードスニペット
  headings: { level: number; text: string }[]; // 見出し構造
  links: { type: 'internal' | 'external'; url: string; text: string }[]; // リンク情報
  tables: { headers: string[]; rows: string[][] }[]; // テーブル・比較表
}

export async function scrapeUrl(url: string): Promise<StructuredLP> {
  // SSRF対策: URLのセキュリティ検証
  await validateUrlSecurity(url);

  // Vercel環境用のブラウザ設定
  const browserOptions = isVercel
    ? {
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: true,
    }
    : {
      // ローカル環境（macOS）用の設定
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      executablePath: process.platform === 'darwin'
        ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
        : process.platform === 'win32'
          ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
          : '/usr/bin/google-chrome',
      headless: true,
    };

  const browser = await puppeteer.launch(browserOptions);

  try {
    const page = await browser.newPage();

    // ビューポートを一般的なデスクトップサイズに設定
    await page.setViewport({ width: 1280, height: 800 });

    // ページ遷移とレンダリング待機
    // timeout: 30秒, waitUntil: networkidle0 (ネットワーク接続がなくなるまで待機)
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });

    // スクリーンショット撮影 (JPEG, quality 80, Base64エンコード)
    // Vision APIの容量制限やコストを考慮してJPEG圧縮
    const screenshotBuffer = await page.screenshot({
      type: 'jpeg',
      quality: 80,
      fullPage: false, // ファーストビュー重視（または必要に応じてfullPage: trueに変更）
      encoding: 'base64'
    });

    // 型アサーション (base64エンコーディングを指定した場合はstringが返る)
    const screenshot = screenshotBuffer as string;

    // HTMLコンテンツの取得
    const html = await page.content();
    const $ = cheerio.load(html);

    // 不要な要素を除去
    $('script, style, noscript, iframe, svg, nav, footer').remove();

    // === Hero セクション ===
    const h1 = $('h1').first().text().trim();
    const heroSection = $('header, [class*="hero"], [class*="Hero"], section').first();
    const subHeadline = heroSection.find('p, h2').first().text().trim().slice(0, 200);
    const heroCta = heroSection.find('a, button').first().text().trim();
    const hasHeroImage = heroSection.find('img').length > 0 || $('[class*="hero"] img').length > 0;

    // === 価値提案 ===
    const valueProps: string[] = [];
    $('h2, h3').each((_, el) => {
      const text = $(el).text().trim();
      if (text && text.length < 100 && !text.match(/FAQ|よくある|お問い合わせ|会社概要/)) {
        valueProps.push(text);
      }
    });

    // === 社会的証明 ===
    const testimonials: string[] = [];
    $('[class*="testimonial"], [class*="review"], [class*="voice"], [class*="お客様"]').each((_, el) => {
      const text = $(el).text().trim().slice(0, 300);
      if (text) testimonials.push(text);
    });

    // 実績数値（数字を含むテキスト）
    const stats: string[] = [];
    $('*').each((_, el) => {
      const text = $(el).clone().children().remove().end().text().trim();
      if (text.match(/\d+[%万件人社名]/)) {
        stats.push(text.slice(0, 100));
      }
    });

    const hasLogos = $('[class*="logo"], [class*="client"], [class*="partner"]').length > 0;

    const media: string[] = [];
    $('[class*="media"], [class*="掲載"]').each((_, el) => {
      const text = $(el).text().trim().slice(0, 100);
      if (text) media.push(text);
    });

    // === 価格情報 ===
    const pricingSection = $('[class*="price"], [class*="pricing"], [class*="料金"], [class*="プラン"]');
    const pricingText = pricingSection.text().trim().slice(0, 500);
    const hasPricing = pricingSection.length > 0 || $('*').text().match(/[¥￥][0-9,]+|月額|年額/) !== null;

    // === FAQ ===
    const faq: string[] = [];
    $('[class*="faq"], [class*="FAQ"], dt, [class*="question"]').each((_, el) => {
      const text = $(el).text().trim().slice(0, 200);
      if (text && text.includes('？') || text.includes('?')) {
        faq.push(text);
      }
    });

    // === 信頼要素 ===
    const pageText = $('body').text().toLowerCase();
    const hasCompanyInfo = pageText.includes('会社概要') || pageText.includes('運営会社') || pageText.includes('about');
    const hasPrivacyPolicy = pageText.includes('プライバシー') || pageText.includes('privacy');
    const hasTokushoho = pageText.includes('特定商取引') || pageText.includes('特商法');
    const hasContact = pageText.includes('お問い合わせ') || pageText.includes('contact');

    // === 緊急性 ===
    const urgency: string[] = [];
    const urgencyPatterns = /期間限定|今だけ|残り|限定|先着|締切|終了間近|急げ|今すぐ/g;
    $('*').each((_, el) => {
      const text = $(el).clone().children().remove().end().text().trim();
      if (text.match(urgencyPatterns)) {
        urgency.push(text.slice(0, 100));
      }
    });

    // === CTA ===
    const ctas: string[] = [];
    $('button, a[class*="btn"], a[class*="button"], input[type="submit"], [class*="cta"]').each((_, el) => {
      const text = $(el).text().trim() || $(el).attr('value') || '';
      if (text && text.length < 50) ctas.push(text);
    });

    // === メタ情報 ===
    const title = $('title').text().trim();
    const description = $('meta[name="description"]').attr('content')?.trim() || '';

    // === 本文テキスト抽出 ===
    const bodyParagraphs: string[] = [];
    // article, main, sectionから段落テキストを抽出
    $('article p, main p, section p, .content p, .post p, .entry p, .body p').each((_, el) => {
      const text = $(el).text().trim();
      if (text && text.length > 30) { // 短すぎるテキストは除外
        bodyParagraphs.push(text);
      }
    });
    // 上記で取得できなかった場合、一般的なpタグから取得
    if (bodyParagraphs.length === 0) {
      $('p').each((_, el) => {
        const text = $(el).text().trim();
        if (text && text.length > 30) {
          bodyParagraphs.push(text);
        }
      });
    }
    // 本文テキストを結合（最大5000文字に制限）
    const bodyText = [...new Set(bodyParagraphs)].join('\n\n').slice(0, 5000);

    // === コードブロック抽出 ===
    const codeBlocks: string[] = [];
    $('pre, pre code, code').each((_, el) => {
      const code = $(el).text().trim();
      // 短すぎるコード（インラインコード）や長すぎるコードは除外
      if (code && code.length > 20 && code.length < 3000) {
        codeBlocks.push(code);
      }
    });

    // === 見出し構造抽出 ===
    const headings: { level: number; text: string }[] = [];
    $('h1, h2, h3, h4, h5, h6').each((_, el) => {
      const tagName = $(el).prop('tagName')?.toLowerCase() || '';
      const level = parseInt(tagName.replace('h', ''), 10);
      const text = $(el).text().trim();
      if (text && text.length < 200) {
        headings.push({ level, text });
      }
    });

    // === テーブル抽出 ===
    const tables: { headers: string[]; rows: string[][] }[] = [];
    $('table').each((_, tableEl) => {
      const headers: string[] = [];
      const rows: string[][] = [];

      // ヘッダー抽出（thead内のth/td、または最初のtr内のth）
      $(tableEl).find('thead th, thead td, tr:first-child th').each((_, th) => {
        headers.push($(th).text().trim());
      });

      // 行データ抽出
      $(tableEl).find('tbody tr, tr').each((rowIdx, tr) => {
        // ヘッダー行はスキップ
        if (rowIdx === 0 && headers.length > 0) return;
        const cells: string[] = [];
        $(tr).find('td, th').each((_, cell) => {
          cells.push($(cell).text().trim());
        });
        if (cells.length > 0 && cells.some(c => c)) {
          rows.push(cells);
        }
      });

      if (headers.length > 0 || rows.length > 0) {
        tables.push({ headers, rows });
      }
    });

    // === リンク抽出 ===
    const parsedUrl = new URL(url);
    const links: { type: 'internal' | 'external'; url: string; text: string }[] = [];
    $('a[href]').each((_, el) => {
      const href = $(el).attr('href') || '';
      const text = $(el).text().trim();
      if (!href || !text || text.length > 100) return;
      // 相対パス、同一ドメイン → internal
      // 異なるドメイン → external
      try {
        const linkUrl = new URL(href, url);
        const type = linkUrl.hostname === parsedUrl.hostname ? 'internal' : 'external';
        links.push({ type, url: href, text });
      } catch {
        // 無効なURLは無視
      }
    });

    return {
      url,
      hero: {
        headline: h1 || valueProps[0] || '',
        subHeadline,
        cta: heroCta,
        hasHeroImage,
      },
      valueProps: [...new Set(valueProps)].slice(0, 10),
      proof: {
        testimonials: [...new Set(testimonials)].slice(0, 5),
        stats: [...new Set(stats)].slice(0, 10),
        hasLogos,
        media: [...new Set(media)].slice(0, 5),
      },
      pricing: {
        displayed: hasPricing,
        text: pricingText.slice(0, 500),
      },
      faq: [...new Set(faq)].slice(0, 10),
      trustSignals: {
        hasCompanyInfo,
        hasPrivacyPolicy,
        hasTokushoho,
        hasContact,
      },
      urgency: [...new Set(urgency)].slice(0, 5),
      ctas: [...new Set(ctas)].slice(0, 10),
      meta: {
        title,
        description,
      },
      screenshot,
      bodyText,
      codeBlocks: [...new Set(codeBlocks)].slice(0, 10),
      headings: headings.slice(0, 30),
      links: links.slice(0, 20),
      tables: tables.slice(0, 10),
    };
  } finally {
    await browser.close();
  }
}
