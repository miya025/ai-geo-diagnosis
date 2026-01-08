import * as cheerio from 'cheerio';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';

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
}

export async function scrapeUrl(url: string): Promise<StructuredLP> {
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
    };
  } finally {
    await browser.close();
  }
}
