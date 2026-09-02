import { AudioTranscriptionService } from './audio-transcription.service';

describe('AudioTranscriptionService', () => {
  describe('cleanTranscript', () => {
    it('should strip surrounding quotes and whitespace', () => {
      expect(AudioTranscriptionService.cleanTranscript('  "Chai 20"  ')).toBe(
        'Chai 20',
      );
      expect(AudioTranscriptionService.cleanTranscript("'Lunch 250'")).toBe(
        'Lunch 250',
      );
      expect(AudioTranscriptionService.cleanTranscript('`Petrol 500`')).toBe(
        'Petrol 500',
      );
    });

    it('should filter out silence indicators and punctuation', () => {
      expect(AudioTranscriptionService.cleanTranscript('.')).toBe('');
      expect(AudioTranscriptionService.cleanTranscript('...')).toBe('');
      expect(AudioTranscriptionService.cleanTranscript('♪♪♪')).toBe('');
      expect(AudioTranscriptionService.cleanTranscript('   ')).toBe('');
      expect(AudioTranscriptionService.cleanTranscript('!?.,-')).toBe('');
    });

    it('should filter out known Whisper hallucination artifacts', () => {
      expect(
        AudioTranscriptionService.cleanTranscript('Thank you for watching!'),
      ).toBe('');
      expect(
        AudioTranscriptionService.cleanTranscript('Subtitles by Amara.org'),
      ).toBe('');
      expect(
        AudioTranscriptionService.cleanTranscript(
          'Please subscribe to our channel',
        ),
      ).toBe('');
      expect(AudioTranscriptionService.cleanTranscript('MBC')).toBe('');
    });

    it('should preserve genuine expense transcripts', () => {
      expect(
        AudioTranscriptionService.cleanTranscript('Spent 200 rupees on auto'),
      ).toBe('Spent 200 rupees on auto');
      expect(
        AudioTranscriptionService.cleanTranscript('Chai 20 and samosa 40'),
      ).toBe('Chai 20 and samosa 40');
      expect(
        AudioTranscriptionService.cleanTranscript('Zomato 450 paid via UPI'),
      ).toBe('Zomato 450 paid via UPI');
    });
  });
});
