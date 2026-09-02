import axios from 'axios';
import { Logger } from '@nestjs/common';

export class AudioTranscriptionService {
  private static readonly logger = new Logger(AudioTranscriptionService.name);

  // Common Whisper hallucinations on silent, short, or background noise audio
  private static readonly HALLUCINATION_PATTERNS = [
    /thank you for watching/i,
    /subtitles by/i,
    /amara\.org/i,
    /please subscribe/i,
    /transcribed by/i,
    /watching/i,
    /mbc/i,
    /subtitle/i,
    /captions by/i,
    /for more videos/i,
  ];

  /**
   * Transcribes an audio buffer with robust cascading fallback:
   * 1. Groq Whisper Turbo (whisper-large-v3-turbo)
   * 2. Groq Whisper Large (whisper-large-v3)
   * 3. Google Gemini Multimodal Audio (gemini-1.5-flash)
   * 4. OpenAI Whisper (whisper-1)
   */
  public static async transcribeAudio(
    audioBuffer: Buffer,
    filename = 'voice.ogg',
    mimeType = 'audio/ogg',
  ): Promise<string | null> {
    const groqKey =
      process.env.GROQ_API_KEY ||
      (process.env.LLM_PROVIDER === 'groq' ? process.env.LLM_API_KEY : null);
    const geminiKey =
      process.env.GEMINI_API_KEY ||
      (process.env.LLM_PROVIDER === 'gemini' ? process.env.LLM_API_KEY : null);
    const openaiKey =
      process.env.OPENAI_API_KEY ||
      (process.env.LLM_PROVIDER === 'openai' ? process.env.LLM_API_KEY : null);

    // 1. Try Groq Whisper Models (Turbo first, then standard Large V3)
    if (groqKey && groqKey.startsWith('gsk_')) {
      for (const model of ['whisper-large-v3-turbo', 'whisper-large-v3']) {
        try {
          const formData = new FormData();
          formData.append(
            'file',
            new Blob([new Uint8Array(audioBuffer)], { type: mimeType }),
            filename,
          );
          formData.append('model', model);
          formData.append('response_format', 'json');
          formData.append(
            'prompt',
            'Chai 20, Lunch 150, Uber 250, Groceries 500, paid 1200, rent 15000, Swiggy, Zomato',
          );

          const res = await axios.post(
            'https://api.groq.com/openai/v1/audio/transcriptions',
            formData,
            {
              headers: {
                Authorization: `Bearer ${groqKey}`,
              },
              timeout: 10000,
            },
          );

          const rawText = (res.data?.text || '').trim();
          const cleaned = this.cleanTranscript(rawText);
          if (cleaned) {
            this.logger.log(
              `Audio successfully transcribed via Groq (${model}): "${cleaned}"`,
            );
            return cleaned;
          }
        } catch (err: any) {
          this.logger.warn(
            `Groq Whisper (${model}) attempt failed: ${err?.response?.data?.error?.message || err?.message}`,
          );
        }
      }
    }

    // 2. Fallback to Google Gemini Multimodal Audio (Gemini 1.5 Flash)
    if (geminiKey) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`;
        const response = await axios.post(
          url,
          {
            contents: [
              {
                parts: [
                  {
                    text: 'Transcribe the exact words spoken in this audio note. Accurately capture spoken expenses, amounts, currencies, merchants, items, or financial logs in any language (English, Hindi, Hinglish, etc.). Return ONLY the transcribed plain text without quotation marks or explanations.',
                  },
                  {
                    inlineData: {
                      mimeType,
                      data: audioBuffer.toString('base64'),
                    },
                  },
                ],
              },
            ],
            generationConfig: {
              temperature: 0.0,
            },
          },
          { headers: { 'Content-Type': 'application/json' }, timeout: 12000 },
        );

        const text = response.data.candidates?.[0]?.content?.parts?.[0]?.text;
        const cleaned = this.cleanTranscript(text || '');
        if (cleaned) {
          this.logger.log(
            `Audio successfully transcribed via Gemini 1.5 Flash: "${cleaned}"`,
          );
          return cleaned;
        }
      } catch (err: any) {
        this.logger.warn(
          `Gemini audio transcription fallback failed: ${err?.response?.data?.error?.message || err?.message}`,
        );
      }
    }

    // 3. Fallback to OpenAI Whisper API
    if (openaiKey && openaiKey.startsWith('sk-')) {
      try {
        const formData = new FormData();
        formData.append(
          'file',
          new Blob([new Uint8Array(audioBuffer)], { type: mimeType }),
          filename,
        );
        formData.append('model', 'whisper-1');
        formData.append('response_format', 'json');

        const res = await axios.post(
          'https://api.openai.com/v1/audio/transcriptions',
          formData,
          {
            headers: {
              Authorization: `Bearer ${openaiKey}`,
            },
            timeout: 10000,
          },
        );

        const rawText = (res.data?.text || '').trim();
        const cleaned = this.cleanTranscript(rawText);
        if (cleaned) {
          this.logger.log(
            `Audio successfully transcribed via OpenAI Whisper: "${cleaned}"`,
          );
          return cleaned;
        }
      } catch (err: any) {
        this.logger.warn(
          `OpenAI Whisper fallback failed: ${err?.response?.data?.error?.message || err?.message}`,
        );
      }
    }

    return null;
  }

  public static cleanTranscript(text: string): string {
    if (!text) return '';
    let cleaned = text.trim();
    // Strip surrounding quotes
    cleaned = cleaned.replace(/^["'`]|["'`]$/g, '').trim();

    // If text is purely punctuation, silence indicators, or single characters
    if (/^[\s.,!?;:~`^_*#@|\\/-]+$/.test(cleaned) || /^[♪\s]+$/.test(cleaned)) {
      return '';
    }

    // Filter known Whisper hallucination patterns if short
    for (const pattern of this.HALLUCINATION_PATTERNS) {
      if (pattern.test(cleaned) && cleaned.length < 50) {
        this.logger.warn(
          `Filtered out Whisper hallucination artifact: "${cleaned}"`,
        );
        return '';
      }
    }

    return cleaned;
  }
}
