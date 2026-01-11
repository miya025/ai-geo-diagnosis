export interface Profile {
    id: string;
    is_premium: boolean;
    free_credits: number;
    credits_reset_at: string | null;
    language: 'ja' | 'en';
    created_at: string;
}

export interface AnalysisResult {
    id: string;
    url_hash: string;
    content_hash: string;
    overall_score: number;
    detail_scores: {
        structure: number;
        context: number;
        freshness: number;
        credibility: number;
    };
    advice_data: any;
    model?: string;
    created_at: string;
}
